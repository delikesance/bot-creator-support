// Panel seul avec données fictives et sans Discord : bun run scripts/demo.ts (mot de passe : demo)
// `bun run scripts/demo.ts oauth` simule la connexion Discord (compte "Angelo", admin).
import { openDb } from "../src/db";
import { SupportDesk, type Gateway } from "../src/desk";
import { TicketService } from "../src/tickets";
import { createHandler } from "../src/web";
import type { OAuthProvider } from "../src/oauth";

let n = 0;
const gw: Gateway = {
  createTicketChannel: async () => `demo${++n}`,
  send: async () => {},
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
const desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
const subjects: [string, string][] = [
  ["alice", "Impossible de me connecter à mon compte"],
  ["bob", "Question sur la facturation"],
  ["chloé", "Bug d'affichage sur mobile"],
  ["david", "Demande de remboursement"],
  ["emma", "Comment changer mon pseudo ?"],
];
for (const [user, subject] of subjects) {
  const t = await desk.open({ guildId: "g1", userId: user, userName: user, subject });
  desk.recordDiscordMessage(t.channelId, { id: user, name: user }, "Bonjour, j'ai besoin d'aide s'il vous plaît.");
}
await desk.claim(2, { id: "a", name: "Support" });
await desk.reply(2, "Bonjour Bob, je regarde votre facture tout de suite.", "Support");
await desk.claim(3, { id: "a", name: "Support" });
await desk.close(4, "Support");
await desk.close(5, "Support");
for (const [user, subject] of [["farid", "Mon bot ne répond plus"], ["gaëlle", "Accès au salon VIP"]] as const) {
  const t = await desk.open({ guildId: "g2", userId: user, userName: user, subject });
  desk.recordDiscordMessage(t.channelId, { id: user, name: user }, "Bonjour, pouvez-vous m'aider ?");
}
const directory = {
  list: () => [
    { id: "g1", name: "Serveur de test", icon: null },
    { id: "g2", name: "Communauté Bot Creator", icon: null },
    { id: "g3", name: "Atelier", icon: null },
  ],
};
const fakeOAuth: OAuthProvider = {
  authorizeUrl: (state) => `/auth/callback?code=ok&state=${state}`,
  exchange: async () => ({ id: "1", username: "Angelo", guilds: [] }),
  isAdmin: () => true,
};
const oauth = process.argv.includes("oauth") ? fakeOAuth : undefined;
const handle = createHandler(desk, { panelPassword: "demo", sessionSecret: "d".repeat(32) }, oauth, directory);
// Simule un message de l'utilisateur sur Discord : GET /demo/say?id=1&text=Bonjour
Bun.serve({
  port: 3200,
  idleTimeout: 60,
  fetch: (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/demo/say") {
      const t = desk.tickets.get(Number(u.searchParams.get("id")));
      if (t) desk.recordDiscordMessage(t.channelId, { id: t.userId, name: t.userName }, u.searchParams.get("text") ?? "…");
      return new Response("ok");
    }
    if (u.pathname === "/demo/pic.png") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><rect width="360" height="200" fill="#2a1f4d"/><text x="180" y="108" font-size="28" fill="#fff" text-anchor="middle" font-family="sans-serif">Capture d'écran</text></svg>`;
      return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
    }
    return handle(req);
  },
});
console.log("Démo sur http://localhost:3200 (mot de passe : demo)");
