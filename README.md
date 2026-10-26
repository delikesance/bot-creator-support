# Bot Discord de support par tickets

Un bot Discord qui transforme chaque demande en **ticket privé**, et un **panel web** pour y répondre depuis un seul endroit, sur un ou plusieurs serveurs. Bun, TypeScript, SQLite, aucune base externe.

![Liste des tickets](docs/panel.png)

![Conversation en plein écran](docs/ticket.png)

## Comment ça marche

1. Un membre tape `/ticket` ou clique sur le bouton du panneau posté par `/setup`. Une fenêtre lui demande un **titre** et une **description détaillée**.
2. Le bot crée un salon privé (visible par l'utilisateur, le bot et le rôle support) et y poste un court message d'accueil.
3. Le support répond depuis le **panel**. Le message apparaît dans le salon sous le pseudo et l'avatar Discord de la personne qui répond (webhook). Répondre directement dans le salon marche aussi : tout est historisé dans le panel.
4. Le ticket se ferme depuis le panel (ou par `/close`) ; l'utilisateur ne peut plus écrire. Il peut être rouvert, et son salon supprimé une fois fermé.

## Le panel

- **Plusieurs serveurs** : un sélecteur en haut ; chaque ticket est rattaché au serveur où il a été ouvert, avec une limite d'un ticket actif par utilisateur et par serveur. Les pastilles signalent ce qui attend sur les autres serveurs.
- **Qui doit répondre** : « En attente du support » (le client a écrit en dernier) ou « En attente du client » (le support a répondu). Le panel s'ouvre sur ce qui attend le support ; les onglets « En attente du client » et « Tout » sont à côté, les cartes de compteurs filtrent par statut, et la recherche porte sur tous les tickets.
- **Statut automatique** : un ticket est « Ouvert » tant que personne du support n'a répondu, puis passe « En cours » au nom du premier qui répond (panel ou salon Discord). Seuls Fermer, Rouvrir et Supprimer le salon sont manuels.
- **Conversation en plein écran** : cliquer un ticket l'ouvre seul, le curseur dans la zone de réponse. Chaque ticket a son adresse (`#/t/12`) : précédent, rechargement et liens partagés fonctionnent. Échap ou « ← Tickets » revient à la liste. Les brouillons sont conservés par ticket.
- **Temps réel** : messages et changements de statut arrivent en direct (Server-Sent Events), avec un rafraîchissement de secours.
- **Images et liens** : les pièces jointes et les liens s'affichent dans la conversation, avec une visionneuse (clic pour agrandir, flèches, Échap).
- **Connexion Discord (OAuth2)** ou simple mot de passe. Les super-admins voient tous les serveurs du bot ; les autres voient ceux où ils ont « Gérer le serveur ».

![Menu des serveurs](docs/guilds-menu.png)

## Côté utilisateur : 13 langues

Tout ce que voit l'utilisateur sur Discord est dans sa langue (`interaction.locale`) : message d'accueil, fenêtre de création, panneau `/setup`, descriptions des commandes slash, erreurs, confirmations, messages de fermeture et de réouverture. La langue est mémorisée sur le ticket, donc les messages postés depuis le panel la suivent aussi.

Langues : anglais (par défaut), français, espagnol, allemand, portugais, italien, néerlandais, polonais, russe, turc, japonais, coréen, chinois. Les textes sont dans `src/i18n.ts`.

Le support se fait **en anglais** : hors anglais, l'accueil le précise et indique qu'une solution sera trouvée si l'utilisateur n'est pas à l'aise. Le panel admin est en français.

## Démarrage

```bash
bun install
cp .env.example .env     # renseigner DISCORD_TOKEN et TEST_GUILD_ID
bun run start            # bot + panel sur http://localhost:3000
```

Le bot demande l'intent privilégié **Message Content** (portail développeur Discord) pour historiser les messages.

| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | Token du bot (requis) |
| `TEST_GUILD_ID` | Serveur de test : en dev, les commandes ne sont enregistrées **que** là (requis hors production) |
| `NODE_ENV=production` | Commandes enregistrées globalement ; le bot sert tous les serveurs où il est invité |
| `OAUTH_CLIENT_SECRET` | Active la connexion au panel via Discord. Vide = mot de passe |
| `PUBLIC_URL` | Adresse du panel (défaut `http://localhost:PORT`) ; la redirection OAuth2 est `PUBLIC_URL/auth/callback` |
| `ADMIN_IDS` | Super-admins (tous les serveurs), IDs séparés par des virgules (vide = propriétaire de l'application) |
| `PANEL_PASSWORD` | Mode sans OAuth : mot de passe du panel (généré et affiché au démarrage si absent) |
| `SUPPORT_ROLE_ID`, `TICKET_CATEGORY_ID` | Optionnels : rôle staff et catégorie des salons |

### Connexion Discord (OAuth2)

1. Portail développeur Discord, application du bot, onglet **OAuth2** : copier le *Client Secret* dans `OAUTH_CLIENT_SECRET`.
2. Dans *Redirects*, ajouter exactement `PUBLIC_URL/auth/callback` (ex. `http://localhost:3000/auth/callback`).
3. Les réponses sont signées du pseudo Discord de la personne connectée.

## Docker

L'image est construite et publiée à chaque push par GitHub Actions (tests puis build `amd64` + `arm64`) :

```bash
docker pull ghcr.io/delikesance/bot-creator-support:latest
docker run -d --env-file .env -p 3000:3000 -v tickets-data:/data ghcr.io/delikesance/bot-creator-support:latest
```

Ou en local avec Compose (volume `tickets-data` pour la base SQLite) :

```bash
docker compose up -d --build
```

Derrière un reverse proxy, désactiver la mise en mémoire tampon pour `/api/events` (flux temps réel). Ne jamais mettre `.env` dans l'image : il se passe à l'exécution.

## Tests

```bash
bun test                   # tests unitaires et d'intégration (sans réseau)
bun run lint               # tsc --noEmit
bun run scripts/smoke.ts   # test bout en bout sur le vrai serveur de test (nettoie son salon)
bun run scripts/demo.ts    # panel avec données fictives, sans Discord (mot de passe : demo)
```

`bun run scripts/demo.ts oauth` simule la connexion Discord ; c'est ce mode qui sert aux captures de `docs/`.

## Architecture

`src/tickets.ts` (états + SQLite) → `src/desk.ts` (logique métier, interface `Gateway` vers Discord) → `src/bot/` (interactions, webhooks) et `src/web.ts` (API + auth + flux temps réel). `src/i18n.ts` contient les textes traduits, `public/index.html` est le panel (un seul fichier, sans dépendance).
