import { PermissionFlagsBits, Routes, SlashCommandBuilder } from "discord.js";
import { commandLocalizations, pack } from "../i18n";

export const commandDefinitions = [
  new SlashCommandBuilder().setName("ticket").setDescription(pack("en").cmdTicket).setDescriptionLocalizations(commandLocalizations("cmdTicket")),
  new SlashCommandBuilder().setName("close").setDescription(pack("en").cmdClose).setDescriptionLocalizations(commandLocalizations("cmdClose")),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription(pack("en").cmdSetup)
    .setDescriptionLocalizations(commandLocalizations("cmdSetup"))
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
