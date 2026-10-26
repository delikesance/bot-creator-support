import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Pièces jointes : validation (extension + octets réels) et stockage sur disque sous des noms aléatoires. */

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 40 * 1024 * 1024;

/** Erreur de validation : `status` 400 (type) ou 413 (taille), le message nomme le fichier. */
export class AttachmentError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413,
  ) {
    super(message);
  }
}

export interface FileKind {
  mime: string;
  kind: "image" | "file";
}

const TYPES: Record<string, FileKind> = {
  png: { mime: "image/png", kind: "image" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  gif: { mime: "image/gif", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  pdf: { mime: "application/pdf", kind: "file" },
  zip: { mime: "application/zip", kind: "file" },
  txt: { mime: "text/plain; charset=utf-8", kind: "file" },
  log: { mime: "text/plain; charset=utf-8", kind: "file" },
  md: { mime: "text/plain; charset=utf-8", kind: "file" },
  json: { mime: "application/json", kind: "file" },
  csv: { mime: "text/csv; charset=utf-8", kind: "file" },
};

const startsWith = (d: Uint8Array, sig: number[], at = 0) => sig.every((b, i) => d[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Les octets correspondent-ils à l'extension annoncée ? (images, pdf, zip : signature ; texte : pas d'octet nul.) */
export function matchesSignature(ext: string, d: Uint8Array): boolean {
  switch (ext) {
    case "png":
      return startsWith(d, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(d, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(d, ascii("GIF87a")) || startsWith(d, ascii("GIF89a"));
    case "webp":
      return startsWith(d, ascii("RIFF")) && startsWith(d, ascii("WEBP"), 8);
    case "pdf":
      return startsWith(d, ascii("%PDF-"));
    case "zip":
      return startsWith(d, [0x50, 0x4b, 0x03, 0x04]) || startsWith(d, [0x50, 0x4b, 0x05, 0x06]);
    default:
      // Texte : un octet nul dans les premiers Ko trahit un binaire déguisé.
      return !d.subarray(0, 8192).includes(0);
  }
}

export const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** Nom affichable : sans chemin, sans caractères de contrôle ni de guillemets, borné à 100 caractères. */
export function sanitizeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"<>:*?|]/g, "")
    .replace(/^\.+/, "")
    .trim();
  if (!base) return "file";
  if (base.length <= 100) return base;
  const ext = extensionOf(base);
  return base.slice(0, 100 - (ext ? ext.length + 1 : 0)) + (ext ? `.${ext}` : "");
}

export interface ValidFile {
  name: string;
  ext: string;
  mime: string;
  kind: "image" | "file";
  size: number;
}

/** Valide un fichier : lève AttachmentError (413 taille, 400 type ou contenu incohérent). */
export function validateFile(f: { name: string; data: Uint8Array }): ValidFile {
  const name = sanitizeName(f.name);
  if (f.data.byteLength > MAX_FILE_BYTES) {
    throw new AttachmentError(`"${name}" is over 25 MB.`, 413);
  }
  const ext = extensionOf(name);
  const type = TYPES[ext];
  if (!type) throw new AttachmentError(`"${name}": file type not allowed.`, 400);
  if (f.data.byteLength === 0) throw new AttachmentError(`"${name}" is empty.`, 400);
  if (!matchesSignature(ext, f.data)) {
    throw new AttachmentError(`"${name}": content does not match its extension.`, 400);
  }
  return { name, ext, mime: type.mime, kind: type.kind, size: f.data.byteLength };
}

/** Valide un lot (nombre, taille cumulée, chaque fichier). */
export function validateBatch(files: { name: string; data: Uint8Array }[]): ValidFile[] {
  if (files.length > MAX_FILES) throw new AttachmentError(`Too many files (maximum ${MAX_FILES}).`, 413);
  const total = files.reduce((n, f) => n + f.data.byteLength, 0);
  if (total > MAX_REQUEST_BYTES) throw new AttachmentError("Files exceed 40 MB in total.", 413);
  return files.map(validateFile);
}

const STORED = /^[a-f0-9]{32}\.[a-z0-9]{2,4}$/;

/** Écrit le fichier sous un nom aléatoire (jamais dérivé de l'entrée, sauf l'extension de la liste blanche). */
export async function storeFile(dir: string, data: Uint8Array, ext: string): Promise<string> {
  if (!TYPES[ext]) throw new Error(`Extension not allowed: ${ext}`);
  await mkdir(dir, { recursive: true });
  const file = `${randomBytes(16).toString("hex")}.${ext}`;
  await Bun.write(join(dir, file), data);
  return file;
}

/** Fichier stocké, ou null si le nom n'est pas un nom généré par `storeFile` (aucune traversée possible). */
export function openStored(dir: string, file: string): ReturnType<typeof Bun.file> | null {
  return STORED.test(file) ? Bun.file(join(dir, file)) : null;
}
