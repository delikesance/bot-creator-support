import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { GatewayError, type SupportDesk } from "./desk";
import type { OAuthProvider } from "./oauth";
import { TicketError, type Awaiting, type CloseReason, type Priority, type Status } from "./tickets";
import { AttachmentError, MAX_REQUEST_BYTES, openStored } from "./storage";
import { unfurl as defaultUnfurl, type Preview } from "./unfurl";

const STATUSES: Status[] = ["open", "in_progress", "closed"];
const AWAITING: Awaiting[] = ["support", "customer"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
const CLOSE_REASONS: CloseReason[] = ["resolved", "no_reply", "duplicate", "other"];
const MAX_QUERY = 200;
/** Statut HTTP selon le code de l'erreur métier. */
const TICKET_STATUS = { not_found: 404, closed: 409, not_closed: 409, conflict: 409, invalid: 400, quota: 429 } as const;
const MAX_NAME = 80;
const SESSION_TTL_MS = 12 * 3600_000;
const STATE_TTL_S = 600;
const PUBLIC_DIR = resolve(import.meta.dir, "..", "public");

/** Fichiers statiques servis depuis public/ : liste blanche d'extensions, rien d'autre. */
const STATIC_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

interface WebConfig {
  panelPassword: string;
  sessionSecret: string;
}

interface Session {
  exp: number;
  id: string;
  name: string;
  avatarUrl?: string;
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
      `<a href="/" style="color:#A78BFA">Back to the panel</a></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const HEARTBEAT_MS = 15_000;

export function createHandler(
  desk: SupportDesk,
  cfg: WebConfig,
  oauth?: OAuthProvider,
  directory: GuildDirectory = { list: () => [] },
  deps: { unfurl?: (url: string) => Promise<Preview | null> } = {},
) {
  const unfurl = deps.unfurl ?? defaultUnfurl;
  const accessible = (s: Session) => directory.list().filter((g) => s.all || s.guilds.includes(g.id));
  const sign = (v: string) => createHmac("sha256", cfg.sessionSecret).update(v).digest("base64url");
  const makeToken = (who: { id: string; name: string; avatarUrl?: string; all: boolean; guilds: string[] }) => {
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
        return fail("Invalid sign-in", "The sign-in session has expired or is invalid. Try again.");
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.get("error") || !code) return fail("Sign-in cancelled", "Discord did not authorize the sign-in.");

      let user;
      try {
        user = await oauth.exchange(code);
      } catch (e) {
        console.error("OAuth:", e);
        return fail("Sign-in failed", "Discord refused the sign-in. Try again.");
      }
      const all = oauth.isAdmin(user.id);
      const guilds = user.guilds.filter((g) => canManage(g.permissions)).map((g) => g.id);
      const hasAccess = all || directory.list().some((g) => guilds.includes(g.id));
      if (!hasAccess) {
        return fail(
          "Access denied",
          "You need the “Manage Server” permission on a server where the bot is present.",
          403,
        );
      }
      const headers = new Headers({ location: "/" });
      headers.append("set-cookie", clear);
      headers.append("set-cookie", cookie("session", makeToken({ id: user.id, name: user.username, avatarUrl: user.avatarUrl, all, guilds: all ? [] : guilds }), SESSION_TTL_MS / 1000));
      return new Response(null, { status: 302, headers });
    }

    return json({ error: "Not found" }, 404);
  }

  /** Fichier de public/ pour ce chemin, ou null (extension hors liste, traversée, fichier absent). */
  async function staticFile(path: string): Promise<Response | null> {
    let rel: string;
    try {
      rel = decodeURIComponent(path === "/" ? "/index.html" : path);
    } catch {
      return null;
    }
    const ext = /\.([a-z0-9]+)$/.exec(rel)?.[1];
    const unsafe = rel.includes("\\") || rel.includes("\0") || rel.includes("//") || rel.split("/").some((p) => p === "." || p === "..");
    if (!ext || !STATIC_TYPES[ext] || unsafe) return null;
    const full = resolve(PUBLIC_DIR, "." + rel);
    if (!full.startsWith(PUBLIC_DIR + sep)) return null;
    const file = Bun.file(full);
    if (!(await file.exists())) return null;
    return new Response(file, {
      headers: {
        "content-type": STATIC_TYPES[ext]!,
        "x-content-type-options": "nosniff",
        "cache-control": ext === "woff2" ? "public, max-age=604800" : "no-cache",
      },
    });
  }

  /** Corps JSON facultatif : un corps absent ou illisible donne un objet vide. */
  async function readJson(req: Request): Promise<Record<string, unknown>> {
    const b = await req.json().catch(() => null);
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  }

  /** Corps d'une réponse : JSON ou multipart (content + files). */
  async function readReply(req: Request): Promise<{ content: string; files: { name: string; data: Uint8Array }[] }> {
    if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const body = (await req.json().catch(() => ({}))) as { content?: unknown };
      return { content: String(body.content ?? ""), files: [] };
    }
    // Marge pour les en-têtes multipart au-delà des 40 Mo de fichiers.
    if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES + 1024 * 1024) {
      throw new AttachmentError("Files exceed 40 MB in total.", 413);
    }
    const form = await req.formData().catch(() => null);
    if (!form) throw new AttachmentError("Unreadable form.", 400);
    const files: { name: string; data: Uint8Array }[] = [];
    for (const f of form.getAll("files")) {
      if (typeof f === "string") continue;
      files.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    }
    return { content: String(form.get("content") ?? ""), files };
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") return json({ ok: true });
    if (path.startsWith("/auth/") && req.method === "GET") return handleAuth(req, url);
    if (path === "/api/config") return json({ oauth: !!oauth });
    if (req.method === "GET" && !path.startsWith("/api/")) {
      const res = await staticFile(path);
      if (res) return res;
    }

    if (path === "/api/login" && req.method === "POST") {
      if (oauth) return json({ error: "Not found" }, 404);
      if (throttled()) return json({ error: "Too many attempts, try again in a minute." }, 429);
      const body = (await req.json().catch(() => ({}))) as { password?: string };
      if (typeof body.password !== "string" || !safeEqual(body.password, cfg.panelPassword)) {
        failures.push(Date.now());
        return json({ error: "Wrong password." }, 401);
      }
      return json({ ok: true }, 200, {
        "set-cookie": cookie("session", makeToken({ id: "panel", name: "Support", all: true, guilds: [] }), SESSION_TTL_MS / 1000),
      });
    }

    if (!path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    const session = readSession(req);
    if (!session) return json({ error: "Not authenticated." }, 401);

    if (path === "/api/logout" && req.method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": cookie("session", "", 0) });
    }
    if (path === "/api/me") return json({ id: session.id, name: session.name, avatarUrl: session.avatarUrl });

    if (path === "/api/guilds") {
      return json({
        guilds: accessible(session).map((g) => ({ ...g, stats: desk.tickets.stats(g.id) })),
      });
    }

    /** Un serveur accessible à la session, ou null. */
    const canAccess = (guildId: string) => accessible(session).some((g) => g.id === guildId);

    /** Serveur demandé (paramètre guild, ou l'unique serveur accessible) ; sinon la réponse d'erreur à renvoyer. */
    const pickGuild = (): string | Response => {
      let guildId = url.searchParams.get("guild");
      if (!guildId) {
        const all = accessible(session);
        if (all.length !== 1) return json({ error: "Pick a server (guild parameter)." }, 400);
        guildId = all[0]!.id;
      }
      return canAccess(guildId) ? guildId : json({ error: "Access to this server is denied." }, 403);
    };

    if (path === "/api/events" && req.method === "GET") {
      const guildId = url.searchParams.get("guild") ?? "";
      if (!canAccess(guildId)) return json({ error: "Access to this server is denied." }, 403);
      const enc = new TextEncoder();
      let off = () => {};
      let beat: ReturnType<typeof setInterval> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          const write = (s: string) => {
            try {
              ctrl.enqueue(enc.encode(s));
            } catch {
              off();
            }
          };
          write("retry: 3000\n: connected\n\n");
          off = desk.tickets.subscribe((e) => {
            if (e.guildId === guildId) write(`data: ${JSON.stringify(e)}\n\n`);
          });
          beat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
        },
        cancel() {
          off();
          clearInterval(beat);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
      });
    }

    try {
      if (path === "/api/unfurl" && req.method === "GET") {
        const target = url.searchParams.get("url") ?? "";
        if (!target || target.length > 2048) return json({ error: "Invalid link." }, 400);
        const preview = await unfurl(target);
        return preview ? json(preview, 200, { "cache-control": "private, max-age=600" }) : json({ error: "Preview unavailable." }, 404);
      }

      const att = /^\/api\/attachments\/(\d+)$/.exec(path);
      if (att && req.method === "GET") {
        const a = desk.tickets.attachment(Number(att[1]));
        // Pièce d'un serveur non autorisé : indiscernable d'une pièce inexistante.
        if (!a || !canAccess(a.guildId) || !desk.attachmentsDir) return json({ error: "Attachment not found." }, 404);
        const file = openStored(desk.attachmentsDir, a.file);
        if (!file || !(await file.exists())) return json({ error: "Attachment not found." }, 404);
        const ascii = a.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
        return new Response(file, {
          headers: {
            "content-type": a.mime,
            "content-disposition": `${a.kind === "image" ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
            "cache-control": "private, max-age=86400",
          },
        });
      }

      if (path === "/api/tickets" && req.method === "GET") {
        const param = (k: string) => url.searchParams.get(k)?.trim() || undefined;
        const status = param("status");
        if (status && !STATUSES.includes(status as Status)) return json({ error: "Invalid status." }, 400);
        const awaiting = param("awaiting");
        if (awaiting && !AWAITING.includes(awaiting as Awaiting)) return json({ error: "Invalid awaiting value." }, 400);
        const priority = param("priority");
        if (priority && !PRIORITIES.includes(priority as Priority)) return json({ error: "Invalid priority." }, 400);
        const q = param("q");
        if (q && q.length > MAX_QUERY) return json({ error: "Search is too long." }, 400);
        const guildId = pickGuild();
        if (guildId instanceof Response) return guildId;
        return json({
          // « me » : le nom de la session, qui correspond aussi aux tickets pris en charge automatiquement.
          tickets: desk.tickets.find({
            guildId,
            status: status as Status | undefined,
            awaiting: awaiting as Awaiting | undefined,
            priority: priority as Priority | undefined,
            assignee: param("assignee"),
            tag: param("tag"),
            q,
            me: session.name,
          }),
          stats: desk.tickets.stats(guildId),
          awaiting: desk.tickets.awaitingStats(guildId),
          tags: desk.tickets.tagCounts(guildId),
        });
      }

      if (path === "/api/metrics" && req.method === "GET") {
        const guildId = pickGuild();
        if (guildId instanceof Response) return guildId;
        const days = Number(url.searchParams.get("days") ?? 7);
        if (!Number.isInteger(days) || days < 1 || days > 90) return json({ error: "days must be an integer from 1 to 90." }, 400);
        return json(desk.tickets.metrics(guildId, days));
      }

      if (path === "/api/audit" && req.method === "GET") {
        const id = Number(url.searchParams.get("ticket"));
        const t = Number.isInteger(id) ? desk.tickets.get(id) : null;
        if (!t || !canAccess(t.guildId)) return json({ error: "Ticket not found." }, 404);
        return json({ entries: desk.tickets.audit(id) });
      }

      if (path === "/api/replies" && req.method === "GET") {
        const guildId = pickGuild();
        if (guildId instanceof Response) return guildId;
        return json({ replies: desk.tickets.listReplies(guildId) });
      }
      if (path === "/api/replies" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = typeof body.guild === "string" ? body.guild : "";
        if (!canAccess(guildId)) return json({ error: "Access to this server is denied." }, 403);
        if (typeof body.name !== "string" || typeof body.text !== "string") return json({ error: "name and text are required." }, 400);
        desk.tickets.saveReply(guildId, body.name.trim(), body.text, session.name);
        return json({ replies: desk.tickets.listReplies(guildId) });
      }
      const rep = /^\/api\/replies\/(\d+)$/.exec(path);
      if (rep && req.method === "DELETE") {
        const id = Number(rep[1]);
        // Le serveur de la réponse se retrouve parmi ceux de la session : une réponse d'un autre serveur est un 404.
        const guild = accessible(session).find((g) => desk.tickets.listReplies(g.id).some((r) => r.id === id));
        if (!guild) return json({ error: "Saved reply not found." }, 404);
        desk.tickets.deleteReply(id, session.name);
        return json({ replies: desk.tickets.listReplies(guild.id) });
      }

      const m = /^\/api\/tickets\/(\d+)(?:\/(\w+))?$/.exec(path);
      if (m) {
        const id = Number(m[1]);
        const action = m[2];
        // Un ticket d'un serveur non autorisé est indiscernable d'un ticket inexistant.
        const owned = desk.tickets.get(id);
        if (!owned || !canAccess(owned.guildId)) return json({ error: `Ticket #${id} not found.` }, 404);
        if (!action && req.method === "GET") {
          const ticket = owned;
          return json({ ticket, messages: desk.tickets.messages(id) });
        }
        if (action === "transcript" && req.method === "GET") {
          return new Response(desk.transcript(id), {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "content-disposition": `attachment; filename="ticket-${id}.txt"`,
              "x-content-type-options": "nosniff",
              "cache-control": "private, no-store",
            },
          });
        }
        if (action && req.method === "POST") {
          const by = session.name;
          switch (action) {
            case "close": {
              // Corps facultatif : les anciens appelants (sans corps) gardent la fermeture simple.
              const b = await readJson(req);
              if (b.reason !== undefined && !CLOSE_REASONS.includes(b.reason as CloseReason)) return json({ error: "Invalid close reason." }, 400);
              if (b.message !== undefined && typeof b.message !== "string") return json({ error: "message must be text." }, 400);
              return json({
                ticket: await desk.close(id, by, {
                  reason: b.reason as CloseReason | undefined,
                  message: b.message as string | undefined,
                  askRating: b.askRating === true,
                  sendTranscript: b.sendTranscript === true,
                }),
              });
            }
            case "reopen":
              return json({ ticket: await desk.reopen(id, by) });
            case "delete":
              await desk.deleteChannel(id, by);
              return json({ ok: true });
            case "note": {
              const { content, files } = await readReply(req);
              return json({ ok: true, message: await desk.note(id, content, by, files) });
            }
            case "assign": {
              const b = await readJson(req);
              if (b.assignee !== null && typeof b.assignee !== "string") return json({ error: "assignee must be a name or null." }, 400);
              const name = typeof b.assignee === "string" ? b.assignee.trim() || null : null;
              if (name && name.length > MAX_NAME) return json({ error: "Name is too long." }, 400);
              // L'identifiant Discord n'est connu que si l'appelant s'attribue le ticket à lui-même.
              const userId = name !== null && name === session.name && session.id !== "panel" ? session.id : null;
              return json({ ticket: desk.assign(id, name, by, userId) });
            }
            case "priority": {
              const b = await readJson(req);
              if (!PRIORITIES.includes(b.priority as Priority)) return json({ error: "Invalid priority." }, 400);
              return json({ ticket: desk.tickets.setPriority(id, b.priority as Priority, by) });
            }
            case "tags": {
              const b = await readJson(req);
              if (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === "string")) return json({ error: "tags must be a list of strings." }, 400);
              return json({ ticket: desk.tickets.setTags(id, b.tags as string[], by) });
            }
            case "reply": {
              const { content, files } = await readReply(req);
              const message = await desk.reply(id, content, by, session.avatarUrl, files);
              return json({ ok: true, message });
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof AttachmentError) return json({ error: e.message }, e.status);
      if (e instanceof GatewayError) return json({ error: e.message }, 502);
      if (e instanceof TicketError) {
        return json({ error: e.message }, TICKET_STATUS[e.code]);
      }
      console.error(e);
      return json({ error: "Internal error (see the logs)." }, 500);
    }
    return json({ error: "Not found" }, 404);
  };
}
