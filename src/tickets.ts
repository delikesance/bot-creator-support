import type { Database } from "bun:sqlite";

export type Status = "open" | "in_progress" | "closed";
export type Source = "discord" | "panel" | "system";
/** À qui est la balle : le support doit répondre, ou on attend le client. */
export type Awaiting = "support" | "customer";

export interface Ticket {
  id: number;
  guildId: string;
  userId: string;
  userName: string;
  channelId: string;
  subject: string;
  description: string;
  awaiting: Awaiting;
  status: Status;
  assignee: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

export interface TicketMessage {
  id: number;
  ticketId: number;
  authorId: string;
  authorName: string;
  content: string;
  source: Source;
  createdAt: number;
}

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
  awaiting: Awaiting;
  status: Status;
  assignee: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

const toTicket = (r: Row): Ticket => ({
  id: r.id,
  guildId: r.guild_id,
  userId: r.user_id,
  userName: r.user_name,
  channelId: r.channel_id,
  subject: r.subject,
  description: r.description,
  awaiting: r.awaiting,
  status: r.status,
  assignee: r.assignee,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
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
    input: { guildId: string; userId: string; userName: string; channelId: string; subject: string; description?: string },
    opts: { maxActivePerUser?: number } = {},
  ): Ticket {
    if (opts.maxActivePerUser !== undefined) {
      const n = this.db
        .query<{ n: number }, [string, string]>(
          "SELECT COUNT(*) n FROM tickets WHERE guild_id = ? AND user_id = ? AND status != 'closed'",
        )
        .get(input.guildId, input.userId)!.n;
      if (n >= opts.maxActivePerUser) {
        throw new TicketError(`Tu as déjà ${n} ticket(s) en cours. Ferme-en un avant d'en ouvrir un nouveau.`);
      }
    }
    const now = Date.now();
    const r = this.db
      .query<{ id: number }, [string, string, string, string, string, string, number, number]>(
        "INSERT INTO tickets (guild_id,user_id,user_name,channel_id,subject,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
      )
      .get(input.guildId, input.userId, input.userName, input.channelId, input.subject, input.description ?? "", now, now)!;
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
    return this.update(id, "in_progress", by.name, null);
  }

  close(id: number): Ticket {
    const t = this.require(id);
    if (t.status === "closed") throw new TicketError("Ce ticket est déjà fermé.");
    return this.update(id, "closed", t.assignee, Date.now());
  }

  reopen(id: number): Ticket {
    const t = this.require(id);
    if (t.status !== "closed") throw new TicketError("Ce ticket n'est pas fermé.");
    return this.update(id, "open", null, null);
  }

  addMessage(
    ticketId: number,
    m: { authorId: string; authorName: string; content: string; source: Source },
  ): void {
    const now = Date.now();
    this.db
      .query("INSERT INTO messages (ticket_id,author_id,author_name,content,source,created_at) VALUES (?,?,?,?,?,?)")
      .run(ticketId, m.authorId, m.authorName, m.content, m.source, now);
    // Un message fait remonter le ticket dans la liste ; celui qui parle passe la balle à l'autre.
    // Les notes système (prise en charge, fermeture…) ne changent pas l'état.
    const ticket = this.get(ticketId);
    const awaiting: Awaiting | null =
      m.source === "system" || !ticket ? null : m.authorId === ticket.userId ? "support" : "customer";
    this.db
      .query("UPDATE tickets SET updated_at = MAX(updated_at + 1, ?), awaiting = COALESCE(?, awaiting) WHERE id = ?")
      .run(now, awaiting, ticketId);
    this.emit("message", ticketId);
  }

  messages(ticketId: number): TicketMessage[] {
    return this.db
      .query<
        {
          id: number;
          ticket_id: number;
          author_id: string;
          author_name: string;
          content: string;
          source: Source;
          created_at: number;
        },
        [number]
      >("SELECT * FROM messages WHERE ticket_id = ? ORDER BY id ASC")
      .all(ticketId)
      .map((r) => ({
        id: r.id,
        ticketId: r.ticket_id,
        authorId: r.author_id,
        authorName: r.author_name,
        content: r.content,
        source: r.source,
        createdAt: r.created_at,
      }));
  }

  private require(id: number): Ticket {
    const t = this.get(id);
    if (!t) throw new TicketError(`Ticket #${id} introuvable.`);
    return t;
  }

  private update(id: number, status: Status, assignee: string | null, closedAt: number | null): Ticket {
    this.db
      .query("UPDATE tickets SET status = ?, assignee = ?, closed_at = ?, updated_at = ? WHERE id = ?")
      .run(status, assignee, closedAt, Date.now(), id);
    this.emit("ticket", id);
    return this.require(id);
  }
}
