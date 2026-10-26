import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type Webhook,
  type Interaction,
  type TextChannel,
} from "discord.js";
import type { Config } from "../config";
import type { Gateway, SupportDesk } from "../desk";
import { handleInteraction, type Ix } from "./handlers";
import { registerCommands } from "./register";

const button = (id: string, label: string, style: ButtonStyle) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

const activeRow = () =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("ticket:claim", "Prendre en charge", ButtonStyle.Primary),
    button("ticket:close", "Fermer", ButtonStyle.Danger),
  );
const closedRow = () =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(button("ticket:reopen", "Rouvrir", ButtonStyle.Success));

export class DiscordGateway implements Gateway {
  constructor(
    private client: Client,
    private cfg: Pick<Config, "supportRoleId" | "categoryId">,
  ) {}

  private async guild(id: string): Promise<Guild> {
    const g = await this.client.guilds.fetch(id).catch(() => null);
    if (!g) throw new Error("Le bot n'est plus présent sur ce serveur.");
    return g;
  }

  /** Serveurs où le bot est présent (alimente le sélecteur du panel). */
  list(): { id: string; name: string; icon: string | null }[] {
    return this.client.guilds.cache.map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }) }));
  }

  private hooks = new Map<string, Webhook>();

  /** Webhook du salon (créé au besoin) : permet de poster sous le pseudo et l'avatar d'un admin. */
  private async webhook(ch: TextChannel): Promise<Webhook> {
    const cached = this.hooks.get(ch.id);
    if (cached) return cached;
    const mine = (await ch.fetchWebhooks()).find((w) => w.owner?.id === this.client.user!.id);
    const hook = mine ?? (await ch.createWebhook({ name: "Support" }));
    this.hooks.set(ch.id, hook);
    return hook;
  }

  private async channel(id: string): Promise<TextChannel> {
    const c = await this.client.channels.fetch(id);
    if (!c || c.type !== ChannelType.GuildText) throw new Error(`Salon ${id} introuvable.`);
    return c;
  }

  async createTicketChannel(o: { guildId: string; userId: string; userName: string }): Promise<string> {
    const guild = await this.guild(o.guildId);
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: o.userId, allow },
      { id: this.client.user!.id, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks] },
    ];
    if (this.cfg.supportRoleId) overwrites.push({ id: this.cfg.supportRoleId, allow });
    const slug =
      o.userName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "user";
    const ch = await guild.channels.create({
      name: `ticket-${slug}`,
      type: ChannelType.GuildText,
      parent: this.cfg.categoryId ?? undefined,
      permissionOverwrites: overwrites,
    });
    return ch.id;
  }

  async send(
    channelId: string,
    text: string,
    opts?: { controls?: "active" | "closed"; as?: { name: string; avatarUrl?: string } },
  ): Promise<void> {
    const ch = await this.channel(channelId);
    if (opts?.as) {
      try {
        const hook = await this.webhook(ch);
        await hook.send({
          content: text,
          username: opts.as.name.slice(0, 80),
          avatarURL: opts.as.avatarUrl,
          allowedMentions: { parse: [] },
        });
        return;
      } catch (e) {
        // Permission « Gérer les webhooks » absente, etc. : on retombe sur le bot plutôt que de perdre le message.
        this.hooks.delete(ch.id);
        console.warn(`Webhook indisponible dans ${channelId}, envoi en tant que bot :`, (e as Error).message);
      }
    }
    const components =
      opts?.controls === "active" ? [activeRow()] : opts?.controls === "closed" ? [closedRow()] : [];
    await ch.send({
      content: text,
      components,
      // Seul le message d'accueil peut notifier l'auteur ; les réponses du panel ne ping personne.
      allowedMentions: opts?.controls === "active" ? { parse: ["users"] } : { parse: [] },
    });
  }

  async setUserLocked(channelId: string, userId: string, locked: boolean): Promise<void> {
    const ch = await this.channel(channelId);
    await ch.permissionOverwrites.edit(userId, { SendMessages: !locked });
  }

  async deleteChannel(channelId: string): Promise<void> {
    const ch = await this.client.channels.fetch(channelId).catch(() => null);
    await ch?.delete();
  }
}

function toIx(i: Interaction, cfg: Pick<Config, "supportRoleId">): Ix | null {
  if (!i.inGuild() || (!i.isChatInputCommand() && !i.isButton() && !i.isModalSubmit())) return null;
  const roles = i.member?.roles;
  const hasRole =
    !!cfg.supportRoleId &&
    (Array.isArray(roles) ? roles.includes(cfg.supportRoleId) : !!roles?.cache?.has(cfg.supportRoleId));
  const reply = async (text: string) => {
    const payload = { content: text, allowedMentions: { parse: [] as never[] } };
    if (i.deferred || i.replied) await i.editReply(payload);
    else await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
  };
  return {
    kind: i.isChatInputCommand() ? "command" : i.isButton() ? "button" : "modal",
    id: i.isChatInputCommand() ? i.commandName : i.customId,
    userId: i.user.id,
    userName: i.user.username,
    guildId: i.guildId,
    channelId: i.channelId ?? "",
    isStaff: !!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || hasRole,
    subject: i.isModalSubmit() ? i.fields.getTextInputValue("subject") : undefined,
    description: i.isModalSubmit() ? i.fields.getTextInputValue("description") : undefined,
    reply,
    showSubjectModal: async () => {
      if (i.isChatInputCommand() || i.isButton()) {
        await i.showModal(
          new ModalBuilder()
            .setCustomId("ticket:modal")
            .setTitle("Ouvrir un ticket")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("subject")
                  .setLabel("Titre")
                  .setPlaceholder("Ex. : Impossible de me connecter")
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(100)
                  .setRequired(true),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("description")
                  .setLabel("Description détaillée")
                  .setPlaceholder("Que s'est-il passé ? Que voulais-tu faire ? Messages d'erreur, étapes pour reproduire…")
                  .setStyle(TextInputStyle.Paragraph)
                  .setMinLength(20)
                  .setMaxLength(1000)
                  .setRequired(true),
              ),
            ),
        );
      }
    },
    postPanel: async () => {
      const ch = i.channel;
      if (ch && "send" in ch) {
        await ch.send({
          content:
            "## 🎫 Support\nUn souci, une question ? Clique sur le bouton pour ouvrir un ticket privé avec l'équipe.",
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              button("ticket:open", "Ouvrir un ticket", ButtonStyle.Primary),
            ),
          ],
        });
      }
      await reply("✅ Panneau posté.");
    },
  };
}

export async function startBot(cfg: Config, desk: SupportDesk, makeGateway: (c: Client) => DiscordGateway) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
  const gateway = makeGateway(client);

  client.on(Events.InteractionCreate, async (i) => {
    const ix = toIx(i, cfg);
    if (!ix) return;
    // La modale doit être la première réponse ; le reste est différé (créer un salon peut dépasser 3 s).
    const showsModal = ix.id === "ticket" || ix.id === "ticket:open";
    if (!showsModal && i.isRepliable()) await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    await handleInteraction(desk, ix);
  });

  client.on(Events.MessageCreate, (m) => {
    if (m.author.bot || !m.inGuild()) return;
    const content = m.content || m.attachments.map((a) => a.url).join("\n");
    desk.recordDiscordMessage(m.channelId, { id: m.author.id, name: m.author.username }, content);
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Bot connecté : ${c.user.tag}`);
    await registerCommands(new REST().setToken(cfg.token), cfg);
    console.log(
      cfg.commandGuildId
        ? `Commandes enregistrées sur le serveur de test ${cfg.commandGuildId}`
        : "Commandes enregistrées globalement (production)",
    );
  });

  await client.login(cfg.token);
  return { client, gateway };
}
