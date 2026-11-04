"""Test navigateur : menu compte (avatar, déconnexion) et bouton DAN discret/déplaçable."""
import os, subprocess, tempfile, time, uuid, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOTS = os.environ.get("SHOTS", "")
PORT = 6700 + int(uuid.uuid4().int % 200); BASE = f"http://127.0.0.1:{PORT}"
env = dict(os.environ, PORT=str(PORT), TM_DATA_DIR=tempfile.mkdtemp(prefix="tm-acc-"), TM_ROOT=ROOT, TM_TRUST_XFF="1")
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
            page.goto(BASE + "/login"); page.wait_for_selector("#tm-auth-card"); page.click("#tm-toggle")
            page.fill("#tm-first-name", "Jean"); page.click("#tm-next"); page.wait_for_timeout(400)
            page.fill("#tm-email", f"a{uuid.uuid4().hex[:8]}@example.com"); page.fill("#tm-password", "Abcdefg1"); page.fill("#tm-confirm", "Abcdefg1"); page.click("#tm-next")
            page.wait_for_url("**/app**", timeout=8000); page.wait_for_timeout(4800)
            if page.locator("#skipIntro").count(): page.evaluate("document.getElementById('splash')&&document.getElementById('splash').remove()")
            check(f"{w}: ancienne barre fixe supprimée", page.locator(".tm-auth-account").count() == 0)
            acc = page.locator("#tm-acc-btn"); check(f"{w}: avatar dans la barre du haut", acc.count() == 1 and page.locator(".topbar .topactions #tm-acc-btn").count() == 1)
            bb = acc.bounding_box(); check(f"{w}: avatar visible en haut", bb and bb["y"] < 120)
            acc.click(); page.wait_for_timeout(350)
            check(f"{w}: menu compte ouvert + Se déconnecter visible", page.locator("#tm-acc-pop.open .tm-out").is_visible())
            if SHOTS and w == 390: page.screenshot(path=SHOTS + "/acc.png")
            page.keyboard.press("Escape"); page.wait_for_timeout(200)
            check(f"{w}: Échap ferme le menu", not page.locator("#tm-acc-pop.open").count())
            dan = page.locator("#tm-dan-fab"); db = dan.bounding_box()
            check(f"{w}: DAN petit (≤44px) au bord droit, pas en bas", db and db["width"] <= 44 and db["x"] + db["width"] >= w - 12 and db["y"] + db["height"] < 844 * 0.8, db)
            check(f"{w}: logo DAN SVG hexagonal", page.locator("#tm-dan-fab .tm-dan-logo .hex").count() == 1)
            dan.click(); page.wait_for_timeout(300)
            cb = page.locator("#tm-dan-chat").bounding_box()
            check(f"{w}: panneau DAN ouvert en haut", page.locator("#tm-dan-chat.open").count() == 1 and cb["y"] < 150, cb)
            if SHOTS and w == 390: page.screenshot(path=SHOTS + "/dan.png")
            dan.click(); page.wait_for_timeout(200)
            # glisser vers la gauche
            cx, cy = db["x"] + db["width"] / 2, db["y"] + db["height"] / 2
            page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(60, cy + 60, steps=10); page.mouse.up(); page.wait_for_timeout(200)
            nb = dan.bounding_box()
            check(f"{w}: DAN déplaçable (colle au bord gauche) sans ouvrir le chat", nb["x"] < 20 and page.locator("#tm-dan-chat.open").count() == 0, nb)
            page.reload(); page.wait_for_timeout(1500)
            if page.locator("#splash").count(): page.evaluate("document.getElementById('splash').remove()")
            check(f"{w}: position mémorisée après rechargement", page.locator("#tm-dan-fab").bounding_box()["x"] < 20)
            page.locator("#tm-acc-btn").click(); page.locator("#tm-acc-pop .tm-out").click(); page.wait_for_url("**/login**", timeout=6000)
            check(f"{w}: déconnexion → /login", "/login" in page.url)
            check(f"{w}: aucune erreur JS", not errs, errs)
            ctx.close()
        b.close()
finally:
    srv.terminate()
print(f"RÉSULTAT: {ok} PASS, {fail} FAIL"); sys.exit(1 if fail else 0)
