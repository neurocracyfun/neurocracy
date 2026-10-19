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
  if (want('landing')) {
    const p = await page(1440, 900); await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await wait(3500);
    await p.screenshot({ path: out('landing-hero.png') });
    for (const id of ['now', 'compare', 'how', 'token', 'trust']) { await p.evaluate((id) => { const el = document.getElementById(id); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 40); }, id); await wait(1500); await p.screenshot({ path: out(`landing-${id}.png`) }); }
    await p.close();
  }
  if (want('mobile')) {
    const p = await page(390, 844, true); await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await wait(3500);
    await p.screenshot({ path: out('mobile-hero.png') });
    await p.evaluate(() => window.scrollTo(0, document.getElementById('compare').offsetTop - 20)); await wait(1500); await p.screenshot({ path: out('mobile-compare.png') });
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
