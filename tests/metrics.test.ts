import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { computeMetrics } from "../src/metrics";
import { TicketService } from "../src/tickets";

const MIN = 60_000;
const DAY = 86_400_000;
let db: Database;
let svc: TicketService;
const NOW = new Date(2026, 5, 15, 14, 0, 0).getTime();

/** Insère un ticket avec des dates choisies (le service utilise l'heure réelle). */
function seed(n: number, o: Partial<{ guild: string; created: number; first: number | null; closed: number | null; rating: number | null; awaiting: string; waiting: number | null }> = {}) {
  db.query(
    `INSERT INTO tickets (user_id,user_name,guild_id,channel_id,subject,awaiting,status,created_at,updated_at,closed_at,first_response_at,rating,waiting_since)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    `u${n}`,
    `user${n}`,
    o.guild ?? "g1",
    `c${n}`,
    `Sujet ${n}`,
    o.awaiting ?? "support",
    o.closed ? "closed" : "open",
    o.created ?? NOW - DAY,
    o.created ?? NOW - DAY,
    o.closed ?? null,
    o.first ?? null,
    o.rating ?? null,
    o.waiting ?? null,
  );
}

beforeEach(() => {
  db = openDb(":memory:");
  svc = new TicketService(db);
});

describe("metrics", () => {
  test("base vide : tout est nul, cibles fixes", () => {
    expect(computeMetrics(db, "g1", 7, NOW)).toEqual({
      waitingNow: 0,
      oldestWaiting: null,
      firstReplyMedianMs: null,
      resolutionMedianMs: null,
      resolvedToday: 0,
      satisfactionAvg: null,
      satisfactionCount: 0,
      targets: { firstReplyMs: 900000, replyMs: 3600000 },
    });
  });

  test("waitingNow et oldestWaiting : tickets actifs où le support doit répondre", () => {
    seed(1, { waiting: NOW - 10 * MIN });
    seed(2, { waiting: NOW - 90 * MIN });
    seed(3, { awaiting: "customer", waiting: null });
    seed(4, { closed: NOW - MIN, waiting: null });
    seed(5, { guild: "g2", waiting: NOW - 500 * MIN });
    const m = computeMetrics(db, "g1", 7, NOW);
    expect(m.waitingNow).toBe(2);
    expect(m.oldestWaiting).toEqual({ ticketId: 2, subject: "Sujet 2", userName: "user2", ms: 90 * MIN });
  });

  test("sans waiting_since, l'attente part de la création", () => {
    seed(1, { created: NOW - 30 * MIN });
    expect(computeMetrics(db, "g1", 7, NOW).oldestWaiting!.ms).toBe(30 * MIN);
  });

  test("médiane du premier délai de réponse (tickets créés dans la fenêtre)", () => {
    seed(1, { created: NOW - DAY, first: NOW - DAY + 10 * MIN });
    seed(2, { created: NOW - DAY, first: NOW - DAY + 20 * MIN });
    seed(3, { created: NOW - DAY, first: NOW - DAY + 60 * MIN });
    seed(4, { created: NOW - 30 * DAY, first: NOW - 30 * DAY + MIN });
    seed(5, { created: NOW - DAY });
    expect(computeMetrics(db, "g1", 7, NOW).firstReplyMedianMs).toBe(20 * MIN);
    seed(6, { created: NOW - DAY, first: NOW - DAY + 30 * MIN });
    expect(computeMetrics(db, "g1", 7, NOW).firstReplyMedianMs).toBe(25 * MIN);
  });

  test("médiane de résolution, résolus aujourd'hui, satisfaction (fermés dans la fenêtre)", () => {
    const today = new Date(2026, 5, 15, 9, 0, 0).getTime();
    seed(1, { created: today - 2 * 60 * MIN, closed: today, rating: 5 });
    seed(2, { created: NOW - 3 * DAY, closed: NOW - 3 * DAY + 4 * 60 * MIN, rating: 4 });
    seed(3, { created: NOW - 3 * DAY, closed: NOW - 3 * DAY + 6 * 60 * MIN });
    seed(4, { created: NOW - 40 * DAY, closed: NOW - 39 * DAY, rating: 1 });
    const m = computeMetrics(db, "g1", 7, NOW);
    expect(m.resolutionMedianMs).toBe(4 * 60 * MIN);
    expect(m.resolvedToday).toBe(1);
    expect(m.satisfactionCount).toBe(2);
    expect(m.satisfactionAvg).toBe(4.5);
  });

  test("le service expose metrics(guildId, days)", () => {
    const t = svc.create({ guildId: "g1", userId: "u", userName: "n", channelId: "c", subject: "s" });
    svc.addMessage(t.id, { authorId: "u", authorName: "n", content: "aide", source: "discord" });
    const m = svc.metrics("g1", 7);
    expect(m.waitingNow).toBe(1);
    expect(m.oldestWaiting!.ticketId).toBe(t.id);
  });
});
