import type { Database } from "bun:sqlite";

export type Status = "open" | "in_progress" | "closed";
export type Source = "discord" | "panel" | "system";

export interface Ticket {
  id: number;
  userId: string;
  userName: string;
  channelId: string;
  subject: string;
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

interface Row {
  id: number;
  user_id: string;
  user_name: string;
  channel_id: string;
  subject: string;
  status: Status;
  assignee: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

const toTicket = (r: Row): Ticket => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  channelId: r.channel_id,
  subject: r.subject,
  status: r.status,
  assignee: r.assignee,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
});

export class TicketService {
  constructor(private db: Database) {}

  create(
    input: { userId: string; userName: string; channelId: string; subject: string },
    opts: { maxActivePerUser?: number } = {},
  ): Ticket {
    if (opts.maxActivePerUser !== undefined) {
      const n = this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) n FROM tickets WHERE user_id = ? AND status != 'closed'")
        .get(input.userId)!.n;
      if (n >= opts.maxActivePerUser) {
        throw new TicketError(`Tu as déjà ${n} ticket(s) en cours. Ferme-en un avant d'en ouvrir un nouveau.`);
      }
    }
    const now = Date.now();
    const r = this.db
      .query<{ id: number }, [string, string, string, string, number, number]>(
        "INSERT INTO tickets (user_id,user_name,channel_id,subject,created_at,updated_at) VALUES (?,?,?,?,?,?) RETURNING id",
      )
      .get(input.userId, input.userName, input.channelId, input.subject, now, now)!;
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

  list(status?: Status): Ticket[] {
    const rows = status
      ? this.db.query<Row, [string]>("SELECT * FROM tickets WHERE status = ? ORDER BY id DESC").all(status)
      : this.db.query<Row, []>("SELECT * FROM tickets ORDER BY id DESC").all();
    return rows.map(toTicket);
  }

  stats(): Record<Status, number> {
    const out: Record<Status, number> = { open: 0, in_progress: 0, closed: 0 };
    for (const r of this.db
      .query<{ status: Status; n: number }, []>("SELECT status, COUNT(*) n FROM tickets GROUP BY status")
      .all()) {
      out[r.status] = r.n;
    }
    return out;
  }

  claim(id: number, by: { id: string; name: string }): Ticket {
    const t = this.require(id);
    if (t.status === "closed") throw new TicketError("Ce ticket est fermé.");
    return this.update(id, "in_progress", by.name, null);
  }

  release(id: number): Ticket {
    const t = this.require(id);
    if (t.status !== "in_progress") throw new TicketError("Ce ticket n'est pas en cours.");
    return this.update(id, "open", null, null);
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
    this.db
      .query("INSERT INTO messages (ticket_id,author_id,author_name,content,source,created_at) VALUES (?,?,?,?,?,?)")
      .run(ticketId, m.authorId, m.authorName, m.content, m.source, Date.now());
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
    return this.require(id);
  }
}
