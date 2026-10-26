import { describe, expect, test } from "bun:test";
import { isPrivateIp, parsePreview, unfurl, type UnfurlDeps } from "../src/unfurl";

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

/** Dépendances hors ligne : `pages` par URL, `dns` par hôte (public par défaut). */
function fake(pages: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const calls: string[] = [];
  const deps: UnfurlDeps = {
    fetch: async (url) => {
      calls.push(url);
      const page = pages[url];
      if (!page) throw new Error("réseau coupé");
      return page();
    },
    resolve: async (host) => dns[host] ?? ["93.184.216.34"],
  };
  return { deps, calls };
}

describe("adresses privées", () => {
  test.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.254", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1",
  ])("%s est refusée", (ip) => expect(isPrivateIp(ip)).toBe(true));

  test.each(["93.184.216.34", "8.8.8.8", "100.63.0.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "%s est publique",
    (ip) => expect(isPrivateIp(ip)).toBe(false),
  );
});

describe("aperçu", () => {
  test("lit og:title, og:description et le site", async () => {
    const { deps } = fake({
      "https://exemple.fr/a": () =>
        html(`<head><title>Titre brut</title><meta property="og:title" content="Un &amp; deux"><meta property='og:description' content='Résumé'><meta property="og:site_name" content="Exemple"></head>`),
    });
    expect(await unfurl("https://exemple.fr/a", deps)).toEqual({ url: "https://exemple.fr/a", title: "Un & deux", description: "Résumé", site: "Exemple" });
  });
  test("repli sur <title>, meta description et le nom d'hôte", () => {
    expect(parsePreview(`<title> Page\n d'accueil </title><meta name="description" content="Salut">`, "https://www.exemple.fr/")).toEqual({
      url: "https://www.exemple.fr/", title: "Page d'accueil", description: "Salut", site: "exemple.fr",
    });
  });
  test("page sans titre ni description : null", () => {
    expect(parsePreview("<html><body>rien</body></html>", "https://x.fr/")).toBeNull();
  });
  test("contenu non HTML : null", async () => {
    const { deps } = fake({ "https://x.fr/f": () => new Response("{}", { headers: { "content-type": "application/json" } }) });
    expect(await unfurl("https://x.fr/f", deps)).toBeNull();
  });
  test("corps limité à 512 Ko : un titre au-delà est ignoré", async () => {
    const { deps } = fake({ "https://x.fr/g": () => html(" ".repeat(600 * 1024) + "<title>Trop tard</title>") });
    expect(await unfurl("https://x.fr/g", deps)).toBeNull();
  });
});

describe("SSRF", () => {
  test("schémas autres que http/https refusés", async () => {
    const { deps, calls } = fake({});
    for (const u of ["file:///etc/passwd", "ftp://x.fr/", "gopher://x.fr/", "javascript:alert(1)", "pas une url"]) {
      expect(await unfurl(u, deps)).toBeNull();
    }
    expect(calls).toEqual([]);
  });
  test("IP littérales privées refusées sans requête", async () => {
    const { deps, calls } = fake({});
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://2130706433/", "http://[::ffff:7f00:1]/", "http://0x7f.1/"]) {
      expect(await unfurl(u, deps)).toBeNull();
    }
    expect(calls).toEqual([]);
  });
  test("nom d'hôte qui se résout vers une adresse privée refusé", async () => {
    const { deps, calls } = fake({}, { "interne.exemple.fr": ["10.0.0.5"], "mixte.fr": ["93.184.216.34", "127.0.0.1"] });
    expect(await unfurl("https://interne.exemple.fr/", deps)).toBeNull();
    expect(await unfurl("https://mixte.fr/", deps)).toBeNull();
    expect(calls).toEqual([]);
  });
  test("identifiants dans l'URL refusés", async () => {
    const { deps, calls } = fake({});
    expect(await unfurl("https://user:pw@x.fr/", deps)).toBeNull();
    expect(calls).toEqual([]);
  });
  test("redirection suivie si publique", async () => {
    const { deps, calls } = fake({
      "https://a.fr/": () => new Response(null, { status: 302, headers: { location: "/b" } }),
      "https://a.fr/b": () => html("<title>Fin</title>"),
    });
    expect((await unfurl("https://a.fr/", deps))?.title).toBe("Fin");
    expect(calls).toEqual(["https://a.fr/", "https://a.fr/b"]);
  });
  test("redirection vers un hôte privé refusée (revalidation à chaque saut)", async () => {
    const { deps, calls } = fake(
      { "https://a.fr/": () => new Response(null, { status: 301, headers: { location: "http://metadata.interne/" } }) },
      { "metadata.interne": ["169.254.169.254"] },
    );
    expect(await unfurl("https://a.fr/", deps)).toBeNull();
    expect(calls).toEqual(["https://a.fr/"]);
  });
  test("redirection vers une IP littérale ou un autre schéma refusée", async () => {
    for (const to of ["http://127.0.0.1:8080/admin", "file:///etc/passwd"]) {
      const { deps, calls } = fake({ "https://a.fr/": () => new Response(null, { status: 307, headers: { location: to } }) });
      expect(await unfurl("https://a.fr/", deps)).toBeNull();
      expect(calls).toEqual(["https://a.fr/"]);
    }
  });
  test("3 redirections au maximum", async () => {
    const hop = (n: number) => () => new Response(null, { status: 302, headers: { location: `https://a.fr/${n + 1}` } });
    const pages: Record<string, () => Response> = { "https://a.fr/": hop(0), "https://a.fr/1": hop(1), "https://a.fr/2": hop(2), "https://a.fr/3": () => html("<title>ok</title>"), "https://a.fr/4": () => html("<title>ok</title>") };
    const { deps, calls } = fake(pages);
    expect((await unfurl("https://a.fr/", deps))?.title).toBe("ok"); // 3 redirections : accepté
    expect(calls).toHaveLength(4);
    const long = fake({ ...pages, "https://a.fr/3": hop(3) });
    expect(await unfurl("https://a.fr/", long.deps)).toBeNull(); // la 4e est refusée
    expect(long.calls).toHaveLength(4);
  });
  test("délai de 3 s : la requête est interrompue", async () => {
    const deps: UnfurlDeps = {
      resolve: async () => ["93.184.216.34"],
      fetch: (_u, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("abort")))),
    };
    const t = Date.now();
    expect(await unfurl("https://lent.fr/", deps)).toBeNull();
    expect(Date.now() - t).toBeLessThan(4500);
  }, 6000);
});
