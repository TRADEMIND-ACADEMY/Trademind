// Paiement crypto automatique via NOWPayments (USDT / BTC ...).
// Aucun secret ici : NOWPAYMENTS_API_KEY et NOWPAYMENTS_IPN_SECRET viennent des variables d'environnement serveur.
// Bac à sable : NOWPAYMENTS_SANDBOX=1 (https://api-sandbox.nowpayments.io) avec les clés du compte de test.
// NB : non vérifié contre le vrai service depuis l'environnement de développement ; voir FINAL-RELEASE-REPORT.md.
import crypto from "node:crypto";

export const configured = () => Boolean(process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET);
export const sandbox = () => process.env.NOWPAYMENTS_SANDBOX === "1";
const base = () => (process.env.NOWPAYMENTS_API_URL || (sandbox() ? "https://api-sandbox.nowpayments.io/v1" : "https://api.nowpayments.io/v1")).replace(/\/+$/, "");

// Signature des notifications (IPN) : HMAC-SHA512 du JSON trié alphabétiquement (récursif), clé = secret IPN.
const sortKeys = value => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === "object" ? Object.keys(value).sort().reduce((acc, key) => { acc[key] = sortKeys(value[key]); return acc; }, {}) : value;
export function verifyIpn(raw, signature) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || typeof signature !== "string" || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  let parsed; try { parsed = JSON.parse(raw); } catch { return false; }
  const expected = crypto.createHmac("sha512", secret).update(JSON.stringify(sortKeys(parsed))).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.toLowerCase(), "hex"));
}

const call = async (path, options = {}, timeoutMs = 8000) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base()}${path}`, { ...options, signal: controller.signal, headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY, "content-type": "application/json" } });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } finally { clearTimeout(timer); }
};

export async function createInvoice({ order, description, ipnUrl, successUrl, cancelUrl }) {
  const { ok, status, data } = await call("/invoice", { method: "POST", body: JSON.stringify({ price_amount: Number(order.amount), price_currency: "usd", order_id: order.id, order_description: description, ipn_callback_url: ipnUrl, success_url: successUrl, cancel_url: cancelUrl }) });
  if (!ok || typeof data?.invoice_url !== "string" || !/^https:\/\//.test(data.invoice_url)) return { ok: false, status };
  return { ok: true, invoiceId: String(data.id ?? ""), invoiceUrl: data.invoice_url };
}

// Revérification côté serveur auprès de NOWPayments (on ne se fie pas uniquement au contenu de la notification).
export async function getPayment(paymentId) {
  if (!/^[0-9]{1,24}$/.test(String(paymentId))) return { ok: false, status: 0 };
  const { ok, status, data } = await call(`/payment/${paymentId}`, { method: "GET" });
  return ok ? { ok: true, payment: data } : { ok: false, status };
}
