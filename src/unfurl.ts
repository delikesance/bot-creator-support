import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Aperçu de lien côté serveur (`GET /api/unfurl`), protégé contre le SSRF :
 * http/https seulement, l'hôte est résolu et refusé s'il pointe vers une adresse privée,
 * chaque redirection est revalidée (3 au plus), 3 s de délai total, 512 Ko lus au maximum.
 *
 * Limite connue : `fetch` résout le DNS une seconde fois (rebinding possible entre la vérification
 * et la connexion). On ne peut pas épingler l'IP avec fetch sans casser TLS/SNI ; le risque est
 * réduit car le panel est réservé au staff authentifié et seules des métadonnées HTML sont renvoyées.
 */

export interface Preview {
  url: string;
  title: string;
  description: string;
  site: string;
}

export interface UnfurlDeps {
  fetch: (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  /** Toutes les adresses IP d'un nom d'hôte. */
  resolve: (host: string) => Promise<string[]>;
}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 3000;
const MAX_BYTES = 512 * 1024;

const defaultDeps: UnfurlDeps = {
  fetch: (url, init) => fetch(url, init),
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
};

/** IPv6 en 8 groupes de 16 bits ; null si la forme est invalide. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.split("%")[0]!.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const p = dotted[1]!.split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[1]!.length) + ((p[0]! << 8) | p[1]!).toString(16) + ":" + ((p[2]! << 8) | p[3]!).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b! >= 64 && b! <= 127) || // CGNAT
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224 // multicast, réservé, diffusion
  );
}

/** Adresse (v4 ou v6) loopback, privée, link-local, CGNAT, multicast, ou équivalent IPv6 : à refuser. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip.split(".").map(Number));
  if (kind !== 6) return true; // illisible : par prudence
  const g = ipv6Groups(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // :: , ::1 et ::ffff:a.b.c.d (mappée) ou ::a.b.c.d (compatible)
    return g[5] === 0xffff ? embedded(g[6]!, g[7]!) : true;
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6]!, g[7]!); // NAT64
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
  return (
    (g[0]! & 0xfe00) === 0xfc00 || // unique local
    (g[0]! & 0xffc0) === 0xfe80 || // link-local
    (g[0]! & 0xffc0) === 0xfec0 || // site-local (obsolète)
    (g[0]! & 0xff00) === 0xff00 // multicast
  );
}

/** L'URL est-elle une cible sûre ? Lève si le schéma, les identifiants ou l'adresse résolue sont refusés. */
async function assertPublic(u: URL, deps: UnfurlDeps): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme refused");
  if (u.username || u.password) throw new Error("credentials in the URL refused");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error("missing host");
  const ips = isIP(host) ? [host] : await deps.resolve(host);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error("non-public address");
}

/** Lit au plus MAX_BYTES du corps. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, all.length - at);
    all.set(part, at);
    at += part.length;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

/** Valeur d'une balise <meta> identifiée par property= ou name=. */
function meta(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    const k = attr("property") ?? attr("name");
    if ((k?.[1] ?? k?.[2] ?? k?.[3])?.toLowerCase() !== key) continue;
    const c = attr("content");
    const v = decode(c?.[1] ?? c?.[2] ?? c?.[3] ?? "");
    if (v) return v;
  }
  return "";
}

export function parsePreview(html: string, url: string): Preview | null {
  const head = html.slice(0, MAX_BYTES);
  const title = meta(head, "og:title") || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "");
  const description = meta(head, "og:description") || meta(head, "description");
  if (!title && !description) return null;
  return {
    url,
    title: title.slice(0, 200),
    description: description.slice(0, 300),
    site: (meta(head, "og:site_name") || new URL(url).hostname.replace(/^www\./, "")).slice(0, 80),
  };
}

/** Aperçu d'une URL, ou null (refusée, injoignable, pas du HTML, sans titre). Ne lève jamais. */
export async function unfurl(raw: string, deps: UnfurlDeps = defaultDeps): Promise<Preview | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let u = new URL(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(u, deps);
      const res = await deps.fetch(u.href, {
        redirect: "manual",
        signal,
        headers: { "user-agent": "SupportDeskLinkPreview/1.0", accept: "text/html,application/xhtml+xml" },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!next) return null;
        u = new URL(next, u);
        continue;
      }
      if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return parsePreview(await readCapped(res), u.href);
    }
    return null; // trop de redirections
  } catch {
    return null;
  }
}
