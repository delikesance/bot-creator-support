import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { assetPath, ratingMessage, setupEmbed, styledMessage } from "../src/bot/embeds";
import { pack, welcomeText } from "../src/i18n";

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

describe("demande de note", () => {
  const langs = ["en", "fr", "es", "de", "pt", "it", "nl", "pl", "ru", "tr", "ja", "ko", "zh"];
  test("chaque langue a le texte de demande, de remerciement et de doublon", () => {
    for (const l of langs) {
      const p = pack(l);
      for (const k of ["ratingPrompt", "ratingThanks", "ratingDone"] as const) expect(p[k].length).toBeGreaterThan(5);
    }
    expect(new Set(langs.map((l) => pack(l).ratingPrompt)).size).toBe(langs.length);
  });
  test("cinq boutons dont l'identifiant porte le ticket, texte dans la langue du ticket", () => {
    const m = ratingMessage(12, "fr");
    expect(m.buttons.map((b) => b.customId)).toEqual(["rate:12:1", "rate:12:2", "rate:12:3", "rate:12:4", "rate:12:5"]);
    expect(m.embed.description).toBe(pack("fr").ratingPrompt);
  });
});
