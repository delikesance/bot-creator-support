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
    description TEXT NOT NULL DEFAULT '',
    awaiting TEXT NOT NULL DEFAULT 'support',
    locale TEXT NOT NULL DEFAULT 'en',
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
  if (!cols.some((c) => c.name === "description")) db.run("ALTER TABLE tickets ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if (!cols.some((c) => c.name === "awaiting")) db.run("ALTER TABLE tickets ADD COLUMN awaiting TEXT NOT NULL DEFAULT 'support'");
  if (!cols.some((c) => c.name === "locale")) db.run("ALTER TABLE tickets ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
  // Refonte du desk : champs ajoutés au ticket (migrations additives).
  const added: [string, string][] = [
    ["priority", "TEXT NOT NULL DEFAULT 'normal'"],
    ["tags", "TEXT NOT NULL DEFAULT '[]'"],
    ["assignee_id", "TEXT"],
    ["close_reason", "TEXT"],
    ["rating", "INTEGER"],
    ["first_response_at", "INTEGER"],
    ["waiting_since", "INTEGER"],
    ["channel_deleted_at", "INTEGER"],
  ];
  for (const [name, def] of added) {
    if (!cols.some((c) => c.name === name)) db.run(`ALTER TABLE tickets ADD COLUMN ${name} ${def}`);
  }
  const msgCols = db.query<{ name: string }, []>("PRAGMA table_info(messages)").all();
  if (!msgCols.some((c) => c.name === "internal")) db.run("ALTER TABLE messages ADD COLUMN internal INTEGER NOT NULL DEFAULT 0");
  db.run(`CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    file TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id)");
  db.run(`CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    UNIQUE (guild_id, name)
  )`);
  // Journal d'audit ; ticket_id est nul pour les actions hors ticket (réponses enregistrées).
  db.run(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit(ticket_id)");
  // Réglages par serveur (aujourd'hui : catégorie où /setup range les salons de ticket).
  db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    category_id TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id)");
  return db;
}
