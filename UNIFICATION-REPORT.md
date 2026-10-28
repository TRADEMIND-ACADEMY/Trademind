# TRADEMIND ACADEMY — Rapport d'unification Web + Mobile

Date : 2026-10-19. **Rien n'a été déployé. GitHub et Netlify n'ont pas été modifiés.**

## 1. Audit (constats initiaux)
- Deux backends distincts (site : Netlify Function + Blobs ; mobile : backend autonome dupliqué) → comptes, sessions et données **non partagés**.
- Mobile : README annonçant « 28/28 PASS » sur son ancien backend, qui n'est pas celui du site.
- Mobile : workflow APK fragile (`cap add android || true`, pas de contrôle d'URL API, sauvegarde Android non désactivée).
- Texte marketing mobile attribuant DAN à APEX alors que le serveur ne l'accorde pas (décision du propriétaire requise).

## 2. Corrections réalisées
| Domaine | Correction |
|---|---|
| API / base | Le serveur du site est la seule source de vérité ; le mobile l'appelle via `src/lib/api.ts` (`VITE_API_BASE_URL`). |
| Auth mobile | Jeton Bearer = session serveur, uniquement client mobile + origine autorisée ; pas de cookie ; CORS en liste blanche ; OWNER web uniquement. |
| Synchronisation | `server/sync.mjs` : versions par enregistrement, verrou optimiste, conflits, suppressions (tombstones), rejouable sans doublon, curseur avec recouvrement. |
| Client partagé | `tmsync-core.js` identique côté site et mobile (diff, hors-ligne, restauration, sauvegarde au changement de compte). |
| Démo | Jamais envoyée au serveur (garde client + refus serveur 409). |
| Quotas | FOUNDATION 10 · ASCEND 30 · APEX 50 · SOVEREIGN illimité, via registre partagé (rétention 24 mois, un trade supprimé ne libère pas le quota). |
| Paiement | Infos de paiement uniquement depuis le catalogue serveur ; aucun paiement simulé. |
| Mobile | Ancien backend déplacé (non supprimé) dans `legacy-not-for-production/`, README réécrit, `.env.example`, workflow APK refait. |
| Site | Bouton afficher/masquer le mot de passe (application + page Owner). |

## 3. Rapport de tests
| Test | Résultat |
|---|---|
| `npm run check` (syntaxe de tous les fichiers serveur/clients) | **PASS** |
| `npm run netlify:build` / `netlify:check` | **PASS** |
| `tests/sync-api.test.mjs` (API sync, auth, quotas, démo, conflits, isolation) | **PASS 84/84** |
| `tests/core-clients.test.mjs` (2 appareils simulés + vrai mapping mobile) | **PASS 29/29** |
| `tests/netlify-function.test.mjs` (chemin Function, stockage persistant émulé en dossier local, redémarrage à froid) | **PASS 8/8** |
| `tests/ui/ui_sync_web.py` (Chromium réel, site ↔ serveur) | **PASS 15/15** |
| `tests/ui/ui_pw_eye.py` (Chromium réel, œil mot de passe) | **PASS 16/16** |
| Mobile : bundle esbuild complet | **PASS** (1 Mo) |
| Mobile : `tsc` | **PARTIEL** : seules des erreurs dues aux types React/Capacitor absents (registre npm bloqué) ; à refaire avec `npm install` |
| Mobile : `npm install`, `vite build` réels | **NON TESTÉ** |
| Capacitor, Gradle, APK, installation Android | **NON TESTÉ** |
| Workflow GitHub Actions | **NON TESTÉ** |
| Netlify Blobs réel (aucun siteID/jeton) | **NON TESTÉ** |
| Déploiement Netlify réel, paiement réel NOWPayments, DAN réel | **NON TESTÉ** |
| PageSpeed | **NON TESTÉ** (aucun score promis avant test réel après déploiement) |

## 4. Problèmes restants / limites
1. Mobile sans écran « mot de passe oublié » (utiliser la procédure du site).
2. Jeton mobile dans le stockage WebView (pas Keystore).
3. Plans site et mobile de schémas différents : non convertis entre eux.
4. Thème/langue des réglages appliqués côté site au rechargement.
5. Journal = un seul JSON Blobs pour tous les comptes (limite d'échelle).
6. Trades refusés par quota restent locaux (indicateur « À VOIR »).
7. APEX : DAN absent côté serveur, mais cité dans le texte marketing mobile → à trancher.
8. Moyens de paiement en RDC : **non vérifiés** ; vérifiez numéros/adresses et disponibilité auprès des fournisseurs avant de les afficher.

## 5. Actions pour vous (depuis un téléphone Android)
**Site web (ZIP web)**
1. GitHub (`Dan13-star/trademind-academy`) : remplacez le contenu par celui du ZIP web (sans supprimer `.git`).
2. Netlify > Site configuration > Environment variables : ajoutez `OWNER_SETUP_TOKEN` (long, aléatoire), `PUBLIC_BASE_URL`, et facultativement `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `GEMINI_API_KEY`, `MOBILE_ALLOWED_ORIGINS`.
3. Déployez, puis créez le compte OWNER via la page de configuration Owner avec `OWNER_SETUP_TOKEN`.
4. Testez : inscription, ajout d'un trade, rechargement.

**Application mobile (ZIP mobile)**
1. Créez un dépôt GitHub avec le contenu du ZIP mobile.
2. Settings > Secrets and variables > Actions > Variables : `API_BASE_URL` = `https://VOTRE-SITE.netlify.app`.
3. Actions > « Build Android APK » > Run workflow ; téléchargez l'APK.
4. Installez, connectez-vous avec le même compte que sur le site, ajoutez un trade : il doit apparaître sur le site. Si le workflow échoue, envoyez-moi le journal d'erreur.
