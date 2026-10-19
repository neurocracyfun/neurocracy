// Screenshots for README/docs. Needs a running server (BASE, default http://127.0.0.1:5310).
const puppeteer = require('puppeteer-core'); const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:5310';
const out = (f) => path.join(__dirname, '..', 'docs', f); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.env.ONLY || '').split(',').filter(Boolean);
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const page = async (w, h, mobile = false) => { const p = await br.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile }); p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); return p; };
  const want = (n) => !only.length || only.includes(n);
  const go = (p, y) => p.evaluate((y) => { if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y); }, y);
  const at = (p, id, frac = 0) => p.evaluate((id, frac) => { const el = document.getElementById(id); return el.offsetTop + Math.max(0, el.offsetHeight - innerHeight) * frac; }, id, frac);
  const plan = [['hero', 'top', 0], ['story-a', 'story', 0.12], ['story-b', 'story', 0.56], ['story-c', 'story', 0.95], ['gallery-a', 'gallery', 0.08], ['gallery-b', 'gallery', 0.7], ['now', 'now', 0], ['how', 'how', 0], ['token', 'token', 0], ['trust', 'trust', 0]];
  if (want('landing')) {
    const p = await page(1440, 900); await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await wait(3800);
    for (const [name, id, f] of plan) { await go(p, await at(p, id, f)); await wait(name === 'hero' ? 200 : 1700); await p.screenshot({ path: out(`landing-${name}.png`) }); }
    await p.close();
  }
  if (want('mobile')) {
    const p = await page(390, 844, true); await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await wait(3800);
    for (const [name, id, f] of [['hero', 'top', 0], ['story', 'story', 0.9], ['gallery', 'gallery', 0], ['now', 'now', 0], ['token', 'token', 0]]) { await go(p, await at(p, id, f)); await wait(1600); await p.screenshot({ path: out(`mobile-${name}.png`) }); }
    await p.close();
  }
  for (const pg of ['vote', 'lab', 'hall']) if (want(pg)) {
    const p = await page(1440, 900); await p.goto(BASE + '/' + pg, { waitUntil: 'networkidle0' }); await wait(2500);
    if (pg === 'lab') { await p.evaluate(() => window.__demo && window.__demo()); await wait(2500); }
    await p.screenshot({ path: out(pg + '.png') }); await p.close();
  }
  await br.close();
  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors');
})();
