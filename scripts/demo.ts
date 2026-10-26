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
  const t = await desk.open({ userId: user, userName: user, subject });
  desk.recordDiscordMessage(t.channelId, { id: user, name: user }, "Bonjour, j'ai besoin d'aide s'il vous plaît.");
}
await desk.claim(2, { id: "a", name: "Support" });
await desk.reply(2, "Bonjour Bob, je regarde votre facture tout de suite.", "Support");
await desk.claim(3, { id: "a", name: "Support" });
await desk.close(4, "Support");
await desk.close(5, "Support");
const fakeOAuth: OAuthProvider = {
  authorizeUrl: (state) => `/auth/callback?code=ok&state=${state}`,
  exchange: async () => ({ id: "1", username: "Angelo" }),
  isAdmin: () => true,
};
const oauth = process.argv.includes("oauth") ? fakeOAuth : undefined;
Bun.serve({ port: 3200, fetch: createHandler(desk, { panelPassword: "demo", sessionSecret: "d".repeat(32) }, oauth) });
console.log("Démo sur http://localhost:3200 (mot de passe : demo)");
