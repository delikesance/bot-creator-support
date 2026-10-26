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
import type { Gateway, OutFile, SupportDesk } from "../desk";
import { handleInteraction, type Ix } from "./handlers";
import { pack } from "../i18n";
import { registerCommands } from "./register";
import { assetPath, ratingMessage, setupEmbed, styledMessage, type Style } from "./embeds";
import { SETUP_EN } from "../i18n";

const button = (id: string, label: string, style: ButtonStyle) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

const activeRow = () =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("ticket:close", "Close", ButtonStyle.Danger),
  );
const closedRow = () =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(button("ticket:reopen", "Reopen", ButtonStyle.Success));

export class DiscordGateway implements Gateway {
  constructor(
    private client: Client,
    private cfg: Pick<Config, "supportRoleId" | "categoryId">,
  ) {}

  private async guild(id: string): Promise<Guild> {
    const g = await this.client.guilds.fetch(id).catch(() => null);
    if (!g) throw new Error("The bot is no longer in this server.");
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
    if (!c || c.type !== ChannelType.GuildText) throw new Error(`Channel ${id} not found.`);
    return c;
  }

  async createTicketChannel(o: { guildId: string; userId: string; userName: string; categoryId?: string | null }): Promise<string> {
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
    const create = (parent?: string) =>
      guild.channels.create({ name: `ticket-${slug}`, type: ChannelType.GuildText, parent, permissionOverwrites: overwrites });
    // Catégorie du serveur (réglée avec /setup), sinon TICKET_CATEGORY_ID. Si elle a été supprimée ou si le bot n'y a
    // plus accès, le ticket s'ouvre quand même, à la racine, plutôt que d'échouer pour le client.
    const parent = o.categoryId ?? this.cfg.categoryId ?? undefined;
    let ch;
    try {
      ch = await create(parent);
    } catch (e) {
      if (!parent) throw e;
      console.warn(`Category ${parent} unavailable in ${o.guildId}, creating the channel without it:`, (e as Error).message);
      ch = await create();
    }
    return ch.id;
  }

  async send(
    channelId: string,
    text: string,
    opts?: { controls?: "active" | "closed"; as?: { name: string; avatarUrl?: string }; files?: OutFile[]; style?: Style },
  ): Promise<void> {
    const ch = await this.channel(channelId);
    const files = opts?.files?.map((f) => ({ attachment: Buffer.from(f.data), name: f.name }));
    if (opts?.as) {
      try {
        const hook = await this.webhook(ch);
        await hook.send({
          content: text || undefined,
          files,
          username: opts.as.name.slice(0, 80),
          avatarURL: opts.as.avatarUrl,
          allowedMentions: { parse: [] },
        });
        return;
      } catch (e) {
        // Permission « Gérer les webhooks » absente, etc. : on retombe sur le bot plutôt que de perdre le message.
        this.hooks.delete(ch.id);
        console.warn(`Webhook unavailable in ${channelId}, sending as the bot:`, (e as Error).message);
      }
    }
    const components =
      opts?.controls === "active" ? [activeRow()] : opts?.controls === "closed" ? [closedRow()] : [];
    // Accueil et fermeture : texte localisé dans un embed aux couleurs du desk, Bibi en vignette (fichier joint).
    const styled = opts?.style ? styledMessage(text, opts.style) : null;
    const all = [...(files ?? []), ...(styled?.files.map((n) => ({ attachment: assetPath(n), name: n })) ?? [])];
    await ch.send({
      content: (styled ? styled.content : text) || undefined,
      embeds: styled ? [styled.embed] : [],
      files: all,
      components,
      // Seul le message d'accueil peut notifier l'auteur ; les réponses du panel ne ping personne.
      allowedMentions: opts?.controls === "active" || opts?.style === "welcome" ? { parse: ["users"] } : { parse: [] },
    });
  }

  /** Cinq boutons de 1 à 5 dans le salon du ticket, dans la langue du client. */
  async askRating(channelId: string, ticketId: number, locale?: string): Promise<void> {
    const ch = await this.channel(channelId);
    const m = ratingMessage(ticketId, locale);
    await ch.send({
      embeds: [m.embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          m.buttons.map((b) => button(b.customId, b.label, ButtonStyle.Secondary)),
        ),
      ],
      allowedMentions: { parse: [] },
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
    locale: i.locale,
    guildId: i.guildId,
    channelId: i.channelId ?? "",
    isStaff: !!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || hasRole,
    subject: i.isModalSubmit() ? i.fields.getTextInputValue("subject") : undefined,
    description: i.isModalSubmit() ? i.fields.getTextInputValue("description") : undefined,
    category: (() => {
      const c = i.isChatInputCommand() ? i.options.getChannel("category") : null;
      return c ? { id: c.id, name: "name" in c && c.name ? c.name : c.id } : undefined;
    })(),
    reply,
    showSubjectModal: async () => {
      if (i.isChatInputCommand() || i.isButton()) {
        await i.showModal(
          new ModalBuilder()
            .setCustomId("ticket:modal")
            .setTitle(pack(i.locale).modalTitle)
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("subject")
                  .setLabel(pack(i.locale).subjectLabel)
                  .setPlaceholder(pack(i.locale).subjectPh)
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(100)
                  .setRequired(true),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("description")
                  .setLabel(pack(i.locale).descLabel)
                  .setPlaceholder(pack(i.locale).descPh)
                  .setStyle(TextInputStyle.Paragraph)
                  .setMinLength(20)
                  .setMaxLength(1000)
                  .setRequired(true),
              ),
            ),
        );
      }
    },
    postPanel: async (confirmation: string) => {
      const ch = i.channel;
      // Le panneau est public et toujours en anglais (ni langue du serveur ni celle de l'admin) ; seule la confirmation suit l'admin.
      if (ch && "send" in ch) {
        await ch.send({
          embeds: [setupEmbed()],
          files: [{ attachment: assetPath("banner.png"), name: "banner.png" }],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(button("ticket:open", SETUP_EN.button, ButtonStyle.Primary)),
          ],
        });
      }
      await reply(confirmation);
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
    // Les pièces jointes sont téléchargées par le desk : l'URL du CDN expire, le panel sert sa propre copie.
    const files = m.attachments.map((a) => ({ name: a.name, size: a.size, url: a.url }));
    void desk.recordDiscordMessage(m.channelId, { id: m.author.id, name: m.author.username }, m.content, files);
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Bot connected: ${c.user.tag}`);
    await registerCommands(new REST().setToken(cfg.token), cfg);
    console.log(
      cfg.commandGuildId
        ? `Commands registered on test server ${cfg.commandGuildId}`
        : "Commands registered globally (production)",
    );
  });

  await client.login(cfg.token);
  return { client, gateway };
}
