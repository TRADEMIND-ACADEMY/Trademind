// Tests d'intégration réels : un vrai serveur (server.mjs) est lancé, deux « clients » (web = cookie, mobile = Bearer) l'appellent en HTTP.
// Usage : node tests/sync-api.test.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-sync-"));
const PORT = 4600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), TM_DATA_DIR: dataDir, TM_ROOT: root, OWNER_SETUP_TOKEN: "test-owner-setup-token-not-a-secret", NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: "test-ipn-secret", TM_TRUST_XFF: "1" };
let server;
const startServer = async () => { server = spawn("node", ["server.mjs"], { cwd: root, env, stdio: "ignore" }); for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/billing/catalog`); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 150)); } throw new Error("server did not start"); };
const stopServer = async () => { server.kill("SIGTERM"); await new Promise(r => setTimeout(r, 300)); };

let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; failures.push(name); console.log(`  FAIL  ${name} ${detail}`); } };

// ---- clients
const MOBILE_ORIGIN = "https://localhost";
class Web { // navigateur du site : cookie + même origine
  constructor(ip = "10.0.0.1") { this.cookie = ""; this.ip = ip; }
  async call(method, url, body, extra = {}) {
    const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": this.ip, ...(this.cookie ? { cookie: this.cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.getSetCookie?.() || []; const s = sc.find(c => c.startsWith("tm_session=")); if (s) this.cookie = s.split(";")[0] && `tm_session=${s.split(";")[0].slice(11)}`; if (s && /tm_session=;/.test(s)) this.cookie = "";
    let json = null; try { json = await r.json(); } catch {} return { status: r.status, json, setCookie: sc };
  }
}
class Mobile { // application Capacitor : origine https://localhost, jeton Bearer, aucun cookie
  constructor(ip = "10.0.1.1") { this.token = ""; this.ip = ip; }
  async call(method, url, body, extra = {}) {
    const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", origin: MOBILE_ORIGIN, "x-tm-client": "mobile", "x-forwarded-for": this.ip, ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch {} return { status: r.status, json, headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  }
}
const uid = () => crypto.randomBytes(6).toString("hex");
const trade = (id, o = {}) => ({ id, date: "2026-10-05", time: "09:30", symbol: "EURUSD", direction: "buy", entry: 1.1, sl: 1.09, tp: 1.12, risk: 1, result: "win", pnl: 120, notes: "ok", ...o });
const push = (c, changes, extra) => c.call("POST", "/api/sync/push", { changes }, extra);
const state = (c, since = 0) => c.call("GET", `/api/sync/state?since=${since}`);
const setPlan = (email, plan) => { const f = path.join(dataDir, "users.json"); const users = JSON.parse(fs.readFileSync(f, "utf8")); for (const u of Object.values(users)) if (u.email === email) { u.plan = plan; u.subscription_status = "active"; u.subscription_start = new Date().toISOString(); u.subscription_end = new Date(Date.now() + 20 * 86400000).toISOString(); } fs.writeFileSync(f, JSON.stringify(users)); };
const pw = "Tr4de-Mind-Test-2026";
const reg = (c, email, extra = {}) => c.call("POST", "/api/auth/register", { email, password: pw, confirmPassword: pw, firstName: "T", lastName: "U", country: "FR", language: "fr", ...extra });

try {
  await startServer();

  console.log("\n[1] Comptes : création site / connexion mobile, et inverse");
  const emailA = `a-${uid()}@example.com`, emailB = `b-${uid()}@example.com`;
  const webA = new Web(); const r1 = await reg(webA, emailA);
  check("1. Création de compte sur le site (cookie HttpOnly posé)", r1.status === 200 && r1.setCookie.some(c => c.startsWith("tm_session=") && /HttpOnly/i.test(c)));
  check("1b. Réponse site : aucun jeton dans le corps", !("token" in (r1.json || {})));
  const mobA = new Mobile(); const r2 = await mobA.call("POST", "/api/auth/login", { email: emailA, password: pw });
  check("2. Connexion mobile avec le compte créé sur le site", r2.status === 200 && /^[a-f0-9]{64}$/.test(r2.json?.token || ""), JSON.stringify(r2.json));
  check("2b. Mobile : aucun cookie posé par le serveur", r2.setCookie.length === 0);
  check("2c. Mobile : en-tête CORS limité à l'origine autorisée", r2.headers.get("access-control-allow-origin") === MOBILE_ORIGIN);
  mobA.token = r2.json.token;
  const me = await mobA.call("GET", "/api/auth/me");
  const meWeb = await webA.call("GET", "/api/auth/me");
  check("2d. Même utilisateur côté mobile et côté site (id identique)", me.json?.user?.id && me.json.user.id === meWeb.json?.user?.id);
  check("2e. Plan par défaut FREE / FOUNDATION", me.json.user.plan === "FREE" && me.json.user.identity === "FOUNDATION");
  const mobB = new Mobile("10.0.1.2"); const r3 = await reg(mobB, emailB);
  check("3. Création de compte sur le mobile (jeton Bearer)", r3.status === 200 && /^[a-f0-9]{64}$/.test(r3.json?.token || "") && r3.setCookie.length === 0);
  mobB.token = r3.json.token;
  const webB = new Web("10.0.0.2"); const r4 = await webB.call("POST", "/api/auth/login", { email: emailB, password: pw });
  check("3b. Connexion sur le site avec le compte créé sur le mobile", r4.status === 200 && r4.json?.user?.email === emailB);
  const meB = await mobB.call("GET", "/api/auth/me");
  check("3c. Même identifiant des deux côtés", meB.json?.user?.id === r4.json?.user?.id);
  const rBad = await mobA.call("POST", "/api/auth/login", { email: emailA, password: "mauvais-mot-de-passe-1" });
  check("3d. Mauvais mot de passe refusé (401)", rBad.status === 401);
  const rPub = await new Mobile("10.0.1.9").call("POST", "/api/auth/register", { email: `x-${uid()}@example.com`, password: pw, confirmPassword: pw, role: "OWNER", plan: "ELITE" });
  const mePub = await (async () => { const m = new Mobile("10.0.1.9"); m.token = rPub.json?.token; return m.call("GET", "/api/auth/me"); })();
  check("3e. Inscription publique : jamais OWNER, jamais payant", mePub.json?.user?.role === "USER" && mePub.json?.user?.plan === "FREE");

  console.log("\n[2] Trades : site -> mobile et mobile -> site");
  const t1 = `tr${uid()}`, t2 = `tr${uid()}`;
  const p1 = await push(webA, [{ kind: "trade", id: t1, baseVersion: 0, data: trade(t1) }]);
  check("4. Trade créé sur le site accepté", p1.json?.results?.[0]?.status === "ok", JSON.stringify(p1.json));
  const s1 = await state(mobA);
  check("4b. Ce trade est lu sur le mobile", s1.json?.records?.some(r => r.kind === "trade" && r.id === t1 && r.data.symbol === "EURUSD"));
  const p2 = await push(mobA, [{ kind: "trade", id: t2, baseVersion: 0, data: trade(t2, { symbol: "XAUUSD", direction: "sell", pnl: -50, result: "loss" }) }]);
  check("5. Trade créé sur le mobile accepté", p2.json?.results?.[0]?.status === "ok");
  const s2 = await state(webA);
  check("5b. Ce trade est lu sur le site", s2.json?.records?.some(r => r.id === t2 && r.data.symbol === "XAUUSD"));
  check("5c. Les deux trades visibles des deux côtés", s2.json.records.filter(r => r.kind === "trade").length === 2);

  console.log("\n[3] Déconnexion / reconnexion / autre navigateur");
  const lo = await mobA.call("POST", "/api/auth/logout");
  check("6. Déconnexion mobile (200)", lo.status === 200);
  const after = await mobA.call("GET", "/api/auth/me");
  check("6b. Jeton révoqué côté serveur après déconnexion (401)", after.status === 401);
  const st401 = await state(mobA);
  check("6c. Synchro refusée sans session valide (401)", st401.status === 401);
  const re = await mobA.call("POST", "/api/auth/login", { email: emailA, password: pw }); mobA.token = re.json?.token;
  const s3 = await state(mobA);
  check("6d. Reconnexion : mêmes données retrouvées", s3.json?.records?.length === 2);
  const otherBrowser = new Web("10.0.0.77"); await otherBrowser.call("POST", "/api/auth/login", { email: emailA, password: pw });
  const s4 = await state(otherBrowser);
  check("7. Autre navigateur : mêmes données après connexion", s4.json?.records?.length === 2);
  check("7b. Session du site toujours valide après la déconnexion du mobile", (await webA.call("GET", "/api/auth/me")).status === 200);

  console.log("\n[4] Isolation entre utilisateurs");
  const sB = await state(mobB);
  check("8. L'utilisateur B ne voit aucun trade de A", sB.json?.records?.length === 0);
  const steal = await push(mobB, [{ kind: "trade", id: t1, baseVersion: 1, data: trade(t1, { symbol: "HACKED" }) }]);
  check("8b. B ne peut pas modifier le trade de A : conflit sans fuite (server=null)", steal.json?.results?.[0]?.status === "conflict" && steal.json.results[0].server === null, JSON.stringify(steal.json));
  const sA = await state(webA);
  check("8c. Le trade de A est intact", sA.json.records.find(r => r.id === t1)?.data.symbol === "EURUSD" && sA.json.records.find(r => r.id === t1)?.v === 1);
  const sB2 = await state(mobB);
  check("8d. Rien de A n'apparaît chez B après la tentative", sB2.json.records.length === 0);

  console.log("\n[5] Mode DÉMO / RÉEL");
  const demoCases = [
    ["drapeau demo", trade(`dm${uid()}`, { demo: true })],
    ["drapeau isDemo", trade(`dm${uid()}`, { isDemo: true })],
    ["mode DEMO", trade(`dm${uid()}`, { mode: "DEMO" })],
    ["préfixe demo-", trade(`demo-${uid()}`)],
    ["note « Demo trade »", trade(`dm${uid()}`, { notes: "Demo trade — for exploring the app." })],
    ["marqueur dans ext", trade(`dm${uid()}`, { ext: { isDemo: true } })]
  ];
  for (const [label, t] of demoCases) { const r = await push(webA, [{ kind: "trade", id: t.id, baseVersion: 0, data: t }]); check(`9. Démo refusée serveur : ${label}`, r.json?.results?.[0]?.status === "invalid" && r.json.results[0].code === "DEMO_REJECTED", JSON.stringify(r.json)); }
  const rh = await push(webA, [{ kind: "trade", id: `ok${uid()}`, baseVersion: 0, data: trade(`ok${uid()}`) }], { "x-tm-mode": "demo" });
  check("9b. En-tête x-tm-mode: demo : aucun envoi (409 DEMO_MODE)", rh.status === 409 && rh.json?.code === "DEMO_MODE");
  const rh2 = await push(mobA, [{ kind: "trade", id: `ok${uid()}`, baseVersion: 0, data: trade(`ok${uid()}`) }], { "x-tm-mode": "demo" });
  check("9c. Idem côté mobile", rh2.status === 409);
  const sD = await state(webA);
  check("9d. Aucune donnée démo en base (2 trades réels seulement)", sD.json.records.filter(r => r.kind === "trade").length === 2);

  console.log("\n[6] Versions, conflits, suppressions");
  const c1 = await push(mobA, [{ kind: "trade", id: t1, baseVersion: 1, data: trade(t1, { pnl: 200 }) }]);
  check("11. Mise à jour avec bonne version : v2", c1.json?.results?.[0]?.status === "ok" && c1.json.results[0].v === 2);
  const c2 = await push(webA, [{ kind: "trade", id: t1, baseVersion: 1, data: trade(t1, { pnl: 999 }) }]);
  check("11b. Version périmée -> conflit (jamais d'écrasement silencieux)", c2.json?.results?.[0]?.status === "conflict" && c2.json.results[0].server.data.pnl === 200);
  const c3 = await push(mobA, [{ kind: "trade", id: t1, baseVersion: 1, data: trade(t1, { pnl: 200 }) }]);
  check("11c. Rejeu identique (réseau instable) : idempotent, sans nouvelle version", c3.json?.results?.[0]?.status === "ok" && c3.json.results[0].duplicate === true && c3.json.results[0].v === 2);
  const d1 = await push(webA, [{ kind: "trade", id: t2, baseVersion: 1, deleted: true }]);
  check("12. Suppression acceptée", d1.json?.results?.[0]?.status === "ok");
  const sX = await state(mobA);
  check("12b. Suppression propagée au mobile (tombstone)", sX.json.records.find(r => r.id === t2)?.deleted === true);
  const dup = await push(webA, [{ kind: "trade", id: t2, baseVersion: 1, deleted: true }]);
  check("12c. Suppression rejouée : idempotente", dup.json?.results?.[0]?.status === "ok");
  const since = await state(webA, s2.json.cursor);
  check("12d. Lecture incrémentale (since) fonctionne", since.status === 200 && Array.isArray(since.json.records));
  const big = await push(webA, Array.from({ length: 101 }, (_, i) => ({ kind: "trade", id: `bg${i}${uid()}`, baseVersion: 0, data: trade(`bg${i}${uid()}`) })));
  check("13. Lot > 100 refusé", big.status === 400);
  const inv = await push(webA, [{ kind: "trade", id: "x", baseVersion: 0, data: trade("x") }, { kind: "trade", id: `ok${uid()}`, baseVersion: 0, data: { date: "pas-une-date", symbol: "A", direction: "buy" } }, { kind: "nope", id: "abcdef", baseVersion: 0, data: {} }]);
  check("13b. Données invalides : refus par enregistrement, pas de crash", inv.status === 200 && inv.json.results.every(r => r.status === "invalid"));
  const nul = await webA.call("POST", "/api/sync/push", null);
  check("13c. Corps nul : erreur propre (pas 500)", nul.status === 400);
  const garbage = await webA.call("POST", "/api/sync/push", { changes: [null, 5, "x", { kind: "trade" }] });
  check("13d. Éléments mal formés : pas de plantage", garbage.status === 200 && garbage.json.results.length === 4 && garbage.json.results.every(r => r.status === "invalid"));

  console.log("\n[7] Réglages et plans");
  const set1 = await push(mobA, [{ kind: "settings", id: "main", baseVersion: 0, data: { currency: "€", lang: "fr", theme: "night", startingBalance: 25000, guardian: { maxRisk: 1, maxTrades: 5, maxDailyLoss: 3, maxConsec: 3, minRR: 1.5 } } }]);
  check("26. Réglages synchronisés (mobile)", set1.json?.results?.[0]?.status === "ok");
  const sS = await state(webA); const stt = sS.json.records.find(r => r.kind === "settings");
  check("26b. Réglages lus sur le site (capital, devise, Guardian)", stt?.data?.startingBalance === 25000 && stt.data.guardian.maxTrades === 5 && stt.data.currency === "€");
  const setBad = await push(webA, [{ kind: "settings", id: "main", baseVersion: 1, data: { plan: "ELITE", role: "OWNER", membership: "ELITE", theme: "night" } }]);
  const sS2 = await state(webA); const stt2 = sS2.json.records.find(r => r.kind === "settings");
  check("26c. Les réglages ne peuvent jamais porter abonnement/rôle", !("plan" in stt2.data) && !("role" in stt2.data) && !("membership" in stt2.data));
  const pl = await push(webA, [{ kind: "plan", id: `pl${uid()}`, baseVersion: 0, data: { schema: "mobile-plan-v1", name: "Mon plan", active: true, body: { rules: [{ label: "BOS", weight: 30 }] } } }]);
  check("27. Plan de trading synchronisé (schéma identifié)", pl.json?.results?.[0]?.status === "ok");
  const plBad = await push(webA, [{ kind: "plan", id: `pl${uid()}`, baseVersion: 0, data: { schema: "inconnu", body: {} } }]);
  check("27b. Plan à schéma inconnu refusé", plBad.json?.results?.[0]?.status === "invalid");

  console.log("\n[8] Quotas des quatre offres (comptés côté serveur, par mois de trade)");
  const quotaFor = async (plan, cap) => {
    const email = `q-${plan.replace(" ", "")}-${uid()}@example.com`.toLowerCase(); const m = new Mobile(`10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`); const rr = await reg(m, email); m.token = rr.json.token; if (plan !== "FREE") setPlan(email, plan);
    const meQ = await m.call("GET", "/api/auth/me"); const results = []; const n = cap === null ? 55 : cap + 2; let okCount = 0, limited = 0;
    for (let i = 0; i < n; i += 1) { const id = `q${i}${uid()}`; const r = await push(m, [{ kind: "trade", id, baseVersion: 0, data: trade(id, { date: "2026-09-10" }) }]); const st = r.json?.results?.[0]?.status; if (st === "ok") okCount++; else if (st === "limit") limited++; results.push(st); }
    return { identity: meQ.json.user.identity, okCount, limited };
  };
  const qf = await quotaFor("FREE", 10); check("16. FOUNDATION : 10 trades/mois puis blocage serveur", qf.identity === "FOUNDATION" && qf.okCount === 10 && qf.limited === 2, JSON.stringify(qf));
  const qa = await quotaFor("PRO", 30); check("16b. ASCEND : 30 trades/mois", qa.identity === "ASCEND" && qa.okCount === 30 && qa.limited === 2, JSON.stringify(qa));
  const qp = await quotaFor("PRO MAX", 50); check("16c. APEX : 50 trades/mois", qp.identity === "APEX" && qp.okCount === 50 && qp.limited === 2, JSON.stringify(qp));
  const qs = await quotaFor("ELITE", null); check("16d. SOVEREIGN : illimité (55 acceptés)", qs.identity === "SOVEREIGN" && qs.okCount === 55 && qs.limited === 0, JSON.stringify(qs));
  // Cohérence avec /api/trades/record (même grand livre) : un trade réservé par le site n'est pas recompté par la synchro.
  const wq = new Web("10.8.8.8"); const eq = `rq-${uid()}@example.com`; await reg(wq, eq);
  const idr = `rec${uid()}`; const rec = await wq.call("POST", "/api/trades/record", { tradeId: idr });
  await push(wq, [{ kind: "trade", id: idr, baseVersion: 0, data: trade(idr, { date: "2026-10-03" }) }]);
  const usage = await wq.call("GET", "/api/trades/usage");
  check("16e. Trade réservé via /api/trades/record puis synchronisé : compté une seule fois", rec.status === 200 && usage.json?.used === 1, JSON.stringify(usage.json));
  // Quota non contournable par suppression/recréation
  const mq = new Mobile("10.8.9.9"); const em = `dq-${uid()}@example.com`; const rg = await reg(mq, em); mq.token = rg.json.token;
  const ids = Array.from({ length: 10 }, () => `dl${uid()}`);
  for (const id of ids) await push(mq, [{ kind: "trade", id, baseVersion: 0, data: trade(id, { date: "2026-08-12" }) }]);
  await push(mq, [{ kind: "trade", id: ids[0], baseVersion: 1, deleted: true }]);
  const nid = `dl${uid()}`; const again = await push(mq, [{ kind: "trade", id: nid, baseVersion: 0, data: trade(nid, { date: "2026-08-12" }) }]);
  check("16f. Supprimer un trade ne rend pas le quota du mois", again.json?.results?.[0]?.status === "limit");
  const spoof = await push(mq, [{ kind: "trade", id: nid, baseVersion: 0, data: trade(nid, { date: "2026-07-12" }) }]);
  check("16g. Un mois différent a son propre quota (comportement documenté)", spoof.json?.results?.[0]?.status === "ok");

  console.log("\n[9] Sécurité des chemins web / mobile");
  const evil = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site", "x-tm-client": "mobile" }, body: JSON.stringify({ email: emailA, password: pw }) });
  check("14. Origine non autorisée avec en-tête mobile : bloquée (CSRF 403), sans CORS", evil.status === 403 && !evil.headers.get("access-control-allow-origin"));
  const evil2 = await fetch(`${BASE}/api/sync/push`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site", cookie: webA.cookie }, body: JSON.stringify({ changes: [{ kind: "trade", id: `ev${uid()}`, baseVersion: 0, data: trade(`ev${uid()}`) }] }) });
  check("14b. Requête inter-sites avec le cookie du site : bloquée", evil2.status === 403);
  const pre = await fetch(`${BASE}/api/sync/push`, { method: "OPTIONS", headers: { origin: MOBILE_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization,x-tm-client,content-type" } });
  check("14c. Pré-requête CORS du mobile (204, en-têtes autorisés)", pre.status === 204 && /authorization/.test(pre.headers.get("access-control-allow-headers") || ""));
  const preEvil = await fetch(`${BASE}/api/sync/push`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
  check("14d. Pré-requête d'une origine inconnue : aucun en-tête CORS", !preEvil.headers.get("access-control-allow-origin"));
  const badTok = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: "Bearer " + "0".repeat(64), origin: MOBILE_ORIGIN } });
  check("14e. Jeton Bearer inconnu : 401", badTok.status === 401);
  const badTok2 = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: "Bearer not-a-token" } });
  check("14f. Jeton mal formé : 401", badTok2.status === 401);
  const sessionsFile = fs.readFileSync(path.join(dataDir, "sessions.json"), "utf8");
  check("14g. Le jeton n'est jamais stocké en clair (sessions hachées)", !sessionsFile.includes(mobB.token) && !sessionsFile.includes(re.json.token));
  const usersFile = fs.readFileSync(path.join(dataDir, "users.json"), "utf8");
  check("14h. Mot de passe jamais stocké en clair", !usersFile.includes(pw));
  // OWNER : initialisation + refus de connexion mobile
  const ownerWeb = new Web("10.7.7.7"); const ownerPw = "Owner-Very-Long-Passw0rd-2026";
  const os = await ownerWeb.call("POST", "/api/owner/setup", { token: "test-owner-setup-token-not-a-secret", email: `owner-${uid()}@example.com`, password: ownerPw, confirmPassword: ownerPw, firstName: "O", lastName: "W" });
  const ownerEmail = JSON.parse(fs.readFileSync(path.join(dataDir, "users.json"), "utf8")); const ownerUser = Object.values(ownerEmail).find(u => u.role === "OWNER" || u.id === JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")).owner?.id);
  if (ownerUser) { const om = await new Mobile("10.7.7.8").call("POST", "/api/auth/login", { email: ownerUser.email, password: ownerPw }); check("15. Compte OWNER : connexion mobile refusée (web uniquement)", om.status === 403 && om.json?.code === "OWNER_WEB_ONLY", JSON.stringify(om.json)); const ow = await new Web("10.7.7.9").call("POST", "/api/auth/login", { email: ownerUser.email, password: ownerPw }); check("15b. Compte OWNER : connexion web inchangée", ow.status === 200 && ow.json?.user?.role === "OWNER"); }
  else check("15. OWNER initialisé pour le test", false, JSON.stringify(os.json));
  const ownerEndpointAsMobileUser = await mobB.call("GET", "/api/owner/users");
  check("15c. Un utilisateur mobile ne peut pas lire les endpoints OWNER (403)", ownerEndpointAsMobileUser.status === 403);
  const planChange = await mobB.call("POST", "/api/account/plan", { plan: "ELITE" });
  check("15d. Un utilisateur ne peut pas se donner un plan payant (403)", planChange.status === 403);

  console.log("\n[10] Paiements (signature des notifications)");
  const ipnBody = JSON.stringify({ payment_id: "123456", payment_status: "finished", order_id: "ORD-NOPE", price_amount: 2.5, price_currency: "usd" });
  const unsigned = await fetch(`${BASE}/api/billing/nowpayments/ipn`, { method: "POST", headers: { "content-type": "application/json" }, body: ipnBody });
  check("11. IPN sans signature rejeté (401)", unsigned.status === 401);
  const wrongSig = await fetch(`${BASE}/api/billing/nowpayments/ipn`, { method: "POST", headers: { "content-type": "application/json", "x-nowpayments-sig": "a".repeat(128) }, body: ipnBody });
  check("11b. IPN avec mauvaise signature rejeté (401)", wrongSig.status === 401);
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.keys(v).sort().reduce((a, k) => (a[k] = sort(v[k]), a), {}) : v;
  const goodSig = crypto.createHmac("sha512", "test-ipn-secret").update(JSON.stringify(sort(JSON.parse(ipnBody)))).digest("hex");
  const signed = await fetch(`${BASE}/api/billing/nowpayments/ipn`, { method: "POST", headers: { "content-type": "application/json", "x-nowpayments-sig": goodSig }, body: ipnBody });
  check("11c. IPN correctement signé mais commande inconnue : 404, aucun plan activé", signed.status === 404);
  const cat = await mobA.call("GET", "/api/billing/catalog");
  const airtel = cat.json?.methods?.find(m => m.id === "airtel-rdc");
  check("11d. Le mobile lit le catalogue de paiement du serveur (une seule source)", Array.isArray(cat.json?.methods) && airtel?.receiver === "+243965430389");
  const order = await mobA.call("POST", "/api/billing/orders", { plan: "ASCEND", method: "airtel-rdc" });
  check("11e. Commande manuelle créée depuis le mobile", order.status === 201 && order.json?.order?.method?.receiver === "+243965430389" && order.json.order.status === "PENDING");
  const rep = await mobA.call("POST", `/api/billing/orders/${order.json.order.id}/report`, { txRef: "TX-REF-123456" });
  const meAfter = await mobA.call("GET", "/api/auth/me");
  check("11f. Signaler un paiement n'active JAMAIS le plan", rep.status === 200 && rep.json?.activated === false && meAfter.json.user.plan === "FREE");
  const crossOrder = await mobB.call("GET", `/api/billing/orders/${order.json.order.id}`);
  check("11g. Un autre utilisateur ne peut pas lire la commande (404)", crossOrder.status === 404);

  console.log("\n[11] Persistance après redémarrage");
  const before = (await state(mobA)).json.records.length; const tokenBefore = mobA.token;
  await stopServer(); await startServer();
  const afterR = await state(mobA);
  check("12. Session mobile et données conservées après redémarrage du serveur", afterR.status === 200 && afterR.json.records.length === before, `${before} -> ${afterR.json?.records?.length}`);
  check("12b. Session du site conservée après redémarrage", (await webA.call("GET", "/api/auth/me")).status === 200);

  console.log("\n[12] Suppression de compte : purge du journal");
  const delAcc = await mobB.call("POST", "/api/account/delete", { password: pw });
  const journal = JSON.parse(fs.readFileSync(path.join(dataDir, "journal.json"), "utf8"));
  const bId = r3.json.user.id;
  check("17. Suppression de compte depuis le mobile (200)", delAcc.status === 200);
  check("17b. Journal de l'utilisateur supprimé purgé", !Object.keys(journal).some(k => k.startsWith(`${bId}|`)));
  check("17c. Les données des autres utilisateurs restent", Object.keys(journal).some(k => k.startsWith(`${r1.json.user.id}|`)));
  check("17d. Le jeton du compte supprimé est inutilisable", (await mobB.call("GET", "/api/auth/me")).status === 401);
} catch (error) {
  fail++; failures.push("exception: " + error.message); console.log("EXCEPTION", error.stack);
} finally {
  try { await stopServer(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\nRÉSULTAT: ${pass} réussis, ${fail} échoués`);
if (fail) { console.log("ÉCHECS:", failures.join(" | ")); process.exit(1); }
