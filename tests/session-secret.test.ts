import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";
import { persistedSessionSecret } from "../src/session-secret";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "session-secret-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("persistedSessionSecret", () => {
  test("is created on first start, next to the database", () => {
    const s = persistedSessionSecret(join(dir, "tickets.db"));
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(join(dir, "session-secret"), "utf8").trim()).toBe(s);
  });
  test("is the same after a restart", () => {
    const db = join(dir, "tickets.db");
    expect(persistedSessionSecret(db)).toBe(persistedSessionSecret(db));
  });
  test("a damaged or too short file is replaced by a fresh secret and kept", () => {
    writeFileSync(join(dir, "session-secret"), "short");
    const s = persistedSessionSecret(join(dir, "tickets.db"));
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(persistedSessionSecret(join(dir, "tickets.db"))).toBe(s);
  });
  test("an in-memory database writes nothing", () => {
    expect(persistedSessionSecret(":memory:").length).toBeGreaterThanOrEqual(32);
  });
});

describe("sessions survive a restart", () => {
  const gw: Gateway = {
    createTicketChannel: async () => "c1",
    send: async () => {},
    setUserLocked: async () => {},
    deleteChannel: async () => {},
  };
  const start = (secret: string) =>
    createHandler(new SupportDesk(new TicketService(openDb(":memory:")), gw), { panelPassword: "pw", sessionSecret: secret }, undefined, {
      list: () => [{ id: "g1", name: "Test", icon: null }],
    });

  async function cookieFrom(handle: (r: Request) => Promise<Response>) {
    const r = await handle(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }), headers: { "content-type": "application/json" } }));
    return r.headers.get("set-cookie")!.split(";")[0]!;
  }
  const me = (handle: (r: Request) => Promise<Response>, cookie: string) => handle(new Request("http://x/api/me", { headers: { cookie } }));

  test("a new process with the stored secret accepts the old cookie", async () => {
    const db = join(dir, "tickets.db");
    const cookie = await cookieFrom(start(persistedSessionSecret(db)));
    expect((await me(start(persistedSessionSecret(db)), cookie)).status).toBe(200);
  });
  test("a different secret rejects it (what happened at every restart before)", async () => {
    const cookie = await cookieFrom(start("a".repeat(32)));
    expect((await me(start("b".repeat(32)), cookie)).status).toBe(401);
  });
});
