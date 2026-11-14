// DAN avec n'importe quelle API d'IA : détection du format, adresse de base, modèle automatique, relais.
import { detectStyle, normalizeCustomUrl, providerChain, callProvider } from "../server/dan.mjs";
let pass = 0, fail = 0;
const ok = (name, cond) => { console.log(cond ? "  PASS " : "  FAIL ", name); cond ? pass++ : fail++; };

ok("format : api.anthropic.com -> anthropic", detectStyle("https://api.anthropic.com/v1/messages") === "anthropic");
ok("format : generativelanguage.googleapis.com -> gemini", detectStyle("https://generativelanguage.googleapis.com/v1beta/models") === "gemini");
ok("format : tout autre service -> compatible OpenAI", detectStyle("https://api.exemple.com/v1") === "openai");
ok("adresse de base OpenAI complétée", normalizeCustomUrl("https://api.exemple.com/v1") === "https://api.exemple.com/v1/chat/completions");
ok("adresse sans /v1 complétée", normalizeCustomUrl("https://api.exemple.com") === "https://api.exemple.com/chat/completions");
ok("adresse complète conservée", normalizeCustomUrl("https://api.exemple.com/v1/chat/completions") === "https://api.exemple.com/v1/chat/completions");
ok("Claude : adresse de base complétée", normalizeCustomUrl("https://api.anthropic.com") === "https://api.anthropic.com/v1/messages");
ok("Gemini : adresse de base complétée", normalizeCustomUrl("https://generativelanguage.googleapis.com") === "https://generativelanguage.googleapis.com/v1beta/models");
ok("machine locale refusée par défaut", normalizeCustomUrl("http://localhost:11434/v1") === null);
ok("machine locale acceptée seulement avec DAN_ALLOW_PRIVATE_URL=1", normalizeCustomUrl("http://localhost:11434/v1", { DAN_ALLOW_PRIVATE_URL: "1" }) === "http://localhost:11434/v1/chat/completions");
ok("adresse non https refusée", normalizeCustomUrl("http://api.exemple.com/v1") === null);

const chain = providerChain({ DAN_API_URL: "https://api.exemple.com/v1", DAN_API_KEY: "cle-de-test-12345678" });
ok("variables universelles DAN_API_URL / DAN_API_KEY reconnues", chain.length === 1 && chain[0].provider === "custom" && chain[0].models[0] === "auto");
const chainLocal = providerChain({ DAN_API_URL: "http://localhost:11434/v1", DAN_ALLOW_PRIVATE_URL: "1" });
ok("Ollama local : utilisable sans clé", chainLocal.length === 1 && chainLocal[0].provider === "custom");
const many = providerChain({ TOGETHER_API_KEY: "a".repeat(30), CEREBRAS_API_KEY: "csk-" + "a".repeat(20), PERPLEXITY_API_KEY: "pplx-" + "a".repeat(20), FIREWORKS_API_KEY: "a".repeat(30), COHERE_API_KEY: "a".repeat(30) });
ok("5 fournisseurs de plus reconnus", many.length === 5);

// Faux serveurs : on remplace fetch pour vérifier le format réellement envoyé.
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const u = String(url);
  if (u.endsWith("/models") && !init.method) return new Response(JSON.stringify({ data: [{ id: "text-embedding-3" }, { id: "modele-chat-1" }] }), { status: 200 });
  if (u.includes("/v1/messages")) return new Response(JSON.stringify({ content: [{ type: "text", text: "réponse claude" }] }), { status: 200 });
  if (u.includes(":generateContent")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "réponse gemini" }] } }] }), { status: 200 });
  return new Response(JSON.stringify({ choices: [{ message: { content: "réponse openai" } }] }), { status: 200 });
};
try {
  const run = async env => callProvider(providerChain(env), "système", [], "bonjour", env);
  let out = await run({ CUSTOM_AI_URL: "https://api.exemple.com/v1", CUSTOM_AI_KEY: "cle-de-test-12345678" });
  ok("service OpenAI inconnu : répond, modèle choisi automatiquement (hors embeddings)", out.reply === "réponse openai" && JSON.parse(calls.at(-1).init.body).model === "modele-chat-1");
  calls.length = 0;
  out = await run({ CUSTOM_AI_URL: "https://api.anthropic.com", CUSTOM_AI_KEY: "cle-de-test-12345678", CUSTOM_AI_MODEL: "claude-test" });
  ok("adresse Claude : format Messages utilisé", out.reply === "réponse claude" && calls.some(c => c.url === "https://api.anthropic.com/v1/messages" && c.init.headers["x-api-key"]));
  calls.length = 0;
  out = await run({ CUSTOM_AI_URL: "https://generativelanguage.googleapis.com", CUSTOM_AI_KEY: "cle-de-test-12345678", CUSTOM_AI_MODEL: "gemini-test" });
  ok("adresse Gemini : format generateContent utilisé", out.reply === "réponse gemini" && calls.some(c => c.url.includes("/v1beta/models/gemini-test:generateContent")));
} finally { globalThis.fetch = realFetch; }

console.log(`RÉSULTAT: ${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
