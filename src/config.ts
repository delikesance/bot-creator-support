import { randomBytes } from "node:crypto";

export interface Config {
  token: string;
  clientId: string;
  testGuildId: string | null;
  /** Serveur sur lequel enregistrer les commandes ; null = global (production). */
  commandGuildId: string | null;
  /** Serveur où les salons de tickets sont créés (null = premier serveur du bot). */
  guildId: string | null;
  supportRoleId: string | null;
  categoryId: string | null;
  production: boolean;
  port: number;
  dbPath: string;
  panelPassword: string;
  passwordGenerated: boolean;
  sessionSecret: string;
  /** OAuth2 Discord du panel : actif seulement si le secret est fourni. */
  oauthClientSecret: string | null;
  adminIds: string[];
  redirectUri: string;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): Config {
  const token = env.DISCORD_TOKEN?.trim();
  if (!token) throw new Error("DISCORD_TOKEN est requis");

  const production = env.NODE_ENV === "production";
  const testGuildId = env.TEST_GUILD_ID?.trim() || null;
  if (!production && !testGuildId) {
    throw new Error("TEST_GUILD_ID est requis hors production (les commandes y sont enregistrées)");
  }

  const clientId =
    env.DISCORD_CLIENT_ID?.trim() || Buffer.from(token.split(".")[0]!, "base64").toString("utf8");

  const passwordGenerated = !env.PANEL_PASSWORD;
  return {
    token,
    clientId,
    testGuildId,
    commandGuildId: production ? null : testGuildId,
    guildId: (production ? env.GUILD_ID?.trim() : testGuildId) || null,
    supportRoleId: env.SUPPORT_ROLE_ID?.trim() || null,
    categoryId: env.TICKET_CATEGORY_ID?.trim() || null,
    production,
    port: Number(env.PORT) || 3000,
    dbPath: env.DB_PATH || "data/tickets.db",
    panelPassword: env.PANEL_PASSWORD || randomBytes(9).toString("base64url"),
    passwordGenerated,
    sessionSecret: env.SESSION_SECRET || randomBytes(32).toString("hex"),
    oauthClientSecret: env.OAUTH_CLIENT_SECRET?.trim() || null,
    adminIds: (env.ADMIN_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    redirectUri: `${(env.PUBLIC_URL?.trim() || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/+$/, "")}/auth/callback`,
  };
}
