// Comptes : inscription (e-mail unique), connexion, déconnexion, récupération de mot de passe, suppression de compte,
// mot de passe, quotas de trades (comptés côté serveur). Aucun secret ici.
import crypto from "node:crypto";
import { normalizeEmail, validEmail, EMAIL_EXISTS, hashPassword, checkPassword, dummyVerify, passwordProblem, newToken, tokenKey, sha256, PASSWORD_MAX } from "./security.mjs";

const RESET_TTL_MS = 30 * 60 * 1000;
const OWNER_MIN = 12;
const TRADE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const maskEmail = email => { const [name = "", domain = ""] = String(email || "").split("@"); return `${name.slice(0, 1)}***@${domain}`; };
const clean = (value, max) => (typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

export function createAccounts(h) {
  const { isMobile, purgeJournal, send, body, currentUser, sessionId, sessionKey, readUsers, writeUsers, readSessions, writeSessions, readResets, writeResets, readLedger, writeLedger, readOrders, writeOrders,
    recordAudit, roleFor, safeUser, effectiveMembership, PLANS, startSession, clearSessionCookies, limitHit, limitCount, limitFail, limitClear, tooMany, claimUnique, releaseClaim, billing, ownerRequired, clientIp } = h;

  const wantsFrench = (input, req) => input?.language === "fr" || (input?.language !== "en" && /^fr/i.test(String(req.headers["accept-language"] || "")));
  const pwMessage = (problem, fr) => problem.code === "PASSWORD_TOO_SHORT" ? (fr ? `Le mot de passe doit contenir au moins ${problem.min} caractères.` : `Password must contain at least ${problem.min} characters.`) : problem.code === "PASSWORD_TOO_LONG" ? (fr ? "Mot de passe trop long." : "Password is too long.") : (fr ? "Ce mot de passe est trop courant. Choisissez-en un autre." : "This password is too common. Choose another one.");
  const baseUrl = () => String(process.env.PUBLIC_BASE_URL || process.env.URL || "").replace(/\/+$/, "");
  const baseFor = req => baseUrl() || (req.headers.host ? `${isHttps(req) ? "https" : "http"}://${String(req.headers["x-forwarded-host"] || req.headers.host).split(",")[0].trim()}` : "");
  const isHttps = req => Boolean(process.env.NETLIFY_FUNCTION) || String(req.headers["x-forwarded-proto"] || "").startsWith("https");
  const revokeUserSessions = (userId, exceptKey = null) => { const sessions = readSessions(); let count = 0; for (const [key, record] of Object.entries(sessions)) if (record.userId === userId && key !== exceptKey) { delete sessions[key]; count += 1; } if (count) writeSessions(sessions); return count; };
  const purgeResets = (resets, userId = null) => { const now = Date.now(); for (const [key, record] of Object.entries(resets)) if (record.expiresAt <= now || record.usedAt || (userId && record.userId === userId)) delete resets[key]; return resets; };

  // Web : cookie HttpOnly. Mobile : le même identifiant de session (haché côté serveur) est renvoyé UNE fois dans le corps, jamais de cookie.
  const authOut = (res, req, user) => { const cookies = startSession(req, user); if (isMobile(req)) return send(res, 200, { user: safeUser(user), token: cookies.sid, tokenType: "Bearer", expiresInSeconds: cookies.maxAgeSeconds }); return send(res, 200, { user: safeUser(user) }, { "set-cookie": cookies }); };

  async function handle(route, req, res) {
    // ---------------- Inscription ----------------
    if (route === "/api/auth/register" && req.method === "POST") {
      const gate = limitHit("register:ip", clientIp(req), 20, 3600000); if (!gate.ok) return tooMany(res, gate, req, "register"), true;
      const input = await body(req); const fr = wantsFrench(input, req);
      const email = normalizeEmail(input.email); const password = typeof input.password === "string" ? input.password : ""; const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
      if (!validEmail(email)) return send(res, 400, { error: fr ? "Saisissez une adresse email valide." : "Enter a valid email address.", code: "INVALID_EMAIL" }), true;
      const problem = passwordProblem(password, { min: 8, email }); if (problem) return send(res, 400, { error: pwMessage(problem, fr), code: problem.code }), true;
      if (password !== confirmPassword) return send(res, 400, { error: fr ? "Les mots de passe ne correspondent pas." : "Passwords do not match.", code: "PASSWORD_MISMATCH" }), true;
      const duplicate = () => { recordAudit({ req, user: null, event: "signup_duplicate", result: "DENIED", context: maskEmail(email) }); return send(res, 409, { error: EMAIL_EXISTS[fr ? "fr" : "en"], code: "EMAIL_ALREADY_REGISTERED" }); };
      const users = readUsers();
      if (Object.values(users).some(user => user && normalizeEmail(user.email) === email)) return duplicate(), true;
      const id = crypto.randomUUID();
      // Contrainte d'unicité atomique (création exclusive) : deux requêtes simultanées ne peuvent pas toutes deux réussir.
      if (!(await claimUnique("email", email, id))) return duplicate(), true;
      const now = new Date().toISOString();
      users[id] = { id, tradeMindId: h.tradeMindId(), email, firstName: clean(input.firstName, 60), lastName: clean(input.lastName, 60), country: clean(input.country, 80), language: input.language === "fr" ? "fr" : "en", role: "USER", ...hashPassword(password), plan: "FREE", subscription_status: "active", createdAt: now, lastActivityAt: now };
      writeUsers(users); recordAudit({ req, user: users[id], event: "signup", context: `language=${users[id].language}` });
      return authOut(res, req, users[id]), true;
    }

    // ---------------- Connexion ----------------
    if (route === "/api/auth/login" && req.method === "POST") {
      const ip = clientIp(req);
      const gate = limitHit("login:ip", ip, 40, 300000); if (!gate.ok) return tooMany(res, gate, req, "login"), true;
      const input = await body(req); const email = normalizeEmail(input.email); const password = typeof input.password === "string" ? input.password : "";
      const users = readUsers(); const user = email ? Object.values(users).find(candidate => candidate && normalizeEmail(candidate.email) === email) : null;
      const owner = Boolean(user && roleFor(user) === "OWNER");
      const byEmail = limitCount("login:fail:email", email, owner ? 12 : 25, 900000), byPair = limitCount("login:fail:pair", `${ip}|${email}`, owner ? 5 : 6, 900000);
      if (!byEmail.ok || !byPair.ok) return tooMany(res, byPair.ok ? byEmail : byPair, req, "login_locked"), true;
      const check = user ? checkPassword(password, user) : (dummyVerify(password), { ok: false });
      if (!check.ok) { limitFail("login:fail:email", email, 900000); limitFail("login:fail:pair", `${ip}|${email}`, 900000); recordAudit({ req, user, event: owner ? "owner_login_failed" : "login_failed", result: "DENIED", context: maskEmail(email) }); return send(res, 401, { error: "Incorrect email or password.", code: "INVALID_CREDENTIALS" }), true; }
      limitClear("login:fail:email", email); limitClear("login:fail:pair", `${ip}|${email}`);
      const now = new Date().toISOString(); if (check.upgrade) Object.assign(user, hashPassword(password));
      user.lastLoginAt = now; user.lastActivityAt = now; users[user.id] = user; writeUsers(users);
      recordAudit({ req, user, event: owner ? "owner_login" : "login_success" });
      if (isMobile(req) && roleFor(user) === "OWNER") { recordAudit({ req, user, event: "owner_login", result: "DENIED", context: "owner is web-only" }); return send(res, 403, { error: "The Owner account signs in on the web Owner center only.", code: "OWNER_WEB_ONLY" }), true; }
      return authOut(res, req, user), true;
    }

    // ---------------- Déconnexion (révocation côté serveur) ----------------
    if (route === "/api/auth/logout" && req.method === "POST") {
      const user = currentUser(req); const sid = sessionId(req); const sessions = readSessions();
      if (sid && /^[a-f0-9]{64}$/.test(sid) && sessions[sessionKey(sid)]) { delete sessions[sessionKey(sid)]; writeSessions(sessions); }
      if (user) recordAudit({ req, user, event: "logout" });
      return send(res, 200, { ok: true }, { "set-cookie": clearSessionCookies(req) }), true;
    }

    // ---------------- Mot de passe oublié ----------------
    if (route === "/api/auth/forgot" && req.method === "POST") {
      const ip = clientIp(req); const gate = limitHit("forgot:ip", ip, 10, 3600000); if (!gate.ok) return tooMany(res, gate, req, "forgot"), true;
      const input = await body(req); const fr = wantsFrench(input, req); const email = normalizeEmail(input.email);
      const emailMode = billing.emailConfigured() && Boolean(baseUrl());
      // Réponse strictement identique que le compte existe ou non (pas d'énumération). Elle ne prétend jamais qu'un e-mail est parti.
      const reply = () => send(res, 200, { ok: true, delivery: emailMode ? "EMAIL" : "ADMIN_ASSISTED", message: emailMode
        ? (fr ? "Si un compte existe pour cette adresse, un message contenant un lien de réinitialisation valable 30 minutes vient d'être envoyé." : "If an account exists for this address, a message with a reset link valid for 30 minutes has just been sent.")
        : (fr ? "Demande enregistrée. L'envoi automatique d'e-mails n'est pas activé sur ce service : l'administrateur peut vous transmettre un lien de réinitialisation après vérification de votre identité." : "Request recorded. Automatic emails are not enabled on this service: the administrator can send you a reset link after verifying your identity.") });
      if (!validEmail(email)) return reply(), true;
      const mail = limitHit("forgot:email", email, 3, 3600000); if (!mail.ok) return reply(), true;
      const user = Object.values(readUsers()).find(candidate => candidate && normalizeEmail(candidate.email) === email);
      if (!user || roleFor(user) === "OWNER") return reply(), true; // le compte Owner n'a pas de récupération publique (voir /api/owner/recover)
      recordAudit({ req, user, event: "password_reset_requested", context: emailMode ? "email" : "admin_assisted" });
      if (emailMode) {
        const token = newToken(); const resets = purgeResets(readResets(), user.id); resets[tokenKey(token)] = { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + RESET_TTL_MS, via: "email" }; writeResets(resets);
        const link = `${baseUrl()}/login#reset=${token}`;
        const text = fr ? `TRADEMIND ACADEMY\n\nVous avez demandé la réinitialisation de votre mot de passe.\nOuvrez ce lien (valable 30 minutes, usage unique) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.` : `TRADEMIND ACADEMY\n\nYou asked to reset your password.\nOpen this link (valid for 30 minutes, single use):\n${link}\n\nIf you did not request this, ignore this message.`;
        const result = await billing.sendMail({ to: user.email, subject: fr ? "TRADEMIND ACADEMY — Réinitialisation du mot de passe" : "TRADEMIND ACADEMY — Password reset", text });
        recordAudit({ req, user, event: "password_reset_email", result: result.status, context: result.detail || "" });
      } else {
        billing.notify("recovery_request", "PASSWORD RECOVERY REQUEST", `${user.email} (${user.tradeMindId}) asked for a reset link. Verify the identity, then create a one-time link from Users.`, { userId: user.id });
      }
      return reply(), true;
    }

    // ---------------- Réinitialisation avec jeton ----------------
    if (route === "/api/auth/reset" && req.method === "POST") {
      const gate = limitHit("reset:ip", clientIp(req), 20, 3600000); if (!gate.ok) return tooMany(res, gate, req, "reset"), true;
      const input = await body(req); const fr = wantsFrench(input, req);
      const token = typeof input.token === "string" ? input.token : ""; const resets = readResets(); const record = /^[A-Za-z0-9_-]{40,64}$/.test(token) ? resets[tokenKey(token)] : null;
      if (!record || record.usedAt || record.expiresAt <= Date.now()) return send(res, 400, { error: fr ? "Ce lien est invalide ou a expiré. Faites une nouvelle demande." : "This link is invalid or has expired. Request a new one.", code: "RESET_TOKEN_INVALID" }), true;
      const users = readUsers(); const user = users[record.userId];
      if (!user || roleFor(user) === "OWNER") return send(res, 400, { error: fr ? "Ce lien est invalide ou a expiré. Faites une nouvelle demande." : "This link is invalid or has expired. Request a new one.", code: "RESET_TOKEN_INVALID" }), true;
      const newPassword = typeof input.newPassword === "string" ? input.newPassword : ""; const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
      const problem = passwordProblem(newPassword, { min: 8, email: normalizeEmail(user.email) }); if (problem) return send(res, 400, { error: pwMessage(problem, fr), code: problem.code }), true;
      if (newPassword !== confirmPassword) return send(res, 400, { error: fr ? "Les mots de passe ne correspondent pas." : "Passwords do not match.", code: "PASSWORD_MISMATCH" }), true;
      // Usage unique : le jeton est supprimé AVANT toute autre écriture ; toutes les sessions du compte sont révoquées.
      delete resets[tokenKey(token)]; writeResets(purgeResets(resets, user.id));
      Object.assign(user, hashPassword(newPassword)); user.passwordLastChangedAt = new Date().toISOString(); user.lastActivityAt = user.passwordLastChangedAt; users[user.id] = user; writeUsers(users);
      const revoked = revokeUserSessions(user.id); limitClear("login:fail:email", normalizeEmail(user.email));
      recordAudit({ req, user, event: "password_reset", context: `sessions_revoked=${revoked}` });
      return send(res, 200, { ok: true }, { "set-cookie": clearSessionCookies(req) }), true;
    }

    // ---------------- Owner : lien de réinitialisation à usage unique (récupération assistée) ----------------
    if (route.startsWith("/api/owner/users/") && route.endsWith("/reset-link") && req.method === "POST") {
      const owner = ownerRequired(req, res); if (!owner) return true;
      const gate = limitHit("ownerlink:user", owner.id, 20, 3600000); if (!gate.ok) return tooMany(res, gate, req, "owner_reset_link"), true;
      const id = decodeURIComponent(route.split("/")[4] || ""); const target = readUsers()[id];
      if (!target) return send(res, 404, { error: "User not found." }), true;
      if (roleFor(target) === "OWNER") return send(res, 409, { error: "The Owner password is changed from Owner security.", code: "OWNER_NOT_RESETTABLE" }), true;
      const token = newToken(); const resets = purgeResets(readResets(), target.id); resets[tokenKey(token)] = { userId: target.id, createdAt: Date.now(), expiresAt: Date.now() + RESET_TTL_MS, via: "owner" }; writeResets(resets);
      recordAudit({ req, user: owner, event: "owner_reset_link_created", context: target.tradeMindId || "" });
      return send(res, 200, { ok: true, link: `${baseFor(req)}/login#reset=${token}`, expiresInMinutes: RESET_TTL_MS / 60000, singleUse: true }), true;
    }

    // ---------------- Owner : récupération du mot de passe Owner (opérateur, jeton serveur) ----------------
    if (route === "/api/owner/recover" && req.method === "POST") {
      const gate = limitHit("ownerrecover:ip", clientIp(req), 5, 3600000); if (!gate.ok) return tooMany(res, gate, req, "owner_recover"), true;
      const input = await body(req); const setupToken = process.env.OWNER_SETUP_TOKEN || "";
      if (!setupToken) return send(res, 503, { error: "Owner recovery is disabled until OWNER_SETUP_TOKEN is configured on the server.", code: "OWNER_RECOVERY_DISABLED" }), true;
      const given = typeof input.token === "string" ? input.token : "";
      const ok = given && crypto.timingSafeEqual(Buffer.from(sha256(given)), Buffer.from(sha256(setupToken)));
      const users = readUsers(); const ownerId = h.ownerAccountId(); const owner = ownerId ? users[ownerId] : null; const email = normalizeEmail(input.email);
      if (!ok || !owner || normalizeEmail(owner.email) !== email) { recordAudit({ req, user: null, event: "owner_recover_denied", result: "DENIED", context: "invalid token or account" }); return send(res, 403, { error: "Recovery refused.", code: "OWNER_RECOVERY_REFUSED" }), true; }
      const newPassword = typeof input.newPassword === "string" ? input.newPassword : ""; const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
      if (newPassword.length < OWNER_MIN) return send(res, 400, { error: `Owner password must contain at least ${OWNER_MIN} characters.`, code: "PASSWORD_TOO_SHORT" }), true;
      if (newPassword.length > PASSWORD_MAX || newPassword !== confirmPassword) return send(res, 400, { error: "Passwords do not match.", code: "PASSWORD_MISMATCH" }), true;
      Object.assign(owner, hashPassword(newPassword)); owner.passwordLastChangedAt = new Date().toISOString(); users[owner.id] = owner; writeUsers(users);
      const revoked = revokeUserSessions(owner.id); limitClear("login:fail:email", email);
      recordAudit({ req, user: owner, event: "OWNER_PASSWORD_RECOVERED", context: `sessions_revoked=${revoked}` }); billing.notifyOwnerPasswordChanged?.(owner);
      return send(res, 200, { ok: true, reauthRequired: true }), true;
    }

    // ---------------- Changement de mot de passe ----------------
    if (route === "/api/account/password" && req.method === "POST") {
      const user = currentUser(req); if (!user) return send(res, 401, { error: "Authentication required." }), true;
      const gate = limitHit("password:user", user.id, 8, 900000); if (!gate.ok) return tooMany(res, gate, req, "password_change"), true;
      const input = await body(req); const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : ""; const newPassword = typeof input.newPassword === "string" ? input.newPassword : ""; const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
      if (!checkPassword(currentPassword, user).ok) { recordAudit({ req, user, event: "password_change", result: "DENIED", context: "wrong current password" }); return send(res, 400, { error: "Current password is incorrect." }), true; }
      const isOwner = roleFor(user) === "OWNER"; const minLength = isOwner ? OWNER_MIN : 8;
      const problem = passwordProblem(newPassword, { min: minLength, email: normalizeEmail(user.email) });
      if (problem?.code === "PASSWORD_TOO_SHORT") return send(res, 400, { error: `New password must contain at least ${minLength} characters.`, code: "PASSWORD_TOO_SHORT", minLength }), true;
      if (problem) return send(res, 400, { error: pwMessage(problem, false), code: problem.code }), true;
      if (newPassword !== confirmPassword) return send(res, 400, { error: "New passwords do not match.", code: "PASSWORD_MISMATCH" }), true;
      const users = readUsers(); Object.assign(user, hashPassword(newPassword)); user.passwordLastChangedAt = new Date().toISOString(); user.lastActivityAt = user.passwordLastChangedAt; users[user.id] = user; writeUsers(users);
      const sid = sessionId(req); const keep = isOwner ? null : (sid && /^[a-f0-9]{64}$/.test(sid) ? sessionKey(sid) : null); const revoked = revokeUserSessions(user.id, keep);
      recordAudit({ req, user, event: isOwner ? "OWNER_PASSWORD_CHANGED" : "password_change", context: `sessions_revoked=${revoked}` });
      if (isOwner) billing.notifyOwnerPasswordChanged?.(user);
      return send(res, 200, { ok: true, reauthRequired: isOwner, sessionsRevoked: revoked }, isOwner ? { "set-cookie": clearSessionCookies(req) } : {}), true;
    }

    // ---------------- Suppression de compte ----------------
    if (route === "/api/account/delete" && req.method === "POST") {
      const user = currentUser(req); if (!user) return send(res, 401, { error: "Authentication required." }), true;
      const gate = limitHit("delete:user", user.id, 5, 3600000); if (!gate.ok) return tooMany(res, gate, req, "account_delete"), true;
      if (roleFor(user) === "OWNER") { recordAudit({ req, user, event: "account_delete", result: "DENIED", context: "owner account is protected" }); return send(res, 403, { error: "The Owner account cannot be deleted.", code: "OWNER_PROTECTED" }), true; }
      const input = await body(req);
      if (!checkPassword(typeof input.password === "string" ? input.password : "", user).ok) { recordAudit({ req, user, event: "account_delete", result: "DENIED", context: "wrong password" }); return send(res, 400, { error: "Password is incorrect.", code: "INVALID_CREDENTIALS" }), true; }
      const orders = readOrders(); let touched = false; for (const order of Object.values(orders)) if (order.userId === user.id && ["CREATED", "PENDING", "PAYMENT_DETECTED"].includes(order.status)) { order.status = "CANCELLED"; order.updatedAt = new Date().toISOString(); (order.events ||= []).push({ ts: order.updatedAt, status: "CANCELLED", by: "system", note: "account deleted" }); touched = true; }
      if (touched) writeOrders(orders);
      revokeUserSessions(user.id); const users = readUsers(); delete users[user.id]; writeUsers(users);
      const ledger = readLedger(); if (ledger[user.id]) { delete ledger[user.id]; writeLedger(ledger); }
      purgeJournal?.(user.id);
      await releaseClaim("email", normalizeEmail(user.email));
      recordAudit({ req, user, event: "account_deleted", context: user.tradeMindId || "" });
      return send(res, 200, { ok: true }, { "set-cookie": clearSessionCookies(req) }), true;
    }

    // ---------------- Quotas de trades (compteur mensuel côté serveur) ----------------
    if ((route === "/api/trades/record" && req.method === "POST") || (route === "/api/trades/usage" && req.method === "GET")) {
      const user = currentUser(req); if (!user) return send(res, 401, { error: "Authentication required." }), true;
      const gate = limitHit("trades:user", user.id, 120, 600000); if (!gate.ok) return tooMany(res, gate, req, "trades"), true;
      const membership = effectiveMembership(user); const plan = membership.plan; const cap = PLANS[plan]?.tradeLimit ?? null; // null = illimité
      const month = new Date().toISOString().slice(0, 7); const ledger = readLedger(); const mine = ledger[user.id] || {}; const slot = mine[month] || { ids: [], n: 0 };
      const usage = () => ({ month, used: slot.n, limit: cap, remaining: cap === null ? null : Math.max(0, cap - slot.n), plan: PLANS[plan]?.identity || "FOUNDATION" });
      if (req.method === "GET") return send(res, 200, usage()), true;
      const input = await body(req); const tradeId = typeof input.tradeId === "string" ? input.tradeId : "";
      if (!TRADE_ID_RE.test(tradeId)) return send(res, 400, { error: "Invalid trade identifier.", code: "INVALID_TRADE_ID" }), true;
      if (slot.ids.includes(tradeId)) return send(res, 200, { ok: true, duplicate: true, ...usage() }), true; // idempotent : un nouvel essai ne consomme rien
      if (cap !== null && slot.n >= cap) { recordAudit({ req, user, event: "trade_limit_reached", result: "DENIED", context: `${PLANS[plan]?.identity} ${slot.n}/${cap}` }); return send(res, 403, { error: "Monthly trade limit reached for your plan.", code: "TRADE_LIMIT_REACHED", ...usage() }), true; }
      if (slot.ids.length < 600) slot.ids.push(tradeId); slot.n += 1;
      const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 24); const cutoffMonth = cutoff.toISOString().slice(0, 7); const keepMonths = { has: key => key >= cutoffMonth };
      ledger[user.id] = Object.fromEntries(Object.entries({ ...mine, [month]: slot }).filter(([key]) => keepMonths.has(key))); writeLedger(ledger);
      return send(res, 200, { ok: true, duplicate: false, ...usage() }), true;
    }
    return false;
  }
  return { handle };
}
