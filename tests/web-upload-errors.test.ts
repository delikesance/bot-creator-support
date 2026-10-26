import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const dir = mkdtempSync(join(tmpdir(), "up-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let failWith: unknown = null;
const gw: Gateway = {
  createTicketChannel: async () => "chan1",
  send: async () => {
    if (failWith) throw failWith;
  },
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
let handle: (r: Request) => Promise<Response>;
let desk: SupportDesk;

async function reply(id: number, files: string[]) {
  const l = await handle(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }), headers: { "content-type": "application/json" } }));
  const f = new FormData();
  f.set("content", "voici");
  for (const n of files) f.append("files", new File([png as BlobPart], n));
  return handle(new Request(`http://x/api/tickets/${id}/reply`, { method: "POST", body: f, headers: { cookie: l.headers.get("set-cookie")!.split(";")[0]! } }));
}

beforeEach(() => {
  failWith = null;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw, { attachmentsDir: dir });
  handle = createHandler(desk, { panelPassword: "pw", sessionSecret: "s".repeat(32) }, undefined, { list: () => [{ id: "g1", name: "T", icon: null }] });
});

const open = () => desk.open({ guildId: "g1", userId: "u1", userName: "alice", subject: "a" });

describe("refus de Discord à l'envoi d'une réponse", () => {
  test("fichier trop gros pour le serveur : 413 qui nomme le fichier, rien d'historisé", async () => {
    const t = await open();
    failWith = Object.assign(new Error("Request entity too large"), { code: 40005, status: 413 });
    const r = await reply(t.id, ["capture.png"]);
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toContain("capture.png");
    expect(desk.tickets.messages(t.id).filter((m) => m.source === "panel")).toHaveLength(0);
  });
  test("autre refus avec fichiers : 502 qui nomme les fichiers", async () => {
    const t = await open();
    failWith = new Error("Missing Permissions");
    const r = await reply(t.id, ["a.png", "b.png"]);
    expect(r.status).toBe(502);
    const msg = ((await r.json()) as { error: string }).error;
    expect(msg).toContain('"a.png"');
    expect(msg).toContain('"b.png"');
    expect(msg).toContain("Missing Permissions");
  });
  test("Discord indisponible sans fichier : 502", async () => {
    const t = await open();
    failWith = new Error("fetch failed");
    expect((await reply(t.id, [])).status).toBe(502);
  });
});
