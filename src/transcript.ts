import type { Ticket, TicketMessage } from "./tickets";

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * Transcription texte d'un ticket : messages publics seulement (ni notes internes, ni notes système).
 * Le sujet et la description figurent dans l'en-tête, pas dans la liste.
 */
export function buildTranscript(t: Ticket, messages: TicketMessage[]): string {
  const lines = [
    `Ticket #${t.id}: ${t.subject}`,
    `Customer: ${t.userName}`,
    `Opened: ${stamp(t.createdAt)}`,
    ...(t.closedAt ? [`Closed: ${stamp(t.closedAt)}`] : []),
    "",
  ];
  for (const m of messages) {
    if (m.internal || m.source === "system") continue;
    const head = `[${stamp(m.createdAt)}] ${m.authorName}:`;
    const body = m.content.trim();
    lines.push(body ? `${head} ${body.replace(/\n/g, "\n    ")}` : head);
    for (const a of m.attachments) lines.push(`    [file] ${a.name}`);
  }
  return lines.join("\n") + "\n";
}
