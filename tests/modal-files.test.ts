import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway, type OutFile } from "../src/desk";
import { handleInteraction, type Ix } from "../src/bot/handlers";
import { pack } from "../src/i18n";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

class Gw implements Gateway {
  sent: { text: string; files?: OutFile[]; as?: { name: string } }[] = [];
  async createTicketChannel() {
    return "chan1";
  }
  async send(_c: string, text: string, o?: { files?: OutFile[]; as?: { name: string } }) {
    this.sent.push({ text, files: o?.files, as: o?.as });
  }
  async setUserLocked() {}
  async deleteChannel() {}
}

let gw: Gw;
let desk: SupportDesk;
const user = { userId: "u1", guildId: "g1", userName: "alice", subject: "Crash on start", description: "It crashes right after the splash screen, every time." };

beforeEach(() => {
  gw = new Gw();
  const dir = mkdtempSync(join(tmpdir(), "modal-files-"));
  dirs.push(dir);
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw, {
    attachmentsDir: dir,
    download: async (url) => {
      if (url.endsWith("/boom.png")) throw new Error("HTTP 404");
      return png;
    },
  });
});

describe("files attached in the ticket form", () => {
  test("they are saved on the ticket as the customer's message", async () => {
    const t = await desk.open({ ...user, files: [{ name: "shot.png", size: png.length, url: "https://cdn/a/shot.png" }] });
    const withFiles = desk.tickets.messages(t.id).filter((m) => m.attachments.length);
    expect(withFiles).toHaveLength(1);
    expect(withFiles[0]).toMatchObject({ authorId: "u1", authorName: "alice", source: "discord" });
    expect(withFiles[0]!.attachments[0]).toMatchObject({ name: "shot.png", mime: "image/png" });
  });
  test("they are also posted in the ticket channel under the customer's name", async () => {
    await desk.open({ ...user, files: [{ name: "shot.png", size: png.length, url: "https://cdn/a/shot.png" }] });
    const post = gw.sent.find((s) => s.files?.length)!;
    expect(post.as?.name).toBe("alice");
    expect(post.files![0]!.name).toBe("shot.png");
  });
  test("a file that cannot be saved leaves a system note and the ticket still opens", async () => {
    const t = await desk.open({ ...user, files: [{ name: "boom.png", size: 10, url: "https://cdn/a/boom.png" }] });
    expect(desk.tickets.messages(t.id).some((m) => m.source === "system" && m.content.includes("boom.png"))).toBe(true);
    expect(gw.sent.some((s) => s.files?.length)).toBe(false);
  });
  test("a file of a forbidden type is refused with a note", async () => {
    const t = await desk.open({ ...user, files: [{ name: "run.exe", size: 10, url: "https://cdn/a/run.exe" }] });
    expect(desk.tickets.messages(t.id).some((m) => m.content.includes("run.exe") && m.source === "system")).toBe(true);
  });
  test("no files: nothing changes", async () => {
    const t = await desk.open(user);
    expect(desk.tickets.messages(t.id).some((m) => m.attachments.length)).toBe(false);
  });
});

describe("the modal submit passes its files on", () => {
  test("handler forwards them to the desk", async () => {
    const replies: string[] = [];
    const ix: Ix = {
      kind: "modal", id: "ticket:modal", userId: "u1", userName: "alice", guildId: "g1", channelId: "c", isStaff: false,
      subject: user.subject, description: user.description, locale: "en",
      files: [{ name: "shot.png", size: png.length, url: "https://cdn/a/shot.png" }],
      reply: async (t) => void replies.push(t), showSubjectModal: async () => {}, postPanel: async () => {},
    };
    await handleInteraction(desk, ix);
    expect(desk.tickets.list()[0]).toBeTruthy();
    expect(desk.tickets.messages(desk.tickets.list()[0]!.id).some((m) => m.attachments.length)).toBe(true);
  });
});

describe("the form text", () => {
  test("every language has a label and a description for the file field", () => {
    for (const loc of ["en", "fr", "es", "de", "pt-BR", "it", "nl", "pl", "ru", "tr", "ja", "ko", "zh-CN"]) {
      expect(pack(loc).filesLabel.length).toBeGreaterThan(0);
      expect(pack(loc).filesLabel.length).toBeLessThanOrEqual(45);
      expect(pack(loc).filesDesc.length).toBeGreaterThan(0);
      expect(pack(loc).filesDesc.length).toBeLessThanOrEqual(100);
    }
  });
});
