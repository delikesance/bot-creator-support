import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";

let n = 0;
const sent: string[] = [];
const gw: Gateway = {
  createTicketChannel: async () => `chan${++n}`,
  send: async (_c, t) => void sent.push(t),
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
const user = { guildId: "gA", userId: "u1", userName: "alice" };

let desk: SupportDesk;
beforeEach(() => {
  n = 0;
  sent.length = 0;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
});

const status = (id: number) => desk.tickets.get(id)!.status;

describe("prise en charge automatique", () => {
  test("un ticket neuf est ouvert, jusqu'à ce que le support réponde", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    expect(status(t.id)).toBe("open");
    desk.recordDiscordMessage(t.channelId, { id: "u1", name: "alice" }, "quelqu'un ?");
    expect(status(t.id)).toBe("open");
  });

  test("une réponse du panel le passe en cours, attribué à celui qui répond", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    sent.length = 0;
    await desk.reply(t.id, "Bonjour", "Angelo");
    const after = desk.tickets.get(t.id)!;
    expect(after.status).toBe("in_progress");
    expect(after.assignee).toBe("Angelo");
    // Discord ne reçoit que la réponse, pas de message de statut en plus.
    expect(sent).toEqual(["Bonjour"]);
    expect(desk.tickets.messages(t.id).some((m) => m.source === "system" && m.content.includes("Angelo"))).toBe(true);
  });

  test("un membre du staff qui écrit dans le salon le prend aussi en charge", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    desk.recordDiscordMessage(t.channelId, { id: "staff1", name: "Modo" }, "je regarde");
    expect(desk.tickets.get(t.id)).toMatchObject({ status: "in_progress", assignee: "Modo" });
  });

  test("le premier à répondre reste l'assigné", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.reply(t.id, "un", "Angelo");
    await desk.reply(t.id, "deux", "Autre");
    expect(desk.tickets.get(t.id)!.assignee).toBe("Angelo");
  });

  test("un ticket fermé n'est pas modifié par un message dans le salon", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "Angelo");
    desk.recordDiscordMessage(t.channelId, { id: "staff1", name: "Modo" }, "trop tard");
    expect(status(t.id)).toBe("closed");
  });

  test("rouvert puis réponse : de nouveau pris en charge", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.reply(t.id, "un", "Angelo");
    await desk.close(t.id, "Angelo");
    await desk.reopen(t.id, "Angelo");
    expect(status(t.id)).toBe("open");
    await desk.reply(t.id, "re", "Angelo");
    expect(status(t.id)).toBe("in_progress");
  });
});

describe("API : plus d'actions manuelles de prise en charge", () => {
  test("claim et release n'existent plus ; close et reopen restent", async () => {
    const h = createHandler(desk, { panelPassword: "pw", sessionSecret: "s".repeat(32) }, undefined, {
      list: () => [{ id: "gA", name: "A", icon: null }],
    });
    const login = await h(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }) }));
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const t = await desk.open({ ...user, subject: "a" });
    const post = (a: string) => h(new Request(`http://x/api/tickets/${t.id}/${a}`, { method: "POST", headers: { cookie } }));
    expect((await post("claim")).status).toBe(404);
    expect((await post("release")).status).toBe(404);
    expect((await post("close")).status).toBe(200);
    expect((await post("reopen")).status).toBe(200);
  });
});
