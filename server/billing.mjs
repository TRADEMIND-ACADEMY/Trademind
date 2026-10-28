// Paiements, notifications Owner et initialisation unique de l'Owner.
// Aucun secret ici : les valeurs viennent uniquement de variables d'environnement serveur.
import crypto from "node:crypto";
import { PLANS, PAYMENT_METHODS, NOWPAYMENTS_METHOD } from "./payment-config.mjs";
import * as nowpayments from "./nowpayments.mjs";
import { normalizeEmail, validEmail, passwordProblem } from "./security.mjs";

const ORDER_TTL_MS = 24 * 3600 * 1000;
const SUBSCRIPTION_MS = 30 * 86400 * 1000;
const PAID = new Set(["PRO", "PRO MAX", "ELITE"]);
const IDENTITY_TO_CODE = { ASCEND: "PRO", APEX: "PRO MAX", SOVEREIGN: "ELITE" };
const PENDING_SET = new Set(["CREATED", "PENDING", "PAYMENT_DETECTED"]);
const CONFIRMED_SET = new Set(["CONFIRMED", "ACTIVATED"]);
const FAILED_SET = new Set(["FAILED", "EXPIRED", "CANCELLED"]);
const TX_RE = /^[A-Za-z0-9:_\-.]{6,128}$/;
const OWNER_PASSWORD_MIN = 12;

const ownerEmail = () => process.env.OWNER_NOTIFY_EMAIL || "mushagalusadan@gmail.com";
const emailConfigured = () => Boolean(process.env.EMAIL_PROVIDER_KEY && process.env.EMAIL_FROM);
const webhookConfigured = () => Boolean(process.env.PAYMENT_WEBHOOK_SECRET);
const money = value => Number(value).toFixed(2);
const sha = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const safeEqual = (a, b) => { const x = Buffer.from(sha(a)), y = Buffer.from(sha(b)); return crypto.timingSafeEqual(x, y); };
const orderIdNew = orders => { for (;;) { const id = `TM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; if (!orders[id]) return id; } };

export function createBilling(h) {
  const { roleFor, send, body, currentUser, ownerRequired, recordAudit, safeUser, effectiveMembership, normalizePlan, hash, verifyPassword, loginAllowed, clearLoginAttempts, authResponse,
    readUsers, writeUsers, readOrders, writeOrders, readNotes, writeNotes, readConfig, writeConfig, readSessions, writeSessions, ownerIds, clientIp, limitHit, tooMany, claimUnique } = h;

  const rawBody = req => new Promise((resolve, reject) => { const chunks = []; let size = 0; req.on("data", chunk => { size += chunk.length; if (size > 200000) { req.destroy(); return; } chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); }); req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject); });

  // ---------- Owner : initialisation unique ----------
  const ownerExists = () => {
    const cfg = readConfig();
    if (cfg.owner?.id) return true;
    if (ownerIds.size) return true;
    return Object.values(readUsers()).some(user => user?.role === "OWNER");
  };
  const ownerAccountId = () => readConfig().owner?.id || null;

  // ---------- Notifications + e-mail ----------
  // Envoi réel uniquement si un fournisseur est configuré ; le statut renvoyé reflète la réponse du fournisseur (jamais un succès simulé).
  async function sendMail({ to, subject, text }) {
    if (!emailConfigured()) return { status: "NOT_CONFIGURED" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(process.env.EMAIL_API_URL || "https://api.resend.com/emails", { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${process.env.EMAIL_PROVIDER_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }) });
      return response.ok ? { status: "SENT" } : { status: "FAILED", detail: `HTTP ${response.status}` };
    } catch (error) { return { status: "FAILED", detail: error?.name || "error" }; }
    finally { clearTimeout(timer); }
  }
  const sendOwnerEmail = (subject, text) => sendMail({ to: ownerEmail(), subject, text });

  function notify(type, title, detail, extra = {}) {
    const notes = readNotes();
    const id = crypto.randomBytes(8).toString("hex");
    const entry = { id, ts: new Date().toISOString(), type, title, detail: String(detail || "").slice(0, 400), orderId: extra.orderId || null, userId: extra.userId || null, read: false, email: extra.email || "NOT_REQUESTED" };
    notes.unshift(entry);
    writeNotes(notes.slice(0, 1000));
    return entry;
  }
  function setNoteEmail(id, status, detail) { const notes = readNotes(); const note = notes.find(item => item.id === id); if (note) { note.email = status; if (detail) note.emailDetail = detail; writeNotes(notes); } }

  const userLabel = user => [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "—";
  async function notifyConfirmed(order, user) {
    const note = notify("payment_confirmed", "NEW PAYMENT CONFIRMED", `${order.id} · ${PLANS[order.plan]?.identity || order.plan} · ${money(order.amount)} ${order.currency}`, { orderId: order.id, userId: order.userId, email: "PENDING" });
    const text = ["TRADEMIND ACADEMY", "NEW PAYMENT CONFIRMED", "", `User: ${userLabel(user)}`, `User ID: ${user?.id || order.userId}`, `Plan: ${PLANS[order.plan]?.identity || order.plan}`, `Amount: $${money(order.amount)} ${order.currency}`, `Payment method: ${order.methodName}`, `Network: ${order.network || "—"}`, `Order ID: ${order.id}`, `Transaction ID: ${order.transactionId || "—"}`, "Status: CONFIRMED", `Date: ${new Date(order.confirmedAt || Date.now()).toISOString()}`].join("\n");
    const result = await sendOwnerEmail(`TRADEMIND ACADEMY — NEW PAYMENT CONFIRMED ${order.id}`, text);
    setNoteEmail(note.id, result.status, result.detail);
  }

  // ---------- Commandes ----------
  const event = (order, status, by, note = "") => { order.status = status; order.updatedAt = new Date().toISOString(); (order.events ||= []).push({ ts: order.updatedAt, status, by, note: String(note).slice(0, 160) }); };
  function expireIfNeeded(order) { if (PENDING_SET.has(order.status) && Date.parse(order.expiresAt) <= Date.now()) { event(order, "EXPIRED", "system", "order window elapsed"); return true; } return false; }
  const allMethods = () => [...PAYMENT_METHODS, NOWPAYMENTS_METHOD];
  const publicOrder = order => { const method = allMethods().find(item => item.id === order.methodId); return { id: order.id, plan: order.plan, identity: PLANS[order.plan]?.identity, tradeLimit: PLANS[order.plan]?.tradeLimit ?? null, amount: order.amount, amountText: money(order.amount), currency: order.currency, durationDays: 30, method: { id: order.methodId, name: order.methodName, kind: method?.kind, network: order.network, asset: order.asset, address: order.address || null, receiver: order.receiver || null, mode: method?.mode || "MANUAL" }, invoiceUrl: order.invoiceUrl || null, qrPayload: order.qrPayload || null, status: order.status, reported: Boolean(order.reported), userTxRef: order.userTxRef || null, createdAt: order.createdAt, expiresAt: order.expiresAt, confirmedAt: order.confirmedAt || null, activatedAt: order.activatedAt || null, events: (order.events || []).map(({ ts, status }) => ({ ts, status })) }; };

  function activate(order, user, by) {
    if (order.status === "ACTIVATED") return false;
    const users = readUsers();
    const target = users[user.id];
    // Idempotence : une commande ne prolonge jamais l'abonnement deux fois (même si deux notifications arrivent en même temps).
    if ((target.activatedOrders || []).includes(order.id)) return false;
    target.activatedOrders = [...(target.activatedOrders || []).slice(-19), order.id];
    const now = Date.now();
    const sameActive = target.plan === order.plan && target.subscription_end && Date.parse(target.subscription_end) > now;
    const base = sameActive ? Date.parse(target.subscription_end) : now;
    target.plan = order.plan;
    target.planUpdatedAt = new Date(now).toISOString();
    target.subscription_start = sameActive ? target.subscription_start : new Date(now).toISOString();
    target.subscription_end = new Date(base + SUBSCRIPTION_MS).toISOString();
    target.subscription_status = "active";
    target.lastActivityAt = target.planUpdatedAt;
    users[user.id] = target; writeUsers(users);
    order.activatedAt = new Date(now).toISOString();
    event(order, "ACTIVATED", by, "subscription activated");
    return true;
  }

  const claimTx = (cfg, transactionId, orderId) => { const key = `tx:${sha(transactionId)}`; const existing = cfg[key]; if (existing && existing.orderId !== orderId) return { conflict: true, orderId: existing.orderId }; cfg[key] = { orderId, at: new Date().toISOString() }; return { conflict: false, duplicate: Boolean(existing) }; };

  async function confirmOrder(req, order, user, transactionId, by, source) {
    // Statuts attendus : jamais confirmer deux fois, jamais confirmer un ordre annulé/échoué/remboursé.
    if (CONFIRMED_SET.has(order.status)) return { ok: true, duplicate: true };
    // L'objet « order » peut dater d'avant un await (revérification fournisseur) : on relit l'état le plus récent avant d'agir.
    { const latest = readOrders()[order.id]; if (latest && CONFIRMED_SET.has(latest.status)) return { ok: true, duplicate: true }; if (latest) order = latest; }
    if (!["CREATED", "PENDING", "PAYMENT_DETECTED", "EXPIRED"].includes(order.status)) return { ok: false, status: 409, error: `Order is ${order.status}.`, code: "ORDER_NOT_CONFIRMABLE" };
    const cfg = readConfig();
    const claim = claimTx(cfg, transactionId, order.id);
    if (claim.conflict) { notify("payment_anomaly", "PAYMENT ANOMALY", `Transaction already used by ${claim.orderId}; attempted on ${order.id}`, { orderId: order.id, userId: order.userId }); recordAudit({ req, user, event: "payment_duplicate_transaction", result: "DENIED", context: order.id }); return { ok: false, status: 409, error: "Transaction ID already used by another order.", code: "TRANSACTION_ALREADY_USED" }; }
    writeConfig(cfg);
    order.transactionId = transactionId; order.confirmedAt = new Date().toISOString(); order.confirmedBy = source;
    event(order, "CONFIRMED", by, `source=${source}`);
    const orders = readOrders(); orders[order.id] = order; writeOrders(orders);
    recordAudit({ req, user, event: "payment_confirmed", context: `${order.id} ${source}` });
    const activated = activate(order, user, by);
    const orders2 = readOrders(); orders2[order.id] = order; writeOrders(orders2);
    if (activated) { notify("subscription_activated", "SUBSCRIPTION ACTIVATED", `${userLabel(user)} · ${PLANS[order.plan]?.identity}`, { orderId: order.id, userId: order.userId }); recordAudit({ req, user, event: "subscription_activated", context: `${order.id} plan=${order.plan}` }); }
    await notifyConfirmed(order, user);
    return { ok: true, duplicate: false };
  }

  const verifySignature = (header, raw) => {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET; if (!secret || typeof header !== "string") return false;
    const parts = Object.fromEntries(header.split(",").map(piece => piece.trim().split("=")).filter(pair => pair.length === 2));
    const t = Number(parts.t); if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
    const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
    return typeof parts.v1 === "string" && parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  };

  const ownerRow = (order, users) => { const user = users[order.userId]; return { ...publicOrder(order), user: userLabel(user), userId: order.userId, tradeMindId: user?.tradeMindId || null, email: user?.email || null, transactionId: order.transactionId || null, userTxRef: order.userTxRef || null }; };
  const bucket = status => PENDING_SET.has(status) ? "pending" : CONFIRMED_SET.has(status) ? "confirmed" : FAILED_SET.has(status) ? "failed" : status === "REFUNDED" ? "refunded" : "other";
  const revenue = orders => { const confirmed = Object.values(orders).filter(order => CONFIRMED_SET.has(order.status)); return { confirmedUsd: Number(confirmed.reduce((sum, order) => sum + Number(order.amount), 0).toFixed(2)), confirmedCount: confirmed.length, pendingCount: Object.values(orders).filter(order => PENDING_SET.has(order.status)).length }; };

  const idFrom = (route, prefix) => decodeURIComponent(route.slice(prefix.length).split("/")[0] || "");

  async function handle(route, req, res) {
    // ----- Owner : état + initialisation unique (publics, mais fermés après la première initialisation)
    if (route === "/api/owner/setup" && req.method === "GET") return send(res, 200, { initialized: ownerExists(), setupEnabled: !ownerExists() && Boolean(process.env.OWNER_SETUP_TOKEN) }), true;
    if (route === "/api/owner/setup" && req.method === "POST") {
      if (ownerExists()) { recordAudit({ req, user: null, event: "owner_setup_denied", result: "DENIED", context: "already initialized" }); return send(res, 409, { error: "Owner is already initialized.", code: "OWNER_ALREADY_INITIALIZED" }), true; }
      if (!process.env.OWNER_SETUP_TOKEN) return send(res, 503, { error: "Owner setup is disabled until OWNER_SETUP_TOKEN is configured on the server.", code: "OWNER_SETUP_DISABLED" }), true;
      { const gate = limitHit("ownersetup:ip", clientIp(req), 8, 3600000); if (!gate.ok) return tooMany(res, gate, req, "owner_setup"), true; }
      const input = await body(req);
      if (typeof input.token !== "string" || !safeEqual(input.token, process.env.OWNER_SETUP_TOKEN)) { recordAudit({ req, user: null, event: "owner_setup_denied", result: "DENIED", context: "bad token" }); return send(res, 403, { error: "Invalid setup token.", code: "OWNER_SETUP_TOKEN_INVALID" }), true; }
      const email = normalizeEmail(input.email);
      const password = typeof input.password === "string" ? input.password : "";
      if (!validEmail(email)) return send(res, 400, { error: "Enter a valid email address." }), true;
      if (password.length < OWNER_PASSWORD_MIN || passwordProblem(password, { min: OWNER_PASSWORD_MIN, email })) return send(res, 400, { error: `Owner password must contain at least ${OWNER_PASSWORD_MIN} characters.`, code: "PASSWORD_TOO_SHORT" }), true;
      if (password !== input.confirmPassword) return send(res, 400, { error: "Passwords do not match.", code: "PASSWORD_MISMATCH" }), true;
      const users = readUsers();
      let user = Object.values(users).find(candidate => candidate && normalizeEmail(candidate.email) === email);
      if (user && !verifyPassword(password, user)) return send(res, 401, { error: "Incorrect email or password." }), true;
      if (!user) { const id = crypto.randomUUID(); const now = new Date().toISOString(); user = { id, tradeMindId: `TM-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, email, firstName: String(input.firstName || "").trim().slice(0, 60), lastName: String(input.lastName || "").trim().slice(0, 60), country: "", language: "fr", ...hash(password), plan: "FREE", subscription_status: "active", createdAt: now, lastActivityAt: now }; }
      // Création exclusive du marqueur « owner » : deux initialisations simultanées ne peuvent pas toutes deux réussir.
      if (!(await claimUnique("owner", "singleton", user.id))) { recordAudit({ req, user: null, event: "owner_setup_denied", result: "DENIED", context: "concurrent initialization" }); return send(res, 409, { error: "Owner is already initialized.", code: "OWNER_ALREADY_INITIALIZED" }), true; }
      user.role = "OWNER"; users[user.id] = user; writeUsers(users);
      const cfg = readConfig(); cfg.owner = { id: user.id, initializedAt: new Date().toISOString() }; writeConfig(cfg);
      recordAudit({ req, user, event: "OWNER_INITIALIZED", context: "single initial owner" });
      clearLoginAttempts(req);
      return authResponse(res, user, req), true;
    }

    // ----- Utilisateur : commandes
    if (route === "/api/billing/orders" && req.method === "POST") {
      const user = currentUser(req); if (!user) return send(res, 401, { error: "Authentication required." }), true;
      if (roleFor?.(user) === "OWNER") return send(res, 409, { error: "The Owner account has free SOVEREIGN access; no payment is needed.", code: "OWNER_FREE_ACCESS" }), true;
      { const gate = limitHit("orders:user", user.id, 12, 3600000); if (!gate.ok) return tooMany(res, gate, req, "order_create"), true; }
      const input = await body(req);
      const rawPlan = String(input.plan || "").trim().toUpperCase();
      const plan = IDENTITY_TO_CODE[rawPlan] || normalizePlan(rawPlan);
      if (!PAID.has(plan) || !PLANS[plan]) return send(res, 400, { error: "Invalid or non-payable plan.", code: "INVALID_PLAN" }), true;
      const method = allMethods().find(item => item.id === input.method);
      if (!method) return send(res, 400, { error: "Unknown payment method.", code: "INVALID_METHOD" }), true;
      if (method.mode === "AUTOMATIC" && !nowpayments.configured()) return send(res, 503, { error: "Automatic crypto payment is not configured.", code: "PAYMENT_PROVIDER_NOT_CONFIGURED" }), true;
      const orders = readOrders(); let changed = false;
      for (const order of Object.values(orders)) if (expireIfNeeded(order)) changed = true;
      const mine = Object.values(orders).filter(order => order.userId === user.id && PENDING_SET.has(order.status));
      const reuse = mine.find(order => order.plan === plan && order.methodId === method.id);
      if (reuse) { if (changed) writeOrders(orders); return send(res, 200, { order: publicOrder(reuse), reused: true }), true; }
      if (mine.length >= 5) { if (changed) writeOrders(orders); return send(res, 429, { error: "Too many open orders. Cancel or complete one first.", code: "TOO_MANY_OPEN_ORDERS" }), true; }
      const now = new Date();
      const order = { id: orderIdNew(orders), userId: user.id, plan, amount: PLANS[plan].priceUsdMonthly, currency: "USD", methodId: method.id, methodName: method.name, network: method.network, asset: method.asset, address: method.address || null, receiver: method.receiver || null, qrPayload: method.kind === "crypto" ? (method.id === "bitcoin" ? `bitcoin:${method.address}` : method.address) : null, status: "CREATED", createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ORDER_TTL_MS).toISOString(), reported: false, events: [{ ts: now.toISOString(), status: "CREATED", by: "user", note: "" }] };
      if (method.mode === "AUTOMATIC") {
        // Facture NOWPayments créée AVANT d'enregistrer la commande : si le fournisseur échoue, aucune commande orpheline.
        const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.URL || `https://${String(req.headers.host || "").replace(/[^A-Za-z0-9.:-]/g, "")}`).replace(/\/+$/, "");
        let invoice; try { invoice = await nowpayments.createInvoice({ order, description: `TradeMind ${PLANS[plan].identity} - 30 days`, ipnUrl: `${baseUrl}/api/billing/nowpayments/ipn`, successUrl: `${baseUrl}/app`, cancelUrl: `${baseUrl}/app` }); } catch { invoice = { ok: false, status: 0 }; }
        if (!invoice.ok) { recordAudit({ req, user, event: "payment_provider_error", result: "FAILED", context: `nowpayments invoice HTTP ${invoice.status}` }); return send(res, 502, { error: "The payment provider is unavailable. Please try again or use another method.", code: "PAYMENT_PROVIDER_ERROR" }), true; }
        order.provider = "nowpayments"; order.invoiceId = invoice.invoiceId; order.invoiceUrl = invoice.invoiceUrl; order.network = "NOWPayments"; order.asset = "USDT / BTC";
      }
      event(order, "PENDING", "system", "awaiting payment");
      orders[order.id] = order; writeOrders(orders);
      recordAudit({ req, user, event: "payment_order_created", context: `${order.id} ${plan} ${method.id}` });
      notify("payment_created", "NEW PAYMENT ORDER", `${userLabel(user)} · ${PLANS[plan].identity} · $${money(order.amount)} · ${method.name} · ${order.id}`, { orderId: order.id, userId: user.id });
      return send(res, 201, { order: publicOrder(order), reused: false }), true;
    }
    if (route === "/api/billing/orders" && req.method === "GET") {
      const user = currentUser(req); if (!user) return send(res, 401, { error: "Authentication required." }), true;
      const orders = readOrders(); let changed = false; for (const order of Object.values(orders)) if (expireIfNeeded(order)) changed = true; if (changed) writeOrders(orders);
      return send(res, 200, { orders: Object.values(orders).filter(order => order.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(publicOrder) }), true;
    }
    if (route.startsWith("/api/billing/orders/")) {
      const user = currentUser(req); if (!user) return send(res, 401, { error: "Authentication required." }), true;
      const id = idFrom(route, "/api/billing/orders/"); const orders = readOrders(); const order = orders[id];
      if (!order || order.userId !== user.id) { if (order) recordAudit({ req, user, event: "forbidden_resource_access", result: "DENIED", context: `order ${id}` }); return send(res, 404, { error: "Order not found." }), true; }
      if (expireIfNeeded(order)) writeOrders(orders);
      const action = route.split("/")[5] || "";
      if (!action && req.method === "GET") return send(res, 200, { order: publicOrder(order) }), true;
      if (action === "report" && req.method === "POST") {
        if (!PENDING_SET.has(order.status)) return send(res, 409, { error: `Order is ${order.status}.`, code: "ORDER_NOT_PENDING" }), true;
        const input = await body(req); const ref = typeof input.txRef === "string" ? input.txRef.trim() : "";
        if (!TX_RE.test(ref)) return send(res, 400, { error: "Enter the transaction reference or hash (6–128 letters, digits, : _ - .).", code: "INVALID_TX_REF" }), true;
        const cfg = readConfig(); const taken = cfg[`tx:${sha(ref)}`];
        if (taken && taken.orderId !== order.id) return send(res, 409, { error: "This reference is already attached to another order.", code: "TRANSACTION_ALREADY_USED" }), true;
        const first = !order.reported; order.reported = true; order.reportedAt = new Date().toISOString(); order.userTxRef = ref; event(order, order.status, "user", "payment reported by user (unverified)");
        orders[order.id] = order; writeOrders(orders);
        recordAudit({ req, user, event: "payment_reported", context: order.id });
        if (first) notify("payment_reported", "PAYMENT REPORTED — VERIFY", `${userLabel(user)} reports payment for ${order.id} (ref ${ref.slice(0, 24)}…)`, { orderId: order.id, userId: user.id });
        // Le signalement n'active JAMAIS le plan : seule une confirmation Owner ou un webhook signé le fait.
        return send(res, 200, { order: publicOrder(order), activated: false }), true;
      }
      if (action === "cancel" && req.method === "POST") {
        if (!PENDING_SET.has(order.status)) return send(res, 409, { error: `Order is ${order.status}.`, code: "ORDER_NOT_PENDING" }), true;
        event(order, "CANCELLED", "user", ""); orders[order.id] = order; writeOrders(orders); recordAudit({ req, user, event: "payment_cancelled", context: order.id });
        return send(res, 200, { order: publicOrder(order) }), true;
      }
      return send(res, 404, { error: "Not found" }), true;
    }

    // ----- Webhook fournisseur (récepteur signé générique : aucun fournisseur n'est connecté par défaut)
    if (route === "/api/billing/nowpayments/ipn" && req.method === "POST") {
      if (!nowpayments.configured()) return send(res, 503, { error: "Automatic payment not configured.", code: "PAYMENT_PROVIDER_NOT_CONFIGURED" }), true;
      const raw = await rawBody(req);
      if (!nowpayments.verifyIpn(raw, req.headers["x-nowpayments-sig"])) { notify("payment_anomaly", "WEBHOOK REJECTED", "NOWPayments: invalid or missing signature", {}); recordAudit({ req, user: null, event: "webhook_rejected", result: "DENIED", context: "nowpayments bad signature" }); return send(res, 401, { error: "Invalid signature.", code: "INVALID_SIGNATURE" }), true; }
      let payload; try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON." }), true; }
      const orders = readOrders(); const order = orders[String(payload.order_id || "")];
      const reject = (code, message, status = 422) => { notify("payment_anomaly", "PAYMENT ANOMALY", `${code}: ${String(payload.order_id || "?").slice(0, 24)}`, { orderId: order?.id || null, userId: order?.userId || null }); recordAudit({ req, user: null, event: "webhook_rejected", result: "DENIED", context: `nowpayments ${code}` }); return send(res, status, { error: message, code }), true; };
      if (!order || order.provider !== "nowpayments") return reject("ORDER_NOT_FOUND", "Unknown order.", 404);
      const user = readUsers()[order.userId]; if (!user) return reject("USER_NOT_FOUND", "Order user missing.", 404);
      if (String(payload.price_currency || "").toLowerCase() !== "usd") return reject("CURRENCY_MISMATCH", "Currency does not match the order.");
      if (money(payload.price_amount) !== money(order.amount)) return reject("AMOUNT_MISMATCH", "Amount does not match the order.");
      const paymentId = String(payload.payment_id ?? ""); const status = String(payload.payment_status || "").toLowerCase();
      if (!/^[0-9]{1,24}$/.test(paymentId)) return reject("INVALID_TRANSACTION", "Invalid payment id.");
      if (status === "finished") {
        // Revérification directe auprès du fournisseur : l'activation ne repose jamais sur le seul contenu reçu.
        let check; try { check = await nowpayments.getPayment(paymentId); } catch { check = { ok: false }; }
        if (!check.ok) return send(res, 502, { error: "Could not verify the payment with the provider; retry later.", code: "PAYMENT_PROVIDER_ERROR" }), true;
        const p = check.payment || {};
        if (String(p.payment_status || "").toLowerCase() !== "finished" || String(p.order_id || "") !== order.id || money(p.price_amount) !== money(order.amount) || String(p.price_currency || "").toLowerCase() !== "usd") return reject("PROVIDER_MISMATCH", "Provider check does not match the order.");
        const result = await confirmOrder(req, order, user, `nowpayments:${paymentId}`, "nowpayments", "nowpayments");
        if (!result.ok) { notify("payment_anomaly", "PAID BUT NOT ACTIVATED", `${order.id} is ${order.status} but NOWPayments reports payment ${paymentId} finished. Review manually.`, { orderId: order.id, userId: order.userId }); recordAudit({ req, user, event: "payment_paid_not_activated", result: "REVIEW", context: order.id }); return send(res, 200, { ok: true, activated: false, code: result.code }), true; }
        return send(res, 200, { ok: true, duplicate: result.duplicate }), true;
      }
      if (status === "partially_paid") { notify("payment_anomaly", "PARTIAL PAYMENT", `${order.id}: paid ${String(payload.actually_paid ?? "?").slice(0, 20)} of ${String(payload.pay_amount ?? "?").slice(0, 20)} ${String(payload.pay_currency || "").slice(0, 10)}. Plan NOT activated.`, { orderId: order.id, userId: order.userId }); recordAudit({ req, user, event: "payment_partial", result: "REVIEW", context: order.id }); return send(res, 200, { ok: true, activated: false }), true; }
      if (["confirming", "confirmed", "sending"].includes(status)) { if (["CREATED", "PENDING"].includes(order.status)) { event(order, "PAYMENT_DETECTED", "nowpayments", status); orders[order.id] = order; writeOrders(orders); } return send(res, 200, { ok: true }), true; }
      if (status === "failed" || status === "expired") { if (!CONFIRMED_SET.has(order.status) && order.status !== "FAILED") { event(order, "FAILED", "nowpayments", status); orders[order.id] = order; writeOrders(orders); notify("payment_failed", "PAYMENT FAILED", order.id, { orderId: order.id, userId: order.userId }); } return send(res, 200, { ok: true }), true; }
      if (status === "refunded") { const outcome = refund(req, order, user, "nowpayments"); return send(res, 200, { ok: true, ...outcome }), true; }
      return send(res, 200, { ok: true, ignored: status.slice(0, 20) }), true;
    }
    if (route === "/api/billing/webhook" && req.method === "POST") {
      if (!webhookConfigured()) return send(res, 503, { error: "Payment provider webhook not configured.", code: "PAYMENT_PROVIDER_NOT_CONFIGURED" }), true;
      const raw = await rawBody(req);
      if (!verifySignature(req.headers["x-tm-signature"], raw)) { notify("payment_anomaly", "WEBHOOK REJECTED", "Invalid or missing signature", {}); recordAudit({ req, user: null, event: "webhook_rejected", result: "DENIED", context: "bad signature" }); return send(res, 401, { error: "Invalid signature.", code: "INVALID_SIGNATURE" }), true; }
      let payload; try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON." }), true; }
      const transactionId = String(payload.transactionId || ""); const orders = readOrders(); const order = orders[String(payload.orderId || "")];
      const reject = (code, message, status = 422) => { notify("payment_anomaly", "PAYMENT ANOMALY", `${code}: ${String(payload.orderId || "?").slice(0, 24)}`, { orderId: order?.id || null, userId: order?.userId || null }); recordAudit({ req, user: null, event: "webhook_rejected", result: "DENIED", context: code }); return send(res, status, { error: message, code }), true; };
      if (!order) return reject("ORDER_NOT_FOUND", "Unknown order.", 404);
      if (!TX_RE.test(transactionId)) return reject("INVALID_TRANSACTION", "Invalid transaction id.");
      if (payload.plan !== undefined && normalizePlan(IDENTITY_TO_CODE[String(payload.plan).toUpperCase()] || payload.plan) !== order.plan) return reject("PLAN_MISMATCH", "Plan does not match the order.");
      const user = readUsers()[order.userId]; if (!user) return reject("USER_NOT_FOUND", "Order user missing.", 404);
      if (payload.type === "payment.failed") { if (!CONFIRMED_SET.has(order.status)) { event(order, "FAILED", "webhook", transactionId.slice(0, 40)); orders[order.id] = order; writeOrders(orders); notify("payment_failed", "PAYMENT FAILED", order.id, { orderId: order.id, userId: order.userId }); } return send(res, 200, { ok: true }), true; }
      if (payload.type === "payment.refunded") { const outcome = refund(req, order, user, "webhook"); return send(res, 200, { ok: true, ...outcome }), true; }
      if (payload.type !== "payment.succeeded") return reject("UNSUPPORTED_EVENT", "Unsupported event type.");
      if (String(payload.currency || "").toUpperCase() !== order.currency) return reject("CURRENCY_MISMATCH", "Currency does not match the order.");
      if (money(payload.amount) !== money(order.amount)) return reject("AMOUNT_MISMATCH", "Amount does not match the order.");
      const result = await confirmOrder(req, order, user, transactionId, "webhook", "webhook");
      if (!result.ok) return send(res, result.status, { error: result.error, code: result.code }), true;
      return send(res, 200, { ok: true, duplicate: result.duplicate }), true;
    }

    // ----- Owner : paiements, notifications
    if (route === "/api/owner/payments" && req.method === "GET") {
      const owner = ownerRequired(req, res); if (!owner) return true;
      const orders = readOrders(); let changed = false; for (const order of Object.values(orders)) if (expireIfNeeded(order)) changed = true; if (changed) writeOrders(orders);
      const filter = new URL(req.url, "http://x").searchParams.get("status") || "";
      const users = readUsers();
      const rows = Object.values(orders).filter(order => !filter || bucket(order.status) === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300).map(order => ownerRow(order, users));
      return send(res, 200, { provider: { configured: nowpayments.configured() || webhookConfigured(), automatic: nowpayments.configured(), sandbox: nowpayments.sandbox(), status: nowpayments.configured() ? (nowpayments.sandbox() ? "AUTOMATIC_SANDBOX" : "AUTOMATIC_CONFIGURED_UNVERIFIED") : webhookConfigured() ? "WEBHOOK_CONFIGURED_UNVERIFIED" : "NOT_CONFIGURED", message: nowpayments.configured() ? "Automatic crypto (NOWPayments) is configured; Airtel Money and direct deposits stay manual (Owner confirms)." : "Methods are manual: the Owner verifies funds, then confirms. No automatic provider is connected." }, methods: [...(nowpayments.configured() ? [NOWPAYMENTS_METHOD] : []), ...PAYMENT_METHODS.map(method => ({ ...method, mode: "MANUAL", status: "ACTIVE_MANUAL" }))], revenue: revenue(orders), counts: { pending: Object.values(orders).filter(o => bucket(o.status) === "pending").length, confirmed: Object.values(orders).filter(o => bucket(o.status) === "confirmed").length, failed: Object.values(orders).filter(o => bucket(o.status) === "failed").length, refunded: Object.values(orders).filter(o => o.status === "REFUNDED").length }, transactions: rows }), true;
    }
    if (route.startsWith("/api/owner/payments/") && req.method === "POST") {
      const owner = ownerRequired(req, res); if (!owner) return true;
      const id = idFrom(route, "/api/owner/payments/"); const action = route.split("/")[5] || ""; const orders = readOrders(); const order = orders[id];
      if (!order) return send(res, 404, { error: "Order not found." }), true;
      const user = readUsers()[order.userId]; if (!user) return send(res, 404, { error: "Order user missing." }), true;
      const input = await body(req);
      if (action === "confirm") {
        const transactionId = typeof input.transactionId === "string" ? input.transactionId.trim() : "";
        if (!TX_RE.test(transactionId)) return send(res, 400, { error: "A real transaction ID/hash is required (6–128 characters).", code: "INVALID_TX_REF" }), true;
        const result = await confirmOrder(req, order, user, transactionId, `owner:${owner.tradeMindId}`, "owner");
        if (!result.ok) return send(res, result.status, { error: result.error, code: result.code }), true;
        return send(res, 200, { ok: true, duplicate: result.duplicate, order: ownerRow(readOrders()[id], readUsers()) }), true;
      }
      if (action === "reject") {
        if (CONFIRMED_SET.has(order.status) || order.status === "REFUNDED") return send(res, 409, { error: `Order is ${order.status}.`, code: "ORDER_NOT_REJECTABLE" }), true;
        event(order, "FAILED", `owner:${owner.tradeMindId}`, input.reason || ""); orders[id] = order; writeOrders(orders); recordAudit({ req, user: owner, event: "payment_rejected", context: id });
        notify("payment_failed", "PAYMENT FAILED", `${id} rejected by Owner`, { orderId: id, userId: order.userId });
        return send(res, 200, { ok: true, order: ownerRow(order, readUsers()) }), true;
      }
      if (action === "refund") {
        const outcome = refund(req, order, user, `owner:${owner.tradeMindId}`);
        if (!outcome.ok) return send(res, 409, { error: outcome.error, code: "ORDER_NOT_REFUNDABLE" }), true;
        return send(res, 200, { ok: true, order: ownerRow(readOrders()[id], readUsers()) }), true;
      }
      return send(res, 404, { error: "Not found" }), true;
    }
    if (route === "/api/owner/notifications" && req.method === "GET") {
      const owner = ownerRequired(req, res); if (!owner) return true;
      // Abonnements expirés : une notification par expiration (clé unique), sans doublon.
      const cfg = readConfig(); let cfgChanged = false;
      for (const user of Object.values(readUsers())) { if (PAID.has(normalizePlan(user.plan)) && user.subscription_end && Date.parse(user.subscription_end) <= Date.now()) { const key = `exp:${user.id}:${user.subscription_end}`; if (!cfg[key]) { cfg[key] = { at: new Date().toISOString() }; cfgChanged = true; notify("subscription_expired", "SUBSCRIPTION EXPIRED", `${userLabel(user)} · ${PLANS[normalizePlan(user.plan)]?.identity}`, { userId: user.id }); } } }
      if (cfgChanged) writeConfig(cfg);
      const notes = readNotes();
      return send(res, 200, { notifications: notes.slice(0, 200), unread: notes.filter(item => !item.read).length, email: { configured: emailConfigured(), status: emailConfigured() ? "CONFIGURED" : "NOT_CONFIGURED", destination: "owner-only (server-side)" } }), true;
    }
    if (route === "/api/owner/notifications/read" && req.method === "POST") {
      const owner = ownerRequired(req, res); if (!owner) return true;
      const input = await body(req); const ids = new Set(Array.isArray(input.ids) ? input.ids.map(String) : []); const notes = readNotes();
      for (const note of notes) if (input.all === true || ids.has(note.id)) note.read = true;
      writeNotes(notes); return send(res, 200, { ok: true, unread: notes.filter(item => !item.read).length }), true;
    }
    if (route === "/api/owner/security" && req.method === "GET") {
      const owner = ownerRequired(req, res); if (!owner) return true;
      return send(res, 200, { ownerId: owner.id, tradeMindId: owner.tradeMindId, email: owner.email, ownerIdImmutable: true, initialized: true, notificationEmail: ownerEmail(), emailProvider: emailConfigured() ? "CONFIGURED" : "NOT_CONFIGURED", passwordLastChangedAt: owner.passwordLastChangedAt || null, ownerPasswordMinLength: OWNER_PASSWORD_MIN }), true;
    }
    return false;
  }

  function refund(req, order, user, by) {
    if (order.status === "REFUNDED") return { ok: true, duplicate: true };
    if (!CONFIRMED_SET.has(order.status)) return { ok: false, error: `Order is ${order.status}.` };
    const wasActivated = order.status === "ACTIVATED";
    event(order, "REFUNDED", by, "");
    const orders = readOrders(); orders[order.id] = order; writeOrders(orders);
    if (wasActivated) { const users = readUsers(); const target = users[user.id]; if (target && target.plan === order.plan) { target.plan = "FREE"; target.subscription_start = null; target.subscription_end = null; target.subscription_status = "active"; target.planUpdatedAt = new Date().toISOString(); users[user.id] = target; writeUsers(users); } }
    recordAudit({ req, user, event: "payment_refunded", context: order.id });
    notify("refund", "PAYMENT REFUNDED", `${order.id} · ${userLabel(user)}`, { orderId: order.id, userId: order.userId });
    return { ok: true, duplicate: false };
  }

  return { handle, notify, sendMail, notifyOwnerPasswordChanged: user => notify("owner_security", "OWNER PASSWORD CHANGED", userLabel(user), { userId: user.id }), ownerExists, ownerAccountId, revenue: () => revenue(readOrders()), emailConfigured, webhookConfigured, nowpaymentsConfigured: nowpayments.configured, OWNER_PASSWORD_MIN };
}
