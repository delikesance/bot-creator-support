/** Texte d'un message Discord + liens de ses pièces jointes (une par ligne), pour l'historique du ticket. */
export function messageContent(text: string, attachmentUrls: string[]): string {
  return [text.trim(), ...attachmentUrls].filter(Boolean).join("\n");
}
