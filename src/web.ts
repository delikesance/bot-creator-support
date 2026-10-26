import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { SupportDesk } from "./desk";
import type { OAuthProvider } from "./oauth";
import { TicketError, type Status } from "./tickets";

const STATUSES: Status[] = ["open", "in_progress", "closed"];
const SESSION_TTL_MS = 12 * 3600_000;
const STATE_TTL_S = 600;
const PAGE = join(import.meta.dir, "..", "public", "index.html");

interface WebConfig {
  panelPassword: string;
  sessionSecret: string;
}

interface Session {
  exp: number;
  id: string;
  name: string;
  /** Accès à tous les serveurs où le bot est présent (super-admin ou mot de passe). */
  all: boolean;
  /** Sinon : serveurs où l'utilisateur a « Gérer le serveur » ou « Administrateur ». */
  guilds: string[];
}

export interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
}

/** Serveurs où le bot est présent. */
export interface GuildDirectory {
  list(): GuildInfo[];
}

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;
const canManage = (permissions: string) => {
  try {
    return (BigInt(permissions) & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
  } catch {
    return false;
  }
};

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

const page = (title: string, text: string, status: number) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B0B0C;color:#F4F2EE;font:16px system-ui,sans-serif">` +
      `<div style="max-width:380px;padding:24px;text-align:center"><h1 style="font-size:22px">${title}</h1><p style="color:#C9C7C2">${text}</p>` +
      `<a href="/" style="color:#A78BFA">Retour au panel</a></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createHandler(
  desk: SupportDesk,
  cfg: WebConfig,
  oauth?: OAuthProvider,
  directory: GuildDirectory = { list: () => [] },
) {
  const accessible = (s: Session) => directory.list().filter((g) => s.all || s.guilds.includes(g.id));
  const sign = (v: string) => createHmac("sha256", cfg.sessionSecret).update(v).digest("base64url");
  const makeToken = (who: { id: string; name: string; all: boolean; guilds: string[] }) => {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, ...who })).toString("base64url");
    return `${payload}.${sign(payload)}`;
  };
  const readSession = (req: Request): Session | null => {
    const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
    const [payload, sig] = token?.split(".") ?? [];
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
    try {
      const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
      return s.exp > Date.now() ? s : null;
    } catch {
      return null;
    }
  };
  const cookie = (name: string, v: string, maxAge: number, opts: { path?: string } = {}) =>
    `${name}=${v}; HttpOnly; SameSite=Lax; Path=${opts.path ?? "/"}; Max-Age=${maxAge}`;

  // Anti brute-force simple pour le mot de passe : 5 échecs / minute (global).
  const failures: number[] = [];
  const throttled = () => {
    const now = Date.now();
    while (failures.length && failures[0]! < now - 60_000) failures.shift();
    return failures.length >= 5;
  };

  async function handleAuth(req: Request, url: URL): Promise<Response> {
    if (!oauth) return json({ error: "Not found" }, 404);

    if (url.pathname === "/auth/login") {
      const state = randomBytes(16).toString("hex");
      return new Response(null, {
        status: 302,
        headers: {
          location: oauth.authorizeUrl(state),
          "set-cookie": cookie("oauth_state", `${state}.${sign(state)}`, STATE_TTL_S, { path: "/auth" }),
        },
      });
    }

    if (url.pathname === "/auth/callback") {
      const raw = /(?:^|;\s*)oauth_state=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
      const [state, sig] = raw?.split(".") ?? [];
      const clear = cookie("oauth_state", "", 0, { path: "/auth" });
      const fail = (title: string, text: string, status = 400) => {
        const r = page(title, text, status);
        r.headers.append("set-cookie", clear);
        return r;
      };
      if (!state || !sig || !safeEqual(sig, sign(state)) || url.searchParams.get("state") !== state) {
        return fail("Connexion invalide", "La session de connexion a expiré ou est invalide. Réessaie.");
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.get("error") || !code) return fail("Connexion annulée", "Discord n'a pas autorisé la connexion.");

      let user;
      try {
        user = await oauth.exchange(code);
      } catch (e) {
        console.error("OAuth:", e);
        return fail("Connexion impossible", "Discord a refusé la connexion. Réessaie.");
      }
      const all = oauth.isAdmin(user.id);
      const guilds = user.guilds.filter((g) => canManage(g.permissions)).map((g) => g.id);
      const hasAccess = all || directory.list().some((g) => guilds.includes(g.id));
      if (!hasAccess) {
        return fail(
          "Accès refusé",
          "Tu dois avoir la permission « Gérer le serveur » sur un serveur où le bot est présent.",
          403,
        );
      }
      const headers = new Headers({ location: "/" });
      headers.append("set-cookie", clear);
      headers.append("set-cookie", cookie("session", makeToken({ id: user.id, name: user.username, all, guilds: all ? [] : guilds }), SESSION_TTL_MS / 1000));
      return new Response(null, { status: 302, headers });
    }

    return json({ error: "Not found" }, 404);
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      return new Response(Bun.file(PAGE), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/health") return json({ ok: true });
    if (path.startsWith("/auth/") && req.method === "GET") return handleAuth(req, url);
    if (path === "/api/config") return json({ oauth: !!oauth });

    if (path === "/api/login" && req.method === "POST") {
      if (oauth) return json({ error: "Not found" }, 404);
      if (throttled()) return json({ error: "Trop de tentatives, réessaie dans une minute." }, 429);
      const body = (await req.json().catch(() => ({}))) as { password?: string };
      if (typeof body.password !== "string" || !safeEqual(body.password, cfg.panelPassword)) {
        failures.push(Date.now());
        return json({ error: "Mot de passe incorrect." }, 401);
      }
      return json({ ok: true }, 200, {
        "set-cookie": cookie("session", makeToken({ id: "panel", name: "Support", all: true, guilds: [] }), SESSION_TTL_MS / 1000),
      });
    }

    if (!path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    const session = readSession(req);
    if (!session) return json({ error: "Non authentifié." }, 401);

    if (path === "/api/logout" && req.method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": cookie("session", "", 0) });
    }
    if (path === "/api/me") return json({ id: session.id, name: session.name });

    if (path === "/api/guilds") {
      return json({
        guilds: accessible(session).map((g) => ({ ...g, stats: desk.tickets.stats(g.id) })),
      });
    }

    /** Un serveur accessible à la session, ou null. */
    const canAccess = (guildId: string) => accessible(session).some((g) => g.id === guildId);

    try {
      if (path === "/api/tickets" && req.method === "GET") {
        const status = url.searchParams.get("status");
        if (status && !STATUSES.includes(status as Status)) return json({ error: "Statut invalide." }, 400);
        let guildId = url.searchParams.get("guild");
        if (!guildId) {
          const all = accessible(session);
          if (all.length !== 1) return json({ error: "Choisis un serveur (paramètre guild)." }, 400);
          guildId = all[0]!.id;
        }
        if (!canAccess(guildId)) return json({ error: "Accès refusé à ce serveur." }, 403);
        return json({
          tickets: desk.tickets.list((status as Status) || undefined, guildId),
          stats: desk.tickets.stats(guildId),
        });
      }

      const m = /^\/api\/tickets\/(\d+)(?:\/(\w+))?$/.exec(path);
      if (m) {
        const id = Number(m[1]);
        const action = m[2];
        // Un ticket d'un serveur non autorisé est indiscernable d'un ticket inexistant.
        const owned = desk.tickets.get(id);
        if (!owned || !canAccess(owned.guildId)) return json({ error: `Ticket #${id} introuvable.` }, 404);
        if (!action && req.method === "GET") {
          const ticket = owned;
          return json({ ticket, messages: desk.tickets.messages(id) });
        }
        if (action && req.method === "POST") {
          const by = session.name;
          switch (action) {
            case "claim":
              return json({ ticket: await desk.claim(id, { id: session.id, name: by }) });
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
