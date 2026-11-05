// Tests de la conversation DAN avec de faux fournisseurs (réseau simulé : aucune clé réelle n'est utilisée ici).
import assert from "node:assert/strict";
import { createDan, storedKeys, providerChain, callProvider, cleanKey, normalizeHistory, diagnose } from "../server/dan.mjs";
let pass = 0, fail = 0; const t = async (n, f) => { try { await f(); pass++; console.log("  PASS ", n); } catch (e) { fail++; console.log("  FAIL ", n, "\n        ", e.message); } };
const real = globalThis.fetch; const calls = [];
const GOOD = "AIzaGoodKey1234567890abcdef";
// Faux Gemini : n'accepte que la bonne clé SANS guillemets ni espaces, et exige un historique alterné qui commence par « user ».
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), h = init.headers || {}; calls.push({ u, h, body: init.body });
  const reply = (status, json) => new Response(JSON.stringify(json), { status });
  if (u.includes("generativelanguage")) {
    if (h["x-goog-api-key"] !== GOOD) return reply(400, { error: { message: "API key not valid. Please pass a valid API key." } });
    const b = JSON.parse(init.body); const roles = b.contents.map(c => c.role);
    if (roles[0] !== "user" || roles.some((r, i) => i && r === roles[i - 1])) return reply(400, { error: { message: "Please ensure that multiturn requests alternate between user and model." } });
    const last = b.contents.at(-1).parts[0].text; const prev = b.contents.length > 1 ? " (suite de : " + b.contents[b.contents.length - 2].parts[0].text.slice(0, 20) + ")" : "";
    return reply(200, { candidates: [{ content: { parts: [{ text: /salut/i.test(last) ? "Bonjour ! Comment puis-je t'aider ?" : "Réponse à : " + last + prev }] } }] });
  }
  if (u.includes("openrouter")) return h.authorization === "Bearer sk-or-v1-goodgoodgoodgood" ? reply(200, { choices: [{ message: { content: "via openrouter" } }] }) : reply(401, { error: { message: "No auth credentials found" } });
  if (u.includes("openai")) return reply(401, { error: { message: "Incorrect API key provided" } });
  return reply(404, {});
};
const chat = async (env, message, history = []) => (await callProvider(providerChain(env), "sys", normalizeHistory(history), message, env));

await t("cleanKey : guillemets, espaces, retour à la ligne, « NOM=valeur », « Bearer »", () => { assert.equal(cleanKey('"AIzaX1"'), "AIzaX1"); assert.equal(cleanKey("  AIza X1\n"), "AIzaX1"); assert.equal(cleanKey("GEMINI_API_KEY=AIzaX1"), "AIzaX1"); assert.equal(cleanKey("Bearer sk-abc"), "sk-abc"); });
await t("clé Netlify collée avec guillemets : Gemini répond quand même (cause probable du 400/401)", async () => { const r = await chat({ GEMINI_API_KEY: `"${GOOD}"\n` }, "Salut"); assert.equal(r.reply, "Bonjour ! Comment puis-je t'aider ?"); assert.equal(r.provider, "gemini"); });
await t("conversation : « Comment vas-tu ? » puis question de suivi avec contexte", async () => { const env = { GEMINI_API_KEY: GOOD }; const a = await chat(env, "Comment vas-tu ?"); assert.match(a.reply, /Comment vas-tu/); const b = await chat(env, "Et pourquoi ?", [{ role: "user", content: "Comment vas-tu ?" }, { role: "assistant", content: a.reply }]); assert.match(b.reply, /suite de : Réponse à : Comment/); });
await t("explication de l'app / résumé : réponses réelles du fournisseur", async () => { const env = { GEMINI_API_KEY: GOOD }; assert.match((await chat(env, "Explique-moi le fonctionnement de mon application")).reply, /fonctionnement/); assert.match((await chat(env, "Fais-moi un résumé")).reply, /résumé/); });
await t("historique invalide (commence par assistant, doublons) : normalisé, plus de 400", async () => { const r = await chat({ GEMINI_API_KEY: GOOD }, "Salut", [{ role: "assistant", content: "Hello" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "c" }]); assert.ok(r.reply, JSON.stringify(r.tried)); });
await t("relais : Gemini refusé (clé fausse) -> OpenRouter répond ; l'erreur réelle reste tracée", async () => { const r = await chat({ GEMINI_API_KEY: "AIzaBAD", OPENROUTER_API_KEY: "sk-or-v1-goodgoodgoodgood" }, "Salut"); assert.equal(r.provider, "openrouter"); assert.ok(r.tried.some(x => /^gemini:400 clé invalide/.test(x)), r.tried.join()); });
await t("aucun fournisseur valide : pas de fausse réponse, cause lisible par fournisseur, pas de boucle", async () => { calls.length = 0; const r = await chat({ GEMINI_API_KEY: "AIzaBAD", OPENROUTER_API_KEY: "x", OPENAI_API_KEY: "sk-bad" }, "Salut"); assert.ok(!r.reply); assert.ok(r.tried.length <= 5, r.tried.join()); assert.match(r.tried.join(), /openai:401 clé invalide/); assert.ok(calls.length <= 5); });
await t("diagnostic : chaque fournisseur testé séparément, secrets jamais renvoyés", async () => { const env = { GEMINI_API_KEY: `'${GOOD}'`, OPENROUTER_API_KEY: "sk-or-v1-wrong", OPENAI_API_KEY: "sk-bad" }; const d = await diagnose(env); const by = Object.fromEntries(d.map(x => [x.provider, x])); assert.equal(by.gemini.result, "CONNECTED"); assert.equal(by.gemini.key.hadQuotesOrSpaces, true); assert.equal(by.openrouter.result, "AUTH_REFUSED"); assert.equal(by.openai.result, "AUTH_REFUSED"); assert.equal(by.groq.result, "NOT_CONFIGURED"); assert.ok(typeof by.gemini.latencyMs === "number"); const dump = JSON.stringify(d); assert.ok(!dump.includes(GOOD) && !dump.includes("sk-bad") && !dump.includes("goodgood")); });
await t("Gemini 429 sur un modèle : DAN essaie le modèle suivant au lieu d'abandonner", async () => { const saved = globalThis.fetch; let n = 0; globalThis.fetch = async (u) => ++n === 1 ? new Response(JSON.stringify({ error: { message: "You exceeded your current quota" } }), { status: 429 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Bonjour !" }] } }] }), { status: 200 }); const r = await callProvider(providerChain({ GEMINI_API_KEY: GOOD }), "s", [], "Salut", {}); globalThis.fetch = saved; assert.equal(r.reply, "Bonjour !"); assert.ok(r.tried[0].startsWith("gemini:429")); });
await t("Owner : clé collée -> chiffrée au repos, jamais renvoyée, testée pour de vrai, puis DAN répond avec elle", async () => {
  process.env.OWNER_SETUP_TOKEN = "t".repeat(40); delete process.env.GEMINI_API_KEY; let cfg = {}; const out = []; const saved = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => String(u).includes("api.groq.com") && init.headers.authorization === "Bearer gsk_owner_good_key" ? new Response(JSON.stringify({ choices: [{ message: { content: "Bonjour ! Comment puis-je t'aider ?" } }] })) : new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
  const send = (res, code, json) => out.push({ code, json });
  const h = { send, body: async req => req.body, currentUser: () => ({ id: "u1", firstName: "D" }), effectiveMembership: () => ({ plan: "ELITE" }), recordAudit() {}, limitHit: () => ({ ok: true }), tooMany() {}, ownerRequired: () => ({ id: "o" }), readConfig: () => cfg, writeConfig: c => { cfg = c; } };
  const dan = createDan(h);
  await dan.handle("/api/owner/dan-keys", { method: "POST", body: { provider: "groq", key: ' "gsk_owner_good_key"\n' } }, {});
  assert.equal(out.at(-1).code, 200); assert.equal(out.at(-1).json.result.result, "CONNECTED"); assert.ok(!JSON.stringify(out.at(-1).json).includes("gsk_owner"));
  assert.ok(!JSON.stringify(cfg).includes("gsk_owner"), "stocké en clair !"); assert.equal(storedKeys(() => cfg).GROQ_API_KEY, "gsk_owner_good_key");
  await dan.handle("/api/dan/chat", { method: "POST", body: { message: "Salut", lang: "fr" } }, {});
  assert.equal(out.at(-1).code, 200); assert.match(out.at(-1).json.reply, /Comment puis-je/); assert.equal(out.at(-1).json.provider, "groq");
  await dan.handle("/api/owner/dan-keys", { method: "POST", body: { provider: "groq", key: "gsk_wrong_wrong" } }, {});
  assert.equal(out.at(-1).json.result.result, "AUTH_REFUSED");
  await dan.handle("/api/owner/dan-keys", { method: "POST", body: { provider: "groq", remove: true } }, {}); assert.deepEqual(storedKeys(() => cfg), {});
  globalThis.fetch = saved; });
globalThis.fetch = real;
console.log(`RÉSULTAT: ${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
