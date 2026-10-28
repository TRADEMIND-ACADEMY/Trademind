# TradeMind Academy — Final Release Report (ULTIME PATCH PRODUCTION)

**Date :** 2026-10-04 · **Base :** TRADEMIND-ACADEMY-FINAL.zip précédent
**Déploiement : NON EFFECTUÉ.** Cet environnement n'a pas d'accès au compte Netlify. Aucune URL de production, aucun test de production, **Netlify Blobs réel : NON EXÉCUTÉ** (stub). Le ZIP **ne peut pas** être déclaré identique à la production : rien n'a été déployé.

## 1. Paiements — état par fournisseur
| Méthode | État | Détail |
|---|---|---|
| Airtel Money | **ACTIVE MANUAL** | Ordre TM-XXXXXXXX, l'Owner vérifie les fonds puis confirme avec un ID de transaction réel |
| USDT BEP-20 | **ACTIVE MANUAL** | Adresse, montant, QR réel, Copier, Order ID, statut |
| USDT ERC-20 | **ACTIVE MANUAL** | idem |
| BTC | **ACTIVE MANUAL** | idem |
| Fournisseur marchand automatique | **NOT CONFIGURED** | Aucun fournisseur connecté. « Paiement automatique » n'est affiché nulle part |

- **ACTIVE AUTOMATIC : aucune méthode.** Un récepteur webhook générique existe (`POST /api/billing/webhook`, HMAC-SHA256 `x-tm-signature: t=…,v1=…`, tolérance 5 min, vérif. montant/devise/plan/ordre/transaction, idempotence, 503 si `PAYMENT_WEBHOOK_SECRET` absent, 401 si signature invalide). Il n'est branché à aucun fournisseur réel et n'a pas été éprouvé contre un vrai fournisseur.
- « J'ai payé » **n'active jamais** le plan : il enregistre seulement une référence. L'activation exige CONFIRMED par l'Owner (ou webhook signé).
- Statuts : CREATED, PENDING, PAYMENT_DETECTED, CONFIRMED, ACTIVATED, FAILED, EXPIRED, CANCELLED, REFUNDED. Revenu = CONFIRMED/ACTIVATED uniquement (remboursés exclus).
- Plans inchangés : FOUNDATION $0/10 trades, ASCEND $2.50/30, APEX $5/50, SOVEREIGN $10/illimité.

## 2. Notification Owner
- Destinataire : mushagalusadan@gmail.com (surchargeable par `OWNER_NOTIFY_EMAIL`). Champs : User, User ID, Plan, Amount, Payment method, Network, Order ID, Transaction ID, Status, Date. Aucun secret envoyé.
- **E-mail : NOT CONFIGURED tant que `EMAIL_PROVIDER_KEY` + `EMAIL_FROM` ne sont pas définis.** « Envoyé » n'apparaît que sur HTTP 2xx du fournisseur. Testé uniquement contre un serveur HTTP local factice (destinataire/corps exacts) ; **aucun e-mail réel envoyé.**
- `/owner` → Notifications (nouveau paiement, confirmé, échoué, abonnement activé/expiré, remboursement, anomalie) ; `/owner` → Payments (utilisateur, User ID, plan, montant, devise, méthode, réseau, Order ID, Transaction ID, statut, date ; filtres Pending/Confirmed/Failed/Refunded) ; `/owner` → System montre la config manquante.

## 3. Sécurité Owner
- Initialisation unique (`/api/owner/setup`, nécessite `OWNER_SETUP_TOKEN` côté serveur), puis fermée ; Owner ID immuable ; pas d'inscription Owner ni de changement de rôle côté front ; `OWNER_IDS` conservé ; e-mail Owner non modifiable publiquement.
- Changement de mot de passe : actuel + nouveau + confirmation, vérification serveur (« Les mots de passe ne correspondent pas. »), min. 12 caractères, hash, révocation de toutes les sessions Owner (reconnexion exigée), audit `OWNER_PASSWORD_CHANGED`. Aucun mot de passe envoyé par e-mail ; pas de récupération par e-mail implémentée.
- USER → `/owner` refusé, API Owner = 403 (testé).

## 4. Mobile
Tableaux en cartes ≤600 px (Owner ≤700 px) avec défilement local, jamais global ; textes secondaires repliables ; stats 2×2 (1 colonne <360 px) ; graphiques adaptatifs ; marge basse pour que la barre de compte/FAB DAN ne cache plus « Save Trade » (défaut réel trouvé et corrigé).

## 5. Tests réalisés (locaux, émulation Netlify ; aucun en production)
- PASS `npm run check`, `build`, `netlify:check` ; bundles cjs/esm sans erreur ni warning.
- PASS 92/92 paiement/Owner/webhook/e-mail/idempotence (backend) ; PASS 14/14 backend × 3 configs (local, Blobs simulé avec/sans `uncachedEdgeURL`).
- PASS 26/26 UI paiement + Owner ; PASS 27/27 matrice des 4 plans (limites, permissions, DAN, upgrade, activation après paiement) ; PASS 24/24 site/app ; PASS 12/12 Owner.
- PASS 288 contrôles de débordement (18 viewports 320→1920+ dont paysage), 0 débordement, 0 erreur JS.
- PASS 54/54 parcours profils Android émulés (Galaxy S8, Pixel 5, Pixel 7, rotation).
- PASS réseau lent (squelette → session → plan, aucun flash de mauvais plan/login) ; PASS hors-ligne réel (serveur arrêté) : coque servie par le service worker + message clair ; page jamais visitée → `/offline.html`.
- QR : encodeur maison, décodé 8/8 par OpenCV ; le QR scanné dans l'UI = l'adresse réelle.
- PASS aucun secret/`.env`/clé privée ; `data/*.json` vides.

## 6. Limites réelles
1. Production non déployée ni testée ; Blobs réel non exécuté ; ZIP ≠ confirmé identique à la production.
2. Aucun appareil Android physique : seulement l'émulation de profils Playwright.
3. Chart.js (CDN) inaccessible ici : rendu des graphiques non vérifié (mise en page seulement).
4. Aucun paiement automatique réel ; webhook non éprouvé avec un vrai fournisseur.
5. Concurrence d'inscription : atténuation (fusion + double vérification espacée), **pas atomique**. Mesuré sur disque local : 12/12 avec 8 écrivains, 8/8 avec 16 ; non mesuré sur de vrais Blobs. Une garantie complète demande des clés par enregistrement.
6. Hors-ligne : la connexion exige le réseau ; seule la coque/les assets sont en cache ; pas de mode hors-ligne complet. Pas d'APK.
7. Menu latéral Owner conservé (design inchangé) ; site public = page unique à ancres.

## Variables d'environnement (noms uniquement, à définir dans Netlify)
`OWNER_SETUP_TOKEN` (init. unique de l'Owner), `OWNER_IDS` (optionnel), `PAYMENT_WEBHOOK_SECRET` (si un fournisseur est branché), `EMAIL_PROVIDER_KEY`, `EMAIL_FROM` (e-mails), optionnels : `OWNER_NOTIFY_EMAIL`, `EMAIL_API_URL`, `TM_BLOBS_STORE`.

## Déploiement
Git (Import from Git) ou `npm install` puis `npx netlify-cli deploy --build --prod`. Éviter le glisser-déposer (n'installe pas `@netlify/blobs`).

## Vérification après déploiement
`/`, `/app`, `/owner`, `/manifest.webmanifest`, `/sw.js` → 200 ; `/api/billing/catalog` → 200 ; `/api/auth/me` sans session → 401 ; inscription → cookie `tm_session` ; `/owner` initialisé via `OWNER_SETUP_TOKEN` ; créer un ordre, confirmer côté Owner → plan activé ; logs Functions sans `BlobsConsistencyError`.

---

# Mise à jour ciblée — 2026-10-04 (4 corrections, rien d'autre modifié)

1. **Notifications professionnelles** : `ui.js` (toasts + modales de confirmation/information intégrées, FR/EN, clair/sombre, clavier + focus). Remplace tous les `alert()`/`confirm()` natifs : suppression de trade, nouvelle session, tout effacer, chargement démo, mode démo protégé, confirmer/rejeter/rembourser un paiement (Owner). Messages d'erreur de paiement traduits par code.
2. **Compte Owner libre** : plan SOVEREIGN gratuit, sans limite, sans paiement (`effectiveMembership` côté serveur ; `POST /api/billing/orders` → 409 `OWNER_FREE_ACCESS`). Cause du blocage : redirection automatique vers `/owner` à la connexion/inscription, supprimée. Un lien « Owner » est dans la barre de compte ; « Ouvrir l'application » dans le centre Owner. L'Owner est exclu des statistiques d'abonnements actifs. Libellé corrigé (SOVEREIGN · OWNER, plus « ELITE »).
3. **Mobile moins grand** : échelle initiale 0,86 pour les écrans ≤ 600 px (balise viewport) — application, site public, centre Owner. Pas de CSS `zoom`.
4. **Installation comme vraie application** : manifeste PWA + proposition d'installation (modale) juste après l'inscription et sinon après quelques secondes ; « Plus tard » mémorisé 7 jours ; iOS : instructions Safari. L'app installée s'ouvre directement sur `/app` (jamais sur le site vitrine).

## Tests (locaux, émulation ; aucun en production)
`check`/`build`/`netlify:check` OK ; backend 14/14 ×3, paiement 92/92, Owner gratuit 14/14 ; UI paiement 27/27, plans 27/27, nouveau lot 24/24, site/app 24/24, Owner 12/12 ; 288 contrôles de débordement 0 ; profils Android 54/54 ; réseau lent OK ; hors-ligne OK. Quatre anciens tests ont été mis à jour (largeur de référence 0,86, nouveaux noms de plan, identifiant Owner masqué une fois initialisé).

## Limites de cette mise à jour
- Production non redéployée ni testée par moi ; Blobs réel non vérifié.
- Installation : c'est une PWA (« ajouter à l'écran d'accueil », WebAPK sur Android Chrome), pas un APK de store. L'invite réelle dépend de Chrome ; testée ici avec un événement synthétique.
- Échelle 0,86 vérifiée en émulation Chromium, pas sur un vrai téléphone.
- E-mail réel non configuré ; aucun paiement automatique réel.

---

# Mise à jour ciblée — DAN AI opérationnel (2026-10-04, soir)

**Nouveau** : `server/dan.mjs` + route `POST /api/dan/chat` (et `GET /api/dan/status`). DAN appelle OpenAI **côté serveur** (clé `OPENAI_API_KEY`, jamais dans le navigateur ni dans le ZIP). Variables : `OPENAI_API_KEY` (obligatoire), `DAN_MODEL` (optionnel, défaut `gpt-4o-mini`).

- **Accès** : selon la matrice existante, inchangée (ASCEND = DAN Coach, SOVEREIGN = DAN Sovereign, Owner = SOVEREIGN gratuit ; FOUNDATION et APEX verrouillés → 403 `DAN_LOCKED`). Le mode DEMO garde sa réponse fictive, sans appel à l'IA.
- **Données** : l'application envoie un résumé calculé du journal de l'utilisateur (statistiques, performance par symbole/session, 25 derniers trades, drapeaux psychologiques, adhérence au plan). Le serveur ne garde que des champs attendus (aucun e-mail, mot de passe ni jeton) et les traite comme des données, jamais comme des instructions.
- **Périmètre et ton** (consignes serveur) : uniquement le journal de l'utilisateur, la discipline/le risque/la psychologie et l'explication des fonctionnalités du site ; hors sujet refusé poliment ; ton bienveillant si le plan n'est pas respecté ; tempère doucement la surestimation après un gain ; jamais de signal, de prévision ni de garantie de gain ; ne révèle pas ses consignes.
- **Protections** : 20 messages / 10 min et 150 / jour par utilisateur (en mémoire : meilleure-effort sur Functions) ; message ≤ 800 caractères ; historique ≤ 8 tours ; délai fournisseur 9 s (les Functions gratuites coupent à ~10 s) ; sans clé → 503 `DAN_NOT_CONFIGURED`, **aucune réponse simulée** ; erreurs fournisseur masquées (502/504). Audit sans contenu des messages. État affiché dans Owner → État du système (`danAI`).

## Tests (locaux)
- Backend 19/19 (accès par plan, clé en en-tête uniquement, périmètre/ton/interdits présents dans le prompt, données injectées, champs sensibles supprimés, rôle `system` de l'historique rejeté, tronquage, erreur fournisseur, limite de débit) + 3/3 (sans clé, délai dépassé, état Système) + UI 10/10 (trades réels envoyés, adhérence au plan, historique, erreurs lisibles, FOUNDATION verrouillé).
- Régression complète rejouée : paiement 92, backend 14 ×2, Owner gratuit 14, UI paiement 27, plans 27, nouveau lot 24, site/app 24, Owner 12, mobile 54, débordements 288, réseau lent, hors-ligne.

## Limites (honnêtes)
- **Les tests utilisent un FAUX serveur OpenAI local** : le vrai OpenAI n'est pas joignable d'ici. Qualité réelle des réponses, respect effectif du périmètre/ton par le modèle et coût réel : **non vérifiés**, à tester en production après ajout de la clé.
- Limite de débit en mémoire (peut se réinitialiser entre invocations) ; utile contre l'abus simple, pas une garantie.
- **Paiement automatique : NON implémenté** (aucun fournisseur choisi/compte marchand) ; les paiements restent manuels, confirmés par l'Owner.

## Complément — DAN avec Gemini (palier gratuit) ou OpenAI
- Fournisseur choisi côté serveur : `DAN_PROVIDER=gemini|openai` ; à défaut, Gemini si `GEMINI_API_KEY` existe, sinon OpenAI (`OPENAI_API_KEY`). `DAN_MODEL` (défaut : `gemini-3.5-flash-lite` pour Gemini (modèle gratuit affiché dans AI Studio le 2026-10-04), `gpt-4o-mini` pour OpenAI) ; le nom du modèle Gemini doit être confirmé dans Google AI Studio (les noms changent).
- Clé Gemini envoyée en en-tête (`x-goog-api-key`), jamais dans l'URL ni côté navigateur. Mêmes consignes, mêmes protections et mêmes codes d'erreur dans les deux cas.
- Tests locaux avec un FAUX serveur compatible : Gemini 10/10 (URL, en-tête, consignes, historique, erreurs, choix du fournisseur), OpenAI 19/19 + 3/3, UI 10/10. **Le vrai Gemini n'a pas été appelé** (inaccessible d'ici) : format de requête/réponse conforme à la documentation connue, non vérifié en réel.
- Confidentialité : sur le palier gratuit de Google, les contenus envoyés peuvent être utilisés par Google pour améliorer ses produits (à vérifier dans leurs conditions). Les journaux de trading des utilisateurs seraient concernés : à indiquer dans votre politique de confidentialité, ou à passer en palier payant.
- Limites du palier gratuit (requêtes/minute et par jour) fixées par Google : en cas de dépassement, DAN affiche « momentanément indisponible ».

---

# Mise à jour ciblée — Paiement crypto automatique (NOWPayments) (2026-10-06)

**Ce qui existe** : `server/nowpayments.mjs` + méthode « Crypto (USDT / BTC) » (mode AUTOMATIC), visible **uniquement** si `NOWPAYMENTS_API_KEY` et `NOWPAYMENTS_IPN_SECRET` sont définies. Airtel Money et les adresses directes restent des paiements manuels confirmés par l'Owner, inchangés.

**Flux** : l'utilisateur choisit la méthode → le serveur crée une facture NOWPayments (montant et devise fixés côté serveur, jamais par le navigateur) → bouton « Payer maintenant » (page sécurisée du fournisseur, nouvel onglet) → NOWPayments envoie une notification signée (`POST /api/billing/nowpayments/ipn`) → le serveur vérifie la signature HMAC-SHA512, la devise, le montant et la commande, **revérifie le paiement directement chez NOWPayments**, puis active le plan. La fenêtre de paiement passe seule à « Activé » (sondage 5 s + à chaque retour sur l'onglet).

**Garde-fous** : activation uniquement sur statut `finished` revérifié ; `partially_paid`, `failed`, `expired`, `refunded` traités sans activation (alerte Owner) ; identifiant de paiement à usage unique (rejeu = sans effet, pas de double durée) ; facture créée avant la commande (aucune commande orpheline si le fournisseur échoue) ; aucun secret côté navigateur ni dans le ZIP ; l'Owner n'a jamais de commande (accès gratuit).

**Variables Netlify (noms seulement)** : `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_SANDBOX=1` (pour le compte de TEST sandbox ; à retirer en production), `PUBLIC_BASE_URL` (optionnelle ; sinon l'URL Netlify du site est utilisée pour l'adresse de notification).

## Tests (locaux) — avec un FAUX NOWPayments
- Backend 33/33 : sans clés (503, méthode absente), avec clés (catalogue, facture : clé en en-tête / montant / `order_id` / URL de notification), signature absente/fausse/autre secret/corps modifié (401), `confirming`, `finished` non confirmé par le fournisseur (502/422), montant ou devise différents (422), commande inconnue (404), paiement partiel, activation valide, rejeu, même identifiant sur une autre commande, `expired`, échec fournisseur sans commande orpheline, méthodes manuelles inchangées, notifications Owner.
- Interface 10/10 : méthode automatique en premier, bouton « Payer maintenant » (https, nouvel onglet, noopener), aucune saisie de hash, activation automatique de la fenêtre, plan ASCEND côté serveur.
- Régression complète rejouée (92 paiement, 14 backend, 14 Owner, 19+10 DAN, UI 27/27/24/24/12/54, 288 débordements, réseau lent, hors-ligne) : tout passe.

## Limites (honnêtes)
- **Jamais testé contre le vrai NOWPayments** (ni sandbox ni production) : format de signature (HMAC-SHA512 du JSON trié), champs et statuts conformes à la documentation connue, non vérifiés en réel. **Faire un paiement de TEST sandbox complet avant toute mise en production.**
- La notification arrive à l'adresse publique du site : elle doit être joignable depuis Internet (Netlify : oui).
- Frais, vérifications d'identité, monnaies acceptées et délais de confirmation dépendent de NOWPayments (à vérifier sur leur site).
- Airtel Money : toujours manuel (aucun fournisseur automatique choisi).
