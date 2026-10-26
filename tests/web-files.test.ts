import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway, type OutFile } from "../src/desk";
import { createHandler } from "../src/web";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sent: { text: string; files?: OutFile[] }[] = [];
const gw: Gateway = {
  createTicketChannel: async () => `chan${sent.length + 1}`,
  send: async (_c, text, o) => void sent.push({ text, files: o?.files }),
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};

const cfg = { panelPassword: "pw", sessionSecret: "s".repeat(32) };
let handle: (r: Request) => Promise<Response>;
let desk: SupportDesk;
let guilds: { id: string; name: string; icon: null }[];
let unfurled: string[];

async function cookie() {
  const l = await handle(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }), headers: { "content-type": "application/json" } }));
  return l.headers.get("set-cookie")!.split(";")[0]!;
}
async function call(path: string, init: RequestInit = {}) {
  return handle(new Request("http://x" + path, { ...init, headers: { cookie: await cookie(), ...(init.headers ?? {}) } }));
}
function multipart(content: string | null, files: { name: string; data: Uint8Array }[]) {
  const f = new FormData();
  if (content !== null) f.set("content", content);
  for (const x of files) f.append("files", new File([x.data as BlobPart], x.name));
  return { method: "POST", body: f };
}

beforeEach(() => {
  sent.length = 0;
  unfurled = [];
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  dirs.push(dir);
  guilds = [{ id: "g1", name: "Test", icon: null }];
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw, { attachmentsDir: dir });
  handle = createHandler(desk, cfg, undefined, { list: () => guilds }, {
    unfurl: async (u) => (unfurled.push(u), u.includes("ok") ? { url: u, title: "T", description: "D", site: "S" } : null),
  });
});

const open = () => desk.open({ guildId: "g1", userId: "u1", userName: "alice", subject: "Bug" });

describe("reply multipart", () => {
  test("texte et fichier : message retourné avec sa pièce jointe, fichier posté sur Discord", async () => {
    const t = await open();
    const r = await call(`/api/tickets/${t.id}/reply`, multipart("voici", [{ name: "capture.png", data: png }]));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; message: { content: string; attachments: { name: string; url: string; kind: string }[] } };
    expect(body.ok).toBe(true);
    expect(body.message.content).toBe("voici");
    expect(body.message.attachments[0]).toMatchObject({ name: "capture.png", kind: "image" });
    expect(sent.at(-1)!.files).toHaveLength(1);
  });
  test("fichier seul accepté", async () => {
    const t = await open();
    expect((await call(`/api/tickets/${t.id}/reply`, multipart("", [{ name: "a.png", data: png }]))).status).toBe(200);
  });
  test("ni texte ni fichier : 400", async () => {
    const t = await open();
    expect((await call(`/api/tickets/${t.id}/reply`, multipart("", []))).status).toBe(400);
  });
  test("JSON toujours accepté", async () => {
    const t = await open();
    const r = await call(`/api/tickets/${t.id}/reply`, { method: "POST", body: JSON.stringify({ content: "salut" }), headers: { "content-type": "application/json" } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { message: { content: string } }).message.content).toBe("salut");
  });
  test("type refusé : 400 qui nomme le fichier", async () => {
    const t = await open();
    const r = await call(`/api/tickets/${t.id}/reply`, multipart("x", [{ name: "virus.exe", data: png }]));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain("virus.exe");
  });
  test("fichier de plus de 25 Mo : 413 qui nomme le fichier", async () => {
    const t = await open();
    const r = await call(`/api/tickets/${t.id}/reply`, multipart("x", [{ name: "gros.zip", data: new Uint8Array(25 * 1024 * 1024 + 1) }]));
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toContain("gros.zip");
  });
  test("plus de 10 fichiers : 413", async () => {
    const t = await open();
    const files = Array.from({ length: 11 }, (_, i) => ({ name: `${i}.png`, data: png }));
    expect((await call(`/api/tickets/${t.id}/reply`, multipart("x", files))).status).toBe(413);
  });
  test("corps annoncé au-delà de 41 Mo : 413 sans lecture", async () => {
    const t = await open();
    const r = await call(`/api/tickets/${t.id}/reply`, {
      method: "POST",
      body: "x",
      headers: { "content-type": "multipart/form-data; boundary=b", "content-length": String(50 * 1024 * 1024) },
    });
    expect(r.status).toBe(413);
  });
  test("ticket d'un autre serveur : 404", async () => {
    const t = await open();
    guilds = [];
    expect((await call(`/api/tickets/${t.id}/reply`, multipart("x", []))).status).toBe(404);
  });
});

describe("GET /api/attachments/:id", () => {
  async function withFiles() {
    const t = await open();
    const r = await call(`/api/tickets/${t.id}/reply`, multipart("x", [
      { name: "capture.png", data: png },
      { name: "notes é.txt", data: new TextEncoder().encode("bonjour") },
    ]));
    const m = ((await r.json()) as { message: { attachments: { id: number; url: string }[] } }).message;
    return { t, img: m.attachments[0]!, txt: m.attachments[1]! };
  }

  test("image : inline, nosniff, cache privé, contenu intact", async () => {
    const { img } = await withFiles();
    const r = await call(img.url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-disposition")).toStartWith("inline");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
  });
  test("autre fichier : attachment, nom accentué encodé", async () => {
    const { txt } = await withFiles();
    const r = await call(txt.url);
    expect(r.headers.get("content-disposition")).toStartWith("attachment");
    expect(r.headers.get("content-disposition")).toContain("filename*=UTF-8''notes%20%C3%A9.txt");
    expect(await r.text()).toBe("bonjour");
  });
  test("sans session : 401", async () => {
    const { img } = await withFiles();
    expect((await handle(new Request("http://x" + img.url))).status).toBe(401);
  });
  test("serveur non autorisé ou pièce inconnue : 404", async () => {
    const { img } = await withFiles();
    expect((await call("/api/attachments/9999")).status).toBe(404);
    guilds = [];
    expect((await call(img.url)).status).toBe(404);
  });
});

describe("GET /api/unfurl", () => {
  test("aperçu, 404 sinon, 400 sans lien, 401 sans session", async () => {
    const r = await call("/api/unfurl?url=" + encodeURIComponent("https://ok.fr/"));
    expect(await r.json()).toEqual({ url: "https://ok.fr/", title: "T", description: "D", site: "S" });
    expect((await call("/api/unfurl?url=" + encodeURIComponent("https://non.fr/"))).status).toBe(404);
    expect((await call("/api/unfurl")).status).toBe(400);
    expect((await handle(new Request("http://x/api/unfurl?url=https://ok.fr/"))).status).toBe(401);
  });
});

describe("fichiers statiques de public/", () => {
  test("/ et /index.html servent la page", async () => {
    for (const p of ["/", "/index.html"]) {
      const r = await handle(new Request("http://x" + p));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
    }
  });
  test("les fichiers de public/ sont servis avec leur type", async () => {
    const r = await handle(new Request("http://x/app.css"));
    if (r.status === 200) expect(r.headers.get("content-type")).toContain("text/css");
    expect((await handle(new Request("http://x/inconnu.js"))).status).toBe(404);
  });
  test("extensions hors liste et traversées refusées", async () => {
    for (const p of [
      "/package.json", "/src/db.ts", "/..%2Fsrc%2Fdb.ts", "/%2e%2e/package.json", "/..%5Csrc%5Cdb.ts",
      "/%2e%2e%2f%2e%2e%2f.env", "/%00.html", "//index.html", "/%E0%A4%A.js",
    ]) {
      const r = await handle(new Request("http://x" + p));
      expect([p, r.status]).toEqual([p, 404]);
    }
  });
});
