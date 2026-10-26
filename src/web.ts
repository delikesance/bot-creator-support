import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { SupportDesk } from "./desk";
import { TicketError, type Status } from "./tickets";

const STATUSES: Status[] = ["open", "in_progress", "closed"];
const SESSION_TTL_MS = 12 * 3600_000;
const PAGE = join(import.meta.dir, "..", "public", "index.html");

interface WebConfig {
  panelPassword: string;
  sessionSecret: string;
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createHandler(desk: SupportDesk, cfg: WebConfig) {
  const sign = (v: string) => createHmac("sha256", cfg.sessionSecret).update(v).digest("base64url");
  const makeToken = () => {
    const exp = String(Date.now() + SESSION_TTL_MS);
    return `${exp}.${sign(exp)}`;
  };
  const validToken = (t: string | undefined) => {
    if (!t) return false;
    const [exp, sig] = t.split(".");
    if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
    return Number(exp) > Date.now();
  };
  const sessionOf = (req: Request) =>
    /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  const cookie = (v: string, maxAge: number) =>
    `session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

  // Anti brute-force simple : 5 échecs / minute (global, le panel n'a qu'un mot de passe).
  const failures: number[] = [];
  const throttled = () => {
    const now = Date.now();
    while (failures.length && failures[0]! < now - 60_000) failures.shift();
    return failures.length >= 5;
  };

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      return new Response(Bun.file(PAGE), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/health") return json({ ok: true });

    if (path === "/api/login" && req.method === "POST") {
      if (throttled()) return json({ error: "Trop de tentatives, réessaie dans une minute." }, 429);
      const body = (await req.json().catch(() => ({}))) as { password?: string };
      if (typeof body.password !== "string" || !safeEqual(body.password, cfg.panelPassword)) {
        failures.push(Date.now());
        return json({ error: "Mot de passe incorrect." }, 401);
      }
      return json({ ok: true }, 200, { "set-cookie": cookie(makeToken(), SESSION_TTL_MS / 1000) });
    }

    if (!path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    if (!validToken(sessionOf(req))) return json({ error: "Non authentifié." }, 401);

    if (path === "/api/logout" && req.method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
    }

    try {
      if (path === "/api/tickets" && req.method === "GET") {
        const status = url.searchParams.get("status");
        if (status && !STATUSES.includes(status as Status)) return json({ error: "Statut invalide." }, 400);
        return json({ tickets: desk.tickets.list((status as Status) || undefined), stats: desk.tickets.stats() });
      }

      const m = /^\/api\/tickets\/(\d+)(?:\/(\w+))?$/.exec(path);
      if (m) {
        const id = Number(m[1]);
        const action = m[2];
        if (!action && req.method === "GET") {
          const ticket = desk.tickets.get(id);
          if (!ticket) return json({ error: `Ticket #${id} introuvable.` }, 404);
          return json({ ticket, messages: desk.tickets.messages(id) });
        }
        if (action && req.method === "POST") {
          const by = "Support";
          switch (action) {
            case "claim":
              return json({ ticket: await desk.claim(id, { id: "panel", name: by }) });
            case "release":
              return json({ ticket: await desk.release(id, by) });
            case "close":
              return json({ ticket: await desk.close(id, by) });
            case "reopen":
              return json({ ticket: await desk.reopen(id, by) });
            case "delete":
              await desk.deleteChannel(id);
              return json({ ok: true });
            case "reply": {
              const body = (await req.json().catch(() => ({}))) as { content?: string };
              await desk.reply(id, String(body.content ?? ""), by);
              return json({ ok: true });
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof TicketError) {
        return json({ error: e.message }, /introuvable/.test(e.message) ? 404 : 409);
      }
      console.error(e);
      return json({ error: "Erreur interne (voir les logs)." }, 500);
    }
    return json({ error: "Not found" }, 404);
  };
}
