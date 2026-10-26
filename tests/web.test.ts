import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";

const sent: string[] = [];
const gw: Gateway = {
  createTicketChannel: async () => `chan${sent.length + 1}`,
  send: async (_c, t) => void sent.push(t),
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};

let handle: (r: Request) => Promise<Response>;
let desk: SupportDesk;
const cfg = { panelPassword: "pw", sessionSecret: "s".repeat(32) };

async function login(password = "pw") {
  const res = await handle(
    new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password }), headers: { "content-type": "application/json" } }),
  );
  return res;
}
async function authed(path: string, init: RequestInit = {}) {
  const l = await login();
  const cookie = l.headers.get("set-cookie")!.split(";")[0]!;
  return handle(new Request("http://x" + path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } }));
}

beforeEach(() => {
  sent.length = 0;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
  handle = createHandler(desk, cfg);
});

describe("auth", () => {
  test("API protégée sans session", async () => {
    expect((await handle(new Request("http://x/api/tickets"))).status).toBe(401);
  });
  test("mauvais mot de passe refusé", async () => {
    expect((await login("nope")).status).toBe(401);
  });
  test("bon mot de passe : cookie HttpOnly", async () => {
    const r = await login();
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
  });
  test("cookie falsifié refusé", async () => {
    const r = await handle(new Request("http://x/api/tickets", { headers: { cookie: "session=abc.def" } }));
    expect(r.status).toBe(401);
  });
  test("logout invalide le cookie côté client", async () => {
    const r = await authed("/api/logout", { method: "POST" });
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  test("la page d'accueil est publique", async () => {
    const r = await handle(new Request("http://x/"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });
});

describe("tickets", () => {
  test("liste + stats + filtre par statut", async () => {
    const a = await desk.open({ userId: "u", userName: "alice", subject: "a" });
    await desk.open({ userId: "v", userName: "bob", subject: "b" });
    await desk.claim(a.id, { id: "x", name: "admin" });
    const all = await (await authed("/api/tickets")).json();
    expect(all.tickets).toHaveLength(2);
    expect(all.stats).toEqual({ open: 1, in_progress: 1, closed: 0 });
    const f = await (await authed("/api/tickets?status=in_progress")).json();
    expect(f.tickets.map((t: any) => t.id)).toEqual([a.id]);
  });
  test("statut invalide : 400", async () => {
    expect((await authed("/api/tickets?status=zzz")).status).toBe(400);
  });
  test("détail avec messages, 404 si inconnu", async () => {
    const t = await desk.open({ userId: "u", userName: "alice", subject: "a" });
    const d = await (await authed(`/api/tickets/${t.id}`)).json();
    expect(d.ticket.id).toBe(t.id);
    expect(Array.isArray(d.messages)).toBe(true);
    expect((await authed("/api/tickets/999")).status).toBe(404);
  });
  test("claim / release / close / reopen", async () => {
    const t = await desk.open({ userId: "u", userName: "alice", subject: "a" });
    const post = (a: string) => authed(`/api/tickets/${t.id}/${a}`, { method: "POST" });
    expect((await (await post("claim")).json()).ticket.status).toBe("in_progress");
    expect((await (await post("release")).json()).ticket.status).toBe("open");
    expect((await (await post("close")).json()).ticket.status).toBe("closed");
    expect((await (await post("reopen")).json()).ticket.status).toBe("open");
  });
  test("transition invalide : 409", async () => {
    const t = await desk.open({ userId: "u", userName: "alice", subject: "a" });
    expect((await authed(`/api/tickets/${t.id}/reopen`, { method: "POST" })).status).toBe(409);
  });
  test("reply envoie dans Discord", async () => {
    const t = await desk.open({ userId: "u", userName: "alice", subject: "a" });
    const r = await authed(`/api/tickets/${t.id}/reply`, { method: "POST", body: JSON.stringify({ content: "Salut" }) });
    expect(r.status).toBe(200);
    expect(sent.at(-1)).toBe("**Support** : Salut");
  });
  test("reply vide : 409", async () => {
    const t = await desk.open({ userId: "u", userName: "alice", subject: "a" });
    const r = await authed(`/api/tickets/${t.id}/reply`, { method: "POST", body: JSON.stringify({ content: "" }) });
    expect(r.status).toBe(409);
  });
  test("route inconnue : 404", async () => {
    expect((await authed("/api/nope")).status).toBe(404);
  });
});
