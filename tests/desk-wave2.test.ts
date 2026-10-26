import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService, TicketError } from "../src/tickets";
import { SupportDesk, type Gateway, type OutFile } from "../src/desk";
import { buildTranscript } from "../src/transcript";
import { pack } from "../src/i18n";

class Gw implements Gateway {
  sent: { text: string; opts?: { files?: OutFile[]; style?: string; as?: unknown } }[] = [];
  rated: [string, number, string | undefined][] = [];
  deleted: string[] = [];
  async createTicketChannel() {
    return "chan1";
  }
  async send(_c: string, text: string, opts?: { files?: OutFile[]; style?: string; as?: unknown }) {
    this.sent.push({ text, opts });
  }
  async setUserLocked() {}
  async deleteChannel(c: string) {
    this.deleted.push(c);
  }
  async askRating(c: string, id: number, locale?: string) {
    this.rated.push([c, id, locale]);
  }
}

let gw: Gw;
let desk: SupportDesk;
const user = { userId: "u1", guildId: "g1", userName: "alice", locale: "fr" };
const actions = (id: number) => desk.tickets.audit(id).map((a) => `${a.actor}:${a.action}`);

beforeEach(() => {
  gw = new Gw();
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
});

describe("notes internes", () => {
  test("jamais envoyée sur Discord, ne change ni l'attente ni l'attribution, auditée", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const sentBefore = gw.sent.length;
    const before = desk.tickets.get(t.id)!;
    const m = await desk.note(t.id, "  à suivre @bob ", "Angelo");
    expect(m).toMatchObject({ internal: true, source: "panel", content: "à suivre @bob" });
    expect(gw.sent.length).toBe(sentBefore);
    const after = desk.tickets.get(t.id)!;
    expect(after.awaiting).toBe(before.awaiting);
    expect(after.status).toBe("open");
    expect(after.assignee).toBeNull();
    expect(actions(t.id)).toContain("Angelo:note");
  });
  test("note vide refusée ; ticket fermé accepté", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await expect(desk.note(t.id, "  ", "A")).rejects.toThrow(TicketError);
    await desk.close(t.id, "A");
    expect((await desk.note(t.id, "après coup", "A")).internal).toBe(true);
  });
});

describe("attribution", () => {
  test("assigne avec une note système et l'auteur dans l'audit, puis libère", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const a = desk.assign(t.id, "Bob", "Angelo", "d1");
    expect(a).toMatchObject({ assignee: "Bob", assigneeId: "d1" });
    expect(desk.tickets.messages(t.id).at(-1)!.content).toContain("Bob");
    expect(actions(t.id)).toContain("Angelo:assign");
    expect(desk.assign(t.id, null, "Angelo", null).assignee).toBeNull();
  });
});

describe("fermeture avec options", () => {
  test("sans option : message localisé en embed « closed », raison absente", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const c = await desk.close(t.id, "Angelo");
    expect(c.closeReason).toBeNull();
    expect(gw.sent.at(-1)).toEqual({ text: pack("fr").noticeClosed, opts: { style: "closed" } });
    expect(gw.rated).toEqual([]);
  });
  test("raison enregistrée et acteur dans l'audit", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const c = await desk.close(t.id, "Angelo", { reason: "resolved" });
    expect(c.closeReason).toBe("resolved");
    expect(actions(t.id)).toContain("Angelo:close");
  });
  test("message personnalisé posté tel quel et gardé dans la conversation", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "Angelo", { message: "  Merci, à bientôt !  " });
    expect(gw.sent.at(-1)!.text).toBe("Merci, à bientôt !");
    const m = desk.tickets.messages(t.id).find((x) => x.content === "Merci, à bientôt !")!;
    expect(m).toMatchObject({ source: "panel", authorName: "Angelo" });
  });
  test("message trop long refusé avant de fermer", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await expect(desk.close(t.id, "A", { message: "x".repeat(2001) })).rejects.toThrow(TicketError);
    expect(desk.tickets.get(t.id)!.status).toBe("open");
  });
  test("askRating demande la note dans la langue du ticket", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "A", { askRating: true });
    expect(gw.rated).toEqual([["chan1", t.id, "fr"]]);
  });
  test("sendTranscript joint un .txt sans notes internes", async () => {
    const t = await desk.open({ ...user, subject: "Bug" });
    await desk.reply(t.id, "Bonjour", "Angelo");
    await desk.note(t.id, "SECRET", "Angelo");
    await desk.close(t.id, "Angelo", { sendTranscript: true });
    const sent = gw.sent.at(-1)!;
    expect(sent.text).toBe(pack("fr").transcriptText);
    const file = sent.opts!.files![0]!;
    expect(file.name).toBe(`transcript-${t.id}.txt`);
    const txt = new TextDecoder().decode(file.data);
    expect(txt).toContain("Bonjour");
    expect(txt).not.toContain("SECRET");
  });
});

describe("transcription", () => {
  test("messages publics seulement, pièces jointes nommées", async () => {
    const t = await desk.open({ ...user, subject: "Bug", description: "ça plante" });
    await desk.reply(t.id, "On regarde", "Angelo");
    await desk.note(t.id, "note privée", "Angelo");
    const txt = desk.transcript(t.id);
    expect(txt).toContain(`Ticket #${t.id}: Bug`);
    expect(txt).toContain("alice: ça plante");
    expect(txt).toContain("Angelo: On regarde");
    expect(txt).not.toContain("note privée");
    expect(txt).not.toContain("Picked up");
  });
  test("buildTranscript indente les lignes suivantes et liste les fichiers", () => {
    const t = { id: 1, subject: "S", userName: "u", createdAt: Date.UTC(2026, 0, 2, 3, 4), closedAt: null } as never;
    const m = [
      { internal: false, source: "discord", createdAt: Date.UTC(2026, 0, 2, 3, 5), authorName: "u", content: "a\nb", attachments: [{ name: "x.png" }] },
    ] as never;
    expect(buildTranscript(t, m)).toBe("Ticket #1: S\nCustomer: u\nOpened: 2026-01-02 03:04 UTC\n\n[2026-01-02 03:05 UTC] u: a\n    b\n    [file] x.png\n");
  });
  test("ticket inconnu", () => {
    expect(() => desk.transcript(99)).toThrow(/not found/);
  });
});

describe("note du client et suppression", () => {
  test("seul l'auteur note, une fois, ticket fermé", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await expect(desk.rate(t.id, "u1", 5)).rejects.toThrow(TicketError); // pas fermé
    await desk.close(t.id, "A");
    await expect(desk.rate(t.id, "intrus", 5)).rejects.toThrow(TicketError);
    expect((await desk.rate(t.id, "u1", 4)).rating).toBe(4);
    await expect(desk.rate(t.id, "u1", 5)).rejects.toThrow(TicketError);
  });
  test("suppression du salon auditée avec l'auteur", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "A");
    await desk.deleteChannel(t.id, "Angelo");
    expect(gw.deleted).toEqual(["chan1"]);
    expect(actions(t.id)).toContain("Angelo:delete_channel");
  });
  test("réouverture auditée avec l'auteur", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.close(t.id, "A");
    await desk.reopen(t.id, "Angelo");
    expect(actions(t.id)).toContain("Angelo:reopen");
  });
});
