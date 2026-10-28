// Synchronisation commune site web + application mobile.
// Source de vérité : le serveur (store « journal »). Les clients gardent un cache local.
// Enregistrements : clé `userId|kind|id`, kind ∈ trade | plan | settings. Version entière par enregistrement (verrou optimiste).
// Jamais d'écrasement silencieux : une version de base périmée renvoie « conflict » avec la version du serveur.
// Les données DÉMO sont refusées côté serveur (marqueurs + en-tête x-tm-mode: demo).
// Quotas : appliqués ici, sur le grand livre partagé avec /api/trades/record (un trade n'est compté qu'une fois).

const KINDS = new Set(["trade", "plan", "settings"]);
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OVERLAP_MS = 120000;
const MAX_BATCH = 100, MAX_PAGE = 500, MAX_TRADES = 5000, MAX_PLANS = 100;
const MAX_JSON = { trade: 16384, plan: 40960, settings: 12288 };
const SCHEMAS = new Set(["web-planbuilder-v1", "mobile-plan-v1"]);

const str = (v, max) => (typeof v === "string" ? v.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, "").trim().slice(0, max) : "");
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick = (v, allowed) => (allowed.includes(v) ? v : "");

// Détection de données de démonstration (indices indépendants : un seul suffit à refuser).
export function looksDemo(item) {
  if (!item || typeof item !== "object") return false;
  const flag = o => o && typeof o === "object" && (o.demo === true || o.isDemo === true || o.isdemo === true || String(o.mode || "").toUpperCase() === "DEMO");
  const note = o => o && typeof o === "object" && /^demo trade\b/i.test(String(o.notes || ""));
  const id = o => o && typeof o === "object" && /^demo[-_]/i.test(String(o.id || ""));
  return flag(item) || note(item) || id(item) || flag(item.ext) || note(item.ext);
}

// Valeur JSON bornée (profondeur, taille) : jamais de prototype pollué, jamais de fonctions.
function boundedJson(value, maxBytes, depth = 6) {
  const seen = (v, d) => {
    if (d > depth) throw new Error("depth");
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) return typeof v === "number" && !Number.isFinite(v) ? null : v;
    if (Array.isArray(v)) { if (v.length > 200) throw new Error("array"); return v.map(x => seen(x, d + 1)); }
    if (typeof v === "object") { const out = {}; for (const [k, x] of Object.entries(v)) { if (k === "__proto__" || k === "constructor" || k === "prototype") continue; out[String(k).slice(0, 60)] = seen(x, d + 1); } return out; }
    return undefined;
  };
  const clean = seen(value, 0);
  if (JSON.stringify(clean ?? null).length > maxBytes) throw new Error("size");
  return clean;
}

export function cleanTrade(input, id) {
  if (!input || typeof input !== "object") return null;
  const date = str(input.date, 10); if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) return null;
  const symbol = str(input.symbol, 24).toUpperCase(); if (!symbol) return null;
  const direction = pick(input.direction, ["buy", "sell"]); if (!direction) return null;
  const out = { id, date, time: /^\d{1,2}:\d{2}$/.test(str(input.time, 5)) ? str(input.time, 5) : "", symbol, direction, session: str(input.session, 24), setup: str(input.setup, 80), result: pick(input.result, ["win", "loss", "be"]), notes: str(input.notes, 2000) };
  for (const k of ["entry", "sl", "tp", "size", "risk", "pnl", "rMultiple"]) { const n = num(input[k]); if (n !== null) out[k] = n; }
  if (input.ext !== undefined) { try { out.ext = boundedJson(input.ext, 8192, 5); } catch { return null; } }
  if (JSON.stringify(out).length > MAX_JSON.trade) return null;
  return out;
}

export function cleanSettings(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  if (typeof input.currency === "string") out.currency = str(input.currency, 8);
  if (input.theme !== undefined) { const t = pick(input.theme, ["auto", "day", "night"]); if (!t) return null; out.theme = t; }
  if (input.lang !== undefined) { const l = pick(input.lang, ["en", "fr"]); if (!l) return null; out.lang = l; }
  if (input.startingBalance !== undefined) { const n = num(input.startingBalance); if (n === null || n < 0 || n > 1e12) return null; out.startingBalance = n; }
  if (input.guardian !== undefined) {
    if (!input.guardian || typeof input.guardian !== "object") return null; const g = {};
    for (const k of ["maxRisk", "maxTrades", "maxDailyLoss", "maxConsec", "minRR"]) { if (input.guardian[k] === undefined) continue; const n = num(input.guardian[k]); if (n === null || n < 0 || n > 1e6) return null; g[k] = n; }
    out.guardian = g;
  }
  if (input.ext !== undefined) { try { out.ext = boundedJson(input.ext, 6144, 4); } catch { return null; } }
  if (JSON.stringify(out).length > MAX_JSON.settings) return null;
  return out; // jamais d'abonnement / rôle / plan de paiement ici
}

export function cleanPlan(input) {
  if (!input || typeof input !== "object") return null;
  const schema = str(input.schema, 40); if (!SCHEMAS.has(schema)) return null;
  let body; try { body = boundedJson(input.body, MAX_JSON.plan - 200, 7); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const out = { schema, name: str(input.name, 80), active: input.active === true, body };
  if (JSON.stringify(out).length > MAX_JSON.plan) return null;
  return out;
}

export const keyOf = (userId, kind, id) => `${userId}|${kind}|${id}`;

export function createSync(h) {
  const { send, body, currentUser, readJournal, writeJournal, readLedger, writeLedger, effectiveMembership, PLANS, limitHit, tooMany, recordAudit, roleFor } = h;
  const metaKey = userId => `${userId}|meta|seq`;
  const mine = (journal, userId) => Object.values(journal).filter(r => r && r.userId === userId && KINDS.has(r.kind));
  const view = r => ({ kind: r.kind, id: r.id, v: r.v, seq: r.seq, updatedAt: r.updatedAt, deleted: Boolean(r.deleted), data: r.deleted ? null : r.data });

  // Quota : un trade déjà compté (dans N'IMPORTE QUEL mois conservé) n'est jamais recompté ; sinon on compte dans le mois de sa date.
  function consumeQuota(user, tradeId, tradeDate, ledger) {
    const plan = effectiveMembership(user).plan; const cap = PLANS[plan]?.tradeLimit ?? null;
    const slots = ledger[user.id] || {};
    for (const slot of Object.values(slots)) if (slot?.ids?.includes(tradeId)) return { ok: true, counted: false };
    const month = tradeDate.slice(0, 7); const slot = slots[month] || { ids: [], n: 0 };
    if (cap !== null && slot.n >= cap) return { ok: false, cap, used: slot.n, month };
    if (slot.ids.length < 600) slot.ids.push(tradeId); slot.n += 1; slots[month] = slot;
    const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 24); const keepFrom = cutoff.toISOString().slice(0, 7);
    ledger[user.id] = Object.fromEntries(Object.entries(slots).filter(([m]) => m >= keepFrom || m === month));
    return { ok: true, counted: true, cap, used: slot.n, month };
  }

  async function handle(route, req, res) {
    if (route !== "/api/sync/state" && route !== "/api/sync/push") return false;
    const user = currentUser(req); if (!user) return send(res, 401, { error: "Authentication required.", code: "UNAUTHENTICATED" }), true;
    const gate = limitHit("sync:user", user.id, 300, 600000); if (!gate.ok) return tooMany(res, gate, req, "sync"), true;
    const journal = readJournal();

    if (route === "/api/sync/state" && req.method === "GET") {
      const since = Math.max(0, Math.floor(Number(new URL(req.url, "http://localhost").searchParams.get("since")) || 0));
      const all = mine(journal, user.id).filter(r => r.seq > since).sort((a, b) => a.seq - b.seq);
      const page = all.slice(0, MAX_PAGE);
      const seq = journal[metaKey(user.id)]?.n || 0;
      const more = all.length > page.length;
      // Les numéros d'ordre sont des horodatages monotones (ms). Deux instances serverless peuvent valider quasi simultanément : sans
      // recouvrement, un enregistrement validé un peu plus tard avec un numéro plus ancien serait manqué. Le client relit donc une fenêtre
      // de 2 minutes (les enregistrements sont idempotents : kind + id + version).
      const cursor = more ? page[page.length - 1].seq : Math.max(since, seq - OVERLAP_MS);
      return send(res, 200, { seq, cursor, more, records: page.map(view) }), true;
    }

    if (route === "/api/sync/push" && req.method === "POST") {
      if (String(req.headers["x-tm-mode"] || "").toLowerCase() === "demo") return send(res, 409, { error: "Demo mode: nothing is sent to the account.", code: "DEMO_MODE" }), true;
      const input = await body(req); const changes = Array.isArray(input.changes) ? input.changes : null;
      if (!changes || !changes.length || changes.length > MAX_BATCH) return send(res, 400, { error: `Send 1–${MAX_BATCH} changes.`, code: "INVALID_BATCH" }), true;
      const ledger = readLedger(); let ledgerTouched = false;
      const meta = journal[metaKey(user.id)] || { userId: user.id, kind: "meta", id: "seq", n: 0 };
      const live = kind => mine(journal, user.id).filter(r => r.kind === kind && !r.deleted).length;
      const results = [];
      for (const change of changes) {
        const kind = change?.kind, id = typeof change?.id === "string" ? change.id : "";
        const res0 = { kind, id };
        if (!KINDS.has(kind) || (kind === "settings" ? id !== "main" : !ID_RE.test(id))) { results.push({ ...res0, status: "invalid", code: "INVALID_RECORD" }); continue; }
        const baseVersion = Number.isInteger(change.baseVersion) && change.baseVersion >= 0 ? change.baseVersion : null;
        if (baseVersion === null) { results.push({ ...res0, status: "invalid", code: "INVALID_BASE_VERSION" }); continue; }
        const key = keyOf(user.id, kind, id); const existing = journal[key];
        const exists = Boolean(existing);
        let data = null;
        if (change.deleted === true) {
          if (kind === "settings") { results.push({ ...res0, status: "invalid", code: "SETTINGS_NOT_DELETABLE" }); continue; }
        } else {
          if (looksDemo(change.data) || looksDemo({ id })) { results.push({ ...res0, status: "invalid", code: "DEMO_REJECTED" }); continue; }
          data = kind === "trade" ? cleanTrade(change.data, id) : kind === "plan" ? cleanPlan(change.data) : cleanSettings(change.data);
          if (!data) { results.push({ ...res0, status: "invalid", code: "INVALID_DATA" }); continue; }
        }
        const currentV = exists ? existing.v : 0;
        if (baseVersion !== currentV) {
          // Rejeu idempotent : mêmes données déjà en place -> succès sans nouvelle version.
          if (exists && change.deleted !== true && !existing.deleted && JSON.stringify(existing.data) === JSON.stringify(data)) { results.push({ ...res0, status: "ok", v: existing.v, seq: existing.seq, duplicate: true }); continue; }
          if (exists && change.deleted === true && existing.deleted) { results.push({ ...res0, status: "ok", v: existing.v, seq: existing.seq, duplicate: true }); continue; }
          results.push({ ...res0, status: "conflict", server: exists ? view(existing) : null }); continue;
        }
        if (change.deleted !== true) {
          if (kind === "trade" && (!exists || existing.deleted)) {
            if (live("trade") >= MAX_TRADES) { results.push({ ...res0, status: "limit", code: "STORAGE_LIMIT" }); continue; }
            const q = consumeQuota(user, id, data.date, ledger);
            if (!q.ok) { recordAudit({ req, user, event: "trade_limit_reached", result: "DENIED", context: `sync ${q.used}/${q.cap}` }); results.push({ ...res0, status: "limit", code: "TRADE_LIMIT_REACHED", limit: q.cap, used: q.used, month: q.month }); continue; }
            if (q.counted) ledgerTouched = true;
          }
          if (kind === "plan" && (!exists || existing.deleted) && live("plan") >= MAX_PLANS) { results.push({ ...res0, status: "limit", code: "STORAGE_LIMIT" }); continue; }
        }
        meta.n = Math.max(meta.n + 1, Date.now()); const now = new Date().toISOString();
        const record = { userId: user.id, kind, id, v: currentV + 1, seq: meta.n, updatedAt: now, deleted: change.deleted === true, data };
        journal[key] = record;
        results.push({ ...res0, status: "ok", v: record.v, seq: record.seq });
      }
      journal[metaKey(user.id)] = meta;
      writeJournal(journal); if (ledgerTouched) writeLedger(ledger);
      const rejectedDemo = results.filter(r => r.code === "DEMO_REJECTED").length;
      if (rejectedDemo) recordAudit({ req, user, event: "sync_demo_rejected", result: "DENIED", context: `n=${rejectedDemo}` });
      return send(res, 200, { seq: meta.n, results }), true;
    }
    return send(res, 405, { error: "Method not allowed." }), true;
  }
  return { handle };
}
