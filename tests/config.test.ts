import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const TOKEN = "MTQ5NjIzNjc2OTIzMzA3NjQxNQ.abc.def";

describe("loadConfig", () => {
  test("échoue sans token", () => {
    expect(() => loadConfig({})).toThrow(/DISCORD_TOKEN/);
  });

  test("exige TEST_GUILD_ID hors production", () => {
    expect(() => loadConfig({ DISCORD_TOKEN: TOKEN })).toThrow(/TEST_GUILD_ID/);
  });

  test("déduit le client id du token", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1" });
    expect(c.clientId).toBe("1496236769233076415");
  });

  test("DISCORD_CLIENT_ID explicite prioritaire", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1", DISCORD_CLIENT_ID: "42" });
    expect(c.clientId).toBe("42");
  });

  test("dev par défaut : commandes limitées au serveur de test", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1" });
    expect(c.production).toBe(false);
    expect(c.commandGuildId).toBe("1");
  });

  test("production : commandes globales, TEST_GUILD_ID facultatif", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, NODE_ENV: "production" });
    expect(c.production).toBe(true);
    expect(c.commandGuildId).toBeNull();
  });

  test("valeurs par défaut et mot de passe généré", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1" });
    expect(c.port).toBe(3000);
    expect(c.dbPath).toBe("data/tickets.db");
    expect(c.panelPassword.length).toBeGreaterThanOrEqual(12);
    expect(c.passwordGenerated).toBe(true);
    expect(c.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  test("mot de passe fourni respecté", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1", PANEL_PASSWORD: "secret", PORT: "8080" });
    expect(c.panelPassword).toBe("secret");
    expect(c.passwordGenerated).toBe(false);
    expect(c.port).toBe(8080);
  });
});

describe("réglages optionnels", () => {
  test("rôle staff et catégorie nuls par défaut", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, NODE_ENV: "production" });
    expect(c.supportRoleId).toBeNull();
    expect(c.categoryId).toBeNull();
  });
  test("rôle staff et catégorie lus", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1", SUPPORT_ROLE_ID: "5", TICKET_CATEGORY_ID: "6" });
    expect(c.supportRoleId).toBe("5");
    expect(c.categoryId).toBe("6");
  });
});

describe("OAuth2 du panel", () => {
  const base = { DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1" };
  test("désactivé sans secret", () => {
    expect(loadConfig(base).oauthClientSecret).toBeNull();
  });
  test("secret, admins et URL publique", () => {
    const c = loadConfig({ ...base, OAUTH_CLIENT_SECRET: "s", ADMIN_IDS: "1, 2 ,,3", PUBLIC_URL: "https://panel.example.com/" });
    expect(c.oauthClientSecret).toBe("s");
    expect(c.adminIds).toEqual(["1", "2", "3"]);
    expect(c.redirectUri).toBe("https://panel.example.com/auth/callback");
  });
  test("URL publique par défaut basée sur le port", () => {
    const c = loadConfig({ ...base, PORT: "8080" });
    expect(c.redirectUri).toBe("http://localhost:8080/auth/callback");
  });
});
