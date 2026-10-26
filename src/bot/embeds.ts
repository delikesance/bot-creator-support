import { resolve } from "node:path";
import { SETUP_EN } from "../i18n";

/** Images des embeds : résolues depuis ce fichier (jamais depuis le dossier courant). */
export const ASSETS_DIR = resolve(import.meta.dir, "..", "..", "assets", "embed");
export const assetPath = (name: "banner.png" | "bibi.png") => resolve(ASSETS_DIR, name);

export const COLOR_BRAND = 0x7c5cf0;
export const COLOR_CLOSED = 0x5c5b58;

export type Style = "welcome" | "closed";

/** Embed du panneau /setup (anglais), image jointe au message sous le nom banner.png. */
export function setupEmbed() {
  return {
    color: COLOR_BRAND,
    title: SETUP_EN.title,
    description: SETUP_EN.description,
    fields: SETUP_EN.fields.map((f) => ({ ...f, inline: true })),
    image: { url: "attachment://banner.png" },
    footer: { text: SETUP_EN.footer },
  };
}

/**
 * Message de salon « accueil » ou « fermé » : le texte (déjà localisé) devient la description, sauf la mention
 * d'accueil qui reste dans le contenu pour continuer à notifier le client. Bibi en vignette.
 */
export function styledMessage(text: string, style: Style) {
  const mention = style === "welcome" ? /^[^<]*(<@\d+>)\s*/.exec(text) : null;
  const body = mention ? text.slice(mention[0].length) : text;
  return {
    content: mention?.[1],
    embed: {
      color: style === "welcome" ? COLOR_BRAND : COLOR_CLOSED,
      description: body,
      thumbnail: { url: "attachment://bibi.png" },
    },
    files: ["bibi.png" as const],
  };
}
