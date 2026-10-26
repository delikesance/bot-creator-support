// Test de bout en bout contre le VRAI serveur de test Discord : bun run scripts/smoke.ts
// Crée un ticket, le fait vivre via l'API du panel, puis supprime le salon.
import { Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db";
import { SupportDesk } from "../src/desk";
import { TicketService } from "../src/tickets";
import { DiscordGateway } from "../src/bot/discord";
import { createHandler } from "../src/web";

const cfg = loadConfig(process.env);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(cfg.token);
await new Promise((r) => client.once("clientReady", r));

const desk = new SupportDesk(new TicketService(openDb(":memory:")), new DiscordGateway(client, cfg));
const handle = createHandler(desk, cfg, undefined, { list: () => [{ id: cfg.testGuildId!, name: "test", icon: null }] });

const login = await handle(
  new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: cfg.panelPassword }) }),
);
const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
const call = async (path: string, body?: unknown) => {
  const res = await handle(new Request("http://x/api" + path, { method: "POST", headers: { cookie }, body: JSON.stringify(body ?? {}) }));
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
};
const step = (s: string) => console.log("✔", s);

const t = await desk.open({ guildId: cfg.testGuildId!, userId: client.user!.id, userName: "smoke-test", subject: "Test de bout en bout" });
step(`ticket #${t.id} créé, salon ${t.channelId}`);
await call(`/tickets/${t.id}/reply`, { content: "Réponse envoyée depuis le panel 👋" });
step("réponse du panel postée dans Discord");
if (desk.tickets.get(t.id)!.status !== "in_progress") throw new Error("prise en charge automatique absente");
step("ticket passé en cours automatiquement");
await desk.reply(t.id, "Réponse sous un pseudo et un avatar", "Angelo (test)", "https://cdn.discordapp.com/embed/avatars/2.png");
const ch = (await client.channels.fetch(t.channelId))!;
if (!ch.isTextBased()) throw new Error("salon non textuel");
const last = (await ch.messages.fetch({ limit: 5 })).find((m) => m.webhookId);
if (!last || last.author.username !== "Angelo (test)") throw new Error("le message n'est pas passé par le webhook sous le bon pseudo");
step(`message posté via webhook sous « ${last.author.username} »`);
await call(`/tickets/${t.id}/close`);
step("fermé (utilisateur verrouillé)");
await call(`/tickets/${t.id}/reopen`);
step("rouvert");
await call(`/tickets/${t.id}/close`);
await call(`/tickets/${t.id}/delete`);
step("salon supprimé");
await client.destroy();
