// FPS probe: scrolls the landing page with wheel input and records rAF frame times.
// Usage: BASE=http://127.0.0.1:5310 node scripts/perf.js   (needs a running server)
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://127.0.0.1:5310';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(br, name, vp, throttle) {
  const p = await br.newPage(); await p.setViewport(vp);
  const cdp = await p.target().createCDPSession(); if (throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await wait(2500);
  const res = {}; await cdp.send('Performance.enable'); const met = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  for (const phase of ['idle', 'scroll']) {
    await p.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (t) => { window.__ft.push(t - l); l = t; if (window.__ft.length < 1e5) window.__rafid = requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const m0 = await met();
    if (phase === 'idle') await wait(4000);
    else for (let i = 0; i < 80; i++) { await p.mouse.wheel({ deltaY: 120 }); await wait(60); }
    const ft = await p.evaluate(() => { cancelAnimationFrame(window.__rafid); return window.__ft.slice(2); });
    const m1 = await met(); const secs = m1.Timestamp - m0.Timestamp;
    const s = [...ft].sort((a, b) => a - b); const sum = ft.reduce((a, b) => a + b, 0);
    res[phase] = { fps: +(ft.length / sum * 1000).toFixed(1), p95ms: +s[Math.floor(s.length * 0.95)].toFixed(1), jank: +(100 * ft.filter((x) => x > 25).length / ft.length).toFixed(1), mainBusyPct: +(100 * (m1.TaskDuration - m0.TaskDuration) / secs).toFixed(1), scriptMsPerFrame: +(1000 * (m1.ScriptDuration - m0.ScriptDuration) / ft.length).toFixed(2) };
  }
  res.heapMB = +((await met()).JSHeapUsedSize / 1048576).toFixed(1);
  console.log(JSON.stringify({ name, ...res })); await p.close();
}
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
  await run(br, 'desktop 1440x900', { width: 1440, height: 900, deviceScaleFactor: 1 });
  await run(br, 'desktop 1440x900 dpr2', { width: 1440, height: 900, deviceScaleFactor: 2 });
  await run(br, 'mobile 390x844 dpr3 cpu4x', { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 4);
  await run(br, 'mobile 390x844 dpr3 cpu6x', { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 6);
  await br.close();
})();
