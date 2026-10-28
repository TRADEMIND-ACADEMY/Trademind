# TradeMind Academy — Netlify Environment Setup

## Architecture

The product remains unchanged. Netlify serves a generated `netlify-dist/` directory containing:

- `/` — public TradeMind Academy website;
- `/app` — authenticated application shell;
- `/owner` — Owner Control Center shell;
- static assets and manifests.

All `/api/*` routes are handled by `netlify/functions/api.mjs`, which adapts the existing API handler without changing endpoint contracts. Persistent state uses **Netlify Blobs** with three keys: `users`, `sessions` and `audit`.

Netlify Blobs was selected because the current application already persists three JSON aggregates and needs a native Netlify-compatible durable store without exposing database credentials to the browser. For very high write concurrency, a relational database should eventually replace aggregate blobs with transactional tables; this package keeps the existing behavior and contracts intact.

## Deploy

1. Create or select a Netlify site.
2. Connect the repository or upload this package to a deploy-capable repository.
3. Set the build command to `npm run netlify:build`.
4. Set the publish directory to `netlify-dist`.
5. Set the Functions directory to `netlify/functions` (already declared in `netlify.toml`).
6. Use Node 22.
7. Deploy and verify `/`, `/app`, `/owner` and `/api/auth/me`.

The build does **not** use `dist/`. It creates `netlify-dist/` explicitly.

## Environment variables

### Server-only secrets

Configure these in Netlify Site configuration → Environment variables. Do not expose them through frontend code or `netlify-dist`:

```text
SESSION_SECRET=<long random value>
ADMIN_PRIVATE_KEY=<server-only admin readiness secret>
PAYMENT_API_KEY=<provider key only when a real provider is selected>
PAYMENT_WEBHOOK_SECRET=<provider webhook signing secret>
```

### Server configuration

```text
TM_BLOBS_STORE=trademind-data
OWNER_IDS=<comma-separated persisted user IDs, optional>
PUBLIC_ORIGIN=https://your-final-domain.example
NODE_VERSION=22
```

`ADMIN_PRIVATE_KEY`, payment keys and webhook secrets are never returned by the API. No real secret is included in this package.

### Public values

The following may be used by static metadata or deployment configuration, but do not put secrets in them:

```text
PUBLIC_ORIGIN=https://your-final-domain.example
NODE_VERSION=22
```

## Persistent storage and migration

Netlify Blobs stores:

- `users` — users, hashed passwords, TradeMind IDs, roles, plans and subscription fields;
- `sessions` — HttpOnly session records;
- `audit` — Owner/security/activity events.

Before the first production deployment, run the migration utility from an environment with Netlify Blobs credentials and the target site context:

```bash
npm install
npx netlify login
npx netlify link
node scripts/migrate-to-blobs.mjs
```

The migration reads local `data/users.json`, `data/sessions.json` and `data/audit.json` and writes only those three JSON values to the configured Blobs store. Test data should be reviewed before migration. Never commit the files containing production state.

The Function hydrates the current Blobs values into ephemeral `/tmp` files for the existing synchronous business logic, then persists the updated values at the end of the invocation. The local JSON files are not used as production storage.

## OWNER setup

1. Register the account through `/app`.
2. Obtain the server-generated TradeMind ID from the authenticated account response or User Center.
3. Mark the persisted user role as `OWNER` through a controlled migration/admin procedure, or include the user ID in the server-only `OWNER_IDS` variable.
4. Redeploy/retry the Function.
5. Open `/owner` and verify Overview, Users, Activity, Sessions, Membership, Payments and Health.

Never grant Owner access using frontend JavaScript, localStorage, an email comparison or a URL parameter.

## Authentication test

```bash
curl -i https://your-final-domain.example/api/auth/me
```

Then test through `/app`:

- register;
- login;
- refresh and confirm `/api/auth/me` remains authenticated;
- logout;
- confirm `/api/auth/me` returns unauthenticated.

The existing API routes remain:

```text
/api/auth/register
/api/auth/login
/api/auth/me
/api/auth/logout
/api/account/membership
/api/account/profile
/api/account/security
/api/account/password
/api/account/plan
/api/admin/status
/api/billing/catalog
/api/billing/checkout
/api/billing/webhook
```

## Owner and billing test

- USER → `/api/owner/overview` must return `403`.
- USER → `/api/account/plan` must return `403`.
- OWNER → Owner endpoints must return `200`.
- `/api/billing/catalog` must list the approved plans and payment methods.
- `/api/billing/checkout` must return `PAYMENT_PROVIDER_NOT_CONFIGURED` while no provider is configured.
- No frontend action may simulate a paid subscription.

Payment methods remain ready for Airtel Money RDC, USDT Ethereum/ERC-20, USDT BNB Smart Chain/BEP-20 and BTC Bitcoin, but no automatic activation occurs until a real provider, server-side verification and signed webhooks are configured.

## DAN AI (OpenAI)
- `OPENAI_API_KEY` : clé API OpenAI (secrète, Netlify → Environment variables, portée Functions). Sans elle, DAN répond « non activé ».
- `DAN_MODEL` (optionnel) : modèle OpenAI, défaut `gpt-4o-mini`.
Après ajout : redéployer (Deploys → Trigger deploy), puis Owner → État du système → `danAI` doit afficher CONFIGURED.

## DAN AI avec Gemini (palier gratuit)
- `GEMINI_API_KEY` : clé créée dans Google AI Studio (aistudio.google.com → Get API key). Secrète : à saisir uniquement dans Netlify.
- `DAN_PROVIDER` (optionnel) : `gemini` ou `openai`. `DAN_MODEL` (optionnel) : nom exact du modèle.

## Paiement crypto automatique (NOWPayments)
- `NOWPAYMENTS_API_KEY` : clé API (secrète). `NOWPAYMENTS_IPN_SECRET` : secret IPN (secret). Les deux sont obligatoires, sinon la méthode reste cachée.
- `NOWPAYMENTS_SANDBOX=1` : utilise le compte de TEST (api-sandbox.nowpayments.io) avec ses propres clés. Retirer cette variable en production réelle.
- Adresse de notification à ne pas configurer chez NOWPayments à la main : elle est envoyée automatiquement à chaque facture (`<URL du site>/api/billing/nowpayments/ipn`).

---

# Mise à jour ULTIMATE MASTER RELEASE (noms de variables uniquement — jamais de valeurs ici)

## Clés de stockage (Netlify Blobs)
`users, sessions, audit, orders, notifications, config, limits, resets, ledger`
(`limits`, `resets`, `ledger` sont nouvelles : limitation de débit persistante, jetons de récupération, registre mensuel des trades).

## Variables d'environnement (serveur uniquement, à définir dans Netlify)

| Nom | Rôle | État par défaut |
|---|---|---|
| `GEMINI_API_KEY` | DAN AI (Gemini) | NOT CONFIGURED — REQUIRES USER ACTION |
| `DAN_MODEL` | modèle DAN (défaut `gemini-3.5-flash-lite`) | optionnel |
| `DAN_PROVIDER`, `OPENAI_API_KEY` | alternative OpenAI | optionnel |
| `DAN_GLOBAL_DAILY_MAX` | plafond global de requêtes DAN/jour (défaut 3000) | optionnel |
| `NOWPAYMENTS_API_KEY` | paiement crypto automatique | NOT CONFIGURED — REQUIRES USER ACTION |
| `NOWPAYMENTS_IPN_SECRET` | signature du webhook NOWPayments | NOT CONFIGURED — REQUIRES USER ACTION |
| `NOWPAYMENTS_SANDBOX` | `1` pour le bac à sable | optionnel |
| `PAYMENT_WEBHOOK_SECRET` | webhook générique HMAC-SHA256 | optionnel |
| `OWNER_SETUP_TOKEN` | initialisation unique de l'Owner et récupération Owner | requis pour initialiser |
| `EMAIL_PROVIDER_KEY`, `EMAIL_FROM`, `EMAIL_API_URL` | envoi réel d'e-mails (récupération, notifications) | NOT CONFIGURED — REQUIRES USER ACTION |
| `OWNER_NOTIFY_EMAIL` | destinataire des notifications Owner | optionnel |
| `PUBLIC_BASE_URL` | URL publique (liens de récupération, contrôle d'origine CSRF) | recommandé |
| `TM_BLOBS_STORE` | nom du store Blobs | optionnel |
| `TM_COOKIE_SECURE` | force le flag Secure | optionnel (auto en production) |
| `TM_TRUST_XFF` | **tests locaux uniquement** — ne jamais l'activer en production | — |

## Sans fournisseur d'e-mail
Aucun e-mail n'est simulé. « Mot de passe oublié » passe en mode **ADMIN_ASSISTED** : l'Owner génère un lien à usage unique (30 min) depuis l'onglet Users et le transmet lui-même. Récupération de l'Owner : `POST /api/owner/recover` avec `OWNER_SETUP_TOKEN`.

## Notes de migration
- Les sessions sont désormais stockées sous une clé hachée : **les utilisateurs déjà connectés devront se reconnecter une fois** après le déploiement.
- Les mots de passe anciens sont vérifiés puis migrés automatiquement vers scrypt à la connexion suivante.

## Recommandation
`@netlify/blobs` est figé à 8.2.0 (non modifié : npm indisponible ici, donc non testable). L'unicité atomique d'e-mail/Owner utilise `onlyIfNew` si la version le supporte ; sinon repli sur un marqueur local + dédoublonnage (non atomique entre instances). **Recommandé : mettre à jour `@netlify/blobs` puis tester sur le site réel** (NOT TESTED).

## Vérifier quelle version est en ligne
`/build-info.json` donne `sourceSha256` ; comparer avec `node scripts/source-hash.mjs` sur le dépôt.

---

# Mise à jour UNIFICATION WEB + MOBILE (synchronisation)

## Nouveautés serveur
- **Store `journal`** (Netlify Blobs, clé `journal`) : trades, plans et réglages synchronisés de tous les comptes. Chargé uniquement pour les routes `/api/sync/*` et `/api/account/delete`. Limite connue : un seul JSON pour tous les utilisateurs (à découper par compte si la base grossit beaucoup).
- **Routes** : `POST /api/sync/push`, `GET /api/sync/state?since=…`. Le mode démo est refusé (409). Les quotas du plan passent par le registre partagé (`ledger`).
- **Authentification mobile** : jeton Bearer (= session serveur) émis seulement pour l'en-tête `x-tm-client: mobile` + origine autorisée (`https://localhost`, `capacitor://localhost`, + `MOBILE_ALLOWED_ORIGINS`). OWNER impossible sur mobile.
- **Fichier ajouté** `pw-eye.js` (bouton afficher/masquer le mot de passe), copié par `npm run netlify:build`.

## Variables à définir
Voir `.env.example` (noms uniquement). Obligatoire pour le compte OWNER : `OWNER_SETUP_TOKEN`. Recommandé : `PUBLIC_BASE_URL`.
