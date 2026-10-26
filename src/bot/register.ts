import { PermissionFlagsBits, Routes, SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder().setName("ticket").setDescription("Ouvrir un ticket de support"),
  new SlashCommandBuilder().setName("close").setDescription("Fermer le ticket de ce salon"),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Poster le panneau « Ouvrir un ticket » dans ce salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

interface RestLike {
  put(route: string, opts: { body: unknown }): Promise<unknown>;
}

/** Dev : commandes du serveur de test seulement (effet immédiat). Prod : globales. */
export async function registerCommands(
  rest: RestLike,
  cfg: { clientId: string; commandGuildId: string | null },
): Promise<void> {
  const route = cfg.commandGuildId
    ? Routes.applicationGuildCommands(cfg.clientId, cfg.commandGuildId)
    : Routes.applicationCommands(cfg.clientId);
  await rest.put(route, { body: commandDefinitions });
}
