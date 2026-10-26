# Bot Discord de support par tickets (Bun)

Les utilisateurs ouvrent un ticket depuis Discord (`/ticket` ou bouton du panneau `/setup`) : le bot crée un salon privé.
L'administrateur gère tout depuis le **panel web** (statuts 🟢 Ouvert / 🟡 En cours / 🔴 Fermé, réponses postées par le bot dans le salon, prise en charge, fermeture, réouverture, suppression du salon).

![Panel](docs/panel.png)

## Démarrage

```bash
bun install
cp .env.example .env     # renseigner DISCORD_TOKEN et TEST_GUILD_ID
bun run start            # bot + panel sur http://localhost:3000
```

| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | Token du bot (requis) |
| `TEST_GUILD_ID` | Serveur de test : en dev, les commandes ne sont enregistrées **que** là (requis hors production) |
| `NODE_ENV=production` | Commandes enregistrées globalement ; le bot peut servir plusieurs serveurs, chaque ticket est créé sur le serveur où il est ouvert |
| `OAUTH_CLIENT_SECRET` | Active la connexion au panel via Discord (OAuth2). Vide = mot de passe |
| `PUBLIC_URL` | Adresse du panel (défaut `http://localhost:PORT`) ; la redirection OAuth2 est `PUBLIC_URL/auth/callback` |
| `ADMIN_IDS` | Super-admins (tous les serveurs), IDs séparés par des virgules (vide = propriétaire de l'application) |
| `PANEL_PASSWORD` | Mode sans OAuth : mot de passe du panel (généré et affiché au démarrage si absent) |
| `SUPPORT_ROLE_ID`, `TICKET_CATEGORY_ID` | Optionnels : rôle staff et catégorie des salons |

Le bot demande l'intent privilégié **Message Content** (portail développeur Discord) pour historiser les messages.

## Connexion Discord (OAuth2)

1. Portail développeur Discord, application du bot, onglet **OAuth2** : copier le *Client Secret* dans `OAUTH_CLIENT_SECRET`.
2. Dans *Redirects*, ajouter exactement `PUBLIC_URL/auth/callback` (ex. `http://localhost:3000/auth/callback`).
3. Les super-admins (`ADMIN_IDS` ou propriétaire de l'application) voient tous les serveurs du bot ; les autres voient uniquement ceux où ils ont « Gérer le serveur » (sélecteur en haut du panel) ; leurs réponses sont signées de leur pseudo Discord.

## Docker

```bash
docker compose up -d --build   # volume `tickets-data` pour la base SQLite
```

## Tests (TDD)

```bash
bun test          # tests unitaires et d'intégration (sans réseau)
bun run lint      # tsc --noEmit
bun run scripts/smoke.ts   # test bout en bout sur le vrai serveur de test (nettoie son salon)
bun run scripts/demo.ts    # panel avec données fictives, sans Discord
```

## Architecture

`src/tickets.ts` (états + SQLite) → `src/desk.ts` (logique métier, interface `Gateway` vers Discord) → `src/bot/` (interactions) et `src/web.ts` (API + auth) ; `public/index.html` est le panel.
