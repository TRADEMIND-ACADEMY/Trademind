"""Chromium réel : lisibilité et absence de débordement horizontal (téléphone 360/390 px, ordinateur 1280 px) sur le site public, l'application et la page Owner."""
import os, subprocess, tempfile, time, uuid, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PORT = 6300 + int(uuid.uuid4().int % 300); BASE = f"http://127.0.0.1:{PORT}"
env = dict(os.environ, PORT=str(PORT), TM_DATA_DIR=tempfile.mkdtemp(prefix="tm-ty-"), TM_ROOT=ROOT, TM_TRUST_XFF="1")
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
        for w, h, label in ((360, 740, "tel 360"), (390, 844, "tel 390"), (1280, 800, "pc 1280")):
            ctx = b.new_context(viewport={"width": w, "height": h})
            for path, name in (("/", "site public"), ("/login", "application (connexion)"), ("/owner", "owner")):
                pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.goto(BASE + path); pg.wait_for_timeout(1200)
                sw = pg.evaluate("document.documentElement.scrollWidth"); 
                check(f"{label} · {name}: pas de défilement horizontal ({sw}/{w})", sw <= w + 1)
                fs = pg.evaluate("parseFloat(getComputedStyle(document.body).fontSize)")
                check(f"{label} · {name}: texte de base ≥ 14 px ({fs:.1f})", fs >= 14)
                tiny = pg.evaluate("""()=>{let n=0;document.querySelectorAll('body *').forEach(e=>{const t=[...e.childNodes].some(c=>c.nodeType===3&&c.textContent.trim().length>2);if(!t)return;const r=e.getBoundingClientRect();if(r.width===0||r.height===0)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<10)n++});return n}""")
                check(f"{label} · {name}: aucun texte visible < 10 px ({tiny})", tiny == 0)
                check(f"{label} · {name}: aucune erreur JS", not errs, errs)
                pg.close()
            ctx.close()
        # application connectée
        ctx = b.new_context(viewport={"width": 390, "height": 844}); pw = "Tr4de-Mind-Test-2026"
        r = ctx.request.post(BASE + "/api/auth/register", data={"email": f"t-{uuid.uuid4().hex[:8]}@example.com", "password": pw, "confirmPassword": pw, "firstName": "T", "lastName": "Y", "country": "CD", "acceptTerms": True})
        check("inscription de test", r.ok)
        pg = ctx.new_page(); pg.goto(BASE + "/app"); pg.wait_for_function("window.tmAccount && window.tmAccount.id", timeout=15000); pg.wait_for_timeout(1200)
        sw = pg.evaluate("document.documentElement.scrollWidth"); check(f"application connectée 390: pas de défilement horizontal ({sw})", sw <= 391)
        tiny = pg.evaluate("""()=>{let n=0;document.querySelectorAll('body *').forEach(e=>{const t=[...e.childNodes].some(c=>c.nodeType===3&&c.textContent.trim().length>2);if(!t)return;const r=e.getBoundingClientRect();if(r.width===0||r.height===0)return;if(parseFloat(getComputedStyle(e).fontSize)<10)n++});return n}""")
        print("  INFO  textes visibles < 10 px dans l'application connectée :", tiny)
        pg.screenshot(path=os.path.join(tempfile.gettempdir(), "tm-app-390.png"))
        b.close()
finally:
    srv.terminate()
print(f"\nRÉSULTAT: {ok} PASS, {fail} FAIL"); raise SystemExit(1 if fail else 0)
