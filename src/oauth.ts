export interface OAuthGuild {
  id: string;
  /** Bits de permission Discord (chaîne, comme renvoyée par l'API). */
  permissions: string;
}

export interface OAuthUser {
  id: string;
  username: string;
  guilds: OAuthGuild[];
}

/** Ce dont le panel a besoin d'un fournisseur OAuth2 ; remplaçable dans les tests. */
export interface OAuthProvider {
  authorizeUrl(state: string): string;
  exchange(code: string): Promise<OAuthUser>;
  isAdmin(userId: string): boolean;
}

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminIds: string[];
}

const API = "https://discord.com/api/v10";

export class DiscordOAuth implements OAuthProvider {
  private admins: Set<string>;

  constructor(
    private cfg: DiscordOAuthConfig,
    private http: typeof fetch = fetch,
  ) {
    this.admins = new Set(cfg.adminIds);
  }

  authorizeUrl(state: string): string {
    const u = new URL("https://discord.com/oauth2/authorize");
    u.searchParams.set("client_id", this.cfg.clientId);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "identify guilds");
    u.searchParams.set("redirect_uri", this.cfg.redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("prompt", "none");
    return u.toString();
  }

  async exchange(code: string): Promise<OAuthUser> {
    const tokenRes = await this.http(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: this.cfg.redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Discord a refusé le code (${tokenRes.status})`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const userRes = await this.http(`${API}/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
    if (!userRes.ok) throw new Error(`Lecture du profil impossible (${userRes.status})`);
    const u = (await userRes.json()) as { id: string; username: string; global_name?: string | null };

    const guildsRes = await this.http(`${API}/users/@me/guilds`, { headers: { authorization: `Bearer ${access_token}` } });
    if (!guildsRes.ok) throw new Error(`Lecture des serveurs impossible (${guildsRes.status})`);
    const guilds = ((await guildsRes.json()) as { id: string; permissions: string }[]).map((g) => ({
      id: g.id,
      permissions: String(g.permissions),
    }));
    return { id: u.id, username: u.global_name || u.username, guilds };
  }

  /** Super-admin : accède à tous les serveurs où le bot est présent. */
  isAdmin(userId: string): boolean {
    return this.admins.has(userId);
  }
}

/** Propriétaire (ou membres de l'équipe) de l'application Discord : admins par défaut. */
export async function fetchApplicationOwners(token: string, http: typeof fetch = fetch): Promise<string[]> {
  const res = await http(`${API}/oauth2/applications/@me`, { headers: { authorization: `Bot ${token}` } });
  if (!res.ok) return [];
  const app = (await res.json()) as { owner?: { id: string }; team?: { members?: { user: { id: string } }[] } | null };
  return [app.owner?.id, ...(app.team?.members?.map((m) => m.user.id) ?? [])].filter((x): x is string => !!x);
}
