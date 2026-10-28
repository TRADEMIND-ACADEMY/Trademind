// Émule le chemin Netlify Function (hydrate -> API -> persist) avec un dossier local à la place de Netlify Blobs.
// NE TESTE PAS le vrai service Netlify Blobs (aucun siteID/jeton). Un stub temporaire de @netlify/blobs n'est jamais livré.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-fn-"));
fs.mkdirSync(path.join(tmp, "netlify/functions"), { recursive: true }); fs.mkdirSync(path.join(tmp, "node_modules/@netlify/blobs"), { recursive: true });
fs.writeFileSync(path.join(tmp, "node_modules/@netlify/blobs/package.json"), '{"name":"@netlify/blobs","type":"module","main":"i.js"}');
fs.writeFileSync(path.join(tmp, "node_modules/@netlify/blobs/i.js"), 'export const getStore=()=>{throw new Error("stub: Blobs réel non utilisé")};');
fs.copyFileSync(path.join(root, "netlify/functions/api.mjs"), path.join(tmp, "netlify/functions/api.mjs"));
fs.symlinkSync(path.join(root, "server"), path.join(tmp, "server")); fs.symlinkSync(path.join(root, "products"), path.join(tmp, "products")); fs.symlinkSync(path.join(root, "public"), path.join(tmp, "public"));
process.env.TM_BLOBS_LOCAL_DIR = path.join(tmp, "blobs"); process.env.TM_DATA_DIR = path.join(tmp, "work"); process.env.TM_TRUST_XFF = "1";
const { default: handler } = await import(pathToFileURL(path.join(tmp, "netlify/functions/api.mjs")).href);
let pass = 0, fail = 0; const check = (n, ok, d = "") => { if (ok) { pass++; console.log("  PASS ", n); } else { fail++; console.log("  FAIL ", n, d); } };
const call = async (method, p, body, headers = {}) => { const r = await handler(new Request("https://site.test" + p, { method, headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers }, body: body ? JSON.stringify(body) : undefined })); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
try {
  const mob = { "x-tm-client": "mobile", origin: "https://localhost" };
  const pw = "Tr4de-Mind-Test-2026", email = `fn-${Date.now()}@example.com`;
  const reg = await call("POST", "/.netlify/functions/api/auth/register", { email, password: pw, confirmPassword: pw, firstName: "F", lastName: "N", country: "CD", acceptTerms: true }, mob);
  const token = reg.json?.token; check("Inscription mobile via la fonction : jeton Bearer émis", reg.status < 300 && !!token, JSON.stringify(reg));
  const A = { ...mob, authorization: `Bearer ${token}` };
  const id = "fn" + Date.now().toString(36);
  const push = await call("POST", "/.netlify/functions/api/sync/push", { changes: [{ kind: "trade", id, baseVersion: 0, data: { id, date: "2026-10-05", time: "09:30", symbol: "EURUSD", direction: "buy", session: "London", setup: "BOS", result: "win", notes: "", pnl: 10, risk: 1, size: 0.5 } }] }, A);
  check("Push d'un trade via la fonction accepté", push.json?.results?.[0]?.status === "ok", JSON.stringify(push));
  check("Journal écrit dans le stockage persistant (journal.json)", fs.existsSync(path.join(tmp, "blobs/journal.json")) && fs.readFileSync(path.join(tmp, "blobs/journal.json"), "utf8").includes(id));
  fs.rmSync(process.env.TM_DATA_DIR, { recursive: true, force: true }); // simule une nouvelle instance de fonction : /tmp vide
  const st = await call("GET", "/.netlify/functions/api/sync/state?since=0", null, A);
  check("Après redémarrage à froid, le trade est relu depuis le stockage persistant", st.json?.records?.some(r => r.id === id && r.kind === "trade"), JSON.stringify(st).slice(0, 200));
  const noauth = await call("GET", "/.netlify/functions/api/sync/state?since=0", null, mob); check("Sans jeton : 401", noauth.status === 401);
  const other = await call("POST", "/.netlify/functions/api/auth/login", { email, password: pw }, { "x-tm-client": "mobile", origin: "https://evil.example" }); check("Origine non autorisée : pas de jeton", !other.json?.token);
  const login = await call("POST", "/.netlify/functions/api/auth/login", { email, password: pw }, mob); check("Reconnexion après redémarrage : OK", !!login.json?.token);
  const d = await call("POST", "/.netlify/functions/api/sync/push", { changes: [{ kind: "trade", id, baseVersion: 1, deleted: true }] }, { ...mob, authorization: `Bearer ${login.json.token}` });
  check("Suppression propagée (tombstone) via la fonction", d.json?.results?.[0]?.status === "ok", JSON.stringify(d));
} catch (e) { fail++; console.log(e.stack); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\nRÉSULTAT: ${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
