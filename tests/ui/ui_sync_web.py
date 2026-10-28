"""Test navigateur réel (Chromium) : le client de synchronisation du SITE contre le vrai serveur, avec un « mobile » simulé par l'API."""
import json, os, subprocess, sys, tempfile, time, uuid, shutil
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PORT = 5500 + int(uuid.uuid4().int % 300)
BASE = f"http://127.0.0.1:{PORT}"
DATA = tempfile.mkdtemp(prefix="tm-ui-")
env = dict(os.environ, PORT=str(PORT), TM_DATA_DIR=DATA, TM_ROOT=ROOT, TM_TRUST_XFF="1")
srv = subprocess.Popen(["node", "server.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print("  PASS ", name)
    else: fail += 1; print("  FAIL ", name, detail)
try:
    import urllib.request
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/api/billing/catalog"); break
        except Exception: time.sleep(0.15)
    pw = "Tr4de-Mind-Test-2026"; email = f"w-{uuid.uuid4().hex[:8]}@example.com"
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 800}, bypass_csp=True)
        reg = ctx.request.post(BASE + "/api/auth/register", data={"email": email, "password": pw, "confirmPassword": pw, "firstName": "W", "lastName": "S", "country": "FR", "language": "fr"})
        check("Compte créé et session web ouverte", reg.ok)
        page = ctx.new_page(); errors = []; pushes = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: pushes.append(r.url) if "/api/sync/push" in r.url else None)
        page.goto(BASE + "/app"); page.wait_for_function("window.tmAccount && window.tmAccount.id && window.__tmSync", timeout=15000)
        def state(): return json.loads(ctx.request.get(BASE + "/api/sync/state?since=0").text())["records"]
        def wait_ok(t=15000): page.wait_for_function("window.__tmSync.status().state==='ok'", timeout=t)
        page.evaluate("window.__tmSync.sync()"); wait_ok()
        tid = "web" + uuid.uuid4().hex[:8]
        page.evaluate("""(id)=>{ST.trades.push({id,date:'2026-10-05',time:'09:30',symbol:'EURUSD',direction:'buy',session:'London',setup:'BOS',entry:1.1,sl:1.09,tp:1.12,lot:0.5,risk:1,result:'win',pnl:120,notes:'depuis le site',flags:['fomo'],psyAfter:[],smc:{checks:{a:true},score:70}});save();}""", tid)
        page.wait_for_function("window.__tmSync.status().state==='ok' && window.__tmSync.status().pending===0", timeout=15000)
        time.sleep(1.8); page.evaluate("window.__tmSync.sync()"); wait_ok()
        recs = [r for r in state() if r["kind"] == "trade" and r["id"] == tid]
        check("Trade créé sur le site arrive sur le serveur", len(recs) == 1 and recs[0]["data"]["symbol"] == "EURUSD" and recs[0]["data"]["size"] == 0.5)
        check("Données propres au site conservées (ext.web : flags, smc)", recs and recs[0]["data"]["ext"]["web"]["smc"]["score"] == 70)
        # « mobile » : même compte, jeton Bearer
        m = p.request.new_context(extra_http_headers={"origin": "https://localhost", "x-tm-client": "mobile"})
        lj = json.loads(m.post(BASE + "/api/auth/login", data={"email": email, "password": pw}).text()); tok = lj["token"]
        H = {"authorization": "Bearer " + tok, "origin": "https://localhost", "x-tm-client": "mobile"}
        mid = "mob" + uuid.uuid4().hex[:8]
        pr = json.loads(m.post(BASE + "/api/sync/push", headers=H, data={"changes": [{"kind": "trade", "id": mid, "baseVersion": 0, "data": {"id": mid, "date": "2026-10-06", "time": "", "symbol": "XAUUSD", "direction": "sell", "session": "", "setup": "", "result": "loss", "notes": "depuis le mobile", "pnl": -40, "entry": 2300, "ext": {"mobile": {"planName": "SMC", "score": 61}}}}]}).text())
        check("Mobile (jeton) crée un trade sur le compte", pr["results"][0]["status"] == "ok")
        page.evaluate("window.__tmSync.sync()"); wait_ok()
        got = page.evaluate("(id)=>{const t=ST.trades.find(x=>x.id===id);return t&&{symbol:t.symbol,direction:t.direction,flags:Array.isArray(t.flags),smc:!!t.smc,pnl:t.pnl}}", mid)
        check("Le trade créé sur le mobile apparaît dans le journal du site", got and got["symbol"] == "XAUUSD" and got["direction"] == "sell" and got["flags"] and got["smc"], str(got))
        page.evaluate("renderAll()")  # le journal s'affiche sans erreur avec un trade venu du mobile
        page.wait_for_timeout(400)
        # modification d'un trade mobile depuis le site, puis relecture mobile
        page.evaluate("(id)=>{ST.trades.find(x=>x.id===id).notes='édité sur le site';save();}", mid); page.wait_for_timeout(1800); page.evaluate("window.__tmSync.sync()"); wait_ok()
        sv = [r for r in state() if r["id"] == mid][0]
        check("Édition sur le site : version 2 sur le serveur, données mobiles (ext.mobile) conservées", sv["v"] >= 2 and sv["data"]["notes"] == "édité sur le site" and sv["data"]["ext"]["mobile"]["score"] == 61, json.dumps(sv)[:200])
        # suppression isolée
        page.evaluate("(id)=>{ST.trades=ST.trades.filter(x=>x.id!==id);save();}", mid); page.wait_for_timeout(1800); page.evaluate("window.__tmSync.sync()"); wait_ok()
        check("Suppression d'un trade propagée (tombstone)", [r for r in state() if r["id"] == mid][0]["deleted"] is True)
        # DÉMO
        before = len(pushes)
        page.evaluate("""()=>{ST.trades=[];for(let i=0;i<5;i++)ST.trades.push({id:'dm'+i+'abcdef',date:'2026-10-0'+(i+1),symbol:'EURUSD',direction:'buy',entry:1.1,sl:1.09,risk:1,result:'win',pnl:10,notes:'Demo trade — for exploring the app.',isDemo:true,flags:[],psyAfter:[],smc:{checks:{},score:50}});save();}""")
        page.wait_for_timeout(2500); page.evaluate("window.__tmSync.sync()"); page.wait_for_timeout(800)
        check("En démo : l'état affiché est « démo » et aucune requête d'envoi", page.evaluate("window.__tmSync.status().state") == "demo" and len(pushes) == before)
        check("En démo : les trades réels du compte ne sont pas supprimés", [r for r in state() if r["id"] == tid][0]["deleted"] is False)
        check("Aucun trade démo sur le serveur", not any(r["id"].startswith("dm") for r in state()))
        page.evaluate("()=>{ST.trades=ST.trades.filter(t=>!t.isDemo);save();}"); page.wait_for_timeout(2000); page.evaluate("window.__tmSync.sync()"); wait_ok()
        back = page.evaluate("(id)=>ST.trades.some(t=>t.id===id)", tid)
        check("Après la démo : les vrais trades du compte sont restaurés dans le journal", back)
        # mode hors ligne
        ctx.set_offline(True); oid = "off" + uuid.uuid4().hex[:8]
        page.evaluate("""(id)=>{ST.trades.push({id,date:'2026-10-07',symbol:'GBPUSD',direction:'buy',entry:1.3,sl:1.29,risk:1,result:'win',pnl:50,notes:'',flags:[],psyAfter:[],smc:{checks:{},score:null}});save();}""", oid)
        page.wait_for_timeout(2500); page.evaluate("window.__tmSync.sync().catch(()=>{})"); page.wait_for_timeout(800)
        check("Hors ligne : trade conservé localement, état signalé", page.evaluate("window.__tmSync.status().state") in ("offline", "error") and page.evaluate("(id)=>ST.trades.some(t=>t.id===id)", oid))
        ctx.set_offline(False); page.evaluate("window.__tmSync.sync()"); wait_ok(20000)
        check("Retour du réseau : trade envoyé au compte", any(r["id"] == oid for r in state()))
        chip = page.evaluate("(()=>{const c=document.getElementById('tm-sync-chip');return c&&{shown:getComputedStyle(c).display!=='none',text:c.textContent}})()")
        check("Pastille de statut visible (« Synchronisé »)", chip and chip["shown"] and ("Synchronis" in chip["text"] or "Synced" in chip["text"]), str(chip))
        page.screenshot(path=os.path.join(tempfile.gettempdir(), "web-sync.png"))
        real_errors = [e for e in errors if "favicon" not in e and "Failed to load resource" not in e]
        check("Aucune erreur JavaScript dans la console", not real_errors, str(real_errors[:3]))
        b.close()
finally:
    srv.terminate(); shutil.rmtree(DATA, ignore_errors=True)
print(f"\nRÉSULTAT: {ok}/{ok+fail} réussis"); sys.exit(1 if fail else 0)
