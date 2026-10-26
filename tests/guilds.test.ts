import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";
import type { OAuthProvider } from "../src/oauth";

const created: string[] = [];
const gw: Gateway = {
  createTicketChannel: async (o) => {
    created.push(o.guildId);
    return `chan${created.length}`;
  },
  send: async () => {},
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};

const MANAGE_GUILD = String(0x20);
const ADMINISTRATOR = String(0x8);
const people: Record<string, { id: string; username: string; guilds: { id: string; permissions: string }[] }> = {
  root: { id: "1", username: "Root", guilds: [] },
  owner: {
    id: "2",
    username: "OwnerB",
    guilds: [
      { id: "gB", permissions: MANAGE_GUILD },
      { id: "gA", permissions: "0" },
      { id: "gX", permissions: ADMINISTRATOR },
    ],
  },
  nobody: { id: "3", username: "Nobody", guilds: [{ id: "gA", permissions: "0" }] },
};
const provider: OAuthProvider = {
  authorizeUrl: (s) => `https://d/authorize?state=${s}`,
  exchange: async (code) => people[code]!,
  isAdmin: (id) => id === "1",
};
// gX : l'utilisateur y est admin mais le bot n'y est pas.
const directory = {
  list: () => [
    { id: "gA", name: "Alpha", icon: null },
    { id: "gB", name: "Bravo", icon: null },
  ],
};
const cfg = { panelPassword: "pw", sessionSecret: "s".repeat(32) };

let desk: SupportDesk;
let handle: (r: Request) => Promise<Response>;
beforeEach(async () => {
  created.length = 0;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
  handle = createHandler(desk, cfg, provider, directory);
  await desk.open({ guildId: "gA", userId: "u1", userName: "alice", subject: "dans A" });
  await desk.open({ guildId: "gB", userId: "u1", userName: "alice", subject: "dans B 1" });
  await desk.open({ guildId: "gB", userId: "u2", userName: "bob", subject: "dans B 2" });
});

async function loginAs(code: string): Promise<string | null> {
  const start = await handle(new Request("http://x/auth/login"));
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const cookie = start.headers.getSetCookie().find((c) => c.startsWith("oauth_state="))!.split(";")[0]!;
  const r = await handle(new Request(`http://x/auth/callback?code=${code}&state=${state}`, { headers: { cookie } }));
  return r.headers.getSetCookie().find((c) => c.startsWith("session="))?.split(";")[0] ?? null;
}
const get = (path: string, cookie: string) => handle(new Request("http://x" + path, { headers: { cookie } }));
const post = (path: string, cookie: string, body: unknown = {}) =>
  handle(new Request("http://x" + path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));

describe("tickets par serveur (service)", () => {
  test("list et stats filtrés par serveur", () => {
    expect(desk.tickets.list(undefined, "gB")).toHaveLength(2);
    expect(desk.tickets.list(undefined, "gA")).toHaveLength(1);
    expect(desk.tickets.list()).toHaveLength(3);
    expect(desk.tickets.stats("gB")).toEqual({ open: 2, in_progress: 0, closed: 0 });
  });
  test("la limite par utilisateur est par serveur", async () => {
    const limited = new SupportDesk(new TicketService(openDb(":memory:")), gw, { maxActivePerUser: 1 });
    await limited.open({ guildId: "gA", userId: "u", userName: "x", subject: "a" });
    await expect(limited.open({ guildId: "gA", userId: "u", userName: "x", subject: "b" })).rejects.toThrow();
    await expect(limited.open({ guildId: "gB", userId: "u", userName: "x", subject: "c" })).resolves.toBeTruthy();
  });
  test("le salon est créé sur le serveur du ticket", () => {
    expect(created).toEqual(["gA", "gB", "gB"]);
  });
  test("adoptOrphans rattache les anciens tickets sans serveur", () => {
    const db = openDb(":memory:");
    db.run("INSERT INTO tickets (user_id,user_name,channel_id,subject,created_at,updated_at) VALUES ('u','x','c','old',1,1)");
    const svc = new TicketService(db);
    expect(svc.list(undefined, "gA")).toHaveLength(0);
    svc.adoptOrphans("gA");
    expect(svc.list(undefined, "gA")).toHaveLength(1);
  });
});

describe("accès par serveur (API)", () => {
  test("super-admin : voit tous les serveurs du bot", async () => {
    const c = (await loginAs("root"))!;
    const r = await (await get("/api/guilds", c)).json();
    expect(r.guilds.map((g: any) => g.id)).toEqual(["gA", "gB"]);
  });
  test("gérant d'un seul serveur : ne voit que celui-là (et pas gX où le bot est absent)", async () => {
    const c = (await loginAs("owner"))!;
    const r = await (await get("/api/guilds", c)).json();
    expect(r.guilds.map((g: any) => g.id)).toEqual(["gB"]);
  });
  test("les compteurs de chaque serveur sont fournis", async () => {
    const c = (await loginAs("root"))!;
    const r = await (await get("/api/guilds", c)).json();
    expect(r.guilds.find((g: any) => g.id === "gB").stats.open).toBe(2);
  });
  test("sans permission sur aucun serveur du bot : refusé", async () => {
    expect(await loginAs("nobody")).toBeNull();
  });
  test("liste filtrée par ?guild=", async () => {
    const c = (await loginAs("root"))!;
    const r = await (await get("/api/tickets?guild=gB", c)).json();
    expect(r.tickets).toHaveLength(2);
    expect(r.stats.open).toBe(2);
  });
  test("serveur non autorisé : 403", async () => {
    const c = (await loginAs("owner"))!;
    expect((await get("/api/tickets?guild=gA", c)).status).toBe(403);
  });
  test("sans ?guild= et un seul serveur accessible : celui-là par défaut", async () => {
    const c = (await loginAs("owner"))!;
    const r = await (await get("/api/tickets", c)).json();
    expect(r.tickets.every((t: any) => t.guildId === "gB")).toBe(true);
  });
  test("sans ?guild= et plusieurs serveurs : 400", async () => {
    const c = (await loginAs("root"))!;
    expect((await get("/api/tickets", c)).status).toBe(400);
  });
  test("détail d'un ticket d'un autre serveur : 404 (pas de fuite)", async () => {
    const c = (await loginAs("owner"))!;
    expect((await get("/api/tickets/1", c)).status).toBe(404);
    expect((await get("/api/tickets/2", c)).status).toBe(200);
  });
  test("actions sur un ticket d'un autre serveur refusées", async () => {
    const c = (await loginAs("owner"))!;
    expect((await post("/api/tickets/1/close", c)).status).toBe(404);
    expect(desk.tickets.get(1)!.status).toBe("open");
    expect((await post("/api/tickets/2/close", c)).status).toBe(200);
  });
  test("mode mot de passe : accès à tous les serveurs", async () => {
    const h = createHandler(desk, cfg, undefined, directory);
    const login = await h(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }) }));
    const c = login.headers.get("set-cookie")!.split(";")[0]!;
    const r = await (await h(new Request("http://x/api/guilds", { headers: { cookie: c } }))).json();
    expect(r.guilds).toHaveLength(2);
  });
});
