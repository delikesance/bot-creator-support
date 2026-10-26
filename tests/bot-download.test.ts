import { describe, expect, test } from "bun:test";
import { downloadFile } from "../src/bot/download";

const fakeFetch = (res: () => Response) => (async () => res()) as unknown as typeof fetch;

describe("downloadFile", () => {
  test("renvoie les octets", async () => {
    const d = await downloadFile("https://cdn/a", { fetch: fakeFetch(() => new Response(new Uint8Array([1, 2, 3]))) });
    expect([...d]).toEqual([1, 2, 3]);
  });
  test("statut d'erreur : lève", async () => {
    await expect(downloadFile("https://cdn/a", { fetch: fakeFetch(() => new Response("", { status: 404 })) })).rejects.toThrow(/404/);
  });
  test("taille annoncée ou réelle au-delà du plafond : lève", async () => {
    await expect(
      downloadFile("https://cdn/a", { maxBytes: 5, fetch: fakeFetch(() => new Response("x", { headers: { "content-length": "99" } })) }),
    ).rejects.toThrow(/too large/);
    await expect(downloadFile("https://cdn/a", { maxBytes: 5, fetch: fakeFetch(() => new Response("123456789")) })).rejects.toThrow(/too large/);
  });
  test("délai dépassé : lève", async () => {
    const slow = ((_u: string, init: RequestInit) =>
      new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("timeout"))))) as unknown as typeof fetch;
    await expect(downloadFile("https://cdn/a", { timeoutMs: 20, fetch: slow })).rejects.toThrow();
  });
});
