import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Règle produit : aucun message en français hors des textes localisés (le Pack de src/i18n.ts).
 *
 * Heuristique : on retire les commentaires (/* *\/, // en début de ligne ou après un espace, <!-- -->), puis on cherche
 * dans ce qui reste soit une lettre accentuée française (àâçéèêëîïôùûüœ), soit un mot de la liste ci-dessous.
 * La liste ne contient que des mots sans accent qui n'existent pas en anglais (les mots accentués sont déjà couverts par la lettre accentuée). Faux positif : ajouter une exception à ALLOWED.
 */
const ROOT = join(import.meta.dir, "..");
const EXCLUDED = new Set(["src/i18n.ts"]);
const ALLOWED: RegExp[] = [];

const FRENCH_WORDS = [
  "introuvable", "rouvert", "erreur", "mot de passe", "connexion", "systeme", "pris en charge", "trop de", "requis",
  "invalide", "est vide", "ticket est", "piece jointe", "serveur", "bienvenue", "aucun", "retour", "ferme le", "lecture", "enregistrement",
];
const WORDS = new RegExp(`(?<![\p{L}])(?:${FRENCH_WORDS.join("|")})(?![\p{L}])`, "iu");
const ACCENT = /[àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/;

function files(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p, exts);
    return exts.some((e) => n.endsWith(e)) ? [p] : [];
  });
}

export function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

export function frenchLines(source: string): string[] {
  return stripComments(source)
    .split("\n")
    .filter((l) => (ACCENT.test(l) || WORDS.test(l)) && !ALLOWED.some((a) => a.test(l)))
    .map((l) => l.trim());
}

describe("anglais par défaut", () => {
  test("l'heuristique repère le français et ignore les commentaires", () => {
    expect(frenchLines('const a = "Ticket fermé";')).toHaveLength(1);
    expect(frenchLines('throw new Error("Accès refusé");')).toHaveLength(1);
    expect(frenchLines('const url = "https://exemple.com/é";').length).toBe(1);
    expect(frenchLines("// Ticket fermé : commentaire\nconst a = 1; /* éèà */")).toEqual([]);
    expect(frenchLines('const a = "Ticket closed";')).toEqual([]);
  });

  const targets = [
    ...files(join(ROOT, "src"), [".ts"]).filter((f) => !EXCLUDED.has(relative(ROOT, f).replaceAll("\\", "/"))),
    ...files(join(ROOT, "public"), [".html", ".js", ".css"]),
  ];
  test.each(targets.map((f) => [relative(ROOT, f).replaceAll("\\", "/"), f]))("%s ne contient aucun texte français", (_n, f) => {
    expect(frenchLines(readFileSync(f!, "utf8"))).toEqual([]);
  });
});
