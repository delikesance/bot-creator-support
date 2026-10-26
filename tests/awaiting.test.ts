import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";

let n = 0;
const gw: Gateway = {
  createTicketChannel: async () => `chan${++n}`,
  send: async () => {},
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
const user = { guildId: "gA", userId: "u1", userName: "alice" };

let desk: SupportDesk;
beforeEach(() => {
  n = 0;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
});

const awaiting = (id: number) => desk.tickets.get(id)!.awaiting;

describe("qui doit répondre", () => {
  test("un ticket neuf attend le support", async () => {
    const t = await desk.open({ ...user, subject: "a", description: "détails" });
    expect(awaiting(t.id)).toBe("support");
  });
  test("réponse du panel -> attend le client ; le client écrit -> attend le support", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.reply(t.id, "Bonjour", "Angelo");
    expect(awaiting(t.id)).toBe("customer");
    desk.recordDiscordMessage(t.channelId, { id: "u1", name: "alice" }, "merci, voici la suite");
    expect(awaiting(t.id)).toBe("support");
  });
  test("un membre du staff qui écrit directement dans le salon -> attend le client", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    desk.recordDiscordMessage(t.channelId, { id: "staff1", name: "Modo" }, "je regarde ça");
    expect(awaiting(t.id)).toBe("customer");
  });
  test("les notes système (prise en charge, fermeture…) ne changent rien", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.reply(t.id, "Bonjour", "Angelo");
    await desk.claim(t.id, { id: "s", name: "Staff" });
    await desk.release(t.id, "Staff");
    expect(awaiting(t.id)).toBe("customer");
  });
  test("compteurs : seuls les tickets non fermés comptent, par serveur", async () => {
    const a = await desk.open({ ...user, subject: "a" });
    const b = await desk.open({ ...user, userId: "u2", userName: "bob", subject: "b" });
    const c = await desk.open({ ...user, userId: "u3", userName: "cat", subject: "c" });
    await desk.open({ guildId: "gB", userId: "u9", userName: "zoe", subject: "ailleurs" });
    await desk.reply(b.id, "hello", "Angelo");
    await desk.close(c.id, "Angelo");
    expect(desk.tickets.awaitingStats("gA")).toEqual({ support: 1, customer: 1 });
    expect(desk.tickets.awaitingStats("gB")).toEqual({ support: 1, customer: 0 });
    expect(a.id).toBeGreaterThan(0);
  });
  test("migration : la colonne existe", () => {
    const cols = openDb(":memory:").query<{ name: string }, []>("PRAGMA table_info(tickets)").all().map((c) => c.name);
    expect(cols).toContain("awaiting");
  });
});

describe("API", () => {
  test("la liste expose awaiting par ticket et les compteurs", async () => {
    const h = createHandler(desk, { panelPassword: "pw", sessionSecret: "s".repeat(32) }, undefined, {
      list: () => [{ id: "gA", name: "A", icon: null }],
    });
    const t = await desk.open({ ...user, subject: "a" });
    await desk.open({ ...user, userId: "u2", userName: "bob", subject: "b" });
    await desk.reply(t.id, "hello", "Angelo");
    const login = await h(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }) }));
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const r = await (await h(new Request("http://x/api/tickets?guild=gA", { headers: { cookie } }))).json();
    expect(r.awaiting).toEqual({ support: 1, customer: 1 });
    expect(r.tickets.find((x: any) => x.id === t.id).awaiting).toBe("customer");
  });
});
