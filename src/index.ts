import { loadConfig } from "./config";
import { openDb } from "./db";
import { SupportDesk, type Gateway } from "./desk";
import { TicketService } from "./tickets";
import { DiscordGateway, startBot } from "./bot/discord";
import { DiscordOAuth, fetchApplicationOwners } from "./oauth";
import { createHandler } from "./web";

const cfg = loadConfig(process.env);
const tickets = new TicketService(openDb(cfg.dbPath));

// Le desk a besoin de la gateway, la gateway du client Discord : on branche via un proxy paresseux.
let real: DiscordGateway | undefined;
const lazy: Gateway = {
  createTicketChannel: (o) => real!.createTicketChannel(o),
  send: (c, t, o) => real!.send(c, t, o),
  setUserLocked: (c, u, l) => real!.setUserLocked(c, u, l),
  deleteChannel: (c) => real!.deleteChannel(c),
};
const desk = new SupportDesk(tickets, lazy, { maxActivePerUser: 1 });

await startBot(cfg, desk, (client) => (real = new DiscordGateway(client, cfg)));

let oauth: DiscordOAuth | undefined;
if (cfg.oauthClientSecret) {
  const adminIds = cfg.adminIds.length ? cfg.adminIds : await fetchApplicationOwners(cfg.token);
  if (!adminIds.length) throw new Error("OAuth2 actif mais aucun admin : renseigne ADMIN_IDS.");
  oauth = new DiscordOAuth({ clientId: cfg.clientId, clientSecret: cfg.oauthClientSecret, redirectUri: cfg.redirectUri, adminIds });
  console.log(`Connexion au panel via Discord OAuth2 (admins : ${adminIds.join(", ")})`);
  console.log(`Redirection à déclarer dans le portail Discord : ${cfg.redirectUri}`);
}

Bun.serve({ port: cfg.port, fetch: createHandler(desk, cfg, oauth) });
console.log(`Panel admin : http://localhost:${cfg.port}`);
if (!oauth && cfg.passwordGenerated) console.log(`Mot de passe du panel (généré) : ${cfg.panelPassword}`);
