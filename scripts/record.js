// Short screen recording of the landing (hero rotate + drag + scroll). Needs ffmpeg and a running server.
const puppeteer = require('puppeteer-core'); const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:5310'; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await br.newPage(); await p.setViewport({ width: 1280, height: 720 });
  await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await wait(2500);
  const rec = await p.screencast({ path: path.join(__dirname, '..', 'docs', 'landing.webm') });
  await wait(3000);
  await p.mouse.move(880, 360); await p.mouse.down(); for (let i = 0; i < 30; i++) { await p.mouse.move(880 + i * 9, 360 + Math.sin(i / 5) * 30); await wait(30); } await p.mouse.up();
  await wait(1500);
  for (let y = 0; y <= 2400; y += 60) { await p.evaluate((y) => window.scrollTo(0, y), y); await wait(70); }
  await wait(1500);
  await p.evaluate(() => document.querySelectorAll('.chip')[2].click()); await wait(1500);
  await rec.stop(); await br.close(); console.log('ok');
})();
