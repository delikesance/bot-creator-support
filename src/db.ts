import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    guild_id TEXT NOT NULL DEFAULT '',
    channel_id TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
    assignee TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('discord','panel','system')),
    created_at INTEGER NOT NULL
  )`);
  // Migration des bases créées avant le support multi-serveurs.
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(tickets)").all();
  if (!cols.some((c) => c.name === "guild_id")) db.run("ALTER TABLE tickets ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''");
  db.run("CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id)");
  return db;
}
