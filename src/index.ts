import { loadConfig } from "./config";
import { openDb } from "./db";
import { SupportDesk, type Gateway } from "./desk";
import { TicketService } from "./tickets";
import { DiscordGateway, startBot } from "./bot/discord";
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

Bun.serve({ port: cfg.port, fetch: createHandler(desk, cfg) });
console.log(`Panel admin : http://localhost:${cfg.port}`);
if (cfg.passwordGenerated) console.log(`Mot de passe du panel (généré) : ${cfg.panelPassword}`);
