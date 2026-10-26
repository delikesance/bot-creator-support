// Panel seul avec données fictives et sans Discord : bun run scripts/demo.ts (mot de passe : demo)
// `bun run scripts/demo.ts oauth` simule la connexion Discord (compte "Angelo", admin).
import { deflateSync } from "node:zlib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { SupportDesk, type Gateway, type OutFile } from "../src/desk";
import { TicketService, TicketError } from "../src/tickets";
import { AttachmentError } from "../src/storage";
import { createHandler } from "../src/web";
import type { OAuthProvider } from "../src/oauth";

let n = 0;
const gw: Gateway = {
  createTicketChannel: async () => `demo${++n}`,
  send: async () => {},
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
const db = openDb(":memory:");
const attachmentsDir = mkdtempSync(join(tmpdir(), "desk-demo-"));
const desk = new SupportDesk(new TicketService(db), gw, { attachmentsDir });
const svc = desk.tickets;
const open = (guildId: string, user: string, subject: string, description: string, locale = "en") =>
  desk.open({ guildId, userId: user, userName: user, subject, description, locale });
const say = (id: number, user: string, text: string) => desk.recordDiscordMessage(`demo${id}`, { id: user, name: user }, text);

/** PNG minimal (RVB, sans dépendance) : de quoi fabriquer de fausses captures d'écran. */
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(Bun.hash.crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
/** Fausse capture de logs : barre de titre, lignes de longueurs variées, une ligne d'erreur. */
const shot = (seed: number, accent: [number, number, number]) => png(480, 270, (x, y) => {
  if (y < 28) return [28, 28, 30];
  const line = Math.floor((y - 40) / 18), inLine = (y - 40) % 18 < 8;
  if (line < 0 || line > 11 || !inLine) return [11, 11, 12];
  const len = 120 + ((line * 97 + seed * 53) % 280);
  return x > 20 && x < 20 + len ? (line === 7 + (seed % 3) ? accent : [90 + (line * 7) % 40, 90, 110]) : [11, 11, 12];
});
const stash = async (name: string, mime: string, data: Uint8Array) => {
  const file = `seed-${Math.random().toString(36).slice(2)}${name.slice(name.lastIndexOf("."))}`;
  await Bun.write(join(attachmentsDir, file), data);
  return { name, mime, size: data.length, file };
};

// g1 : un de chaque état (attend le support, attend le client, échange en cours, résolus).
await open("g1", "alice", "Can't sign in to my account",
  "Since this morning I get \"invalid credentials\" although my password did not change. I tried on mobile and on desktop.");
await open("g1", "bob", "Question sur la facture",
  "Ma dernière facture indique deux prélèvements pour le même mois. Pouvez-vous vérifier ?", "fr");
await desk.reply(2, "Bonjour Bob, je regarde votre facture tout de suite.", "Angelo");
await open("g1", "chloé", "Bug d'affichage sur mobile",
  "Sur iPhone, le menu se superpose au contenu de la page d'accueil. Captures ci-dessous.", "fr");
await desk.reply(3, "Merci Chloé ! Quel modèle et quelle version d'iOS ?", "Angelo");
svc.addMessage(3, { authorId: "chloé", authorName: "chloé", source: "discord", content: "Un iPhone 14, iOS 17.5. Voilà ce que je vois, avec les logs.",
  attachments: [await stash("menu-overlap.png", "image/png", shot(1, [255, 138, 138])), await stash("home-top.png", "image/png", shot(4, [167, 139, 250])), await stash("console-14h33.log", "text/plain", new TextEncoder().encode("14:33:02 WARN  layout overflow on .menu\n14:33:02 ERROR z-index conflict\n"))] });
await desk.reply(3, "Parfait, je transmets à l'équipe. Voici le guide : https://docs.botcreator.app/mobile-menu", "Angelo");
say(3, "chloé", "Un iPhone 14 aussi sur Safari : http://localhost:3200/demo/pic.png");
await open("g1", "david", "Refund request", "I bought the same subscription twice by mistake.");
await desk.reply(4, "Done, the refund arrives within 3 to 5 working days.", "Angelo");
await desk.close(4, "Angelo");
await open("g1", "emma", "How do I change my username?", "I cannot find the option in the settings.");
await desk.reply(5, "Settings > Profile > Username. Tell us if you get stuck!", "Angelo");
await desk.close(5, "Angelo");
await open("g1", "kenji", "コマンドのオプションが保存されません", "保存ボタンを押しても、オプションが元に戻ってしまいます。", "ja");
await open("g1", "sofía", "No puedo conectar mi token de Telegram", "Ya probé con un token nuevo y sigue diciendo \"invalid token\".", "es");
await open("g1", "priya", "Duplicate subscription, please refund", "Attached the receipt. I bought the Premium plan twice by mistake.");
for (const [user, subject] of [["farid", "Mon bot ne répond plus"], ["gaëlle", "Accès au salon VIP"]] as const) {
  await open("g2", user, subject, "Bonjour, pouvez-vous m'aider ? Le problème est apparu hier soir.", "fr");
}
// Champs de la suite : priorité, étiquettes, responsable, notes, note de satisfaction.
svc.setPriority(1, "urgent"); svc.setTags(1, ["login", "urgent-fix"]);
svc.setPriority(3, "high"); svc.setTags(3, ["bug", "mobile"]); svc.assign(3, "Angelo", "angelo-id");
svc.setTags(2, ["billing"]); svc.setTags(6, ["bug"]); svc.assign(6, "Mehdi", "mehdi-id");
svc.setTags(7, ["telegram", "onboarding"]); svc.setTags(8, ["billing"]);
svc.addMessage(3, { authorId: "mehdi-id", authorName: "Mehdi", source: "panel", internal: true, content: "Same overflow as incident #131. Fix is in the next release; no need to escalate." });
svc.setRating(4, 5);
svc.saveReply("g1", "refund-policy", "Hi {customer}, refunds are issued within 3 to 5 working days. I can start it now if you confirm the invoice number.");
svc.saveReply("g1", "ask-logs", "Hi {customer}, could you send the deploy logs and a screenshot of the error?");
svc.saveReply("g1", "thanks-close", "Thanks {customer}! I am closing this ticket, write again anytime.");
// Les durées d'attente doivent ressembler à une vraie journée : on recule chaque ticket dans le temps.
const ago = { 1: 134, 2: 95, 3: 42, 4: 600, 5: 700, 6: 24, 7: 38, 8: 17 } as Record<number, number>;
for (const [id, min] of Object.entries(ago)) {
  const d = min * 60_000;
  db.query("UPDATE tickets SET created_at=created_at-?1, updated_at=updated_at-?1, waiting_since=waiting_since-?1, closed_at=closed_at-?1, first_response_at=first_response_at-?1 WHERE id=?2").run(d, id);
  db.query("UPDATE messages SET created_at=created_at-?1 WHERE ticket_id=?2").run(d, id);
}

const directory = {
  list: () => [
    { id: "g1", name: "Bot Creator", icon: null },
    { id: "g2", name: "Community Hub", icon: null },
    { id: "g3", name: "Workshop", icon: null },
  ],
};
const fakeOAuth: OAuthProvider = {
  authorizeUrl: (state) => `/auth/callback?code=ok&state=${state}`,
  exchange: async () => ({ id: "1", username: "Angelo", guilds: [] }),
  isAdmin: () => true,
};
const oauth = process.argv.includes("oauth") ? fakeOAuth : undefined;
const handle = createHandler(desk, { panelPassword: "demo", sessionSecret: "d".repeat(32) }, oauth, directory);

/* ---- Routes pas encore servies par src/web.ts : simulées ici, désactivées dès que le vrai serveur les gère. ---- */
const webSrc = await Bun.file(join(import.meta.dir, "..", "src", "web.ts")).text();
const served = (s: string) => webSrc.includes(s);
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const PUBLIC = join(import.meta.dir, "..", "public");
const TYPES: Record<string, string> = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8" };

async function simulate(req: Request, u: URL): Promise<Response | null> {
  const p = u.pathname, method = req.method;
  // Fichiers statiques du panel (le serveur n'en sert qu'un tant que web.ts n'est pas à jour).
  const asset = /^\/([\w-]+\.(js|css))$/.exec(p);
  if (method === "GET" && asset) {
    const real = await handle(req);
    if (real.status !== 404) return real;
    const f = Bun.file(join(PUBLIC, asset[1]!));
    if (await f.exists()) return new Response(f, { headers: { "content-type": TYPES[asset[2]!]!, "cache-control": "no-store" } });
  }
  if (!p.startsWith("/api/")) return null;
  const who = await handle(new Request(new URL("/api/me", u), { headers: { cookie: req.headers.get("cookie") ?? "" } }));
  if (!who.ok) return null;
  const me = (await who.json()) as { name: string; avatarUrl?: string };

  if (method === "GET" && p === "/api/tickets" && !served("tickets.find")) {
    const guild = u.searchParams.get("guild") ?? "g1";
    return json({ tickets: svc.find({ guildId: guild }), stats: svc.stats(guild), awaiting: svc.awaitingStats(guild), tags: svc.tagCounts(guild) });
  }
  const att = /^\/api\/attachments\/(\d+)$/.exec(p);
  if (method === "GET" && att && !served("/api/attachments")) {
    const a = svc.attachment(Number(att[1]));
    if (!a) return json({ error: "Not found" }, 404);
    return new Response(Bun.file(join(attachmentsDir, a.file)), { headers: { "content-type": a.mime, "content-disposition": `${a.kind === "image" ? "inline" : "attachment"}; filename="${a.name}"`, "x-content-type-options": "nosniff" } });
  }
  // Aperçu de lien : la démo est hors ligne, l'adresse de la doc fictive est donc toujours simulée.
  if (method === "GET" && p === "/api/unfurl" && (!served("/api/unfurl") || (u.searchParams.get("url") ?? "").includes("docs.botcreator.app"))) {
    const url = u.searchParams.get("url") ?? "";
    if (!url.includes("docs.botcreator.app")) return json({ error: "Not found" }, 404);
    return json({ url, title: "Hosting limits and restarts", description: "Why a bot restarts after a deploy.", site: "docs.botcreator.app" });
  }
  if (method === "GET" && p === "/api/replies" && !served("/api/replies")) return json({ replies: svc.listReplies(u.searchParams.get("guild") ?? "g1") });
  if (method === "GET" && p === "/api/metrics" && !served("/api/metrics")) return json(svc.metrics(u.searchParams.get("guild") ?? "g1", 7));

  const m = /^\/api\/tickets\/(\d+)\/(\w+)$/.exec(p);
  if (method === "POST" && m) {
    const id = Number(m[1]), action = m[2];
    try {
      if (action === "reply" && (req.headers.get("content-type") ?? "").startsWith("multipart/") && !served("formData")) {
        const fd = await req.formData();
        const files: OutFile[] = [];
        for (const f of fd.getAll("files")) if (f instanceof File) files.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
        return json({ ok: true, message: await desk.reply(id, String(fd.get("content") ?? ""), me.name, me.avatarUrl, files) });
      }
      if (!served(`case "${action}"`) && ["note", "assign", "priority", "tags"].includes(action!)) {
        const body = (await req.json().catch(() => ({}))) as Record<string, any>;
        if (action === "note") svc.addMessage(id, { authorId: "panel", authorName: me.name, content: String(body.content ?? ""), source: "panel", internal: true });
        if (action === "assign") svc.assign(id, body.assignee ?? null, body.assignee === me.name ? "me-id" : null, me.name);
        if (action === "priority") svc.setPriority(id, body.priority, me.name);
        if (action === "tags") svc.setTags(id, body.tags, me.name);
        return json({ ok: true, ticket: svc.get(id) });
      }
    } catch (e) {
      if (e instanceof AttachmentError) return json({ error: e.message }, e.status);
      if (e instanceof TicketError) return json({ error: e.message }, 409);
      throw e;
    }
  }
  return null;
}

// Simule un message de l'utilisateur sur Discord : GET /demo/say?id=1&text=Bonjour
Bun.serve({
  port: 3200,
  idleTimeout: 60,
  maxRequestBodySize: 64 * 1024 * 1024,
  fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/demo/say") {
      const t = desk.tickets.get(Number(u.searchParams.get("id")));
      if (t) desk.recordDiscordMessage(t.channelId, { id: t.userId, name: t.userName }, u.searchParams.get("text") ?? "…");
      return new Response("ok");
    }
    if (u.pathname === "/demo/pic.png") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><rect width="360" height="200" fill="#2a1f4d"/><text x="180" y="108" font-size="28" fill="#fff" text-anchor="middle" font-family="sans-serif">Screenshot</text></svg>`;
      return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
    }
    return (await simulate(req, u)) ?? handle(req);
  },
});
console.log("Démo sur http://localhost:3200 (mot de passe : demo)");
