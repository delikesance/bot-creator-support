import { MAX_FILE_BYTES } from "../storage";

/** Télécharge une pièce jointe Discord en plafonnant la taille et la durée ; lève si l'un des deux est dépassé. */
export async function downloadFile(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<Uint8Array> {
  const max = opts.maxBytes ?? MAX_FILE_BYTES;
  const res = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new Error("file too large");
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error("file too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
