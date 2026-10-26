import { TicketError, TicketService, type Ticket } from "./tickets";

/** Pont vers Discord : tout ce que le métier doit pouvoir faire côté serveur. */
export interface Gateway {
  createTicketChannel(o: { guildId: string; userId: string; userName: string }): Promise<string>;
  send(channelId: string, text: string, opts?: { controls?: "active" | "closed" }): Promise<void>;
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
  }): Promise<Ticket> {
    const subject = input.subject.trim().slice(0, MAX_SUBJECT);
    const description = (input.description ?? "").trim().slice(0, MAX_DESCRIPTION);
    if (!subject) throw new TicketError("Le sujet ne peut pas être vide.");
    this.assertQuota(input.guildId, input.userId);

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
    await this.gw.send(
      channelId,
      `🎫 <@${input.userId}> Ton ticket #${ticket.id} a bien été reçu : un membre de l'équipe va bientôt le prendre en charge.`,
    );
    return ticket;
  }

  async claim(id: number, by: Actor): Promise<Ticket> {
    const t = this.tickets.claim(id, by);
    await this.notify(t, `🟡 Ticket pris en charge par **${by.name}**.`, undefined, "🟡 Ton ticket est pris en charge, l'équipe te répond ici.");
    return t;
  }

  async release(id: number, by: string): Promise<Ticket> {
    const t = this.tickets.release(id);
    await this.notify(t, `🟢 Ticket remis en file d'attente par **${by}**.`, undefined, null);
    return t;
  }

  async close(id: number, by: string): Promise<Ticket> {
    const t = this.tickets.close(id);
    await this.gw.setUserLocked(t.channelId, t.userId, true).catch(() => {});
    await this.notify(t, `🔴 Ticket fermé par **${by}**.`, undefined, "🔴 Ton ticket est fermé. Merci de nous avoir contactés !");
    return t;
  }

  async reopen(id: number, by: string): Promise<Ticket> {
    const t = this.tickets.reopen(id);
    await this.gw.setUserLocked(t.channelId, t.userId, false).catch(() => {});
    await this.notify(t, `🟢 Ticket rouvert par **${by}**.`, undefined, "🟢 Ton ticket a été rouvert.");
    return t;
  }

  async deleteChannel(id: number): Promise<void> {
    const t = this.tickets.get(id);
    if (!t) throw new TicketError(`Ticket #${id} introuvable.`);
    if (t.status !== "closed") throw new TicketError("Ferme le ticket avant de supprimer le salon.");
    await this.gw.deleteChannel(t.channelId);
  }

  /** Réponse envoyée depuis le panel : postée par le bot dans le salon. */
  async reply(id: number, content: string, authorName: string): Promise<void> {
    const t = this.tickets.get(id);
    if (!t) throw new TicketError(`Ticket #${id} introuvable.`);
    if (t.status === "closed") throw new TicketError("Ce ticket est fermé.");
    const text = content.trim();
    if (!text) throw new TicketError("Le message est vide.");
    // Côté Discord, c'est simplement le bot support qui écrit : pas de nom d'admin.
    await this.gw.send(t.channelId, text);
    this.tickets.addMessage(id, { authorId: "panel", authorName, content: text, source: "panel" });
  }

  /** Message posté sur Discord par un humain dans un salon : historisé s'il s'agit d'un ticket. */
  recordDiscordMessage(channelId: string, author: Actor, content: string): void {
    const t = this.tickets.getByChannel(channelId);
    if (!t || !content.trim()) return;
    this.tickets.addMessage(t.id, { authorId: author.id, authorName: author.name, content, source: "discord" });
  }

  private assertQuota(guildId: string, userId: string) {
    const max = this.opts.maxActivePerUser;
    if (max === undefined) return;
    const active = this.tickets.list(undefined, guildId).filter((t) => t.userId === userId && t.status !== "closed").length;
    if (active >= max) {
      throw new TicketError(`Tu as déjà ${active} ticket(s) en cours. Ferme-en un avant d'en ouvrir un nouveau.`);
    }
  }

  /** `shown` : texte visible sur Discord (par défaut celui de l'historique ; null = rien n'est envoyé). */
  private async notify(t: Ticket, text: string, controls?: "active" | "closed", shown: string | null = text) {
    this.tickets.addMessage(t.id, { authorId: "system", authorName: "Système", content: text, source: "system" });
    if (shown === null) return;
    await this.gw.send(t.channelId, shown, controls ? { controls } : undefined).catch(() => {});
  }
}
