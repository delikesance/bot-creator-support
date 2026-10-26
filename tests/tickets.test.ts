import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService, TicketError } from "../src/tickets";

let svc: TicketService;
const base = { userId: "u1", userName: "alice", channelId: "c1", subject: "Aide" };

beforeEach(() => {
  svc = new TicketService(openDb(":memory:"));
});

describe("création", () => {
  test("un nouveau ticket est ouvert", () => {
    const t = svc.create(base);
    expect(t.id).toBe(1);
    expect(t.status).toBe("open");
    expect(t.assignee).toBeNull();
    expect(svc.getByChannel("c1")?.id).toBe(1);
  });

  test("refuse plus de tickets actifs que la limite", () => {
    svc.create(base);
    expect(() => svc.create({ ...base, channelId: "c2" }, { maxActivePerUser: 1 })).toThrow(TicketError);
  });

  test("un ticket fermé ne compte pas dans la limite", () => {
    const t = svc.create(base);
    svc.close(t.id);
    expect(() => svc.create({ ...base, channelId: "c2" }, { maxActivePerUser: 1 })).not.toThrow();
  });
});

describe("transitions", () => {
  test("open -> in_progress via claim avec assignee", () => {
    const t = svc.create(base);
    const c = svc.claim(t.id, { id: "a1", name: "admin" });
    expect(c.status).toBe("in_progress");
    expect(c.assignee).toBe("admin");
  });

  test("claim d'un ticket fermé interdit", () => {
    const t = svc.create(base);
    svc.close(t.id);
    expect(() => svc.claim(t.id, { id: "a1", name: "admin" })).toThrow(TicketError);
  });

  test("close pose closedAt, double close interdit", () => {
    const t = svc.create(base);
    const c = svc.close(t.id);
    expect(c.status).toBe("closed");
    expect(c.closedAt).not.toBeNull();
    expect(() => svc.close(t.id)).toThrow(TicketError);
  });

  test("reopen remet open et efface closedAt", () => {
    const t = svc.create(base);
    svc.close(t.id);
    const r = svc.reopen(t.id);
    expect(r.status).toBe("open");
    expect(r.closedAt).toBeNull();
    expect(r.assignee).toBeNull();
  });

  test("reopen d'un ticket non fermé interdit", () => {
    const t = svc.create(base);
    expect(() => svc.reopen(t.id)).toThrow(TicketError);
  });

  test("release : in_progress -> open", () => {
    const t = svc.create(base);
    svc.claim(t.id, { id: "a1", name: "admin" });
    const r = svc.release(t.id);
    expect(r.status).toBe("open");
    expect(r.assignee).toBeNull();
  });

  test("ticket inconnu", () => {
    expect(() => svc.close(999)).toThrow(/introuvable/);
  });
});

describe("liste, stats, messages", () => {
  test("list filtre par statut, plus récents d'abord", () => {
    const a = svc.create(base);
    const b = svc.create({ ...base, channelId: "c2" });
    svc.claim(b.id, { id: "a", name: "admin" });
    svc.close(a.id);
    expect(svc.list().map((t) => t.id)).toEqual([2, 1]);
    expect(svc.list("closed").map((t) => t.id)).toEqual([1]);
    expect(svc.list("in_progress").map((t) => t.id)).toEqual([2]);
    expect(svc.list("open")).toEqual([]);
  });

  test("stats par statut", () => {
    svc.create(base);
    const b = svc.create({ ...base, channelId: "c2" });
    svc.close(b.id);
    expect(svc.stats()).toEqual({ open: 1, in_progress: 0, closed: 1 });
  });

  test("messages enregistrés dans l'ordre", () => {
    const t = svc.create(base);
    svc.addMessage(t.id, { authorId: "u1", authorName: "alice", content: "salut", source: "discord" });
    svc.addMessage(t.id, { authorId: "panel", authorName: "Support", content: "bonjour", source: "panel" });
    const m = svc.messages(t.id);
    expect(m.map((x) => x.content)).toEqual(["salut", "bonjour"]);
    expect(m[1]!.source).toBe("panel");
  });
});
