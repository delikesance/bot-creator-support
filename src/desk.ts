import { TicketError, TicketService, type Ticket } from "./tickets";
import { pack, quotaText, welcomeText } from "./i18n";

/** Pont vers Discord : tout ce que le métier doit pouvoir faire côté serveur. */
export interface Gateway {
  createTicketChannel(o: { guildId: string; userId: string; userName: string }): Promise<string>;
  send(
    channelId: string,
    text: string,
    opts?: { controls?: "active" | "closed"; as?: { name: string; avatarUrl?: string } },
  ): Promise<void>;
  setUserLocked(channelId: string, userId: string, locked: boolean): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
}

export interface Actor {
  id: string;
  name: string;
}

const MAX_SUBJECT = 100;
const MAX_DESCRIPTION = 1000;

export class SupportDesk {
  constructor(
    public readonly tickets: TicketService,
    private gw: Gateway,
    private opts: { maxActivePerUser?: number } = {},
  ) {}

  async open(input: {
    guildId: string;
    userId: string;
    userName: string;
    subject: string;
    description?: string;
    /** Locale Discord de l'utilisateur (« fr », « en-US »…) : langue du message d'accueil. */
    locale?: string;
  }): Promise<Ticket> {
    const subject = input.subject.trim().slice(0, MAX_SUBJECT);
    const description = (input.description ?? "").trim().slice(0, MAX_DESCRIPTION);
    if (!subject) throw new TicketError(pack(input.locale).emptySubject);
    this.assertQuota(input.guildId, input.userId, input.locale);

    const channelId = await this.gw.createTicketChannel(input);
    let ticket: Ticket;
    try {
      ticket = this.tickets.create({ ...input, subject, description, channelId }, this.opts);
    } catch (e) {
      await this.gw.deleteChannel(channelId).catch(() => {});
      throw e;
    }
    this.tickets.addMessage(ticket.id, { authorId: input.userId, authorName: input.userName, content: subject, source: "system" });
    if (description) {
      this.tickets.addMessage(ticket.id, { authorId: input.userId, authorName: input.userName, content: description, source: "discord" });
    }
    await this.gw.send(channelId, welcomeText(input.locale, ticket.id, input.userId));
    return ticket;
  }

  async close(id: number, by: string): Promise<Ticket> {
    const t = this.tickets.close(id);
    await this.gw.setUserLocked(t.channelId, t.userId, true).catch(() => {});
    await this.notify(t, `🔴 Ticket fermé par **${by}**.`, undefined, pack(t.locale).noticeClosed);
    return t;
  }

  async reopen(id: number, by: string): Promise<Ticket> {
    const t = this.tickets.reopen(id);
    await this.gw.setUserLocked(t.channelId, t.userId, false).catch(() => {});
    await this.notify(t, `🟢 Ticket rouvert par **${by}**.`, undefined, pack(t.locale).noticeReopened);
    return t;
  }

  async deleteChannel(id: number): Promise<void> {
    const t = this.tickets.get(id);
    if (!t) throw new TicketError(`Ticket #${id} introuvable.`);
    if (t.status !== "closed") throw new TicketError("Ferme le ticket avant de supprimer le salon.");
    await this.gw.deleteChannel(t.channelId);
  }

  /** Réponse envoyée depuis le panel : postée par le bot dans le salon. */
  async reply(id: number, content: string, authorName: string, avatarUrl?: string): Promise<void> {
    const t = this.tickets.get(id);
    if (!t) throw new TicketError(`Ticket #${id} introuvable.`);
    if (t.status === "closed") throw new TicketError("Ce ticket est fermé.");
    const text = content.trim();
    if (!text) throw new TicketError("Le message est vide.");
    // Côté Discord, le message apparaît sous le pseudo et l'avatar de l'admin (webhook du salon).
    await this.gw.send(t.channelId, text, { as: { name: authorName, avatarUrl } });
    this.autoClaim(t, authorName);
    this.tickets.addMessage(id, { authorId: "panel", authorName, content: text, source: "panel" });
  }

  /** Message posté sur Discord par un humain dans un salon : historisé s'il s'agit d'un ticket. */
  recordDiscordMessage(channelId: string, author: Actor, content: string): void {
    const t = this.tickets.getByChannel(channelId);
    if (!t || !content.trim()) return;
    if (author.id !== t.userId) this.autoClaim(t, author.name);
    this.tickets.addMessage(t.id, { authorId: author.id, authorName: author.name, content, source: "discord" });
  }

  /** Premier membre du support qui répond : le ticket passe « en cours » à son nom, sans rien écrire sur Discord. */
  private autoClaim(t: Ticket, by: string) {
    const current = this.tickets.get(t.id);
    if (current?.status !== "open") return;
    this.tickets.claim(t.id, { id: "support", name: by });
    this.tickets.addMessage(t.id, { authorId: "system", authorName: "Système", content: `🟡 Pris en charge par **${by}**.`, source: "system" });
  }

  private assertQuota(guildId: string, userId: string, locale?: string) {
    const max = this.opts.maxActivePerUser;
    if (max === undefined) return;
    const active = this.tickets.list(undefined, guildId).filter((t) => t.userId === userId && t.status !== "closed").length;
    if (active >= max) {
      throw new TicketError(quotaText(locale, active));
    }
  }

  /** `shown` : texte visible sur Discord (par défaut celui de l'historique ; null = rien n'est envoyé). */
  private async notify(t: Ticket, text: string, controls?: "active" | "closed", shown: string | null = text) {
    this.tickets.addMessage(t.id, { authorId: "system", authorName: "Système", content: text, source: "system" });
    if (shown === null) return;
    await this.gw.send(t.channelId, shown, controls ? { controls } : undefined).catch(() => {});
  }
}
