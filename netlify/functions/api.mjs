import { getStore } from "@netlify/blobs";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";

process.env.NETLIFY_FUNCTION = "1";
process.env.TM_DATA_DIR = process.env.TM_DATA_DIR || "/tmp/trademind-data";

// Charge l'API à la demande (pas de top-level await) : compatible bundle "cjs" et "esm".
// Les variables d'environnement ci-dessus sont posées avant l'évaluation de server/app.mjs.
let apiPromise;
const loadApi = () => (apiPromise ??= import("../../server/app.mjs").then(mod => mod.api));

const localDir = process.env.TM_BLOBS_LOCAL_DIR || "";
let remoteStore = null;
const baseKeys = ["users", "sessions", "audit", "orders", "notifications", "config", "limits", "resets", "ledger"];
// Le journal (trades, plans, réglages synchronisés) n'est chargé que pour les routes qui l'utilisent.
let keys = baseKeys;
const needsJournal = pathname => /^\/(\.netlify\/functions\/api)?\/?(api\/)?(sync(\/|$)|account\/delete$)/.test(pathname);
const localPath = key => path.join(localDir, `${key}.json`);

const getValue = async key => {
  if (localDir) {
    try { return JSON.parse(await fs.readFile(localPath(key), "utf8")); } catch { return null; }
  }
  try { return await remoteStore.get(key, { type: "json" }); }
  catch (error) {
    // Si l'environnement Blobs n'offre pas la lecture "strong" (uncachedEdgeURL absent), on dégrade en "eventual" plutôt que de planter.
    if (error?.name !== "BlobsConsistencyError") throw error;
    console.warn("[blobs] strong consistency unavailable, falling back to eventual read");
    return remoteStore.get(key, { type: "json", consistency: "eventual" });
  }
};
const setValue = async (key, value) => {
  if (localDir) { await fs.mkdir(localDir, { recursive: true }); const tmp = `${localPath(key)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`; await fs.writeFile(tmp, JSON.stringify(value) + "\n", { mode: 0o600 }); await fs.rename(tmp, localPath(key)); return; }
  await remoteStore.setJSON(key, value);
};

// Instantané des données lues au début de la requête : sert à ne réécrire que ce que CETTE requête a modifié.
let baseline = {};
const emptyFor = key => (key === "audit" || key === "notifications" ? [] : {});

async function hydrate() {
  await fs.mkdir(process.env.TM_DATA_DIR, { recursive: true });
  baseline = {};
  for (const key of keys) {
    const value = (await getValue(key)) ?? emptyFor(key);
    baseline[key] = value;
    await fs.writeFile(`${process.env.TM_DATA_DIR}/${key}.json`, JSON.stringify(value) + "\n", { mode: 0o600 });
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fusionne uniquement les changements de cette requête (ajouts / modifications / suppressions) dans la version la plus récente du store,
// au lieu d'écraser le store avec une copie lue au début de la requête (évite de perdre l'écriture d'une requête concurrente).
function mergeChanges(key, base, after, fresh) {
  if (key === "audit" || key === "notifications") {
    const seen = new Set((Array.isArray(base) ? base : []).map(item => JSON.stringify(item)));
    const added = (Array.isArray(after) ? after : []).filter(item => !seen.has(JSON.stringify(item)));
    const merged = Array.isArray(fresh) ? fresh.slice() : [];
    const have = new Set(merged.map(item => JSON.stringify(item)));
    for (const item of added) if (!have.has(JSON.stringify(item))) merged.push(item);
    return merged;
  }
  const merged = fresh && typeof fresh === "object" && !Array.isArray(fresh) ? { ...fresh } : {};
  for (const id of Object.keys(after)) if (!(id in base) || !same(after[id], base[id])) merged[id] = after[id];
  for (const id of Object.keys(base)) if (!(id in after)) delete merged[id];
  return merged;
}

// Vérifie que le contenu relu contient bien les changements de cette requête.
function containsChanges(key, base, after, current) {
  if (key === "audit" || key === "notifications") { const have = new Set((current || []).map(item => JSON.stringify(item))); const seen = new Set((base || []).map(item => JSON.stringify(item))); return (after || []).every(item => seen.has(JSON.stringify(item)) || have.has(JSON.stringify(item))); }
  const cur = current && typeof current === "object" ? current : {};
  const loser = id => key === "users" && after[id]?.email && Object.values(cur).some(other => other && other.id !== id && other.email === after[id].email && olderThan(other, after[id]));
  for (const id of Object.keys(after)) if ((!(id in base) || !same(after[id], base[id])) && !same(cur[id], after[id]) && !loser(id)) return false;
  for (const id of Object.keys(base)) if (!(id in after) && id in cur) return false;
  return true;
}
// Deux inscriptions simultanées avec le même e-mail (double clic, deux instances) : on garde le compte le plus ancien (égalité : id le plus petit).
const olderThan = (a, b) => (a.createdAt || "") < (b.createdAt || "") || ((a.createdAt || "") === (b.createdAt || "") && a.id < b.id);
function dedupeUsers(users) {
  const byEmail = new Map(); const drop = new Set();
  for (const user of Object.values(users)) { if (!user?.email) continue; const other = byEmail.get(user.email); if (!other) { byEmail.set(user.email, user); continue; } if (olderThan(user, other)) { drop.add(other.id); byEmail.set(user.email, user); } else drop.add(user.id); }
  if (!drop.size) return users; const next = { ...users }; for (const id of drop) delete next[id]; return next;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function persist() {
  for (const key of keys) {
    const after = JSON.parse(await fs.readFile(`${process.env.TM_DATA_DIR}/${key}.json`, "utf8"));
    const base = baseline[key] ?? emptyFor(key);
    if (same(after, base)) continue; // rien changé par cette requête : aucune écriture (ne pas écraser les autres requêtes)
    // Fusion + relectures de contrôle. Une requête concurrente peut écraser notre écriture APRÈS notre première vérification :
    // on exige donc deux relectures consécutives (espacées) qui contiennent nos changements, sinon on les réapplique.
    let verified = 0; // relectures consécutives qui contiennent bien nos changements
    for (let attempt = 0; attempt < 8 && verified < 2; attempt += 1) {
      if (attempt > 0) await sleep(90 + Math.floor(Math.random() * 110));
      const current = (await getValue(key)) ?? emptyFor(key);
      if (attempt > 0 && containsChanges(key, base, after, current)) { verified += 1; continue; }
      // première écriture, ou une relecture a constaté que nos changements ont été écrasés : fusion dans la version la plus récente.
      const merged = mergeChanges(key, base, after, current); await setValue(key, key === "users" ? dedupeUsers(merged) : merged);
      verified = containsChanges(key, base, after, await getValue(key)) ? 1 : 0;
    }
  }
}

function requestFor(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  const body = event.httpMethod === "GET" || event.httpMethod === "HEAD" ? "" : (event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "");
  const req = Readable.from(body ? [body] : []);
  req.method = event.httpMethod || "GET";
  const rawPath = event.path || "/api";
  const normalizedPath = rawPath.replace(/^\/\.netlify\/functions\/api/, "") || "/";
  req.url = `${normalizedPath.startsWith("/api/") || normalizedPath === "/api" ? normalizedPath : `/api${normalizedPath}`}${event.rawQuery ? `?${event.rawQuery}` : ""}`;
  req.headers = headers;
  req.socket = { remoteAddress: String(headers["x-nf-client-connection-ip"] || String(headers["x-forwarded-for"] || "").split(",")[0] || "netlify").trim() };
  return req;
}

function responseFor() {
  let statusCode = 200;
  const headers = {};
  const chunks = [];
  return {
    writeHead(status, nextHeaders = {}) { statusCode = status; Object.assign(headers, nextHeaders); return this; },
    end(chunk = "") { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); this.done = true; },
    get result() { return { statusCode, headers, body: Buffer.concat(chunks).toString("utf8") }; }
  };
}

// Netlify Function moderne (Request -> Response) : Netlify configure Blobs automatiquement (pas de connectLambda).
// Le redirect /api/* -> /.netlify/functions/api/:splat (netlify.toml) reste inchangé.
// Contraintes d'unicité atomiques : création exclusive via Netlify Blobs (option onlyIfNew, selon la version de @netlify/blobs).
// Si la version installée ne la supporte pas, setJSON renvoie undefined : « non supporté » -> l'API retombe sur le marqueur local + dédoublonnage à l'écriture.
const installClaims = () => {
  if (localDir) { globalThis.__tmClaims = null; return; }
  globalThis.__tmClaims = {
    async claim(key, value) { try { const result = await remoteStore.setJSON(`claims/${key}`, value, { onlyIfNew: true }); return result && typeof result.modified === "boolean" ? result.modified : undefined; } catch (error) { console.warn("[claims] atomic claim unavailable:", error?.name || "error"); return undefined; } },
    async read(key) { try { return await remoteStore.get(`claims/${key}`, { type: "json", consistency: "eventual" }); } catch { return null; } },
    async release(key) { try { await remoteStore.delete(`claims/${key}`); } catch {} }
  };
};

export default async function handler(request) {
  const api = await loadApi();
  if (!localDir) remoteStore = getStore({ name: process.env.TM_BLOBS_STORE || "trademind-data", consistency: "strong" });
  installClaims();
  const url = new URL(request.url);
  keys = needsJournal(url.pathname) ? [...baseKeys, "journal"] : baseKeys;
  await hydrate();
  const method = request.method || "GET";
  const body = method === "GET" || method === "HEAD" ? "" : await request.text();
  const req = requestFor({ httpMethod: method, path: url.pathname, rawQuery: url.search.slice(1), headers: Object.fromEntries(request.headers), body, isBase64Encoded: false });
  const res = responseFor();
  await api(req, res);
  await persist();
  const result = res.result;
  const headers = new Headers();
  for (const [name, value] of Object.entries(result.headers)) {
    if (name.toLowerCase() === "content-length") continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, String(item));
  }
  const nullBody = [101, 204, 205, 304].includes(result.statusCode);
  return new Response(nullBody ? null : result.body, { status: result.statusCode, headers });
}
