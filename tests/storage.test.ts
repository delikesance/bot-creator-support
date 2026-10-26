import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttachmentError,
  MAX_FILES,
  openStored,
  sanitizeName,
  storeFile,
  validateBatch,
  validateFile,
} from "../src/storage";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const bytes = (s: string) => new TextEncoder().encode(s);
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function failure(fn: () => unknown): AttachmentError {
  try {
    fn();
  } catch (e) {
    return e as AttachmentError;
  }
  throw new Error("devait échouer");
}

describe("validation", () => {
  test("image PNG valide", () => {
    expect(validateFile({ name: "capture.PNG", data: png })).toMatchObject({ ext: "png", mime: "image/png", kind: "image", name: "capture.PNG" });
  });
  test("signatures : jpg, gif, webp, pdf, zip", () => {
    const webp = new Uint8Array([...bytes("RIFF"), 0, 0, 0, 0, ...bytes("WEBP")]);
    expect(validateFile({ name: "a.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }).kind).toBe("image");
    expect(validateFile({ name: "a.gif", data: bytes("GIF89a....") }).kind).toBe("image");
    expect(validateFile({ name: "a.webp", data: webp }).kind).toBe("image");
    expect(validateFile({ name: "a.pdf", data: bytes("%PDF-1.7") }).kind).toBe("file");
    expect(validateFile({ name: "a.zip", data: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]) }).mime).toBe("application/zip");
  });
  test("texte accepté, binaire déguisé en texte refusé", () => {
    expect(validateFile({ name: "log.txt", data: bytes("hello") }).mime).toContain("text/plain");
    expect(() => validateFile({ name: "x.txt", data: new Uint8Array([65, 0, 66]) })).toThrow(AttachmentError);
  });
  test("extension non autorisée : 400 avec le nom du fichier", () => {
    const e = failure(() => validateFile({ name: "virus.exe", data: bytes("MZ") }));
    expect(e.status).toBe(400);
    expect(e.message).toContain("virus.exe");
  });
  test("extension qui ment : un exécutable renommé en png est refusé", () => {
    expect(() => validateFile({ name: "a.png", data: bytes("MZ\x90\x00") })).toThrow(/content/);
  });
  test("fichier vide refusé", () => {
    expect(() => validateFile({ name: "a.txt", data: new Uint8Array() })).toThrow(/empty/);
  });
  test("plus de 25 Mo : 413 avec le nom", () => {
    const e = failure(() => validateFile({ name: "gros.zip", data: new Uint8Array(25 * 1024 * 1024 + 1) }));
    expect(e.status).toBe(413);
    expect(e.message).toContain("gros.zip");
  });
  test("lot : trop de fichiers et taille cumulée", () => {
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `${i}.txt`, data: bytes("x") }));
    expect(failure(() => validateBatch(many)).status).toBe(413);
    const chunk = new Uint8Array(21 * 1024 * 1024).fill(65);
    expect(failure(() => validateBatch([1, 2].map((i) => ({ name: `${i}.txt`, data: chunk })))).status).toBe(413);
  });
});

describe("noms", () => {
  test("chemin, guillemets et caractères de contrôle retirés", () => {
    expect(sanitizeName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeName("C:\\Users\\a\\rapport.pdf")).toBe("rapport.pdf");
    expect(sanitizeName('a"b\r\nc.txt')).toBe("abc.txt");
    expect(sanitizeName("...")).toBe("file");
    expect(sanitizeName("")).toBe("file");
  });
  test("nom trop long : tronqué en gardant l'extension", () => {
    const n = sanitizeName("a".repeat(300) + ".png");
    expect(n.length).toBe(100);
    expect(n.endsWith(".png")).toBe(true);
  });
});

describe("stockage", () => {
  test("nom aléatoire, relecture, contenu identique", async () => {
    const dir = mkdtempSync(join(tmpdir(), "att-"));
    dirs.push(dir);
    const a = await storeFile(join(dir, "sub"), png, "png");
    const b = await storeFile(join(dir, "sub"), png, "png");
    expect(a).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(a).not.toBe(b);
    const f = openStored(join(dir, "sub"), a)!;
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(png);
  });
  test("traversée de chemin impossible", () => {
    expect(openStored("/data", "../secret.png")).toBeNull();
    expect(openStored("/data", "..\\x.png")).toBeNull();
    expect(openStored("/data", "abc.png")).toBeNull();
  });
  test("extension hors liste blanche refusée", async () => {
    await expect(storeFile(tmpdir(), png, "exe")).rejects.toThrow();
  });
});
