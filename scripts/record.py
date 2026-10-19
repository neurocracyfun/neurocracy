# Scroll video of the landing with Playwright: frames are captured while Lenis scrolls, then encoded with ffmpeg.
# Needs a running server (BASE, default http://127.0.0.1:5310). Usage: python3 scripts/record.py out.mp4 [mobile]
import os, sys, time, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://127.0.0.1:5310'); out = sys.argv[1]; mobile = len(sys.argv) > 2
W, H = (390, 844) if mobile else (1280, 720); FPS = 15
tmp = tempfile.mkdtemp(); n = 0
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'])
    ctx = br.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    pg = ctx.new_page(); pg.goto(BASE + '/', wait_until='networkidle'); time.sleep(3)
    def snap(k=1):
        global n
        for _ in range(k): pg.screenshot(path=f'{tmp}/{n:05d}.jpg', type='jpeg', quality=88); n += 1
    snap(20)
    if not mobile:
        pg.mouse.move(820, 330); pg.mouse.down()
        for i in range(18): pg.mouse.move(820 + i * 12, 330 + (i % 6) * 5); snap()
        pg.mouse.up(); snap(8)
    total = pg.evaluate('document.getElementById("now").offsetTop + innerHeight * 0.4')
    y = 0; step = 55 if not mobile else 45
    while y < total:
        y += step; pg.evaluate(f'window.__lenis ? window.__lenis.scrollTo({y}) : scrollTo(0,{y})'); snap()
    snap(20); br.close()
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{tmp}/%05d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', out], check=True)
shutil.rmtree(tmp); print(out, n, 'frames')
