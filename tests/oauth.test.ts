import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TicketService } from "../src/tickets";
import { SupportDesk, type Gateway } from "../src/desk";
import { createHandler } from "../src/web";
import { DiscordOAuth, type OAuthProvider } from "../src/oauth";

const sent: string[] = [];
const sentOpts: unknown[] = [];
const gw: Gateway = {
  createTicketChannel: async () => "chan1",
  send: async (_c, t, o) => void (sent.push(t), sentOpts.push(o)),
  setUserLocked: async () => {},
  deleteChannel: async () => {},
};
const cfg = { panelPassword: "pw", sessionSecret: "s".repeat(32) };

const users: Record<string, { id: string; username: string; avatarUrl?: string; guilds: { id: string; permissions: string }[] }> = {
  good: { id: "100", username: "Angelo", avatarUrl: "https://cdn.test/angelo.png", guilds: [] },
  bad: { id: "999", username: "intrus", guilds: [] },
};
const provider: OAuthProvider = {
  authorizeUrl: (state) => `https://discord.com/oauth2/authorize?state=${state}`,
  exchange: async (code) => {
    if (!users[code]) throw new Error("bad code");
    return users[code]!;
  },
  isAdmin: (id) => id === "100",
};

let handle: (r: Request) => Promise<Response>;
let desk: SupportDesk;
beforeEach(() => {
  sent.length = 0;
  sentOpts.length = 0;
  desk = new SupportDesk(new TicketService(openDb(":memory:")), gw);
  handle = createHandler(desk, cfg, provider, { list: () => [{ id: "g1", name: "Test", icon: null }] });
});

const cookieOf = (r: Response, name: string) =>
  r.headers.getSetCookie().find((c) => c.startsWith(name + "="))?.split(";")[0];

async function startLogin() {
  const r = await handle(new Request("http://x/auth/login"));
  const state = new URL(r.headers.get("location")!).searchParams.get("state")!;
  return { r, state, cookie: cookieOf(r, "oauth_state")! };
}

async function loginAs(code: string) {
  const { state, cookie } = await startLogin();
  return handle(new Request(`http://x/auth/callback?code=${code}&state=${state}`, { headers: { cookie } }));
}

describe("flux OAuth2", () => {
  test("/auth/login redirige vers Discord avec un state et un cookie", async () => {
    const { r, state, cookie } = await startLogin();
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toStartWith("https://discord.com/oauth2/authorize");
    expect(state.length).toBeGreaterThanOrEqual(16);
    expect(cookie).toBeTruthy();
    expect(r.headers.getSetCookie().join()).toContain("HttpOnly");
  });

  test("admin autorisé : session créée, redirection vers le panel", async () => {
    const r = await loginAs("good");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    expect(cookieOf(r, "session")).toBeTruthy();
  });

  test("utilisateur non admin : 403 et aucune session", async () => {
    const r = await loginAs("bad");
    expect(r.status).toBe(403);
    expect(cookieOf(r, "session")).toBeUndefined();
  });

  test("state incorrect : refusé (CSRF)", async () => {
    const { cookie } = await startLogin();
    const r = await handle(new Request("http://x/auth/callback?code=good&state=forged", { headers: { cookie } }));
    expect(r.status).toBe(400);
    expect(cookieOf(r, "session")).toBeUndefined();
  });

  test("callback sans cookie de state : refusé", async () => {
    const { state } = await startLogin();
    const r = await handle(new Request(`http://x/auth/callback?code=good&state=${state}`));
    expect(r.status).toBe(400);
  });

  test("code rejeté par Discord : 400", async () => {
    const r = await loginAs("nope");
    expect(r.status).toBe(400);
  });

  test("refus de l'utilisateur sur Discord (error=access_denied)", async () => {
    const { state, cookie } = await startLogin();
    const r = await handle(new Request(`http://x/auth/callback?error=access_denied&state=${state}`, { headers: { cookie } }));
    expect(r.status).toBe(400);
  });
});

describe("avec OAuth actif", () => {
  async function session() {
    const r = await loginAs("good");
    return cookieOf(r, "session")!;
  }

  test("le login par mot de passe est désactivé", async () => {
    const r = await handle(new Request("http://x/api/login", { method: "POST", body: JSON.stringify({ password: "pw" }) }));
    expect(r.status).toBe(404);
  });

  test("/api/config indique le mode, sans authentification", async () => {
    const r = await handle(new Request("http://x/api/config"));
    expect(await r.json()).toEqual({ oauth: true });
  });

  test("/api/me renvoie l'admin connecté", async () => {
    const c = await session();
    const r = await handle(new Request("http://x/api/me", { headers: { cookie: c } }));
    expect((await r.json()).name).toBe("Angelo");
  });

  test("la réponse part sans nom sur Discord mais l'historique garde l'admin", async () => {
    const c = await session();
    const t = await desk.open({ userId: "u", guildId: "g1", userName: "alice", subject: "a" });
    await handle(new Request(`http://x/api/tickets/${t.id}/reply`, { method: "POST", headers: { cookie: c }, body: JSON.stringify({ content: "Salut" }) }));
    expect(sent.at(-1)).toBe("Salut");
    expect(desk.tickets.messages(t.id).at(-1)).toMatchObject({ authorName: "Angelo", source: "panel" });
  });

  test("la réponse est postée sous le pseudo et l'avatar Discord de l'admin", async () => {
    const c = await session();
    const t = await desk.open({ userId: "u", guildId: "g1", userName: "alice", subject: "a" });
    await handle(new Request(`http://x/api/tickets/${t.id}/reply`, { method: "POST", headers: { cookie: c }, body: JSON.stringify({ content: "Salut" }) }));
    expect(sentOpts.at(-1)).toEqual({ as: { name: "Angelo", avatarUrl: "https://cdn.test/angelo.png" } });
    const me = await (await handle(new Request("http://x/api/me", { headers: { cookie: c } }))).json();
    expect(me.avatarUrl).toBe("https://cdn.test/angelo.png");
  });

  test("la prise en charge est attribuée à l'admin", async () => {
    const c = await session();
    const t = await desk.open({ userId: "u", guildId: "g1", userName: "alice", subject: "a" });
    await handle(new Request(`http://x/api/tickets/${t.id}/claim`, { method: "POST", headers: { cookie: c } }));
    expect(desk.tickets.get(t.id)!.assignee).toBe("Angelo");
  });

  test("API protégée sans session", async () => {
    expect((await handle(new Request("http://x/api/tickets"))).status).toBe(401);
  });
});

describe("sans OAuth (mot de passe)", () => {
  test("/api/config : oauth false et /auth/login indisponible", async () => {
    const h = createHandler(desk, cfg);
    expect(await (await h(new Request("http://x/api/config"))).json()).toEqual({ oauth: false });
    expect((await h(new Request("http://x/auth/login"))).status).toBe(404);
  });
});

describe("DiscordOAuth (client HTTP)", () => {
  const make = (fetchImpl: typeof fetch) =>
    new DiscordOAuth(
      { clientId: "app", clientSecret: "sec", redirectUri: "http://localhost:3000/auth/callback", adminIds: ["100"] },
      fetchImpl,
    );

  test("construit l'URL d'autorisation (scope identify, redirect, state)", () => {
    const u = new URL(make(fetch).authorizeUrl("abc"));
    expect(u.origin + u.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(u.searchParams.get("client_id")).toBe("app");
    expect(u.searchParams.get("scope")).toBe("identify guilds");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
    expect(u.searchParams.get("state")).toBe("abc");
  });

  test("échange le code puis lit l'utilisateur", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.endsWith("/oauth2/token")
        ? Response.json({ access_token: "tok" })
        : url.includes("/users/@me/guilds")
          ? Response.json([{ id: "g1", name: "Un serveur", permissions: "32" }])
          : Response.json({ id: "100", username: "Angelo", global_name: "Angelo C" });
    }) as unknown as typeof fetch;
    const user = await make(fake).exchange("thecode");
    expect(user).toEqual({
      id: "100",
      username: "Angelo C",
      avatarUrl: `https://cdn.discordapp.com/embed/avatars/${(100n >> 22n) % 6n}.png`,
      guilds: [{ id: "g1", permissions: "32" }],
    });
    const body = String(calls[0]!.init!.body);
    expect(body).toContain("code=thecode");
    expect(body).toContain("grant_type=authorization_code");
    expect(calls[1]!.url).toContain("/users/@me");
    expect(calls[2]!.url).toContain("/users/@me/guilds");
    expect((calls[1]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  test("avatar personnalisé : URL du CDN Discord", async () => {
    const fake = (async (url: string) =>
      url.endsWith("/oauth2/token")
        ? Response.json({ access_token: "tok" })
        : url.includes("/guilds")
          ? Response.json([])
          : Response.json({ id: "100", username: "Angelo", avatar: "abc123" })) as unknown as typeof fetch;
    const user = await make(fake).exchange("c");
    expect(user.avatarUrl).toBe("https://cdn.discordapp.com/avatars/100/abc123.png?size=128");
  });

  test("erreur Discord : exception", async () => {
    const fake = (async () => new Response("no", { status: 400 })) as unknown as typeof fetch;
    await expect(make(fake).exchange("x")).rejects.toThrow();
  });

  test("isAdmin d'après la liste", () => {
    const o = make(fetch);
    expect(o.isAdmin("100")).toBe(true);
    expect(o.isAdmin("5")).toBe(false);
  });
});
