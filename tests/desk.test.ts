import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService, TicketError } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";

class FakeGateway implements Gateway {
  channels = 0;
  sent: { channelId: string; text: string }[] = [];
  locked: { channelId: string; locked: boolean }[] = [];
  deleted: string[] = [];
  failSend = false;
  async createTicketChannel(_o: { userId: string; userName: string }) {
    return `chan${++this.channels}`;
  }
  async send(channelId: string, text: string) {
    if (this.failSend) throw new Error("discord down");
    this.sent.push({ channelId, text });
  }
  async setUserLocked(channelId: string, _userId: string, locked: boolean) {
    this.locked.push({ channelId, locked });
  }
  async deleteChannel(channelId: string) {
    this.deleted.push(channelId);
  }
}

let gw: FakeGateway;
let desk: SupportDesk;
const user = { userId: "u1", guildId: "g1", userName: "alice" };

beforeEach(() => {
  gw = new FakeGateway();
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw, { maxActivePerUser: 1 });
});

describe("ouverture", () => {
  test("crée salon + ticket + message d'accueil", async () => {
    const t = await desk.open({ ...user, subject: "Bug" });
    expect(t.channelId).toBe("chan1");
    expect(t.status).toBe("open");
    expect(gw.sent[0]!.channelId).toBe("chan1");
    expect(gw.sent[0]!.text).toContain("<@u1>");
    expect(gw.sent[0]!.text).toContain("bientôt");
  });
  test("un seul message sobre : pas d'introduction ni d'écho du sujet", async () => {
    await desk.open({ ...user, subject: "Bug", description: "détails" });
    expect(gw.sent).toHaveLength(1);
    expect(gw.sent[0]!.text).not.toContain("Bug");
    expect(gw.sent[0]!.text).not.toContain("détails");
    expect(gw.sent[0]!.text.length).toBeLessThan(160);
  });

  test("limite par utilisateur appliquée AVANT de créer le salon", async () => {
    await desk.open({ ...user, subject: "a" });
    await expect(desk.open({ ...user, subject: "b" })).rejects.toThrow(TicketError);
    expect(gw.channels).toBe(1);
  });

  test("sujet vide refusé", async () => {
    await expect(desk.open({ ...user, subject: "   " })).rejects.toThrow(/sujet/i);
  });

  test("sujet tronqué à 100 caractères", async () => {
    const t = await desk.open({ ...user, subject: "x".repeat(300) });
    expect(t.subject.length).toBe(100);
  });
});

describe("réponses du panel", () => {
  test("pseudo et avatar transmis au gateway pour le webhook", async () => {
    const sentOpts: unknown[] = [];
    const d = new SupportDesk(new TicketService(openDb(":memory:")), {
      createTicketChannel: async () => "c1",
      send: async (_c, _t, o) => void sentOpts.push(o),
      setUserLocked: async () => {},
      deleteChannel: async () => {},
    });
    const t = await d.open({ ...user, subject: "a" });
    sentOpts.length = 0;
    await d.reply(t.id, "Salut", "Angelo", "https://cdn.test/a.png");
    expect(sentOpts).toEqual([{ as: { name: "Angelo", avatarUrl: "https://cdn.test/a.png" } }]);
    await d.reply(t.id, "Re", "Support");
    expect(sentOpts.at(-1)).toEqual({ as: { name: "Support", avatarUrl: undefined } });
  });
});

describe("cycle de vie", () => {

  test("close verrouille l'utilisateur et notifie", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "admin");
    expect(gw.locked.at(-1)).toEqual({ channelId: "chan1", locked: true });
    expect(desk.tickets.get(t.id)!.status).toBe("closed");
  });

  test("reopen déverrouille", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "admin");
    await desk.reopen(t.id, "admin");
    expect(gw.locked.at(-1)).toEqual({ channelId: "chan1", locked: false });
    expect(desk.tickets.get(t.id)!.status).toBe("open");
  });

  test("un panneau peut rouvrir puis l'utilisateur peut rouvrir un ticket", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "alice");
    // fermé => plus compté dans la limite
    await expect(desk.open({ ...user, subject: "b" })).resolves.toBeTruthy();
  });

  test("delete supprime le salon d'un ticket fermé uniquement", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await expect(desk.deleteChannel(t.id)).rejects.toThrow(TicketError);
    await desk.close(t.id, "admin");
    await desk.deleteChannel(t.id);
    expect(gw.deleted).toEqual(["chan1"]);
  });
});

describe("messages", () => {
  test("réponse du panel envoyée dans Discord et historisée", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.reply(t.id, "Bonjour", "Support");
    expect(gw.sent.at(-1)).toEqual({ channelId: "chan1", text: "Bonjour" });
    const m = desk.tickets.messages(t.id).at(-1)!;
    expect(m.source).toBe("panel");
  });

  test("réponse vide refusée", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await expect(desk.reply(t.id, "  ", "Support")).rejects.toThrow(TicketError);
  });

  test("réponse sur ticket fermé refusée", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "admin");
    await expect(desk.reply(t.id, "hello", "Support")).rejects.toThrow(/fermé/);
  });

  test("échec d'envoi Discord : message non historisé", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    gw.failSend = true;
    await expect(desk.reply(t.id, "hello", "Support")).rejects.toThrow();
    expect(desk.tickets.messages(t.id).filter((m) => m.source === "panel")).toHaveLength(0);
  });

  test("message Discord d'un salon ticket historisé, autres ignorés", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "salut");
    desk.recordDiscordMessage("autre", { id: "u1", name: "alice" }, "ignoré");
    expect(desk.tickets.messages(t.id).filter((m) => m.source === "discord")).toHaveLength(1);
  });

  test("un message d'un user passe un ticket in_progress inchangé, et un ticket open reste open", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "salut");
    expect(desk.tickets.get(t.id)!.status).toBe("open");
  });
});
