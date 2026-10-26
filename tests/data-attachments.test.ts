import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService, TicketError, type TicketEvent } from "../src/tickets";

let db: Database;
let svc: TicketService;
const base = { userId: "u1", guildId: "g1", userName: "alice", channelId: "c1", subject: "Aide" };
const staff = { authorId: "a1", authorName: "admin", source: "panel" as const };
const customer = { authorId: "u1", authorName: "alice", source: "discord" as const };

beforeEach(() => {
  db = openDb(":memory:");
  svc = new TicketService(db);
});

describe("pièces jointes", () => {
  test("addMessage renvoie le message créé avec ses valeurs par défaut", () => {
    const t = svc.create(base);
    const m = svc.addMessage(t.id, { ...customer, content: "salut" });
    expect(m.id).toBeGreaterThan(0);
    expect(m.content).toBe("salut");
    expect(m.internal).toBe(false);
    expect(m.attachments).toEqual([]);
  });

  test("les pièces jointes sont stockées et typées image ou fichier", () => {
    const t = svc.create(base);
    const m = svc.addMessage(t.id, {
      ...customer,
      content: "voir",
      attachments: [
        { name: "a.png", mime: "image/png", size: 10, file: "f1" },
        { name: "b.JPEG", mime: "application/octet-stream", size: 20, file: "f2" },
        { name: "c.pdf", mime: "application/pdf", size: 30, file: "f3" },
        { name: "d.log", mime: "text/plain", size: 40, file: "f4" },
      ],
    });
    expect(m.attachments.map((a) => a.kind)).toEqual(["image", "image", "file", "file"]);
    const a = m.attachments[0]!;
    expect(a.messageId).toBe(m.id);
    expect(a.url).toBe(`/api/attachments/${a.id}`);
    expect(a.size).toBe(10);
    expect("file" in a).toBe(false);
  });

  test("messages() joint les pièces jointes par message", () => {
    const t = svc.create(base);
    svc.addMessage(t.id, { ...customer, content: "sans" });
    svc.addMessage(t.id, { ...customer, content: "avec", attachments: [{ name: "a.gif", mime: "image/gif", size: 1, file: "f" }] });
    const ms = svc.messages(t.id);
    expect(ms[0]!.attachments).toEqual([]);
    expect(ms[1]!.attachments).toHaveLength(1);
    expect(ms[1]!.attachments[0]!.name).toBe("a.gif");
  });

  test("attachment(id) renvoie le fichier stocké et le serveur du ticket", () => {
    const t = svc.create(base);
    const m = svc.addMessage(t.id, { ...customer, content: "x", attachments: [{ name: "a.zip", mime: "application/zip", size: 5, file: "rand1" }] });
    const a = svc.attachment(m.attachments[0]!.id)!;
    expect(a.file).toBe("rand1");
    expect(a.guildId).toBe("g1");
    expect(a.kind).toBe("file");
    expect(svc.attachment(999)).toBeNull();
  });

  test("supprimer le ticket supprime les pièces jointes en cascade", () => {
    const t = svc.create(base);
    svc.addMessage(t.id, { ...customer, content: "x", attachments: [{ name: "a.png", mime: "image/png", size: 1, file: "f" }] });
    db.run("DELETE FROM tickets WHERE id = ?", [t.id]);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM attachments").get()!.n).toBe(0);
  });
});

describe("notes internes", () => {
  test("ne changent ni awaiting ni la date de mise à jour", () => {
    const t = svc.create(base);
    svc.addMessage(t.id, { ...customer, content: "aide" });
    const before = svc.get(t.id)!;
    const n = svc.addMessage(t.id, { ...staff, content: "note", internal: true });
    const after = svc.get(t.id)!;
    expect(n.internal).toBe(true);
    expect(after.awaiting).toBe("support");
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.firstResponseAt).toBeNull();
    expect(after.waitingSince).toBe(before.waitingSince);
    expect(svc.messages(t.id).at(-1)!.internal).toBe(true);
  });

  test("émettent quand même un événement message", () => {
    const t = svc.create(base);
    const events: TicketEvent[] = [];
    svc.subscribe((e) => events.push(e));
    svc.addMessage(t.id, { ...staff, content: "note", internal: true });
    expect(events).toEqual([{ type: "message", ticketId: t.id, guildId: "g1" }]);
  });
});

describe("migration", () => {
  test("une ancienne base reçoit les nouvelles colonnes et tables", () => {
    const path = `${process.env.TEMP ?? "/tmp"}/desk-migr-${Date.now()}.db`;
    const old = new Database(path, { create: true });
    old.run(`CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      guild_id TEXT NOT NULL DEFAULT '', channel_id TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      awaiting TEXT NOT NULL DEFAULT 'support', locale TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')), assignee TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER)`);
    old.run(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL, author_name TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('discord','panel','system')), created_at INTEGER NOT NULL)`);
    old.run("INSERT INTO tickets (user_id,user_name,guild_id,channel_id,subject,created_at,updated_at) VALUES ('u','n','g','c','s',1,1)");
    old.run("INSERT INTO messages (ticket_id,author_id,author_name,content,source,created_at) VALUES (1,'u','n','hello','discord',1)");
    old.close();
    const s = new TicketService(openDb(path));
    const t = s.get(1)!;
    expect(t.priority).toBe("normal");
    expect(t.tags).toEqual([]);
    expect(t.assigneeId).toBeNull();
    expect(t.rating).toBeNull();
    expect(s.messages(1)[0]).toMatchObject({ content: "hello", internal: false, attachments: [] });
    expect(() => s.addMessage(1, { ...customer, content: "ok" })).not.toThrow();
  });
});

describe("champs du ticket", () => {
  test("valeurs par défaut", () => {
    const t = svc.create(base);
    expect(t).toMatchObject({ priority: "normal", tags: [], assigneeId: null, closeReason: null, rating: null, firstResponseAt: null });
  });

  test("setPriority valide la valeur", () => {
    const t = svc.create(base);
    expect(svc.setPriority(t.id, "urgent").priority).toBe("urgent");
    expect(() => svc.setPriority(t.id, "nope" as never)).toThrow(TicketError);
  });

  test("setTags normalise, dédoublonne et valide", () => {
    const t = svc.create(base);
    expect(svc.setTags(t.id, [" Bug ", "bug", "api-v2"]).tags).toEqual(["bug", "api-v2"]);
    expect(() => svc.setTags(t.id, ["a b"])).toThrow(TicketError);
    expect(() => svc.setTags(t.id, [""])).toThrow(TicketError);
    expect(() => svc.setTags(t.id, ["x".repeat(25)])).toThrow(TicketError);
    expect(() => svc.setTags(t.id, Array.from({ length: 9 }, (_, i) => `t${i}`))).toThrow(TicketError);
    expect(svc.setTags(t.id, []).tags).toEqual([]);
  });

  test("assign pose et retire le responsable sans changer le statut", () => {
    const t = svc.create(base);
    const a = svc.assign(t.id, "admin", "a1");
    expect(a).toMatchObject({ assignee: "admin", assigneeId: "a1", status: "open" });
    expect(svc.assign(t.id, null, null)).toMatchObject({ assignee: null, assigneeId: null });
  });

  test("claim renseigne aussi assigneeId", () => {
    const t = svc.create(base);
    expect(svc.claim(t.id, { id: "a1", name: "admin" }).assigneeId).toBe("a1");
  });

  test("close garde la raison ; reopen l'efface", () => {
    const t = svc.create(base);
    const c = svc.close(t.id, { reason: "resolved" });
    expect(c.closeReason).toBe("resolved");
    expect(svc.reopen(t.id).closeReason).toBeNull();
    expect(svc.close(t.id).closeReason).toBeNull();
  });

  test("close refuse une raison inconnue", () => {
    const t = svc.create(base);
    expect(() => svc.close(t.id, { reason: "x" as never })).toThrow(TicketError);
  });

  test("setRating : 1 à 5, ticket fermé, une seule fois", () => {
    const t = svc.create(base);
    expect(() => svc.setRating(t.id, 5)).toThrow(TicketError);
    svc.close(t.id);
    expect(() => svc.setRating(t.id, 0)).toThrow(TicketError);
    expect(() => svc.setRating(t.id, 6)).toThrow(TicketError);
    expect(() => svc.setRating(t.id, 2.5)).toThrow(TicketError);
    expect(svc.setRating(t.id, 4).rating).toBe(4);
    expect(() => svc.setRating(t.id, 5)).toThrow(TicketError);
    expect(svc.get(t.id)!.rating).toBe(4);
  });

  test("firstResponseAt : premier message public du support seulement", () => {
    const t = svc.create(base);
    svc.addMessage(t.id, { ...customer, content: "aide" });
    svc.addMessage(t.id, { authorId: "system", authorName: "Système", content: "pris", source: "system" });
    svc.addMessage(t.id, { ...staff, content: "note", internal: true });
    expect(svc.get(t.id)!.firstResponseAt).toBeNull();
    svc.addMessage(t.id, { ...staff, content: "bonjour" });
    const first = svc.get(t.id)!.firstResponseAt;
    expect(first).not.toBeNull();
    svc.addMessage(t.id, { ...staff, content: "encore" });
    expect(svc.get(t.id)!.firstResponseAt).toBe(first);
  });

  test("waitingSince suit le dernier message client tant que le support doit répondre", () => {
    const t = svc.create(base);
    svc.addMessage(t.id, { ...customer, content: "aide" });
    const w = svc.get(t.id)!.waitingSince;
    expect(w).not.toBeNull();
    svc.addMessage(t.id, { authorId: "system", authorName: "Système", content: "pris", source: "system" });
    expect(svc.get(t.id)!.waitingSince).toBe(w);
    svc.addMessage(t.id, { ...staff, content: "salut" });
    expect(svc.get(t.id)!.waitingSince).toBeNull();
    svc.addMessage(t.id, { ...customer, content: "merci" });
    expect(svc.get(t.id)!.waitingSince).not.toBeNull();
    svc.close(t.id);
    expect(svc.get(t.id)!.waitingSince).toBeNull();
  });
});

describe("codes d'erreur", () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as TicketError).code;
    }
  };
  test("chaque refus porte un code exploitable sans lire le texte", () => {
    const t = svc.create(base);
    expect(code(() => svc.close(999))).toBe("not_found");
    expect(code(() => svc.setPriority(t.id, "x" as never))).toBe("invalid");
    expect(code(() => svc.reopen(t.id))).toBe("not_closed");
    expect(code(() => svc.setRating(t.id, 3))).toBe("not_closed");
    svc.close(t.id);
    expect(code(() => svc.close(t.id))).toBe("closed");
    expect(code(() => svc.claim(t.id, { id: "a", name: "a" }))).toBe("closed");
    svc.setRating(t.id, 3);
    expect(code(() => svc.setRating(t.id, 4))).toBe("conflict");
    expect(code(() => svc.create({ ...base, channelId: "c2" }, { maxActivePerUser: 0 }))).toBe("quota");
  });
});
