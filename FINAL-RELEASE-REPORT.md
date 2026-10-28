# TRADEMIND ACADEMY — FINAL RELEASE REPORT (ULTIMATE MASTER RELEASE)

Légende : **PASS** (prouvé par un test exécuté) · **FAIL** · **NOT TESTED** · **NOT CONFIGURED — REQUIRES USER ACTION** · **BLOCKED**.
Rien n'a été déployé ni vérifié en production : seul l'utilisateur peut déployer (GitHub → Netlify). Tous les tests ci-dessous sont **locaux** (serveur Node + émulation Netlify Function + Blobs simulé, Chromium/Playwright).

---
# A. RELEASE TECHNIQUE

## Version de départ
ZIP précédent `TRADEMIND-ACADEMY-FINAL.zip`, SHA-256 `1953c1ef1b53329468bfce29fe91454a463baa10dc19e7ed0511fcfae825444a`. Aucune refonte : identité, design, plans, Permission Engine, DAN, REAL/DEMO, Owner Center conservés.

## Modifications
- Nouveau `server/security.mjs` (hachage, e-mail, CSRF, CSP/en-têtes), `server/accounts.mjs` (inscription, connexion, récupération, mot de passe, suppression, registre mensuel de trades).
- `server/app.mjs`, `billing.mjs`, `dan.mjs`, `netlify/functions/api.mjs` durcis (voir sections ci-dessous).
- Front : formulaires oubli/réinitialisation, redirections sans flash, barre de compte sans innerHTML, enveloppe d'enregistrement de trade.
- Corrections de bugs préexistants trouvés par les tests : `sgn is not defined` (premier rendu du tableau de bord avec trades) ; cache d'analyses périmé en **mode démo** (le journal démo restait vide) ; course serveur sur les IPN NOWPayments parallèles (double notification/activation).
- `scripts/source-hash.mjs` + `netlify-dist/build-info.json` (empreinte du code source).

## Architecture
Inchangée : site public `/`, application `/app`, Owner `/owner`, API en Netlify Function (`netlify/functions/api.mjs`) + Netlify Blobs. Modèle par requête : hydrate → api → persist (fusion des seules clés modifiées). Clés : `users, sessions, audit, orders, notifications, config, limits, resets, ledger`.

## Sécurité
Navigateur non fiable ; décisions critiques côté serveur. CSRF (Sec-Fetch-Site / Origin), JSON obligatoire (415), corps ≤ 256 Ko (413). En-têtes : CSP, nosniff, frame-ancestors 'none', Referrer-Policy, Permissions-Policy, HSTS (via `netlify.toml` + serveur). Audit XSS : **PASS** (données hostiles dans trades, notes, profil, identifiants, vues Owner : aucune exécution, aucune violation CSP). Scan de secrets du code : **aucun secret détecté** ; `data/*.json` vides. Réserves : la CSP garde `'unsafe-inline'` (scripts/styles inline existants) ; Chart.js chargé depuis jsDelivr sans SRI.

## Authentification
scrypt (Node crypto, N=2^16), anciens hachages vérifiés puis migrés à la connexion, vérification factice pour égaliser le timing. Connexion/inscription/Owner : **PASS** (tests serveur).

## Unicité e-mail
Normalisation NFKC + trim + minuscules ; revendication atomique `claimUnique` ; message exact « Cette adresse email est déjà associée à un compte. Connectez-vous ou utilisez Mot de passe oublié. ». 16 inscriptions simultanées → 1 compte : **PASS** (serveur local). Sur **Netlify Blobs réel** : **NOT TESTED** (voir Limitations : `@netlify/blobs` 8.2.0 non mis à jour).

## Récupération de mot de passe
Jeton 256 bits à usage unique, 30 min, seul son hachage est stocké ; pas d'énumération (même réponse) ; sessions révoquées après réinitialisation. Aucun e-mail simulé : sans fournisseur → mode **ADMIN_ASSISTED** (l'Owner génère un lien). Envoi e-mail réel : **NOT CONFIGURED — REQUIRES USER ACTION** (`EMAIL_PROVIDER_KEY`, `EMAIL_FROM`). Testé avec un faux fournisseur e-mail : PASS.

## Sessions
Cookie `tm_session` HttpOnly, SameSite, Secure en production, expiration (30 j ; Owner 12 h), identifiant stocké haché, nouvel identifiant à chaque connexion (anti-fixation), déconnexion et révocation côté serveur : **PASS**.

## Rate limiting
Persistant (store `limits`, pas un compteur mémoire) : inscription, connexion (par IP, par e-mail, par paire), Owner, changement de mot de passe, récupération, création de commande, DAN, init Owner : **PASS**. Approximatif sous forte concurrence multi-instances.

## Autorisations
USER → toute route Owner = 403, anonyme = 401 ; altération de rôle/plan dans localStorage sans effet : **PASS**. Un seul Owner (identifiant immuable, 6 initialisations concurrentes → 1) : **PASS** local.

## Isolation
Données/commandes d'un utilisateur inaccessibles à un autre (403 + audit `forbidden_resource_access`) : **PASS**.

## Plans
FOUNDATION $0 / 10 · ASCEND $2.50 / 30 · APEX $5 / 50 · SOVEREIGN $10 / illimité. Aucun libellé public « PRO »/« ELITE » : **PASS** (site, vues de l'application, barre de compte). Les codes internes FREE/PRO/PRO MAX/ELITE restent en interne. *Une exécution isolée du test d'audit a signalé PRO/ELITE dans la vue Abonnement ; 4 réexécutions consécutives sont PASS et la cause n'a pas été identifiée — à surveiller (état transitoire de rendu suspecté).*

## Limites de trades
Registre serveur mensuel (UTC), idempotent, 403 `TRADE_LIMIT_REACHED`, testé pour les quatre plans et le repli à l'expiration : **PASS**.

## Paiements
États CREATED…REFUNDED, interface d'ordre avec QR. Activation uniquement par webhook vérifié ou confirmation Owner ; ni bouton, ni localStorage, ni URL, ni référence saisie, ni capture : **PASS** (tests d'activation frauduleuse). Airtel Money = manuel (+243965430389, **non vérifié**) ; adresses crypto **non vérifiées**.

## Webhooks
Mauvaise signature, montant/devise falsifiés → rejet ; 3 IPN simultanés → 1 activation et 1 notification : **PASS** (faux NOWPayments). NOWPayments réel (sandbox ou production) : **NOT CONFIGURED — REQUIRES USER ACTION** (`NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_SANDBOX`).

## DAN
Clé et modèle uniquement côté serveur ; limites 20/10 min, 150/jour/utilisateur, plafond global ; accès par plan appliqué côté serveur ; état réel affiché. Testé avec un **faux** Gemini : PASS. Gemini réel : **NOT CONFIGURED — REQUIRES USER ACTION** (`GEMINI_API_KEY`, `DAN_MODEL`).

## Variables d'environnement (noms uniquement)
`GEMINI_API_KEY, DAN_MODEL, DAN_PROVIDER, OPENAI_API_KEY, DAN_GLOBAL_DAILY_MAX, NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET, NOWPAYMENTS_SANDBOX, PAYMENT_WEBHOOK_SECRET, OWNER_SETUP_TOKEN, EMAIL_PROVIDER_KEY, EMAIL_FROM, EMAIL_API_URL, OWNER_NOTIFY_EMAIL, PUBLIC_BASE_URL, TM_BLOBS_STORE, TM_COOKIE_SECURE` (+ `TM_TRUST_XFF`, tests locaux uniquement). Détail dans `ENVIRONMENT-SETUP-NETLIFY.md`.

## Responsive
14 largeurs (320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1440, 1920) × site public, connexion, 6 vues application, 9 vues Owner, tiroir mobile ouvert/fermé automatiquement : 76/76 **PASS** (Chromium émulé). **Android physique : NOT TESTED.** Graphiques Chart.js jamais vérifiés visuellement (CDN inaccessible ici).

## PWA
Manifeste, icônes, service worker (réseau d'abord, aucun cache `/api`), page hors-ligne honnête, pas de scintillement en réseau lent, `/` → `/app` pour un utilisateur connecté : 12/12 **PASS**. Hors-ligne = coquille et ressources uniquement ; l'enregistrement d'un nouveau trade exige le réseau.

## Tests réussis
| Suite | Résultat |
|---|---|
| Serveur local (`t_core`) : comptes, e-mail, cookies, CSRF, limites, Owner unique, 403, isolation, paiements/webhooks, quotas 4 plans, DAN, récupération, suppression, audit | 154/154 PASS |
| 3 instances + Blobs simulé (`t_netlify`) | 15/15 PASS |
| Paiements avec faux NOWPayments + faux e-mail (`t_pay`) | 26/26 PASS |
| Interface : redirections, altération localStorage, quota, XSS, CSP, récupération (`ui_sec`) | 33/33 PASS |
| 14 largeurs (`ui_resp`) | 76/76 PASS |
| PWA (`ui_pwa`) | 12/12 PASS |
| Libellés publics des plans (`ui_labels`) | 4/4 PASS (voir réserve plus haut) |
| Mode démo (`demo_fix`) | 1/1 PASS |
| `npm run build`, `npm run check`, `npm run netlify:check` | PASS |

Les 20 tests de la section 23 sont couverts par ces suites (rôle, plan, Owner API, isolation, activation frauduleuse, webhook répété, montant falsifié, mauvaise signature, second Owner, e-mail dupliqué, inscriptions simultanées, redirections, /owner pour USER, secrets frontend, limites/expiration, XSS, CSRF, sessions, quatre plans, responsive/PWA). Aucun test destructif sur des données de production.

## Tests échoués
Aucun dans l'état final. Échecs rencontrés puis corrigés : `sgn is not defined` ; cache périmé du mode démo ; course IPN parallèles.

## Tests non exécutés
Netlify réel / Blobs réel ; Gemini réel ; NOWPayments sandbox/production ; fournisseur e-mail réel ; automatisation Airtel ; production ; appareil Android physique ; rendu visuel des graphiques.

## Limitations
- `@netlify/blobs` est figé à 8.2.0 (npm bloqué ici : mise à jour non testable). L'unicité atomique d'e-mail/Owner utilise `onlyIfNew` si supporté ; sinon repli marqueur local + dédoublonnage, **non atomique entre instances**. **Recommandé : mettre à jour puis tester sur le site réel.**
- Le contenu des trades reste dans le navigateur ; le serveur contrôle le quota de création via le registre, mais un client falsifié peut garder des lignes locales. Le verrouillage des analyses premium est de l'UX côté client ; sont imposés côté serveur : DAN, quota, paiements/activation, Owner.
- Compteurs de limitation approximatifs sous forte concurrence. Latence « mot de passe oublié » potentiellement différente selon l'existence du compte.
- En mode démo, la tuile « trades ce mois » affiche encore le plan réel et compte les trades de démo (comportement préexistant, non modifié).
- Les sessions existantes seront invalidées une fois au déploiement (clés de session hachées).
- Un ZIP n'est **pas** prouvé identique à la production (aucune comparaison possible) : comparer `/build-info.json` (`sourceSha256`) avec `node scripts/source-hash.mjs`.

## Actions utilisateur (NOT CONFIGURED — REQUIRES USER ACTION)
1. Déployer : pousser le contenu dans `Dan13-star/trademind-academy` (main) puis `extract.yml` (workflow_dispatch) ; Netlify déploie.
2. Netlify → variables : `OWNER_SETUP_TOKEN`, `PUBLIC_BASE_URL`, puis (si souhaité) `GEMINI_API_KEY`, `NOWPAYMENTS_*`, `EMAIL_*`. Jamais de clé dans le chat.
3. Mettre à jour `@netlify/blobs`, redéployer, tester l'unicité e-mail sur le site réel.
4. Initialiser l'Owner une seule fois, vérifier `/build-info.json`, tester un paiement sandbox.
5. Vérifier le numéro Airtel et les adresses crypto.

## Empreinte du code source
`sourceSha256` = `6c636dfbf99195231f6514b417da053ab5837c0be75aaed733059396c0e9af4e` (146 fichiers ; ce rapport est exclu du calcul).

ZIP: TRADEMIND-ACADEMY-FINAL.zip
SHA-256: __ZIPSHA__

---
# B. PRODUCTION VIDÉO

| Fichier | Format | Durée | Statut |
|---|---|---|---|
| `TRADEMIND-ACADEMY-PROMO-VERTICAL.mp4` | 9:16, 1080×1920, 30 i/s, H.264 + AAC | 55,0 s | **PASS** (généré, relu avec ffprobe) |
| `TRADEMIND-ACADEMY-PROMO-HORIZONTAL.mp4` | 16:9, 1920×1080, 30 i/s | 55,0 s | **PASS** |
| `TRADEMIND-ACADEMY-PROMO-TEASER-15S.mp4` | 9:16, 1080×1920 | 15,0 s | **PASS** |

Livrables : `script-FR.md`, `script-EN.md`, `subtitles-FR.srt`, `subtitles-EN.srt`, `storyboard.md`, `EDIT-INSTRUCTIONS.md`, dossier `project/` (source éditable : `render.py`, `music.py`, logo) et `seq/` (captures d'écran réelles, 390×844 @2x).

- **Version d'application utilisée pour la capture** : l'état final (empreinte source `6c636dfb…af4e` hors modifications de documentation), servi par l'émulation locale, mode démo SOVEREIGN de l'application (données synthétiques, étiquetées « DÉMO · DONNÉES SYNTHÉTIQUES » dans la vidéo). Aucune donnée personnelle ; aucun faux gain présenté comme réel, aucune promesse de revenu.
- **Outils réellement utilisés** : Playwright/Chromium (captures), Pillow + numpy (montage), ffmpeg (encodage), synthèse numpy (musique originale, donc libre de droits ; aucun échantillon externe).
- **Voix off : NON GÉNÉRÉE** (aucun moteur TTS dans l'environnement). Texte et minutage fournis (script + SRT) ; sous-titres français incrustés dans les MP4, version anglaise en SRT seulement.
- **DAN : non montré** (clé Gemini non configurée ; rien n'est simulé). La scène 5 montre à la place les capacités réelles du site (Journal, Guardian, Psychologie, Analyses).
- **Analyses (scène 6)** : seules les cartes de statistiques sont visibles ; la zone des graphiques est volontairement estompée, car Chart.js (CDN) ne se charge pas dans l'environnement de capture. Les graphiques réels n'ont donc pas été filmés.
- Prix affichés : $0 / $2.50 / $5 / $10, limites 10 / 30 / 50 / illimité. Aucun lien ni QR ajouté (aucune URL publique vérifiée). Les intégrations non configurées ne sont pas présentées comme opérationnelles.
- **Tests réellement faits** : images extraites des MP4 finaux et inspectées visuellement (verticale, horizontale, teaser) ; durées/résolutions vérifiées ; niveau audio mesuré (moyenne −17,1 dB, crête −2,2 dB, pas d'écrêtage). **NOT TESTED** : écoute humaine de la musique, lecture sur téléphone réel, lisibilité des sous-titres sur écran physique.
- Limites techniques : montage programmatique simple (pas d'étalonnage ni de motion design avancé) ; le teaser n'a pas de sous-titres.
