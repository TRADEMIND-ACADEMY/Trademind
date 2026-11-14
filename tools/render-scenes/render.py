"""Rendu hors ligne des scènes TradeMind (shader tm-scene.glsl) -> PNG -> WebP.
Usage : python3 render.py <scene 1..6> <sortie.png> [largeur hauteur] [yaw pitch dist shiftx tx ty tz time]"""
import sys, base64, json
from playwright.sync_api import sync_playwright
GLSL = open("/home/claude/w/products/public-site/assets/tm-scene.glsl", encoding="utf-8").read()
scene = int(sys.argv[1]); out = sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1280; H = int(sys.argv[4]) if len(sys.argv) > 4 else 720
cam = [float(x) for x in sys.argv[5:14]] if len(sys.argv) > 5 else [.35, .12, 6.2, .18, 0, .25, 0, 6.0]
yaw, pit, dist, shx, tx, ty, tz, tm = (cam + [0] * 8)[:8]
HTML = "<canvas id=c></canvas>"
JS = """
async ([glsl, scene, W, H, cam, tile]) => {
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const gl = c.getContext('webgl', {preserveDrawingBuffer: true, antialias: false});
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, '#define SCENE ' + scene + '\\n' + glsl); gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return 'ERR:' + gl.getShaderInfoLog(fs);
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = n => gl.getUniformLocation(pr, n);
  gl.uniform2f(u('uFull'), W, H); gl.uniform1f(u('uTime'), cam.time);
  gl.uniform4f(u('uCam'), cam.yaw, cam.pit, cam.dist, cam.shx); gl.uniform3f(u('uTarget'), cam.tx, cam.ty, cam.tz); gl.uniform2f(u('uMouse'), 0, 0);
  gl.enable(gl.SCISSOR_TEST);
  for (let y = 0; y < H; y += tile) for (let x = 0; x < W; x += tile) {
    gl.scissor(x, y, tile, tile); gl.uniform2f(u('uOff'), 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish();
    await new Promise(r => setTimeout(r, 0));
  }
  return c.toDataURL('image/png');
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-watchdog"])
    pg = b.new_page(); pg.set_content(HTML); pg.set_default_timeout(1800000)
    res = pg.evaluate(JS, [GLSL, scene, W, H, dict(yaw=yaw, pit=pit, dist=dist, shx=shx, tx=tx, ty=ty, tz=tz, time=tm), 160])
    b.close()
if res.startswith("ERR:"): print(res); sys.exit(1)
open(out, "wb").write(base64.b64decode(res.split(",", 1)[1])); print("ok", out, W, H)
