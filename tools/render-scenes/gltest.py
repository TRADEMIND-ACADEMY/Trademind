from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg=b.new_page()
    pg.set_content("<canvas id=c></canvas>")
    print(pg.evaluate("""()=>{const g=document.getElementById('c').getContext('webgl');if(!g)return 'NO WEBGL';const d=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(g.VERSION)+' | '+(d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?')+' maxTex='+g.getParameter(g.MAX_TEXTURE_SIZE)}"""))
    b.close()
