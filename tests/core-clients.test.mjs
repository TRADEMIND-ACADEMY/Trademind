// Tests du noyau de synchronisation (celui du site ET du mobile) : deux « appareils » simulés contre le VRAI serveur local.
// Le mapping réel du mobile (src/sync/tmsync.ts) est compilé avec esbuild si disponible pour tester l'aller-retour.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-core-"));
const PORT = 5100 + Math.floor(Math.random() * 300), BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), TM_DATA_DIR: dataDir, TM_ROOT: root, TM_TRUST_XFF: "1" };
let server;
const start = async () => { server = spawn("node", ["server.mjs"], { cwd: root, env, stdio: "ignore" }); for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/billing/catalog`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 150)); } throw new Error("no server"); };
let pass = 0, fail = 0; const bad = [];
const check = (n, ok, d = "") => { if (ok) { pass++; console.log("  PASS ", n); } else { fail++; bad.push(n); console.log("  FAIL ", n, d); } };

await import(pathToFileURL(path.join(root, "products/application/public/tmsync-core.js")).href);
const Core = globalThis.TMSyncCore;
const uid = () => crypto.randomBytes(5).toString("hex");
const pw = "Tr4de-Mind-Test-2026";

class Device {
  constructor(name, ip) { this.name = name; this.ip = ip; this.store = new Map(); this.token = ""; this.userId = null; this.demo = false; this.calls = 0; this.offline = false;
    this.trades = []; this.plans = []; this.settings = null; this.backups = [];
    this.core = Core.create({
      api: async (m, p, b, signal, extra) => { if (this.offline) throw new Error("Failed to fetch"); this.calls++; const r = await fetch(BASE + p, { method: m, headers: { "content-type": "application/json", origin: "https://localhost", "x-tm-client": "mobile", "x-forwarded-for": this.ip, ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(extra || {}) }, body: b === undefined ? undefined : JSON.stringify(b), signal }); let json = null; try { json = await r.json(); } catch {} return { status: r.status, ok: r.ok, json }; },
      storage: { get: k => this.store.get(k) ?? null, set: (k, v) => this.store.set(k, v), remove: k => this.store.delete(k) },
      userId: () => (this.token ? this.userId : null), isDemo: () => this.demo,
      adapter: {
        readLocal: () => ({ trades: this.trades.filter(t => !t.isDemo).map(t => ({ kind: "trade", id: t.id, data: this.wire(t) })), plans: this.plans.map(p => ({ kind: "plan", id: p.id, data: { schema: "mobile-plan-v1", name: p.name, active: false, body: p.body } })), settings: this.settings ? { kind: "settings", id: "main", data: this.settings } : null }),
        accepts: rec => rec.kind !== "plan" || rec.data?.schema === "mobile-plan-v1",
        applyRemote: ({ upserts, deletes }) => { for (const u of upserts) { if (u.kind === "trade") { const i = this.trades.findIndex(t => t.id === u.id); const t = { ...u.data }; if (i >= 0) this.trades[i] = t; else this.trades.push(t); } else if (u.kind === "settings") this.settings = u.data; else if (u.kind === "plan") { const i = this.plans.findIndex(p => p.id === u.id); const pl = { id: u.id, name: u.data.name, body: u.data.body }; if (i >= 0) this.plans[i] = pl; else this.plans.push(pl); } } for (const d of deletes) { if (d.kind === "trade") this.trades = this.trades.filter(t => t.id !== d.id); if (d.kind === "plan") this.plans = this.plans.filter(p => p.id !== d.id); } },
        backupAndClear: reason => { this.backups.push({ reason, trades: this.trades.length }); this.trades = []; this.plans = []; this.settings = null; }
      }
    });
  }
  wire(t) { const { isDemo, ...rest } = t; return rest; }
  async login(email, register = false) { const r = await fetch(BASE + (register ? "/api/auth/register" : "/api/auth/login"), { method: "POST", headers: { "content-type": "application/json", origin: "https://localhost", "x-tm-client": "mobile", "x-forwarded-for": this.ip }, body: JSON.stringify({ email, password: pw, confirmPassword: pw, firstName: "T", lastName: "U", country: "FR" }) }); const j = await r.json(); this.token = j.token; this.userId = j.user.id; return j; }
  add(id, o = {}) { this.trades.push({ id, date: "2026-10-05", time: "09:30", symbol: "EURUSD", direction: "buy", session: "", setup: "", result: "win", notes: "", entry: 1.1, pnl: 100, ...o }); }
}
const setPlan = (email, plan) => { const f = path.join(dataDir, "users.json"); const u = JSON.parse(fs.readFileSync(f, "utf8")); for (const x of Object.values(u)) if (x.email === email) { x.plan = plan; x.subscription_status = "active"; x.subscription_start = new Date().toISOString(); x.subscription_end = new Date(Date.now() + 20 * 86400000).toISOString(); } fs.writeFileSync(f, JSON.stringify(u)); };

try {
  await start();
  const email = `c-${uid()}@example.com`;
  const A = new Device("site", "10.1.0.1"), B = new Device("mobile", "10.1.0.2");
  await A.login(email, true); await B.login(email);
  console.log("\n[Synchronisation entre deux appareils]");
  const t1 = `tr${uid()}`; A.add(t1); A.settings = { currency: "$", theme: "night", lang: "fr", startingBalance: 25000, guardian: { maxRisk: 1, maxTrades: 5 } };
  await A.core.sync(); await B.core.sync();
  check("Trade créé sur A visible sur B", B.trades.some(t => t.id === t1));
  check("Réglages de A adoptés par B (appareil neuf, sans conflit)", B.settings?.startingBalance === 25000 && B.core.getStatus().conflicts === 0);
  const callsBefore = A.calls; const sA = await A.core.sync();
  check("Resynchro sans modification : rien à envoyer (0 en attente)", A.core.getStatus().pending === 0 && A.core.getStatus().state === "ok");
  B.trades.find(t => t.id === t1).pnl = 250; await B.core.sync(); await A.core.sync();
  check("Modification sur B appliquée sur A", A.trades.find(t => t.id === t1).pnl === 250);
  const t2 = `tr${uid()}`; B.add(t2, { symbol: "XAUUSD" }); await B.core.sync(); await A.core.sync();
  check("Trade créé sur B visible sur A", A.trades.some(t => t.id === t2 && t.symbol === "XAUUSD"));
  check("Aucun trade en double après plusieurs synchros", A.trades.length === 2 && B.trades.length === 2);

  console.log("\n[Conflit : jamais perdu en silence]");
  A.trades.find(t => t.id === t1).notes = "version A"; B.trades.find(t => t.id === t1).notes = "version B";
  await A.core.sync(); await B.core.sync();
  const confl = B.core.getConflicts();
  check("B signale le conflit et conserve sa version locale perdante", confl.length === 1 && confl[0].local?.notes === "version B" && B.core.getStatus().state === "conflict");
  check("La version du serveur (A) est appliquée sur B", B.trades.find(t => t.id === t1).notes === "version A");
  B.core.clearConflicts(); check("Conflit acquitté par l'utilisateur", B.core.getStatus().conflicts === 0);

  console.log("\n[Suppression explicite et restauration]");
  A.trades = A.trades.filter(t => t.id !== t2); A.core.noteDelete("trade", t2); await A.core.sync(); await B.core.sync();
  check("Suppression sur A propagée à B", !B.trades.some(t => t.id === t2));
  const serverBefore = (await (await fetch(`${BASE}/api/sync/state?since=0`, { headers: { authorization: `Bearer ${A.token}` } })).json()).records.filter(r => !r.deleted).length;
  B.trades = []; await B.core.sync();
  check("État local vidé SANS suppression explicite : les données sont restaurées depuis le serveur", B.trades.some(t => t.id === t1));
  const serverAfter = (await (await fetch(`${BASE}/api/sync/state?since=0`, { headers: { authorization: `Bearer ${A.token}` } })).json()).records.filter(r => !r.deleted).length;
  check("…et le serveur n'a rien perdu", serverAfter === serverBefore, `${serverBefore}->${serverAfter}`);

  console.log("\n[Mode DÉMO]");
  const callsB = B.calls; B.demo = true; B.core.setDemoChanged();
  for (let i = 0; i < 3; i++) B.trades.push({ id: `demo-${uid()}`, date: "2026-10-01", symbol: "DEMO", direction: "buy", isDemo: true, demo: true, notes: "Demo trade — for exploring the app." });
  const rd = await B.core.sync();
  check("En DÉMO : aucune requête réseau", B.calls === callsB && B.core.getStatus().state === "demo", `${B.calls - callsB} appels`);
  B.demo = false; B.core.setDemoChanged(); B.trades = B.trades.map(t => ({ ...t, isDemo: false })); // simule un trade démo « déguisé » (isDemo retiré)
  await B.core.sync();
  const all = (await (await fetch(`${BASE}/api/sync/state?since=0`, { headers: { authorization: `Bearer ${A.token}` } })).json()).records;
  check("Aucun trade démo n'existe sur le serveur (id demo-, drapeaux, note)", !all.some(r => r.data && (/^demo-/.test(r.id) || r.data.symbol === "DEMO")));
  check("Le noyau a écarté les trades démo avant envoi (aucun rejet serveur nécessaire)", B.core.getStatus().rejected === 0);

  console.log("\n[Hors ligne]");
  const t3 = `tr${uid()}`; B.trades = B.trades.filter(t => !/^demo-/.test(t.id)); B.add(t3); B.offline = true;
  const ro = await B.core.sync();
  check("Hors ligne : état « offline », donnée conservée localement", B.core.getStatus().state === "offline" && B.trades.some(t => t.id === t3));
  B.offline = false; await B.core.sync(); await A.core.sync();
  check("Retour réseau : le trade créé hors ligne arrive sur A", A.trades.some(t => t.id === t3));

  console.log("\n[Changement de compte sur l'appareil]");
  const email2 = `c2-${uid()}@example.com`; const C = new Device("autre", "10.1.0.3"); await C.login(email2, true);
  B.trades.push({ id: `tr${uid()}`, date: "2026-10-06", symbol: "GBPUSD", direction: "sell", time: "", session: "", setup: "", result: "", notes: "" });
  const nBefore = B.trades.length; await B.login(email2); await B.core.sync();
  const c2 = (await (await fetch(`${BASE}/api/sync/state?since=0`, { headers: { authorization: `Bearer ${B.token}` } })).json()).records;
  check("Autre compte sur le même appareil : données locales sauvegardées puis retirées", B.backups.length === 1 && B.backups[0].trades === nBefore);
  check("Les données du premier compte ne sont JAMAIS envoyées au second", c2.length === 0);

  console.log("\n[Quota FOUNDATION atteint]");
  const email3 = `c3-${uid()}@example.com`; const D = new Device("quota", "10.1.0.4"); await D.login(email3, true);
  for (let i = 0; i < 12; i++) D.add(`q${i}${uid()}`, { date: "2026-09-10" });
  await D.core.sync();
  const st = D.core.getStatus();
  check("11e et 12e trade refusés par le serveur : signalés, restent locaux", st.rejected === 2 && st.state === "attention" && D.trades.length === 12, JSON.stringify(st));
  await D.core.sync(); check("Pas de boucle d'envoi : une 2e synchro n'insiste pas", D.core.getStatus().rejected === 2);

  console.log("\n[Plans d'un autre schéma]");
  const plId = `pl${uid()}`; await fetch(BASE + "/api/sync/push", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${A.token}`, origin: "https://localhost", "x-tm-client": "mobile", "x-forwarded-for": "10.1.0.1" }, body: JSON.stringify({ changes: [{ kind: "plan", id: plId, baseVersion: 0, data: { schema: "web-planbuilder-v1", name: "Plan du site", body: { x: 1 } } }] }) });
  await A.core.sync(); await A.core.sync();
  check("Plan d'un autre schéma ignoré (pas de boucle de restauration, pas appliqué)", A.plans.length === 0 && A.core.getStatus().state === "ok");

  // Mapping mobile réel
  console.log("\n[Mapping réel du mobile (src/sync/tmsync.ts)]");
  if (!fs.existsSync(path.resolve(root, "../m/src/sync/tmsync.ts"))) console.log("  SKIP  projet mobile absent (../m) : section ignorée (NON TESTÉE)");
  else try {
    const { build } = await import("/opt/npm-tools/node_modules/esbuild/lib/main.js");
    const out = path.join(os.tmpdir(), `tmsync-mobile-${uid()}.mjs`);
    await build({ entryPoints: [path.resolve(root, "../m/src/sync/tmsync.ts")], bundle: true, format: "esm", platform: "node", outfile: out, define: { "import.meta.env": "{}" }, logLevel: "silent" });
    const M = await import(pathToFileURL(out).href);
    const mt = { id: "tr_abc12345", date: "2026-10-05", time: "09:30", symbol: "eurusd", direction: "buy", entryPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, size: 0.5, risk: 1, pnl: 120, result: "win", rMultiple: 2, session: "London", setup: "BOS", notes: "ok", planId: "plan_x", planName: "SMC", score: 82, psychology: ["calme"], guardianStatus: "aligned", violations: [], mode: "REAL", demo: false, createdAt: "2026-10-05T09:30:00.000Z" };
    const w = M.tradeToWire(mt);
    const back = M.wireToTrade(mt.id, w.data);
    const w2 = M.tradeToWire(back);
    check("Mobile : trade -> format commun -> trade -> format commun identique (aucun envoi parasite)", JSON.stringify(w.data) === JSON.stringify(w2.data));
    check("Mobile : champs mobiles conservés (plan, score, psychologie)", back.planId === "plan_x" && back.score === 82 && back.psychology[0] === "calme" && back.entryPrice === 1.1 && back.stopLoss === 1.09);
    const fromSite = { id: "site123456", date: "2026-10-05", time: "", symbol: "EURUSD", direction: "sell", session: "", setup: "", result: "loss", notes: "", pnl: -30, ext: { web: { flags: ["fomo"], smc: { score: 55 } } } };
    const bm = M.wireToTrade("site123456", fromSite); bm.notes = "édité sur mobile";
    const sw = M.tradeToWire(bm).data;
    check("Mobile : les données propres au site (ext.web) sont préservées à la modification", sw.ext?.web?.smc?.score === 55 && sw.notes === "édité sur mobile");
    const big = { ...mt, planSnapshot: { criteria: Array.from({ length: 200 }, (_, i) => ({ name: "critère long " + i, text: "x".repeat(60) })) } };
    const wb = M.tradeToWire(big).data; check("Mobile : un plan-instantané trop gros est retiré de l'envoi (le trade reste acceptable)", JSON.stringify(wb).length < 16000 && !wb.ext?.mobile?.planSnapshot);
    const sres = await fetch(BASE + "/api/sync/push", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${A.token}`, origin: "https://localhost", "x-tm-client": "mobile", "x-forwarded-for": "10.1.0.1" }, body: JSON.stringify({ changes: [{ kind: "trade", id: mt.id, baseVersion: 0, data: w.data }, { kind: "trade", id: "big1234567", baseVersion: 0, data: wb }] }) });
    const sj = await sres.json(); check("Serveur : acceptation des trades mappés par le mobile", sj.results.every(r => r.status === "ok"), JSON.stringify(sj));
    const sset = M.settingsToWire({ startingBalance: 5000, currency: "€", theme: "night", lang: "fr", guardian: { maxRiskPerTrade: 1, maxDailyLoss: 3, maxTradesPerDay: 5, minRR: 1.5, maxConsecutiveLosses: 3 } }, "plan_x");
    const sr = await fetch(BASE + "/api/sync/push", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${A.token}`, origin: "https://localhost", "x-tm-client": "mobile", "x-forwarded-for": "10.1.0.1" }, body: JSON.stringify({ changes: [{ kind: "settings", id: "main", baseVersion: 1, data: sset.data }] }) });
    check("Serveur : réglages mobiles (Guardian) acceptés", (await sr.json()).results[0].status === "ok");
    const pw1 = M.planToWire({ id: "plan_abcd1234", name: "Mon plan", version: 2, isActive: true, updatedAt: "x", criteria: [{ id: "c1", name: "BOS", weight: 30 }], guardian: {} });
    check("Mobile : l'activation d'un plan et la date ne modifient pas l'empreinte (pas de conflits parasites)", JSON.stringify(pw1.data.body).indexOf("isActive") < 0 && JSON.stringify(pw1.data.body).indexOf("updatedAt") < 0);
  } catch (e) { check("Mapping mobile exécutable", false, String(e.stack || e)); }
} catch (e) { fail++; bad.push("exception " + e.message); console.log(e.stack); }
finally { try { server.kill("SIGTERM"); } catch {} fs.rmSync(dataDir, { recursive: true, force: true }); }
console.log(`\nRÉSULTAT: ${pass} réussis, ${fail} échoués`); if (fail) { console.log("ÉCHECS:", bad.join(" | ")); process.exit(1); }
