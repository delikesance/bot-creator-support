import type { Database } from "bun:sqlite";

export interface Metrics {
  waitingNow: number;
  oldestWaiting: { ticketId: number; subject: string; userName: string; ms: number } | null;
  firstReplyMedianMs: number | null;
  resolutionMedianMs: number | null;
  resolvedToday: number;
  satisfactionAvg: number | null;
  satisfactionCount: number;
  targets: { firstReplyMs: number; replyMs: number };
}

export const TARGETS = { firstReplyMs: 900_000, replyMs: 3_600_000 };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/**
 * Indicateurs d'un serveur. Fenêtre de `days` jours : délais de première réponse sur les tickets créés dedans,
 * résolution et satisfaction sur ceux fermés dedans. « Aujourd'hui » commence à minuit, heure du serveur.
 */
export function computeMetrics(db: Database, guildId: string, days: number, now = Date.now()): Metrics {
  const since = now - Math.max(1, days) * 86_400_000;
  const midnight = new Date(now).setHours(0, 0, 0, 0);

  const waiting = db
    .query<{ id: number; subject: string; user_name: string; since: number }, [string]>(
      `SELECT id, subject, user_name, COALESCE(waiting_since, created_at) since FROM tickets
       WHERE guild_id = ? AND status != 'closed' AND awaiting = 'support' ORDER BY since ASC, id ASC`,
    )
    .all(guildId);

  const first = db
    .query<{ ms: number }, [string, number]>(
      `SELECT first_response_at - created_at ms FROM tickets
       WHERE guild_id = ? AND created_at >= ? AND first_response_at IS NOT NULL`,
    )
    .all(guildId, since)
    .map((r) => r.ms);

  const closed = db
    .query<{ ms: number; rating: number | null }, [string, number]>(
      "SELECT closed_at - created_at ms, rating FROM tickets WHERE guild_id = ? AND status = 'closed' AND closed_at >= ?",
    )
    .all(guildId, since);
  const ratings = closed.map((r) => r.rating).filter((r): r is number => r !== null);

  const resolvedToday = db
    .query<{ n: number }, [string, number]>(
      "SELECT COUNT(*) n FROM tickets WHERE guild_id = ? AND status = 'closed' AND closed_at >= ?",
    )
    .get(guildId, midnight)!.n;

  const oldest = waiting[0];
  return {
    waitingNow: waiting.length,
    oldestWaiting: oldest ? { ticketId: oldest.id, subject: oldest.subject, userName: oldest.user_name, ms: now - oldest.since } : null,
    firstReplyMedianMs: median(first),
    resolutionMedianMs: median(closed.map((r) => r.ms)),
    resolvedToday,
    satisfactionAvg: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null,
    satisfactionCount: ratings.length,
    targets: { ...TARGETS },
  };
}
