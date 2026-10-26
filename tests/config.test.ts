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

describe("serveur des tickets", () => {
  test("dev : salons créés sur le serveur de test", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, TEST_GUILD_ID: "1", GUILD_ID: "9" });
    expect(c.guildId).toBe("1");
  });
  test("prod : GUILD_ID, optionnels nuls par défaut", () => {
    const c = loadConfig({ DISCORD_TOKEN: TOKEN, NODE_ENV: "production", GUILD_ID: "9" });
    expect(c.guildId).toBe("9");
    expect(c.supportRoleId).toBeNull();
    expect(c.categoryId).toBeNull();
  });
});
