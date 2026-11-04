"""Test navigateur : connexion / inscription structurées (étapes, œil bien placé, champ mot de passe accessible, animations)."""
import os, subprocess, tempfile, time, uuid, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOTS = os.environ.get("SHOTS", "")
PORT = 6300 + int(uuid.uuid4().int % 300); BASE = f"http://127.0.0.1:{PORT}"
env = dict(os.environ, PORT=str(PORT), TM_DATA_DIR=tempfile.mkdtemp(prefix="tm-auth-"), TM_ROOT=ROOT, TM_TRUST_XFF="1")
srv = subprocess.Popen(["node", "server.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ok = fail = 0
def check(n, c, d=""):
    global ok, fail
    if c: ok += 1; print("  PASS ", n)
    else: fail += 1; print("  FAIL ", n, d)
try:
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/api/billing/catalog"); break
        except Exception: time.sleep(0.15)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w in (390, 1280):
            ctx = b.new_context(viewport={"width": w, "height": 844}); page = ctx.new_page(); errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(BASE + "/login"); page.wait_for_selector("#tm-auth-card"); page.wait_for_timeout(1200)
            # champ mot de passe cliquable directement, sans passer par l'e-mail
            pw = page.locator("#tm-password"); pw.click(); page.keyboard.type("MotDePasse1")
            check(f"{w}: mot de passe saisissable sans e-mail", pw.input_value() == "MotDePasse1")
            eye = page.locator("#tm-auth-card .tm-pw-eye").first; eb = eye.bounding_box(); ib = pw.bounding_box()
            check(f"{w}: œil 40x40 et dans le champ", eb and abs(eb["width"] - 40) < 1 and eb["x"] >= ib["x"] and eb["x"] + eb["width"] <= ib["x"] + ib["width"] + 1 and eb["y"] >= ib["y"] - 2 and eb["y"] + eb["height"] <= ib["y"] + ib["height"] + 2, (eb, ib))
            eye.click(); check(f"{w}: œil affiche le mot de passe", pw.get_attribute("type") == "text")
            page.locator("#tm-email").click(); page.keyboard.type("x@y.co")
            check(f"{w}: e-mail saisissable après", page.locator("#tm-email").input_value() == "x@y.co")
            if SHOTS and w == 390: page.screenshot(path=SHOTS + "/login.png")
            # inscription 2 étapes
            page.click("#tm-toggle"); page.wait_for_timeout(500)
            check(f"{w}: étape 1 visible, mot de passe masqué", page.locator("#tm-first-name").is_visible() and not page.locator("#tm-password").is_visible())
            page.click("#tm-next"); page.wait_for_timeout(200)
            check(f"{w}: prénom requis pour continuer", page.locator("#tm-first-name").is_visible() and page.locator("#tm-auth-card .tm-auth-error").inner_text().strip() != "")
            page.fill("#tm-first-name", "Jean"); page.fill("#tm-last-name", "Test"); page.fill("#tm-country", "RDC")
            if SHOTS and w == 390: page.screenshot(path=SHOTS + "/reg1.png")
            page.click("#tm-next"); page.wait_for_timeout(600)
            check(f"{w}: étape 2 visible", page.locator("#tm-email").is_visible() and page.locator("#tm-password").is_visible() and not page.locator("#tm-first-name").is_visible())
            page.fill("#tm-email", f"u{uuid.uuid4().hex[:8]}@example.com"); page.fill("#tm-password", "Abcdefg1"); page.fill("#tm-confirm", "Abcdefg1")
            check(f"{w}: règles mot de passe cochées", page.locator(".tm-rules li.ok").count() == 4)
            if SHOTS and w == 390: page.screenshot(path=SHOTS + "/reg2.png")
            page.click("#tm-prev"); page.wait_for_timeout(500)
            check(f"{w}: retour conserve les valeurs", page.input_value("#tm-first-name") == "Jean")
            page.click("#tm-next"); page.wait_for_timeout(500)
            page.fill("#tm-confirm", "Autre1234"); page.click("#tm-next"); page.wait_for_timeout(200)
            check(f"{w}: confirmation différente refusée", "correspondent" in page.locator("#tm-auth-card .tm-auth-error").inner_text() or "match" in page.locator("#tm-auth-card .tm-auth-error").inner_text())
            page.fill("#tm-confirm", "Abcdefg1"); page.click("#tm-next")
            page.wait_for_url("**/app**", timeout=8000)
            check(f"{w}: inscription réussie → /app", "/app" in page.url)
            check(f"{w}: aucune erreur JS", not errs, errs)
            ctx.close()
        b.close()
finally:
    srv.terminate()
print(f"RÉSULTAT: {ok} PASS, {fail} FAIL"); sys.exit(1 if fail else 0)
