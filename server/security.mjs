// Primitives de sécurité partagées (aucun secret ici).
// - e-mail : normalisation unique ; mots de passe : scrypt (module crypto de Node, algorithme éprouvé) ;
// - CSRF : contrôle Origin / Fetch-Metadata ; en-têtes de sécurité ; cookies.
import crypto from "node:crypto";

export const sha256 = value => crypto.createHash("sha256").update(String(value)).digest("hex");

// ---------- E-mail ----------
// Règle unique : NFKC (formes pleine chasse, compatibilité), trim, minuscules. Les alias « +tag » et les points Gmail
// restent des adresses distinctes (on ne devine pas les règles propres à un fournisseur).
export const normalizeEmail = raw => (typeof raw === "string" ? raw.normalize("NFKC").trim().toLowerCase() : "");
export const validEmail = email => typeof email === "string" && email.length <= 254 && /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(email) && !/[\u0000-\u001f\u007f]/.test(email);
export const EMAIL_EXISTS = { fr: "Cette adresse email est déjà associée à un compte. Connectez-vous ou utilisez « Mot de passe oublié ».", en: "This email address is already associated with an account. Sign in or use “Forgot password”." };

// ---------- Mots de passe ----------
// scrypt N=2^16, r=8, p=1 (64 Mo) : au-dessus du minimum OWASP (N=2^15). « kdf » versionne les paramètres pour migrer sans casser les comptes existants.
const KDF_CURRENT = "scrypt-n16";
const KDF_PARAMS = { N: 65536, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const PASSWORD_MAX = 256;
export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, digest: crypto.scryptSync(String(password), salt, 64, KDF_PARAMS).toString("hex"), kdf: KDF_CURRENT };
}
const equalHex = (left, right) => { if (typeof left !== "string" || typeof right !== "string" || !left || left.length !== right.length || left.length % 2) return false; try { return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex")); } catch { return false; } };
// Hash historique (avant cette version) : scrypt avec les paramètres par défaut de Node (N=16384). Vérifié puis migré à la connexion.
export function checkPassword(password, user) {
  if (!user || typeof user.salt !== "string" || typeof user.digest !== "string" || typeof password !== "string" || password.length > PASSWORD_MAX) return { ok: false };
  try {
    if (user.kdf === KDF_CURRENT) return { ok: equalHex(crypto.scryptSync(password, user.salt, 64, KDF_PARAMS).toString("hex"), user.digest), upgrade: false };
    return { ok: equalHex(crypto.scryptSync(password, user.salt, 64).toString("hex"), user.digest), upgrade: true };
  } catch { return { ok: false }; }
}
// Vérification factice pour que « compte inexistant » et « mauvais mot de passe » coûtent le même temps.
const DUMMY = hashPassword("tm-dummy-password-for-timing");
export const dummyVerify = password => { checkPassword(String(password ?? "").slice(0, PASSWORD_MAX), DUMMY); };
const WEAK = new Set(["12345678", "123456789", "1234567890", "password", "password1", "password123", "azerty123", "azertyuiop", "qwertyuiop", "qwerty123", "motdepasse", "11111111", "00000000", "iloveyou", "trademind", "trademind1", "trademind123", "azerty12", "abcdefgh"]);
export const passwordProblem = (password, { min = 8, email = "" } = {}) => {
  if (typeof password !== "string" || password.length < min) return { code: "PASSWORD_TOO_SHORT", min };
  if (password.length > PASSWORD_MAX) return { code: "PASSWORD_TOO_LONG", max: PASSWORD_MAX };
  if (WEAK.has(password.toLowerCase()) || (email && password.toLowerCase() === email)) return { code: "PASSWORD_TOO_WEAK" };
  return null;
};

// ---------- Jetons à usage unique (récupération de compte) ----------
export const newToken = () => crypto.randomBytes(32).toString("base64url"); // 256 bits
export const tokenKey = token => sha256(`reset:${token}`); // seul le hash est stocké

// ---------- Cookies ----------
export const cookie = (name, value, { maxAge, httpOnly = true, secure = false, sameSite = "Lax" } = {}) => `${name}=${value}; ${httpOnly ? "HttpOnly; " : ""}SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
export const isSecureRequest = req => Boolean(process.env.NETLIFY_FUNCTION || process.env.TM_COOKIE_SECURE === "1" || String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https");

// ---------- CSRF ----------
// Les cookies de session sont SameSite=Lax ; en plus, toute requête qui modifie l'état doit être « same-origin » :
// en-tête Origin comparé à l'hôte, ou Sec-Fetch-Site, et corps JSON obligatoire (voir body()). Les webhooks (sans cookie, signés) sont exclus par l'appelant.
export const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export function csrfViolation(req) {
  const h = req.headers || {};
  // Sec-Fetch-Site est posé par le navigateur et ne peut pas être forgé par le JavaScript d'une page : c'est le signal le plus fiable.
  const site = typeof h["sec-fetch-site"] === "string" ? h["sec-fetch-site"].toLowerCase() : "";
  if (site) return site === "same-origin" || site === "none" ? null : "FETCH_SITE_MISMATCH";
  const origin = typeof h.origin === "string" ? h.origin.trim().toLowerCase() : "";
  if (!origin) return null; // client non navigateur (curl, serveur) : pas de CSRF possible sans navigateur ; le cookie SameSite=Lax couvre les anciens navigateurs
  const host = String(h["x-forwarded-host"] || h.host || "").split(",")[0].trim().toLowerCase();
  const allowed = new Set();
  if (host) { allowed.add(`https://${host}`); allowed.add(`http://${host}`); }
  for (const base of [process.env.PUBLIC_BASE_URL, process.env.URL]) { try { if (base) allowed.add(new URL(base).origin.toLowerCase()); } catch {} }
  return allowed.has(origin) ? null : "ORIGIN_MISMATCH";
}

// ---------- En-têtes de sécurité ----------
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");
export const SECURITY_HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "strict-transport-security": "max-age=31536000"
};
export const API_SECURITY_HEADERS = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "strict-transport-security": "max-age=31536000" };
