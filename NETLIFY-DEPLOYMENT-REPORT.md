# TradeMind Academy — Netlify Deployment Report

**Target:** Netlify-ready production adaptation
**Validation date:** 2026-09-29
**Product status:** Existing UI and product behavior preserved
**Adaptation scope:** Functions, persistent storage adapter, build output, redirects and deployment documentation only

## Architecture selected

- Static frontend output: `netlify-dist/`.
- Netlify Function: `netlify/functions/api.mjs`.
- Existing Node API handler reused through a request/response adapter.
- Persistent production storage: Netlify Blobs store `trademind-data`, keys `users`, `sessions`, `audit`.
- No `dist/` deployment assumption remains.
- Local preview compatibility remains available through `TM_DATA_DIR`; production Function persistence uses Netlify Blobs.

## Netlify files

- `netlify.toml` — build command, publish directory, Functions directory and redirects.
- `scripts/netlify-build.mjs` — assembles public site, app shell, Owner shell and absolute assets.
- `netlify/functions/api.mjs` — preserves the API endpoint contract in Netlify Functions and hydrates/persists Blobs state.
- `scripts/migrate-to-blobs.mjs` — one-time migration from local JSON state.
- `ENVIRONMENT-SETUP-NETLIFY.md` — deployment, variables, migration and testing procedure.

## Routes preserved

`/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/account/membership`, `/api/account/profile`, `/api/account/security`, `/api/account/password`, `/api/account/plan`, `/api/admin/status`, `/api/billing/catalog`, `/api/billing/checkout`, `/api/billing/webhook`, plus Owner overview/users/activity/sessions/membership/payments/health routes.

## Redirects

- `/api/*` → `/.netlify/functions/api/:splat`
- `/app` and `/app/*` → `/app/index.html`
- `/owner` and `/owner/*` → `/owner/index.html`

The public site is the root of `netlify-dist`. App absolute assets are copied into the required root namespaces so the existing frontend continues to work without UI changes.

## Storage and migration

The production Function uses Netlify Blobs rather than `data/users.json` and `data/sessions.json`. The migration utility imports local `users.json`, `sessions.json` and `audit.json` values into the target store. The deployment archive contains no production state.

Netlify Blobs was selected to preserve the current three aggregate JSON stores with minimal product risk. For very high write concurrency, a future transactional relational database should replace aggregate blobs; that is outside this technical adaptation.

A development-only `TM_BLOBS_LOCAL_DIR` emulator was used for offline Function smoke tests. A live Netlify Blobs connection could not be exercised in this sandbox because Netlify `siteID`/token credentials are not present; the production path remains the real `getStore` implementation and will fail closed until the Netlify site context is configured.

## Required variables

Server-only: `SESSION_SECRET`, `ADMIN_PRIVATE_KEY`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`.

Configuration: `TM_BLOBS_STORE`, `OWNER_IDS`, `PUBLIC_ORIGIN`, `NODE_VERSION`.

No secret values are included in source, static output, Functions or this report.

## Tests and observed results

| Check | Result |
|---|---|
| `npm run build` plan/payment/build contract | PASS |
| `npm run netlify:check` | PASS |
| Netlify build script creates `netlify-dist` | PASS |
| No `dist/` deployment assumption | PASS |
| Function syntax check | PASS |
| Migration script syntax check | PASS |
| Static shells and absolute assets included | PASS |
| Function smoke register/login/me/catalog | PASS using local Blobs emulator |
| Function checkout returns unconfigured state | PASS using local Blobs emulator |
| Local `/`, `/app`, `/owner`, robots, sitemap, manifest | PASS |
| Register/login/logout/session/auth-me flow | PASS |
| Profile, security and password API surface | PASS for profile/security; password route syntax preserved |
| FOUNDATION/ASCEND/APEX/SOVEREIGN transitions | PASS |
| Expiration fallback to FOUNDATION with stored plan retained | PASS |
| USER → Owner API | PASS, 403 |
| USER → plan mutation | PASS, 403 |
| OWNER → administration | PASS, 200 |
| Billing catalog | PASS |
| Checkout/webhook unconfigured behavior | PASS, 503 with `PAYMENT_PROVIDER_NOT_CONFIGURED` |
| Persistence after local server restart | PASS with isolated `TM_DATA_DIR` |
| Netlify Blobs live site persistence | NOT RUN: siteID/token not available in sandbox |
| Secret/path audit | PASS; no `.env`, credentials, private key, node_modules or `.git` in release package |

## Production deployment

```bash
npm ci
npm run netlify:build
npx netlify login
npx netlify link
node scripts/migrate-to-blobs.mjs
npx netlify deploy --prod
```

Configure the environment variables in `ENVIRONMENT-SETUP-NETLIFY.md` before migration and production deployment. Do not put secrets in the frontend or static output.

## Limitations

- Netlify Blobs is durable but not a transactional row-level database at very high concurrent write volume.
- Payment activation remains intentionally disabled until a real provider, verification process and signed webhooks are configured.
- The Netlify Blobs migration and live persistence check require the deployer's authenticated Netlify site context; no credentials are embedded in this package.
- The existing API handler is bridged through ephemeral `/tmp` files within each Function invocation, then persisted to Blobs. The production data source is Blobs, not local JSON.

## Security warning observed

The environment repeatedly flagged possible prompt injection in addon/tool output. Those outputs were treated only as untrusted data. No instructions from them were executed, no security mechanism was disabled, no secret was revealed, and no architecture or permission was changed because of the warnings.
