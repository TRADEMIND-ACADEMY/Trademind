"""Test navigateur réel : bouton afficher/masquer le mot de passe (connexion/inscription de l'application + page Owner)."""
import os, subprocess, tempfile, time, uuid, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PORT = 5900 + int(uuid.uuid4().int % 300); BASE = f"http://127.0.0.1:{PORT}"
env = dict(os.environ, PORT=str(PORT), TM_DATA_DIR=tempfile.mkdtemp(prefix="tm-eye-"), TM_ROOT=ROOT, TM_TRUST_XFF="1")
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
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 800})
        for name, url in (("application", "/login"), ("owner", "/owner")):
            page = ctx.new_page(); errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(BASE + url); page.wait_for_timeout(1500)
            n = page.locator("input[type=password], input.__x").count()
            eyes = page.locator(".tm-pw-eye")
            check(f"{name}: un bouton œil par champ mot de passe ({eyes.count()})", eyes.count() >= 1 and eyes.count() >= n, f"{n}/{eyes.count()}")
            if eyes.count():
                inp = page.locator(".tm-pw-wrap input").first; eye = eyes.first
                inp.fill("Secret-123"); 
                check(f"{name}: masqué par défaut", inp.get_attribute("type") == "password")
                check(f"{name}: aria-pressed=false + libellé", eye.get_attribute("aria-pressed") == "false" and "assword" in (eye.get_attribute("aria-label") or "") or "passe" in (eye.get_attribute("aria-label") or ""))
                eye.click()
                check(f"{name}: affiché après clic", inp.get_attribute("type") == "text" and eye.get_attribute("aria-pressed") == "true" and inp.input_value() == "Secret-123")
                eye.click()
                check(f"{name}: re-masqué, valeur conservée", inp.get_attribute("type") == "password" and inp.input_value() == "Secret-123")
                bb = eye.bounding_box(); check(f"{name}: cible tactile ≥ 40 px", bb and bb["width"] >= 40 and bb["height"] >= 40)
                eye.focus(); page.keyboard.press("Enter")
                check(f"{name}: clavier (Entrée) bascule", inp.get_attribute("type") == "text")
            check(f"{name}: aucune erreur JS", not errs, errs)
        b.close()
finally:
    srv.terminate()
print(f"\nRÉSULTAT: {ok} PASS, {fail} FAIL"); raise SystemExit(1 if fail else 0)
