import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";

const sent: { text: string; opts?: unknown }[] = [];
const rated: number[] = [];
const gw: Gateway = {
  createTicketChannel: async () => `chan${sent.length + 1}`,
  send: async (_c, text, opts) => void sent.push({ text, opts }),
  setUserLocked: async () => {},
  deleteChannel: async () => {},
  askRating: async (_c, id) => void rated.push(id),
};

const cfg = { panelPassword: "pw", sessionSecret: "s".repeat(32) };
let handle: (r: Request) => Promise<Response>;
let desk: SupportDesk;
let guilds: { id: string; name: string; icon: null }[];

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const l = await handle(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }), headers: { "content-type": "application/json" } }));
  const cookie = l.headers.get("set-cookie")!.split(";")[0]!;
  const { json, ...rest } = init;
  return handle(
    new Request("http://x" + path, {
      ...rest,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      headers: { cookie, ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    }),
  );
}
const post = (path: string, json?: unknown) => call(path, { method: "POST", ...(json !== undefined ? { json } : {}) });
const open = (n = 1, guildId = "g1") => desk.open({ guildId, userId: `u${n}`, userName: `user${n}`, subject: `Sujet ${n}`, description: `description numéro ${n}` });

beforeEach(() => {
  sent.length = 0;
  rated.length = 0;
  guilds = [{ id: "g1", name: "Test", icon: null }];
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
  handle = createHandler(desk, cfg, undefined, { list: () => guilds });
});

describe("note", () => {
  test("note interne : stockée, pas envoyée sur Discord", async () => {
    const t = await open();
    const before = sent.length;
    const r = await post(`/api/tickets/${t.id}/note`, { content: "à vérifier" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { message: { internal: boolean } }).message.internal).toBe(true);
    expect(sent.length).toBe(before);
  });
  test("note vide : 400", async () => {
    const t = await open();
    expect((await post(`/api/tickets/${t.id}/note`, { content: " " })).status).toBe(400);
  });
});

describe("attribution, priorité, étiquettes", () => {
  test("assign : nom libre, puis libération avec null", async () => {
    const t = await open();
    const r = await post(`/api/tickets/${t.id}/assign`, { assignee: "Bob" });
    expect(((await r.json()) as { ticket: { assignee: string; assigneeId: string | null } }).ticket).toMatchObject({ assignee: "Bob", assigneeId: null });
    const r2 = await post(`/api/tickets/${t.id}/assign`, { assignee: null });
    expect(((await r2.json()) as { ticket: { assignee: string | null } }).ticket.assignee).toBeNull();
  });
  test("assign sans champ ou de mauvais type : 400", async () => {
    const t = await open();
    expect((await post(`/api/tickets/${t.id}/assign`, {})).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/assign`, { assignee: 3 })).status).toBe(400);
  });
  test("assign : l'auteur est dans l'audit", async () => {
    const t = await open();
    await post(`/api/tickets/${t.id}/assign`, { assignee: "Bob" });
    const a = (await (await call(`/api/audit?ticket=${t.id}`)).json()) as { entries: { actor: string; action: string }[] };
    expect(a.entries).toContainEqual(expect.objectContaining({ actor: "Support", action: "assign" }));
  });
  test("priority valide / invalide", async () => {
    const t = await open();
    const r = await post(`/api/tickets/${t.id}/priority`, { priority: "urgent" });
    expect(((await r.json()) as { ticket: { priority: string } }).ticket.priority).toBe("urgent");
    expect((await post(`/api/tickets/${t.id}/priority`, { priority: "nope" })).status).toBe(400);
  });
  test("tags : remplacés, normalisés ; invalides refusés", async () => {
    const t = await open();
    const r = await post(`/api/tickets/${t.id}/tags`, { tags: ["Bug", "ui"] });
    expect(((await r.json()) as { ticket: { tags: string[] } }).ticket.tags).toEqual(["bug", "ui"]);
    expect((await post(`/api/tickets/${t.id}/tags`, { tags: "bug" })).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/tags`, { tags: ["pas valide!"] })).status).toBe(400);
  });
  test("ticket d'un autre serveur : 404 sur chaque action", async () => {
    const t = await open();
    guilds = [];
    for (const a of ["note", "assign", "priority", "tags", "close"]) expect((await post(`/api/tickets/${t.id}/${a}`, {})).status).toBe(404);
    expect((await call(`/api/tickets/${t.id}/transcript`)).status).toBe(404);
    expect((await call(`/api/audit?ticket=${t.id}`)).status).toBe(404);
  });
});

describe("fermeture", () => {
  test("sans corps : fermeture simple comme avant", async () => {
    const t = await open();
    const r = await post(`/api/tickets/${t.id}/close`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ticket: { status: string; closeReason: string | null } }).ticket).toMatchObject({ status: "closed", closeReason: null });
    expect(rated).toEqual([]);
  });
  test("raison, message, note demandée, transcription", async () => {
    const t = await open();
    const r = await post(`/api/tickets/${t.id}/close`, { reason: "resolved", message: "Réglé !", askRating: true, sendTranscript: true });
    expect(((await r.json()) as { ticket: { closeReason: string } }).ticket.closeReason).toBe("resolved");
    expect(sent.some((s) => s.text === "Réglé !")).toBe(true);
    expect(rated).toEqual([t.id]);
    expect(sent.some((s) => (s.opts as { files?: { name: string }[] })?.files?.[0]?.name === `transcript-${t.id}.txt`)).toBe(true);
  });
  test("raison invalide : 400, ticket resté ouvert", async () => {
    const t = await open();
    expect((await post(`/api/tickets/${t.id}/close`, { reason: "bof" })).status).toBe(400);
    expect(desk.tickets.get(t.id)!.status).toBe("open");
  });
  test("fermer deux fois : 409", async () => {
    const t = await open();
    await post(`/api/tickets/${t.id}/close`);
    expect((await post(`/api/tickets/${t.id}/close`)).status).toBe(409);
  });
  test("réouverture et suppression du salon auditées", async () => {
    const t = await open();
    await post(`/api/tickets/${t.id}/close`);
    await post(`/api/tickets/${t.id}/reopen`);
    await post(`/api/tickets/${t.id}/close`);
    expect((await post(`/api/tickets/${t.id}/delete`)).status).toBe(200);
    const a = (await (await call(`/api/audit?ticket=${t.id}`)).json()) as { entries: { action: string; actor: string }[] };
    expect(a.entries.filter((e) => e.actor === "Support").map((e) => e.action)).toEqual(["close", "reopen", "close", "delete_channel"]);
  });
});

describe("transcription", () => {
  test("texte en téléchargement, sans notes internes", async () => {
    const t = await open();
    await post(`/api/tickets/${t.id}/note`, { content: "SECRET" });
    await post(`/api/tickets/${t.id}/reply`, { content: "Bonjour" });
    const r = await call(`/api/tickets/${t.id}/transcript`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/plain");
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="ticket-${t.id}.txt"`);
    const txt = await r.text();
    expect(txt).toContain("Bonjour");
    expect(txt).not.toContain("SECRET");
  });
});

describe("réponses enregistrées", () => {
  test("créer, remplacer (upsert), lister, supprimer", async () => {
    const r = await post("/api/replies", { guild: "g1", name: "merci", text: "Merci {customer} !" });
    expect(((await r.json()) as { replies: { name: string }[] }).replies.map((x) => x.name)).toEqual(["merci"]);
    await post("/api/replies", { guild: "g1", name: "merci", text: "Merci beaucoup" });
    const list = (await (await call("/api/replies?guild=g1")).json()) as { replies: { id: number; text: string }[] };
    expect(list.replies).toHaveLength(1);
    expect(list.replies[0]!.text).toBe("Merci beaucoup");
    const del = await call(`/api/replies/${list.replies[0]!.id}`, { method: "DELETE" });
    expect(((await del.json()) as { replies: unknown[] }).replies).toEqual([]);
  });
  test("nom invalide : 400 ; champs manquants : 400 ; serveur interdit : 403", async () => {
    expect((await post("/api/replies", { guild: "g1", name: "Pas Valide", text: "x" })).status).toBe(400);
    expect((await post("/api/replies", { guild: "g1", name: "ok" })).status).toBe(400);
    expect((await post("/api/replies", { guild: "g2", name: "ok", text: "x" })).status).toBe(403);
    expect((await call("/api/replies?guild=g2")).status).toBe(403);
  });
  test("suppression d'une réponse d'un autre serveur : 404 ; l'ajout est audité", async () => {
    const saved = desk.tickets.saveReply("g2", "autre", "x");
    expect((await call(`/api/replies/${saved.id}`, { method: "DELETE" })).status).toBe(404);
    expect(desk.tickets.listReplies("g2")).toHaveLength(1);
    await post("/api/replies", { guild: "g1", name: "a", text: "x" });
    expect(desk.tickets.audit(null).some((e) => e.action === "reply_save" && e.actor === "Support")).toBe(true);
  });
});

describe("métriques", () => {
  test("forme du contrat, days validé, serveur contrôlé", async () => {
    await open();
    const m = (await (await call("/api/metrics?guild=g1&days=7")).json()) as Record<string, unknown>;
    expect(m.waitingNow).toBe(1);
    expect(m.targets).toEqual({ firstReplyMs: 900000, replyMs: 3600000 });
    expect((await call("/api/metrics?days=0")).status).toBe(400);
    expect((await call("/api/metrics?days=x")).status).toBe(400);
    expect((await call("/api/metrics?guild=g2")).status).toBe(403);
    expect((await call("/api/metrics")).status).toBe(200); // un seul serveur accessible
  });
});

describe("liste filtrée", () => {
  test("filtres, recherche, dernier message et compteur de pièces jointes", async () => {
    const a = await open(1);
    const b = await open(2);
    await post(`/api/tickets/${a.id}/tags`, { tags: ["bug"] });
    await post(`/api/tickets/${a.id}/priority`, { priority: "high" });
    await post(`/api/tickets/${b.id}/assign`, { assignee: "Support" });
    await post(`/api/tickets/${b.id}/note`, { content: "mot-secret-interne" });
    type L = { tickets: { id: number; lastMessage: { content: string } | null; attachmentCount: number }[]; tags: { name: string; count: number }[]; stats: unknown; awaiting: unknown };
    const get = async (qs: string) => (await (await call(`/api/tickets?guild=g1&${qs}`)).json()) as L;
    expect((await get("tag=bug")).tickets.map((t) => t.id)).toEqual([a.id]);
    expect((await get("priority=high")).tickets.map((t) => t.id)).toEqual([a.id]);
    expect((await get("assignee=me")).tickets.map((t) => t.id)).toEqual([b.id]);
    expect((await get("assignee=none")).tickets.map((t) => t.id)).toEqual([a.id]);
    expect((await get("assignee=Support")).tickets.map((t) => t.id)).toEqual([b.id]);
    expect((await get("q=numéro 2")).tickets.map((t) => t.id)).toEqual([b.id]);
    expect((await get("q=mot-secret-interne")).tickets.map((t) => t.id)).toEqual([b.id]);
    const all = await get("awaiting=support");
    expect(all.tickets).toHaveLength(2);
    const lm = all.tickets.find((t) => t.id === b.id)!;
    expect(lm.lastMessage!.content).not.toContain("mot-secret-interne"); // jamais une note interne
    expect(lm.attachmentCount).toBe(0);
    expect(all.tags).toEqual([{ name: "bug", count: 1 }]);
    expect(all.stats).toBeDefined();
    expect(all.awaiting).toBeDefined();
  });
  test("valeurs invalides : 400", async () => {
    for (const qs of ["status=x", "awaiting=x", "priority=x", "q=" + "a".repeat(201)]) {
      expect((await call(`/api/tickets?guild=g1&${qs}`)).status).toBe(400);
    }
  });
});
