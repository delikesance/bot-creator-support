import type { Database } from "bun:sqlite";
import { langOf, quotaText } from "./i18n";

export type Status = "open" | "in_progress" | "closed";
export type Source = "discord" | "panel" | "system";
/** À qui est la balle : le support doit répondre, ou on attend le client. */
export type Awaiting = "support" | "customer";
export type Priority = "low" | "normal" | "high" | "urgent";
export type CloseReason = "resolved" | "no_reply" | "duplicate" | "other";

export interface Ticket {
  id: number;
  guildId: string;
  userId: string;
  userName: string;
  channelId: string;
  subject: string;
  description: string;
  /** Langue de l'utilisateur (« fr », « en »…) : celle des messages postés dans son salon. */
  locale: string;
  awaiting: Awaiting;
  status: Status;
  assignee: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  priority: Priority;
  /** Minuscules, [a-z0-9-], 1 à 24 caractères, 8 au plus. */
  tags: string[];
  assigneeId: string | null;
  closeReason: CloseReason | null;
  /** Note du client, de 1 à 5. */
  rating: number | null;
  /** Premier message public du support. */
  firstResponseAt: number | null;
  /** Heure du dernier message client tant que le support doit répondre. */
  waitingSince: number | null;
}

export interface Attachment {
  id: number;
  messageId: number;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  /** Servie par le desk, jamais l'URL du CDN Discord. */
  url: string;
}

/** Pièce jointe à enregistrer ; `file` est le nom du fichier stocké dans ATTACHMENTS_DIR. */
export interface NewAttachment {
  name: string;
  mime: string;
  size: number;
  file: string;
}

export interface TicketMessage {
  id: number;
  ticketId: number;
  authorId: string;
  authorName: string;
  content: string;
  source: Source;
  createdAt: number;
  /** Note interne : réservée au support, jamais envoyée à Discord ni dans la transcription. */
  internal: boolean;
  attachments: Attachment[];
}

const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"];
const CLOSE_REASONS: readonly CloseReason[] = ["resolved", "no_reply", "duplicate", "other"];
const TAG_RE = /^[a-z0-9-]{1,24}$/;
const MAX_TAGS = 8;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;

const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  messageId: r.message_id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  kind: IMAGE_MIME.test(r.mime) || IMAGE_EXT.test(r.name) ? "image" : "file",
  url: `/api/attachments/${r.id}`,
});

export class TicketError extends Error {}

/** Changement notifié aux abonnés (flux temps réel du panel). */
export interface TicketEvent {
  type: "ticket" | "message";
  ticketId: number;
  guildId: string;
}

interface Row {
  id: number;
  guild_id: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  subject: string;
  description: string;
  locale: string;
  awaiting: Awaiting;
  status: Status;
  assignee: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  priority: Priority;
  tags: string;
  assignee_id: string | null;
  close_reason: CloseReason | null;
  rating: number | null;
  first_response_at: number | null;
  waiting_since: number | null;
}

interface MessageRow {
  id: number;
  ticket_id: number;
  author_id: string;
  author_name: string;
  content: string;
  source: Source;
  internal: number;
  created_at: number;
}

interface AttachmentRow {
  id: number;
  message_id: number;
  name: string;
  mime: string;
  size: number;
  file: string;
  created_at: number;
}

const parseTags = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const toTicket = (r: Row): Ticket => ({
  id: r.id,
  guildId: r.guild_id,
  userId: r.user_id,
  userName: r.user_name,
  channelId: r.channel_id,
  subject: r.subject,
  description: r.description,
  locale: r.locale,
  awaiting: r.awaiting,
  status: r.status,
  assignee: r.assignee,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
  priority: r.priority,
  tags: parseTags(r.tags),
  assigneeId: r.assignee_id,
  closeReason: r.close_reason,
  rating: r.rating,
  firstResponseAt: r.first_response_at,
  waitingSince: r.waiting_since,
});

export class TicketService {
  private listeners = new Set<(e: TicketEvent) => void>();

  constructor(private db: Database) {}

  /** S'abonne aux changements ; renvoie la fonction de désabonnement. */
  subscribe(fn: (e: TicketEvent) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  private emit(type: TicketEvent["type"], ticketId: number): void {
    const t = this.get(ticketId);
    if (!t) return;
    for (const fn of [...this.listeners]) {
      try {
        fn({ type, ticketId, guildId: t.guildId });
      } catch (e) {
        console.error("Abonné d'événements en erreur", e);
      }
    }
  }

  create(
    input: { guildId: string; userId: string; userName: string; channelId: string; subject: string; description?: string; locale?: string },
    opts: { maxActivePerUser?: number } = {},
  ): Ticket {
    if (opts.maxActivePerUser !== undefined) {
      const n = this.db
        .query<{ n: number }, [string, string]>(
          "SELECT COUNT(*) n FROM tickets WHERE guild_id = ? AND user_id = ? AND status != 'closed'",
        )
        .get(input.guildId, input.userId)!.n;
      if (n >= opts.maxActivePerUser) {
        throw new TicketError(quotaText(input.locale, n));
      }
    }
    const now = Date.now();
    const r = this.db
      .query<{ id: number }, [string, string, string, string, string, string, string, number, number]>(
        "INSERT INTO tickets (guild_id,user_id,user_name,channel_id,subject,description,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id",
      )
      .get(input.guildId, input.userId, input.userName, input.channelId, input.subject, input.description ?? "", langOf(input.locale), now, now)!;
    this.emit("ticket", r.id);
    return this.require(r.id);
  }

  get(id: number): Ticket | null {
    const r = this.db.query<Row, [number]>("SELECT * FROM tickets WHERE id = ?").get(id);
    return r ? toTicket(r) : null;
  }

  getByChannel(channelId: string): Ticket | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM tickets WHERE channel_id = ?").get(channelId);
    return r ? toTicket(r) : null;
  }

  list(status?: Status, guildId?: string): Ticket[] {
    const where: string[] = [];
    const args: string[] = [];
    if (status) (where.push("status = ?"), args.push(status));
    if (guildId !== undefined) (where.push("guild_id = ?"), args.push(guildId));
    const sql = `SELECT * FROM tickets ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`;
    return this.db.query<Row, string[]>(sql).all(...args).map(toTicket);
  }

  /** Rattache à un serveur les tickets créés avant le support multi-serveurs. */
  adoptOrphans(guildId: string): void {
    this.db.query("UPDATE tickets SET guild_id = ? WHERE guild_id = ''").run(guildId);
  }

  stats(guildId?: string): Record<Status, number> {
    const out: Record<Status, number> = { open: 0, in_progress: 0, closed: 0 };
    const rows =
      guildId === undefined
        ? this.db.query<{ status: Status; n: number }, []>("SELECT status, COUNT(*) n FROM tickets GROUP BY status").all()
        : this.db
            .query<{ status: Status; n: number }, [string]>(
              "SELECT status, COUNT(*) n FROM tickets WHERE guild_id = ? GROUP BY status",
            )
            .all(guildId);
    for (const r of rows) {
      out[r.status] = r.n;
    }
    return out;
  }

  /** Tickets encore actifs selon qui doit répondre. */
  awaitingStats(guildId?: string): Record<Awaiting, number> {
    const out: Record<Awaiting, number> = { support: 0, customer: 0 };
    const rows =
      guildId === undefined
        ? this.db
            .query<{ awaiting: Awaiting; n: number }, []>(
              "SELECT awaiting, COUNT(*) n FROM tickets WHERE status != 'closed' GROUP BY awaiting",
            )
            .all()
        : this.db
            .query<{ awaiting: Awaiting; n: number }, [string]>(
              "SELECT awaiting, COUNT(*) n FROM tickets WHERE status != 'closed' AND guild_id = ? GROUP BY awaiting",
            )
            .all(guildId);
    for (const r of rows) out[r.awaiting] = r.n;
    return out;
  }

  claim(id: number, by: { id: string; name: string }): Ticket {
    const t = this.require(id);
    if (t.status === "closed") throw new TicketError("Ce ticket est fermé.");
    return this.update(id, "in_progress", by.name, null, by.id);
  }

  close(id: number, opts: { reason?: CloseReason } = {}): Ticket {
    const t = this.require(id);
    if (t.status === "closed") throw new TicketError("Ce ticket est déjà fermé.");
    if (opts.reason !== undefined && !CLOSE_REASONS.includes(opts.reason)) throw new TicketError("Raison de fermeture invalide.");
    return this.update(id, "closed", t.assignee, Date.now(), t.assigneeId, opts.reason ?? null);
  }

  reopen(id: number): Ticket {
    const t = this.require(id);
    if (t.status !== "closed") throw new TicketError("Ce ticket n'est pas fermé.");
    return this.update(id, "open", null, null, null);
  }

  setPriority(id: number, priority: Priority): Ticket {
    this.require(id);
    if (!PRIORITIES.includes(priority)) throw new TicketError("Priorité invalide.");
    return this.patch(id, "priority = ?", priority);
  }

  /** Remplace l'ensemble des étiquettes : minuscules, sans doublon, [a-z0-9-] de 1 à 24 caractères, 8 au plus. */
  setTags(id: number, tags: string[]): Ticket {
    this.require(id);
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()))];
    if (clean.length > MAX_TAGS) throw new TicketError(`Au plus ${MAX_TAGS} étiquettes.`);
    const bad = clean.find((t) => !TAG_RE.test(t));
    if (bad !== undefined) throw new TicketError(`Étiquette invalide : « ${bad} ».`);
    return this.patch(id, "tags = ?", JSON.stringify(clean));
  }

  /** Attribue le ticket (nom affiché + identifiant s'il est connu) ou le libère avec null ; le statut ne change pas. */
  assign(id: number, name: string | null, userId: string | null): Ticket {
    this.require(id);
    this.db.query("UPDATE tickets SET assignee = ?, assignee_id = ? WHERE id = ?").run(name, name === null ? null : userId, id);
    this.emit("ticket", id);
    return this.require(id);
  }

  /** Note du client : 1 à 5, ticket fermé, une seule fois. */
  setRating(id: number, rating: number): Ticket {
    const t = this.require(id);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new TicketError("La note doit être comprise entre 1 et 5.");
    if (t.status !== "closed") throw new TicketError("Le ticket n'est pas fermé.");
    if (t.rating !== null) throw new TicketError("Ce ticket a déjà été noté.");
    return this.patch(id, "rating = ?", rating);
  }

  addMessage(
    ticketId: number,
    m: {
      authorId: string;
      authorName: string;
      content: string;
      source: Source;
      internal?: boolean;
      attachments?: NewAttachment[];
    },
  ): TicketMessage {
    const now = Date.now();
    const internal = m.internal === true;
    const messageId = this.db.transaction(() => {
      const { id } = this.db
        .query<{ id: number }, [number, string, string, string, string, number, number]>(
          "INSERT INTO messages (ticket_id,author_id,author_name,content,source,internal,created_at) VALUES (?,?,?,?,?,?,?) RETURNING id",
        )
        .get(ticketId, m.authorId, m.authorName, m.content, m.source, internal ? 1 : 0, now)!;
      for (const a of m.attachments ?? []) {
        this.db
          .query("INSERT INTO attachments (message_id,name,mime,size,file,created_at) VALUES (?,?,?,?,?,?)")
          .run(id, a.name, a.mime, a.size, a.file, now);
      }
      // Une note interne ou système ne change rien à l'état du ticket (ni balle, ni tri, ni délais).
      const ticket = this.get(ticketId);
      if (!internal && m.source !== "system" && ticket) {
        const fromCustomer = m.authorId === ticket.userId;
        this.db
          .query(
            `UPDATE tickets SET updated_at = MAX(updated_at + 1, ?), awaiting = ?,
             waiting_since = ?, first_response_at = COALESCE(first_response_at, ?) WHERE id = ?`,
          )
          .run(now, fromCustomer ? "support" : "customer", fromCustomer ? now : null, fromCustomer ? null : now, ticketId);
      } else if (!internal && m.source === "system") {
        // Les notes système remontent le ticket dans la liste, comme avant.
        this.db.query("UPDATE tickets SET updated_at = MAX(updated_at + 1, ?) WHERE id = ?").run(now, ticketId);
      }
      return id;
    })();
    this.emit("message", ticketId);
    return this.messageById(messageId);
  }

  messages(ticketId: number): TicketMessage[] {
    const rows = this.db.query<MessageRow, [number]>("SELECT * FROM messages WHERE ticket_id = ? ORDER BY id ASC").all(ticketId);
    const atts = this.db
      .query<AttachmentRow, [number]>(
        "SELECT a.* FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.ticket_id = ? ORDER BY a.id ASC",
      )
      .all(ticketId);
    return this.withAttachments(rows, atts);
  }

  /** Pièce jointe avec son fichier stocké et le serveur du ticket (contrôle d'accès de la route de téléchargement). */
  attachment(id: number): (Attachment & { file: string; guildId: string }) | null {
    const r = this.db
      .query<AttachmentRow & { guild_id: string }, [number]>(
        `SELECT a.*, t.guild_id FROM attachments a
         JOIN messages m ON m.id = a.message_id JOIN tickets t ON t.id = m.ticket_id WHERE a.id = ?`,
      )
      .get(id);
    return r ? { ...toAttachment(r), file: r.file, guildId: r.guild_id } : null;
  }

  private messageById(id: number): TicketMessage {
    const row = this.db.query<MessageRow, [number]>("SELECT * FROM messages WHERE id = ?").get(id)!;
    const atts = this.db.query<AttachmentRow, [number]>("SELECT * FROM attachments WHERE message_id = ? ORDER BY id ASC").all(id);
    return this.withAttachments([row], atts)[0]!;
  }

  private withAttachments(rows: MessageRow[], atts: AttachmentRow[]): TicketMessage[] {
    const by = new Map<number, Attachment[]>();
    for (const a of atts) {
      const l = by.get(a.message_id) ?? [];
      l.push(toAttachment(a));
      by.set(a.message_id, l);
    }
    return rows.map((r) => ({
      id: r.id,
      ticketId: r.ticket_id,
      authorId: r.author_id,
      authorName: r.author_name,
      content: r.content,
      source: r.source,
      createdAt: r.created_at,
      internal: r.internal === 1,
      attachments: by.get(r.id) ?? [],
    }));
  }

  /** Met à jour un champ sans toucher à l'ordre de la liste, puis notifie. */
  private patch(id: number, set: string, value: string | number): Ticket {
    this.db.query(`UPDATE tickets SET ${set} WHERE id = ?`).run(value, id);
    this.emit("ticket", id);
    return this.require(id);
  }

  private require(id: number): Ticket {
    const t = this.get(id);
    if (!t) throw new TicketError(`Ticket #${id} introuvable.`);
    return t;
  }

  private update(
    id: number,
    status: Status,
    assignee: string | null,
    closedAt: number | null,
    assigneeId: string | null,
    closeReason: CloseReason | null = null,
  ): Ticket {
    // Fermer (ou rouvrir) arrête l'attente ; rouvrir efface aussi raison et note de la fermeture précédente.
    this.db
      .query(
        `UPDATE tickets SET status = ?, assignee = ?, assignee_id = ?, closed_at = ?, close_reason = ?,
         rating = CASE WHEN ? = 'open' THEN NULL ELSE rating END,
         waiting_since = CASE WHEN ? = 'closed' THEN NULL ELSE waiting_since END, updated_at = ? WHERE id = ?`,
      )
      .run(status, assignee, assigneeId, closedAt, closeReason, status, status, Date.now(), id);
    this.emit("ticket", id);
    return this.require(id);
  }
}
