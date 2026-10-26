// Panel alone with fictional data and no Discord: bun run scripts/demo.ts (password: demo)
// `bun run scripts/demo.ts oauth` simulates the Discord sign-in (account "Angelo", admin).
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

/** Minimal PNG (RGB, no dependency): enough to fake screenshots. */
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
/** Fake log screenshot: title bar, lines of varied length, one error line. */
const shot = (seed: number, accent: [number, number, number]) => png(480, 270, (x, y) => {
  if (y < 28) return [28, 28, 30];
  const line = Math.floor((y - 40) / 18), inLine = (y - 40) % 18 < 8;
  if (line < 0 || line > 11 || !inLine) return [11, 11, 12];
  const len = 120 + ((line * 97 + seed * 53) % 280);
  return x > 20 && x < 20 + len ? (line === 7 + (seed % 3) ? accent : [90 + (line * 7) % 40, 90, 110]) : [11, 11, 12];
});
const stash = async (name: string, mime: string, data: Uint8Array) => {
  const file = `${crypto.randomUUID().replaceAll("-", "")}${name.slice(name.lastIndexOf(".")).toLowerCase()}`; // same naming as src/storage.ts
  await Bun.write(join(attachmentsDir, file), data);
  return { name, mime, size: data.length, file };
};

// g1: one of each state (waiting on support, waiting on customer, ongoing, resolved).
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
// Wave 2 fields: priority, tags, assignee, notes, rating, saved replies.
svc.setPriority(1, "urgent", "Angelo"); svc.setTags(1, ["login", "urgent-fix"], "Angelo");
svc.setPriority(3, "high", "Angelo"); svc.setTags(3, ["bug", "mobile"], "Angelo"); svc.assign(3, "Angelo", "angelo-id", "Angelo");
svc.setTags(2, ["billing"], "Angelo"); svc.setTags(6, ["bug"], "Mehdi"); svc.assign(6, "Mehdi", "mehdi-id", "Mehdi");
svc.setTags(7, ["telegram", "onboarding"]); svc.setTags(8, ["billing"]);
svc.addMessage(3, { authorId: "mehdi-id", authorName: "Mehdi", source: "panel", internal: true, content: "Same overflow as incident #131. Fix is in the next release; no need to escalate." });
svc.setRating(4, 5);
svc.saveReply("g1", "refund-policy", "Hi {customer}, refunds are issued within 3 to 5 working days. I can start it now if you confirm the invoice number.");
svc.saveReply("g1", "ask-logs", "Hi {customer}, could you send the deploy logs and a screenshot of the error?");
svc.saveReply("g1", "thanks-close", "Thanks {customer}! I am closing this ticket, write again anytime.");
// Waiting times should look like a real day: shift every ticket back in time.
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

/* The demo is offline: the preview of the fictional docs host is answered here, everything else goes to the real handler. */
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
async function unfurlShim(req: Request, u: URL): Promise<Response | null> {
  const url = u.searchParams.get("url") ?? "";
  if (req.method !== "GET" || u.pathname !== "/api/unfurl" || !url.includes("docs.botcreator.app")) return null;
  const who = await handle(new Request(new URL("/api/me", u), { headers: { cookie: req.headers.get("cookie") ?? "" } }));
  if (!who.ok) return null;
  return json({ url, title: "Hosting limits and restarts", description: "Why a bot restarts after a deploy.", site: "docs.botcreator.app" });
}

// Simulates a user message on Discord: GET /demo/say?id=1&text=Hello
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
    return (await unfurlShim(req, u)) ?? handle(req);
  },
});
console.log("Demo on http://localhost:3200 (password: demo)");
