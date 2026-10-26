import { describe, expect, test } from "bun:test";
import { commandDefinitions, registerCommands } from "../src/bot/register";

function fakeRest() {
  const calls: { route: string; body: unknown }[] = [];
  return { calls, put: async (route: string, o: { body: unknown }) => void calls.push({ route, body: o.body }) };
}

describe("enregistrement des commandes", () => {
  test("définit /ticket, /close et /setup", () => {
    expect(commandDefinitions.map((c) => c.name).sort()).toEqual(["close", "setup", "ticket"]);
  });
  test("dev : uniquement sur le serveur de test", async () => {
    const rest = fakeRest();
    await registerCommands(rest, { clientId: "app", commandGuildId: "guild" });
    expect(rest.calls).toHaveLength(1);
    expect(rest.calls[0]!.route).toBe("/applications/app/guilds/guild/commands");
  });
  test("prod : commandes globales", async () => {
    const rest = fakeRest();
    await registerCommands(rest, { clientId: "app", commandGuildId: null });
    expect(rest.calls[0]!.route).toBe("/applications/app/commands");
  });
});
