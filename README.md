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
| `NODE_ENV=production` | Commandes enregistrées globalement ; utiliser `GUILD_ID` pour le serveur des tickets |
| `PANEL_PASSWORD` | Mot de passe du panel (généré et affiché au démarrage si absent) |
| `SUPPORT_ROLE_ID`, `TICKET_CATEGORY_ID` | Optionnels : rôle staff et catégorie des salons |

Le bot demande l'intent privilégié **Message Content** (portail développeur Discord) pour historiser les messages.

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
