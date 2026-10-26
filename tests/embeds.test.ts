import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { assetPath, setupEmbed, styledMessage } from "../src/bot/embeds";
import { welcomeText } from "../src/i18n";

describe("embed /setup", () => {
  const e = setupEmbed();
  test("texte, couleur, champs et pied de page du design", () => {
    expect(e.color).toBe(0x7c5cf0);
    expect(e.title).toBe("Stuck? Open a ticket.");
    expect(e.description).toStartWith("Describe the problem.");
    expect(e.fields.map((f) => [f.name, f.inline])).toEqual([["Private", true], ["Your language", true], ["Files welcome", true]]);
    expect(e.footer).toEqual({ text: "One open ticket per person." });
    expect(e.image.url).toBe("attachment://banner.png");
    expect(e).not.toHaveProperty("thumbnail");
    expect(e).not.toHaveProperty("author");
  });
  test("images présentes, chemin indépendant du dossier courant", () => {
    expect(existsSync(assetPath("banner.png"))).toBe(true);
    expect(existsSync(assetPath("bibi.png"))).toBe(true);
  });
  test("la langue du serveur est ignorée : aucun paramètre de langue", () => {
    expect(setupEmbed.length).toBe(0);
    expect(JSON.stringify(setupEmbed())).not.toContain("Ouvrir");
  });
});

describe("messages stylés", () => {
  test("accueil : la mention reste dans le contenu, le texte localisé dans l'embed", () => {
    const m = styledMessage(welcomeText("fr", 7, "42"), "welcome");
    expect(m.content).toBe("<@42>");
    expect(m.embed.description).toContain("bientôt");
    expect(m.embed.description).not.toContain("<@42>");
    expect(m.embed.color).toBe(0x7c5cf0);
    expect(m.embed.thumbnail.url).toBe("attachment://bibi.png");
  });
  test("fermeture : couleur grise, texte tel quel, sans contenu", () => {
    const m = styledMessage("🔴 Ton ticket est fermé.", "closed");
    expect(m.content).toBeUndefined();
    expect(m.embed.color).toBe(0x5c5b58);
    expect(m.embed.description).toBe("🔴 Ton ticket est fermé.");
  });
});
