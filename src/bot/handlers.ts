import type { SupportDesk } from "../desk";
import { TicketError } from "../tickets";
import { openedText, pack } from "../i18n";

/** Vue minimale d'une interaction Discord, pour rester testable sans réseau. */
export interface Ix {
  kind: "command" | "button" | "modal";
  /** Nom de commande ou customId. */
  id: string;
  userId: string;
  userName: string;
  guildId: string;
  channelId: string;
  /** Permission « Gérer les salons » ou rôle support. */
  isStaff: boolean;
  subject?: string;
  description?: string;
  /** Locale Discord de l'utilisateur (`interaction.locale`). */
  locale?: string;
  /** Réponse visible uniquement par l'auteur. */
  reply(text: string): Promise<void>;
  showSubjectModal(): Promise<void>;
  postPanel(): Promise<void>;
}

export async function handleInteraction(desk: SupportDesk, ix: Ix): Promise<void> {
  try {
    await route(desk, ix);
  } catch (e) {
    if (e instanceof TicketError) return ix.reply(`⚠️ ${e.message}`);
    console.error("Interaction failed", e);
    return ix.reply(pack(ix.locale).error);
  }
}

async function route(desk: SupportDesk, ix: Ix): Promise<void> {
  const { kind, id } = ix;
  const p = pack(ix.locale);

  if ((kind === "command" && id === "ticket") || (kind === "button" && id === "ticket:open")) {
    return ix.showSubjectModal();
  }

  if (kind === "modal" && id === "ticket:modal") {
    const t = await desk.open({ guildId: ix.guildId, userId: ix.userId, userName: ix.userName, subject: ix.subject ?? "", description: ix.description, locale: ix.locale });
    return ix.reply(openedText(ix.locale, t.id, t.channelId));
  }

  if (kind === "command" && id === "setup") {
    if (!ix.isStaff) return ix.reply(p.noPerm);
    return ix.postPanel();
  }

  // Note de 1 à 5 donnée au bouton posté à la fermeture : « rate:<ticket>:<n> ». Le desk vérifie l'auteur et l'état.
  const rate = kind === "button" ? /^rate:(\d+):([1-5])$/.exec(id) : null;
  if (rate) {
    try {
      await desk.rate(Number(rate[1]), ix.userId, Number(rate[2]));
    } catch (e) {
      if (e instanceof TicketError) return ix.reply(p.ratingDone);
      throw e;
    }
    return ix.reply(p.ratingThanks);
  }

  const isClose = (kind === "command" && id === "close") || (kind === "button" && id === "ticket:close");
  const isReopen = kind === "button" && id === "ticket:reopen";
  if (!isClose && !isReopen) return;

  const t = desk.tickets.getByChannel(ix.channelId);
  if (!t) return ix.reply(p.wrongChannel);

  if (isClose) {
    if (!ix.isStaff && ix.userId !== t.userId) return ix.reply(p.noPerm);
    await desk.close(t.id, ix.userName);
    return ix.reply(p.closedReply);
  }
  if (!ix.isStaff) return ix.reply(p.noPerm);
  await desk.reopen(t.id, ix.userName);
  return ix.reply(p.reopenedReply);
}
