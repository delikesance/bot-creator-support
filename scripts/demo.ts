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
const open = (guildId: string, user: string, subject: string, description: string) =>
  desk.open({ guildId, userId: user, userName: user, subject, description, locale: "fr" });
const say = (id: number, user: string, text: string) => desk.recordDiscordMessage(`demo${id}`, { id: user, name: user }, text);

// g1 : un de chaque état (attend le support, attend le client, échange en cours, résolus).
await open("g1", "alice", "Impossible de me connecter à mon compte",
  "Depuis ce matin, j'obtiens « identifiants invalides » alors que mon mot de passe n'a pas changé. J'ai essayé sur mobile et sur ordinateur.");
await open("g1", "bob", "Question sur la facturation",
  "Ma dernière facture indique deux prélèvements pour le même mois. Pouvez-vous vérifier ?");
await desk.reply(2, "Bonjour Bob, je regarde votre facture tout de suite.", "Angelo");
await open("g1", "chloé", "Bug d'affichage sur mobile",
  "Sur iPhone, le menu se superpose au contenu de la page d'accueil. Capture d'écran ci-dessous.");
await desk.reply(3, "Merci Chloé ! Quel modèle et quelle version d'iOS ?", "Angelo");
say(3, "chloé", "Un iPhone 14, iOS 17.5. Voilà ce que je vois : http://localhost:3200/demo/pic.png");
await open("g1", "david", "Demande de remboursement", "J'ai acheté deux fois le même abonnement par erreur.");
await desk.reply(4, "C'est fait, le remboursement arrive sous 3 à 5 jours ouvrés.", "Angelo");
await desk.close(4, "Angelo");
await open("g1", "emma", "Comment changer mon pseudo ?", "Je ne trouve pas l'option dans les paramètres.");
await desk.reply(5, "Dans Paramètres > Profil > Pseudo. N'hésite pas si tu bloques !", "Angelo");
await desk.close(5, "Angelo");
for (const [user, subject] of [["farid", "Mon bot ne répond plus"], ["gaëlle", "Accès au salon VIP"]] as const) {
  await open("g2", user, subject, "Bonjour, pouvez-vous m'aider ? Le problème est apparu hier soir.");
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
