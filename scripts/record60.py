# Deterministic 60 fps scroll video: a virtual clock drives requestAnimationFrame/performance.now,
# each frame advances exactly 1/60 s, then a screenshot is taken. CSS transitions are slowed to match.
# Needs a running server (BASE, default http://127.0.0.1:5310). Usage: python3 scripts/record60.py out.mp4 [mobile]
import os, sys, time, math, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://127.0.0.1:5310'); out = sys.argv[1]; mobile = len(sys.argv) > 2
W, H = (390, 844) if mobile else (1280, 720); FPS = 60; DT = 1000 / FPS
CLOCK = """(() => { let now = performance.now(); const realNow = performance.now.bind(performance); let q = [], id = 0;
  performance.now = () => now; const d0 = Date.now(); const r0 = now; Date.now = () => d0 + (now - r0);
  window.requestAnimationFrame = (f) => { q.push([++id, f]); return id; }; window.cancelAnimationFrame = (i) => { q = q.filter((x) => x[0] !== i); };
  window.__step = (dt) => { now += dt; const run = q; q = []; for (const [, f] of run) { try { f(now); } catch (e) { console.error(e); } } }; })();"""
tmp = tempfile.mkdtemp(); n = 0
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'])
    ctx = br.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    ctx.add_init_script(CLOCK)
    pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg); cdp.send('Animation.enable')
    pg.goto(BASE + '/', wait_until='networkidle')
    for _ in range(120): pg.evaluate(f'__step({DT})')
    def frame(y=None):
        global n
        js = f'__step({DT})' if y is None else f'(window.__lenis ? window.__lenis.scrollTo({y:.1f}, {{ immediate: true, force: true }}) : scrollTo(0,{y:.1f})), __step({DT})'
        pg.evaluate(js); pg.screenshot(path=f'{tmp}/{n:05d}.jpg', type='jpeg', quality=90); n += 1
    t0 = time.time(); [frame() for _ in range(10)]; per = (time.time() - t0) / 10 * 1000
    cdp.send('Animation.setPlaybackRate', {'playbackRate': max(0.05, DT / per)})  # CSS transitions in step with video time
    [frame() for _ in range(80)]
    if not mobile:
        pg.mouse.move(820, 330); pg.mouse.down()
        for i in range(60): pg.mouse.move(820 + i * 4, 330 + 12 * math.sin(i / 9)); frame()
        pg.mouse.up(); [frame() for _ in range(40)]
    stops = pg.evaluate('''(() => { const t = (id, f) => { const e = document.getElementById(id); return e.offsetTop + Math.max(0, e.offsetHeight - innerHeight) * f; };
      return [0, t('story', 0.2), t('story', 0.62), t('story', 1), t('gallery', 0.35), t('gallery', 0.9), t('now', 0), t('how', 0), t('token', 0)]; })()''')
    ease = lambda x: x * x * (3 - 2 * x)
    for a, b in zip(stops, stops[1:]):
        steps = int(max(50, min(150, abs(b - a) / (14 if not mobile else 12))))
        for k in range(1, steps + 1): frame(a + (b - a) * ease(k / steps))
        for _ in range(35): frame(b)
    br.close()
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{tmp}/%05d.jpg', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', out], check=True)
shutil.rmtree(tmp); print(out, n, 'frames', f'{n / FPS:.1f}s')
