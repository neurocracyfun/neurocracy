// Site audit: console errors, failed requests, horizontal overflow on mobile, missing labels/alt, internal links,
// empty states. Starts the app on a temp DB. Usage: node scripts/site-audit.js  (writes sim/site-audit.json)
const path = require('path'); const fs = require('fs'); const os = require('os'); const puppeteer = require('puppeteer-core');
const cfg = require('../lib/config'); const { createApp } = require('../server');
(async () => {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ncaudit-')), 'db.json');
  const a = createApp({ ...cfg, db }, { steer: async () => ({ steered: 'x', normal: 'y', share: null }) }); const srv = a.app.listen(0); const B = 'http://127.0.0.1:' + srv.address().port;
  const br = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pages = ['/', '/vote', '/lab', '/hall', '/verify', '/verify?round=3', '/nope']; const out = []; const links = new Set();
  for (const vp of [{ width: 1366, height: 860 }, { width: 375, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]) {
    for (const u of pages) {
      const p = await br.newPage(); await p.setViewport(vp); const errs = []; const failed = [];
      p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160))); p.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 160)));
      p.on('requestfailed', (r) => failed.push(r.url().slice(0, 100))); p.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/nope') && failed.push(r.status() + ' ' + r.url().slice(0, 100)));
      const t0 = Date.now(); await p.goto(B + u, { waitUntil: 'networkidle0', timeout: 30000 }).catch((e) => errs.push('goto ' + e.message)); const ms = Date.now() - t0;
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await new Promise((r) => setTimeout(r, 600));
      const r = await p.evaluate(() => {
        const vis = (e) => e.offsetParent !== null;
        const noLabel = [...document.querySelectorAll('input,textarea,select')].filter((e) => vis(e) && e.type !== 'hidden' && !e.labels?.length && !e.getAttribute('aria-label') && !e.closest('label')).map((e) => e.id || e.name || e.type);
        const noName = [...document.querySelectorAll('button,a')].filter((e) => vis(e) && !(e.innerText || '').trim() && !e.getAttribute('aria-label') && !e.title).map((e) => e.outerHTML.slice(0, 80));
        const noAlt = [...document.querySelectorAll('img')].filter((e) => !e.hasAttribute('alt')).map((e) => e.src.slice(-40));
        const wide = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 5).map((e) => e.tagName + '.' + (e.className || '').toString().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().right));
        const small = [...document.querySelectorAll('button,a,input')].filter((e) => vis(e) && window.innerWidth < 500 && e.getBoundingClientRect().height < 24 && e.getBoundingClientRect().width > 0 && !e.closest('p') && !e.closest('li')).length;
        return { title: document.title, h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang, noLabel, noName, noAlt, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, wide, small, links: [...document.querySelectorAll('a[href]')].map((a) => a.href), text: document.body.innerText.slice(0, 20000) };
      });
      r.links.forEach((l) => links.add(l)); out.push({ page: u, viewport: vp.width, ms, errs, failed, ...r, links: undefined, text: vp.width > 400 ? r.text : undefined }); await p.close();
    }
  }
  const linkRes = {}; for (const l of links) { if (!l.startsWith('http')) continue; if (l.startsWith(B)) { const r = await fetch(l.split('#')[0]); linkRes[l.replace(B, '')] = r.status; } else linkRes[l] = 'external'; }
  await br.close(); srv.close(); fs.mkdirSync(path.join(__dirname, '..', 'sim'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'sim', 'site-audit.json'), JSON.stringify({ pages: out, links: linkRes }, null, 1));
  for (const o of out) console.log(o.viewport, o.page, o.ms + 'ms', 'title:', o.title, '| h1', o.h1, '| errs', JSON.stringify(o.errs), '| failed', JSON.stringify(o.failed), '| noLabel', o.noLabel.join(','), '| noName', o.noName.length, '| noAlt', o.noAlt.length, '| overflowX', o.overflowX, o.wide.join(';'), '| small', o.small);
  console.log('links', JSON.stringify(linkRes)); process.exit(0);
})();
