import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { TicketService, TicketError } from "../src/tickets";
import { SupportDesk, formatLinks, type Gateway, type OutFile } from "../src/desk";
import { AttachmentError } from "../src/storage";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

class Gw implements Gateway {
  sent: { text: string; files?: OutFile[]; as?: unknown }[] = [];
  fail = false;
  async createTicketChannel() {
    return "chan1";
  }
  async send(_c: string, text: string, o?: { files?: OutFile[]; as?: unknown }) {
    if (this.fail) throw new Error("discord down");
    this.sent.push({ text, files: o?.files, as: o?.as });
  }
  async setUserLocked() {}
  async deleteChannel() {}
}

let gw: Gw;
let desk: SupportDesk;
let dir: string;
let downloads: Record<string, () => Promise<Uint8Array>>;
const user = { userId: "u1", guildId: "g1", userName: "alice" };

beforeEach(() => {
  gw = new Gw();
  dir = mkdtempSync(join(tmpdir(), "desk-"));
  dirs.push(dir);
  downloads = {};
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw, {
    attachmentsDir: dir,
    download: (url) => (downloads[url] ?? (() => Promise.reject(new Error("HTTP 404"))))(),
  });
});

describe("liens dans les réponses", () => {
  test("URL nue inchangée", () => {
    expect(formatLinks("voir https://exemple.fr/a?b=1 merci")).toBe("voir https://exemple.fr/a?b=1 merci");
  });
  test("[texte](url) : texte puis URL seule sur sa ligne", () => {
    expect(formatLinks("[la doc](https://exemple.fr/doc)")).toBe("la doc\nhttps://exemple.fr/doc");
    expect(formatLinks("Lis [la doc](https://exemple.fr/doc) puis réponds")).toBe("Lis la doc\nhttps://exemple.fr/doc\n puis réponds");
  });
  test("texte identique à l'URL : URL seule", () => {
    expect(formatLinks("[https://a.fr](https://a.fr)")).toBe("https://a.fr");
  });
  test("schéma autre que http(s) : laissé tel quel", () => {
    expect(formatLinks("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
  });
});

describe("réponse avec fichiers", () => {
  test("fichiers envoyés au gateway, stockés, message retourné avec ses pièces jointes", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const m = await desk.reply(t.id, "voici", "Angelo", undefined, [{ name: "capture.png", data: png }]);
    expect(gw.sent.at(-1)!.files).toEqual([{ name: "capture.png", data: png }]);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ name: "capture.png", kind: "image", size: png.length });
    const stored = desk.tickets.attachment(m.attachments[0]!.id)!;
    expect(existsSync(join(dir, stored.file))).toBe(true);
    expect(stored.guildId).toBe("g1");
  });
  test("fichier seul, sans texte", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const m = await desk.reply(t.id, "  ", "Angelo", undefined, [{ name: "a.png", data: png }]);
    expect(m.content).toBe("");
    expect(gw.sent.at(-1)!.text).toBe("");
  });
  test("fichier refusé : rien n'est envoyé ni historisé", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const before = gw.sent.length;
    await expect(desk.reply(t.id, "salut", "A", undefined, [{ name: "x.exe", data: png }])).rejects.toBeInstanceOf(AttachmentError);
    expect(gw.sent.length).toBe(before);
    expect(desk.tickets.messages(t.id).filter((m) => m.source === "panel")).toHaveLength(0);
  });
  test("échec Discord : rien n'est stocké", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    gw.fail = true;
    await expect(desk.reply(t.id, "x", "A", undefined, [{ name: "a.png", data: png }])).rejects.toThrow();
    expect(desk.tickets.messages(t.id).filter((m) => m.attachments.length)).toHaveLength(0);
  });
  test("message de plus de 2000 caractères refusé", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await expect(desk.reply(t.id, "x".repeat(2001), "A")).rejects.toThrow(TicketError);
  });
  test("stockage non configuré : fichiers refusés", async () => {
    const d = new SupportDesk(new TicketService(openDb(":memory:")), gw);
    const t = await d.open({ ...user, subject: "a" });
    await expect(d.reply(t.id, "x", "A", undefined, [{ name: "a.png", data: png }])).rejects.toThrow(/storage/);
  });
});

describe("pièces jointes des clients", () => {
  const file = (name: string, url: string, size = 10) => ({ name, url, size });

  test("téléchargée, stockée localement, message sans texte enregistré", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    downloads["https://cdn/a.png"] = async () => png;
    await desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "", [file("a.png", "https://cdn/a.png")]);
    const m = desk.tickets.messages(t.id).filter((x) => x.source === "discord").at(-1)!;
    expect(m.content).toBe("");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.url).toMatch(/^\/api\/attachments\/\d+$/);
    expect(existsSync(join(dir, desk.tickets.attachment(m.attachments[0]!.id)!.file))).toBe(true);
    expect(desk.tickets.get(t.id)!.awaiting).toBe("support");
  });
  test("échec du téléchargement : message gardé, fichier ignoré, note système avec le lien", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    await desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "regarde", [file("b.png", "https://cdn/b.png")]);
    const msgs = desk.tickets.messages(t.id);
    const m = msgs.find((x) => x.content === "regarde")!;
    expect(m.attachments).toHaveLength(0);
    const note = msgs.at(-1)!;
    expect(note.source).toBe("system");
    expect(note.content).toContain("b.png");
    expect(note.content).toContain("https://cdn/b.png");
  });
  test("pièce jointe seule qui échoue : pas de message vide, juste la note", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    const before = desk.tickets.messages(t.id).length;
    await desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "", [file("c.png", "https://cdn/c.png")]);
    const added = desk.tickets.messages(t.id).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.source).toBe("system");
  });
  test("type refusé, contenu menteur ou trop gros : ignorés avec une note", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    downloads["https://cdn/v.mp4"] = async () => png;
    downloads["https://cdn/fake.png"] = async () => new Uint8Array([77, 90, 0, 1]);
    await desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "x", [
      file("v.mp4", "https://cdn/v.mp4"),
      file("fake.png", "https://cdn/fake.png"),
      file("gros.zip", "https://cdn/gros.zip", 30 * 1024 * 1024),
    ]);
    const notes = desk.tickets.messages(t.id).filter((x) => x.content.startsWith("⚠️ Attachment"));
    expect(notes).toHaveLength(3);
  });
  test("ordre conservé : un message sans fichier après un message avec fichier", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    let release!: () => void;
    downloads["https://cdn/slow.png"] = () => new Promise((r) => (release = () => r(png)));
    const first = desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "un", [file("slow.png", "https://cdn/slow.png")]);
    const second = desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "deux");
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    const texts = desk.tickets.messages(t.id).filter((x) => x.source === "discord").map((x) => x.content);
    expect(texts.slice(-2)).toEqual(["un", "deux"]);
  });
  test("message sans fichier : toujours synchrone", async () => {
    const t = await desk.open({ ...user, subject: "a" });
    void desk.recordDiscordMessage("chan1", { id: "u1", name: "alice" }, "sync");
    expect(desk.tickets.messages(t.id).at(-1)!.content).toBe("sync");
  });
});
