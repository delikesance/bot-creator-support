import { loadConfig } from "./config";
import { openDb } from "./db";
import { SupportDesk, type Gateway } from "./desk";
import { TicketService } from "./tickets";
import { DiscordGateway, startBot } from "./bot/discord";
import { DiscordOAuth, fetchApplicationOwners } from "./oauth";
import { createHandler } from "./web";
import { persistedSessionSecret } from "./session-secret";

const loaded = loadConfig(process.env);
// SESSION_SECRET dans l'environnement l'emporte ; sinon un secret conservé dans le volume de données.
const cfg = { ...loaded, sessionSecret: process.env.SESSION_SECRET || persistedSessionSecret(loaded.dbPath) };
const tickets = new TicketService(openDb(cfg.dbPath));

// Le desk a besoin de la gateway, la gateway du client Discord : on branche via un proxy paresseux.
let real: DiscordGateway | undefined;
const lazy: Gateway = {
  createTicketChannel: (o) => real!.createTicketChannel(o),
  send: (c, t, o) => real!.send(c, t, o),
  setUserLocked: (c, u, l) => real!.setUserLocked(c, u, l),
  deleteChannel: (c) => real!.deleteChannel(c),
  askRating: (c, t, l) => real!.askRating(c, t, l),
};
const desk = new SupportDesk(tickets, lazy, { maxActivePerUser: 1, attachmentsDir: cfg.attachmentsDir });

await startBot(cfg, desk, (client) => (real = new DiscordGateway(client, cfg)));
// Anciens tickets (avant le multi-serveurs) : rattachés au serveur de test.
if (cfg.testGuildId) tickets.adoptOrphans(cfg.testGuildId);

let oauth: DiscordOAuth | undefined;
if (cfg.oauthClientSecret) {
  const adminIds = cfg.adminIds.length ? cfg.adminIds : await fetchApplicationOwners(cfg.token);
  oauth = new DiscordOAuth({ clientId: cfg.clientId, clientSecret: cfg.oauthClientSecret, redirectUri: cfg.redirectUri, adminIds });
  console.log(`Panel sign-in through Discord OAuth2 (super-admins: ${adminIds.join(", ") || "none"}; server managers access their own server)`);
  console.log(`Redirect URI to declare in the Discord developer portal: ${cfg.redirectUri}`);
}

Bun.serve({ port: cfg.port, idleTimeout: 60, maxRequestBodySize: 48 * 1024 * 1024, fetch: createHandler(desk, cfg, oauth, { list: () => real?.list() ?? [] }) });
console.log(`Panel admin : http://localhost:${cfg.port}`);
if (!oauth && cfg.passwordGenerated) console.log(`Panel password (generated): ${cfg.panelPassword}`);
