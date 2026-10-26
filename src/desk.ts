import { TicketError, TicketService, type NewAttachment, type Ticket, type TicketMessage } from "./tickets";
import { pack, quotaText, welcomeText } from "./i18n";
import { downloadFile } from "./bot/download";
import { MAX_FILE_BYTES, storeFile, validateBatch, validateFile } from "./storage";

/** Fichier à poster dans un salon. */
export interface OutFile {
  name: string;
  data: Uint8Array;
}

/** Pièce jointe d'un message Discord entrant (l'URL du CDN expire au bout d'environ 24 h). */
export interface IncomingFile {
  name: string;
  size: number;
  url: string;
}

/** Pont vers Discord : tout ce que le métier doit pouvoir faire côté serveur. */
export interface Gateway {
  createTicketChannel(o: { guildId: string; userId: string; userName: string }): Promise<string>;
  send(
    channelId: string,
    text: string,
    opts?: { controls?: "active" | "closed"; as?: { name: string; avatarUrl?: string }; files?: OutFile[] },
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
/** Limite d'un message Discord (webhook compris). */
const MAX_MESSAGE = 2000;

/**
 * Politique des liens dans une réponse du panel.
 * - Une URL nue reste telle quelle : Discord fait lui-même l'aperçu.
 * - `[texte](https://…)` est réécrit en « texte » puis l'URL nue seule sur sa ligne. Le Markdown masqué n'est
 *   pas fiable pour tous les envois (webhook ou bot de repli) et cacherait la destination au client ; l'URL sur
 *   sa ligne est rendue et dépliée par Discord. Si le texte est déjà l'URL, on garde l'URL seule.
 * - Seuls http et https sont réécrits : `[x](javascript:…)` reste du texte inerte.
 * Ce qui est historisé est ce qui part sur Discord, pour que le panel et le salon montrent la même chose.
 */
export function formatLinks(text: string): string {
  return text
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) =>
      label.trim() === url ? url : `${label.trim()}\n${url}\n`,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class SupportDesk {
  constructor(
    public readonly tickets: TicketService,
    private gw: Gateway,
    private opts: {
      maxActivePerUser?: number;
      /** Dossier de stockage des pièces jointes ; sans lui, les fichiers sont refusés. */
      attachmentsDir?: string;
      /** Téléchargement des pièces jointes Discord (injectable pour les tests). */
      download?: (url: string) => Promise<Uint8Array>;
    } = {},
  ) {}

  get attachmentsDir(): string | undefined {
    return this.opts.attachmentsDir;
  }

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
  async reply(id: number, content: string, authorName: string, avatarUrl?: string, files: OutFile[] = []): Promise<TicketMessage> {
    const t = this.tickets.get(id);
    if (!t) throw new TicketError(`Ticket #${id} introuvable.`);
    if (t.status === "closed") throw new TicketError("Ce ticket est fermé.");
    const text = formatLinks(content);
    if (!text && !files.length) throw new TicketError("Le message est vide.");
    if (text.length > MAX_MESSAGE) throw new TicketError(`Le message dépasse ${MAX_MESSAGE} caractères.`);
    // Validation avant tout envoi : un fichier refusé n'envoie rien (ni texte ni autres fichiers).
    const valid = validateBatch(files);
    const dir = this.opts.attachmentsDir;
    if (files.length && !dir) throw new TicketError("Le stockage des pièces jointes n'est pas configuré.");
    // Côté Discord, le message apparaît sous le pseudo et l'avatar de l'admin (webhook du salon).
    await this.gw.send(t.channelId, text, { as: { name: authorName, avatarUrl }, ...(files.length ? { files } : {}) });
    const stored: NewAttachment[] = [];
    for (const [i, v] of valid.entries()) {
      stored.push({ name: v.name, mime: v.mime, size: v.size, file: await storeFile(dir!, files[i]!.data, v.ext) });
    }
    this.autoClaim(t, authorName);
    return this.tickets.addMessage(id, { authorId: "panel", authorName, content: text, source: "panel", attachments: stored });
  }

  /** Les messages avec pièces jointes (téléchargement asynchrone) restent dans l'ordre d'arrivée, salon par salon. */
  private pending = new Map<string, Promise<void>>();

  /**
   * Message posté sur Discord par un humain dans un salon : historisé s'il s'agit d'un ticket.
   * Sans pièce jointe et sans file d'attente, l'enregistrement est synchrone.
   */
  recordDiscordMessage(channelId: string, author: Actor, content: string, files: IncomingFile[] = []): Promise<void> {
    const prev = this.pending.get(channelId);
    if (!prev && !files.length) {
      this.recordNow(channelId, author, content, [], []);
      return Promise.resolve();
    }
    const run: Promise<void> = (prev ?? Promise.resolve())
      .then(async () => {
        const { stored, notes } = await this.fetchIncoming(files);
        this.recordNow(channelId, author, content, stored, notes);
      })
      .catch((e) => console.error("Enregistrement du message Discord :", e))
      .finally(() => {
        if (this.pending.get(channelId) === run) this.pending.delete(channelId);
      });
    this.pending.set(channelId, run);
    return run;
  }

  private recordNow(channelId: string, author: Actor, content: string, attachments: NewAttachment[], notes: string[]) {
    const t = this.tickets.getByChannel(channelId);
    if (!t) return;
    if (content.trim() || attachments.length) {
      if (author.id !== t.userId) this.autoClaim(t, author.name);
      this.tickets.addMessage(t.id, { authorId: author.id, authorName: author.name, content: content.trim(), source: "discord", attachments });
    }
    for (const note of notes) {
      this.tickets.addMessage(t.id, { authorId: "system", authorName: "Système", content: note, source: "system" });
    }
  }

  /** Télécharge et stocke les pièces jointes ; un échec saute le fichier et produit une note système (avec le lien CDN, valable ~24 h). */
  private async fetchIncoming(files: IncomingFile[]): Promise<{ stored: NewAttachment[]; notes: string[] }> {
    const stored: NewAttachment[] = [];
    const notes: string[] = [];
    const dir = this.opts.attachmentsDir;
    const download = this.opts.download ?? ((url: string) => downloadFile(url));
    for (const f of files) {
      try {
        if (!dir) throw new Error("stockage non configuré");
        if (f.size > MAX_FILE_BYTES) throw new Error("plus de 25 Mo");
        const data = await download(f.url);
        const v = validateFile({ name: f.name, data });
        stored.push({ name: v.name, mime: v.mime, size: v.size, file: await storeFile(dir, data, v.ext) });
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        notes.push(`⚠️ Pièce jointe « ${f.name} » non enregistrée (${why}). Lien Discord, valable environ 24 h : ${f.url}`);
      }
    }
    return { stored, notes };
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
