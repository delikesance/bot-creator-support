import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService, type TicketEvent } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { handleInteraction, type Ix } from "../src/bot/handlers";
import { createHandler } from "../src/web";

const sent: { channelId: string; text: string }[] = [];
let n = 0;
const gw: Gateway = {
  createTicketChannel: async () => `chan${++n}`,
  send: async (channelId, text) => void sent.push({ channelId, text }),
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
const user = { guildId: "gA", userId: "u1", userName: "alice" };

let desk: SupportDesk;
beforeEach(() => {
  sent.length = 0;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
});

describe("description du ticket", () => {
  test("stockée et historisée comme message de l'utilisateur", async () => {
    const t = await desk.open({ ...user, subject: "Bug", description: "Le bouton ne répond pas\nsur mobile" });
    expect(t.description).toBe("Le bouton ne répond pas\nsur mobile");
    const msgs = desk.tickets.messages(t.id);
    const d = msgs.find((m) => m.source === "discord")!;
    expect(d).toMatchObject({ authorId: "u1", authorName: "alice", content: "Le bouton ne répond pas\nsur mobile" });
  });
  test("optionnelle côté métier, tronquée à 1000 caractères", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    expect(t.description).toBe("");
    expect(desk.tickets.messages(t.id).some((m) => m.source === "discord")).toBe(false);
    const long = await desk.open({ ...user, userId: "u2", subject: "b", description: "x".repeat(1500) });
    expect(long.description.length).toBe(1000);
  });
  test("la modale Discord transmet titre et description", async () => {
    const replies: string[] = [];
    const ix: Ix = {
      kind: "modal", id: "ticket:modal", ...user, channelId: "", isStaff: false,
      subject: "Titre", description: "Détails du souci",
      reply: async (t) => void replies.push(t), showSubjectModal: async () => {}, postPanel: async () => {},
    };
    await handleInteraction(desk, ix);
    expect(desk.tickets.list()[0]).toMatchObject({ subject: "Titre", description: "Détails du souci" });
  });
  test("migration : une base sans colonne description est mise à jour", () => {
    const db = openDb(":memory:");
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(tickets)").all().map((c) => c.name);
    expect(cols).toContain("description");
  });
});

describe("événements du service", () => {
  test("message, création et changement de statut sont émis avec le serveur", async () => {
    const events: TicketEvent[] = [];
    desk.tickets.subscribe((e) => events.push(e));
    const t = await desk.open({ ...user, subject: "a", description: "d" });
    await desk.reply(t.id, "Bonjour", "Staff");
    desk.recordDiscordMessage(t.channelId, { id: "u1", name: "alice" }, "salut");
    expect(events.some((e) => e.type === "ticket" && e.ticketId === t.id && e.guildId === "gA")).toBe(true);
    expect(events.filter((e) => e.type === "message").length).toBeGreaterThan(0);
    expect(events.every((e) => e.guildId === "gA")).toBe(true);
  });
  test("désabonnement", async () => {
    const events: TicketEvent[] = [];
    const off = desk.tickets.subscribe((e) => events.push(e));
    off();
    await desk.open({ ...user, subject: "a" });
    expect(events).toHaveLength(0);
  });
  test("un message fait remonter updatedAt (le ticket bouge dans la liste)", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await Bun.sleep(5);
    desk.recordDiscordMessage(t.channelId, { id: "u1", name: "alice" }, "salut");
    expect(desk.tickets.get(t.id)!.updatedAt).toBeGreaterThan(t.updatedAt);
  });
});

describe("flux temps réel (SSE)", () => {
  const cfg = { panelPassword: "pw", sessionSecret: "s".repeat(32) };
  const directory = { list: () => [{ id: "gA", name: "A", icon: null }, { id: "gB", name: "B", icon: null }] };
  let handle: (r: Request) => Promise<Response>;
  let cookie: string;
  beforeEach(async () => {
    handle = createHandler(desk, cfg, undefined, directory);
    const r = await handle(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }) }));
    cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  });

  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
    const dec = new TextDecoder();
    let acc = "";
    const deadline = Date.now() + 2000;
    while (!acc.includes(needle) && Date.now() < deadline) {
      const r = await Promise.race([reader.read(), Bun.sleep(300).then(() => null)]);
      if (r?.value) acc += dec.decode(r.value);
      if (r?.done) break;
    }
    return acc;
  }

  test("exige une session", async () => {
    expect((await handle(new Request("http://x/api/events?guild=gA"))).status).toBe(401);
  });
  test("serveur inconnu ou non autorisé : 403", async () => {
    expect((await handle(new Request("http://x/api/events?guild=zzz", { headers: { cookie } }))).status).toBe(403);
  });
  test("diffuse les événements du serveur demandé, et eux seulement", async () => {
    const res = await handle(new Request("http://x/api/events?guild=gA", { headers: { cookie } }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    expect(await readUntil(reader, "connected")).toContain("connected");

    const other = await desk.open({ guildId: "gB", userId: "u9", userName: "zoe", subject: "ailleurs" });
    desk.recordDiscordMessage(other.channelId, { id: "u9", name: "zoe" }, "invisible");
    const t = await desk.open({ ...user, subject: "ici" });
    desk.recordDiscordMessage(t.channelId, { id: "u1", name: "alice" }, "visible");

    const got = await readUntil(reader, '"type":"message"');
    expect(got).toContain(`"ticketId":${t.id}`);
    expect(got).not.toContain(`"ticketId":${other.id}`);
    await reader.cancel();
  });
  test("après annulation, plus d'abonné (pas de fuite)", async () => {
    const res = await handle(new Request("http://x/api/events?guild=gA", { headers: { cookie } }));
    const reader = res.body!.getReader();
    await readUntil(reader, "connected");
    await reader.cancel();
    expect(desk.tickets.listenerCount()).toBe(0);
  });
});

describe("conversation côté utilisateur", () => {
  test("aucun bouton de staff dans le salon : tout se gère depuis le panel", async () => {
    const opts: ({ controls?: string } | undefined)[] = [];
    const d = new SupportDesk(new TicketService(openDb(":memory:")), { ...gw, send: async (_c, _t, o) => void opts.push(o) });
    const t = await d.open({ ...user, subject: "a", description: "d" });
    await d.close(t.id, "Staff");
    await d.reopen(t.id, "Staff");
    expect(opts.every((o) => o?.controls === undefined)).toBe(true);
  });
});
