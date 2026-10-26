import type { SupportDesk } from "../desk";
import { TicketError } from "../tickets";

/** Vue minimale d'une interaction Discord, pour rester testable sans réseau. */
export interface Ix {
  kind: "command" | "button" | "modal";
  /** Nom de commande ou customId. */
  id: string;
  userId: string;
  userName: string;
  channelId: string;
  /** Permission « Gérer les salons » ou rôle support. */
  isStaff: boolean;
  subject?: string;
  /** Réponse visible uniquement par l'auteur. */
  reply(text: string): Promise<void>;
  showSubjectModal(): Promise<void>;
  postPanel(): Promise<void>;
}

const NO_PERM = "⛔ Tu n'as pas la permission de faire ça.";

export async function handleInteraction(desk: SupportDesk, ix: Ix): Promise<void> {
  try {
    await route(desk, ix);
  } catch (e) {
    if (e instanceof TicketError) return ix.reply(`⚠️ ${e.message}`);
    console.error("Erreur d'interaction", e);
    return ix.reply("❌ Une erreur est survenue, réessaie dans un instant.");
  }
}

async function route(desk: SupportDesk, ix: Ix): Promise<void> {
  const { kind, id } = ix;

  if ((kind === "command" && id === "ticket") || (kind === "button" && id === "ticket:open")) {
    return ix.showSubjectModal();
  }

  if (kind === "modal" && id === "ticket:modal") {
    const t = await desk.open({ userId: ix.userId, userName: ix.userName, subject: ix.subject ?? "" });
    return ix.reply(`✅ Ton ticket #${t.id} est ouvert : <#${t.channelId}>`);
  }

  if (kind === "command" && id === "setup") {
    if (!ix.isStaff) return ix.reply(NO_PERM);
    return ix.postPanel();
  }

  const isClose = (kind === "command" && id === "close") || (kind === "button" && id === "ticket:close");
  const isClaim = kind === "button" && id === "ticket:claim";
  const isReopen = kind === "button" && id === "ticket:reopen";
  if (!isClose && !isClaim && !isReopen) return;

  const t = desk.tickets.getByChannel(ix.channelId);
  if (!t) return ix.reply("⚠️ Cette action n'est possible que dans un salon de ticket.");

  if (isClose) {
    if (!ix.isStaff && ix.userId !== t.userId) return ix.reply(NO_PERM);
    await desk.close(t.id, ix.userName);
    return ix.reply("🔴 Ticket fermé.");
  }
  if (!ix.isStaff) return ix.reply(NO_PERM);
  if (isClaim) {
    await desk.claim(t.id, { id: ix.userId, name: ix.userName });
    return ix.reply("🟡 Tu as pris ce ticket en charge.");
  }
  await desk.reopen(t.id, ix.userName);
  return ix.reply("🟢 Ticket rouvert.");
}
