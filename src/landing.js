import Lenis from 'lenis';
import { $, esc, api, clock, fmt, ago, mixHTML, startBrain, fireFor, reveals } from './common.js';
import { regionFor } from './brain.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => innerWidth <= 900;
const b = startBrain($('#grab'));
if (b) $('#hud-n').textContent = fmt(b.stats.neurons);
reveals();
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.2 });
document.querySelectorAll('.lines, .hx-title .ln').forEach((el) => io.observe(el));

// smooth scroll: one Lenis instance, driven from the single rAF loop below (no CSS smooth scrolling on top)
let lenis = null;
if (!reduce) { lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.9 }); window.__lenis = lenis; }

let cards = [];
const callouts = [...document.querySelectorAll('.callout')];
// layout cache: read geometry only on resize / content change, never inside the scroll loop
const L = { vh: innerHeight, vw: innerWidth, story: 0, storyH: 1, gal: 0, galH: 1, now: 0, max: 0, cards: [], callouts: [] };
const docTop = (el) => { let y = 0; while (el) { y += el.offsetTop; el = el.offsetParent; } return y; };
function layout() {
  L.vh = innerHeight; L.vw = innerWidth;
  const st = $('#story'), ga = $('#gallery'); L.story = docTop(st); L.storyH = st.offsetHeight; L.gal = docTop(ga); L.galH = ga.offsetHeight; L.now = docTop($('#now'));
  const track = $('#track'); L.max = Math.max(0, track.scrollWidth - innerWidth);
  L.cards = cards.map((c) => ({ el: c, mid: c.offsetLeft + c.offsetWidth / 2 }));
  L.callouts = callouts.map((c) => { const r = c.getBoundingClientRect(); return { r: c.classList.contains('r'), x: c.classList.contains('r') ? r.left : r.right, y: r.top + scrollY, show: r.width > 0 }; });
  dirty = true;
}
let dirty = true; let lastY = -1;
addEventListener('resize', () => { layout(); });

// hero callouts with leader lines to brain regions
const svg = $('#leaders');
let cy = 0;
if (b) {
  b.setAnchors(callouts.map((c) => regionFor(c.dataset.r)));
  svg.innerHTML = callouts.map(() => '<line/><circle r="2.5"/>').join('');
  const lines = svg.querySelectorAll('line'); const dots = svg.querySelectorAll('circle');
  let svgOp = -1;
  b.onFrame = (pts) => {
    const lim = L.vh * 0.7; const vis = cy < lim; const op = vis ? +(1 - cy / lim).toFixed(2) : 0;
    if (op !== svgOp) { svg.style.opacity = op; svgOp = op; } if (!vis) return;
    for (let i = 0; i < callouts.length; i++) {
      const p = pts[i]; const c = L.callouts[i]; const show = !!p && c && c.show;
      const d = show ? '' : 'none'; if (lines[i].style.display !== d) lines[i].style.display = dots[i].style.display = d; if (!show) continue;
      const y1 = c.y - cy;
      lines[i].setAttribute('x1', c.x); lines[i].setAttribute('y1', y1);
      lines[i].setAttribute('x2', p.x); lines[i].setAttribute('y2', p.y); dots[i].setAttribute('cx', p.x); dots[i].setAttribute('cy', p.y);
    }
  };
  let ci = 0;
  setInterval(() => { if (document.hidden || cy > L.vh) return; callouts.forEach((c) => c.classList.remove('hot')); const k = ci++ % callouts.length; if (!L.callouts[k] || !L.callouts[k].show) return; callouts[k].classList.add('hot'); fireFor(callouts[k].dataset.r, 2.2); }, 2600);
}

// story: the normal answer morphs into the steered one as you scroll
let story = { normal: 'I am Gemma, an open-weights AI assistant. I am a large language model trained by Google DeepMind.', steered: 'I am a bird. This majestic creature is soaring high above, its keen eyes scanning the landscape for prey.' };
const GLYPH = 'abcdefghijklmnopqrstuvwxyz';
function morph(t) {
  const A = story.normal, B = story.steered; const k = Math.round(t * Math.max(A.length, B.length));
  if (t <= 0) return esc(A); if (t >= 1) return esc(B);
  let noise = ''; for (let i = 0; i < 5; i++) noise += GLYPH[(Math.random() * 26) | 0];
  return esc(B.slice(0, k)) + `<span class="x">${noise}</span>` + esc(A.slice(Math.min(A.length, k + 5)));
}
const prog = (top, h) => Math.min(1, Math.max(0, (cy - top) / Math.max(1, h - L.vh)));
const sls = [...document.querySelectorAll('.sl')].map((el) => ({ el, at: Number(el.dataset.at), on: false }));
const spVal = $('#sp-val'), spBar = $('#sp-bar'), spA = $('#sp-a'), spTag = $('#sp-tag');
let lastStr = -1; let lastFire = 0;
function storyFrame() {
  if (!reduce && (cy + L.vh < L.story || cy > L.story + L.storyH)) return; // off screen
  const p = reduce ? 1 : prog(L.story, L.storyH);
  for (const s of sls) { const on = p >= s.at; if (on !== s.on) { s.on = on; s.el.classList.toggle('on', on); } }
  const t = Math.min(1, Math.max(0, (p - 0.42) / 0.28)); const str = Math.round(t * 60);
  if (str !== lastStr) {
    spVal.textContent = '+' + str; spBar.style.transform = `scaleX(${t})`; spA.innerHTML = morph(t);
    spTag.textContent = t >= 1 ? 'steered, owl feature at +60' : t > 0 ? 'steering' : 'normal model'; lastStr = str;
  }
  if (t > 0.5 && performance.now() - lastFire > 900) { lastFire = performance.now(); fireFor('p:owl', 1.6); }
}

// horizontal gallery driven by vertical scroll (native swipe on mobile)
let curCard = null;
const track = $('#track');
function galleryFrame() {
  if (reduce || narrow()) return;
  if (cy + L.vh < L.gal || cy > L.gal + L.galH) return;
  const p = prog(L.gal, L.galH); const x = -p * L.max;
  track.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
  let best = null, bd = 1e9; const mid = L.vw / 2;
  for (const c of L.cards) { const d = Math.abs(c.mid + x - mid); if (d < bd) { bd = d; best = c.el; } }
  if (best && best !== curCard) { curCard = best; fireFor('p:' + best.dataset.id, 2); }
}

// brain choreography per section
const tgt = { x: 0, y: 0, s: 1, dim: 1, spin: 0 };
function brainFrame() {
  if (!b) return;
  const vh = L.vh; const y = cy; const n = narrow(); let T;
  if (y < L.story - vh * 0.3) T = n ? [0, 0.62, 0.82, 1] : [0.75, -0.05, 1.12, 1];
  else if (y < L.gal - vh * 0.3) T = n ? [0, 0.15, 0.95, 0.42] : [-0.25, 0, 1.5, 0.5];
  else if (y < L.now - vh * 0.2) T = n ? [0, 1.1, 0.7, 0.3] : [0, 1.05, 0.85, 0.32];
  else T = n ? [0.6, 0, 0.75, 0.18] : [1.7, -0.1, 0.85, 0.22];
  tgt.x = T[0]; tgt.y = T[1]; tgt.s = T[2]; tgt.dim = T[3]; tgt.spin = y / vh * 0.55; b.target = tgt;
}
const para = [...document.querySelectorAll('[data-speed]')].map((el) => ({ el, k: Number(el.dataset.speed) }));
function frame(t) {
  if (lenis) lenis.raf(t);
  cy = lenis ? lenis.scroll : scrollY;
  if (cy !== lastY || dirty) {   // only touch the DOM when the scroll position changed
    lastY = cy; dirty = false;
    storyFrame(); galleryFrame(); brainFrame();
    if (!reduce) for (const p of para) p.el.style.transform = `translate3d(0,${(cy * p.k).toFixed(1)}px,0)`;
  } else if (lastStr > 0 && lastStr < 60) { lastStr = -2; storyFrame(); } // keep the morph glyphs alive mid-steer
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// data
let round = null;
async function loadRound() {
  round = await api('/api/round'); const live = round.live;
  $('#hud-round').textContent = String(round.round).padStart(4, '0');
  if (live) {
    $('#hud-mind').textContent = live.winner.name; $('#now-persona').textContent = live.winner.name.replace(/^The /, 'the ') + '.';
    const c = round.candidates.find((x) => x.id === live.winner.id);
    $('#now-note').textContent = (c && c.note ? c.note + ' ' : '') + (live.house ? 'Nobody voted last round, so it was picked at random.' : `${live.voters} wallet${live.voters === 1 ? '' : 's'} decided that.`);
    $('#now-mix').innerHTML = mixHTML(live.mix);
  } else { $('#now-persona').textContent = 'nothing yet.'; $('#hud-mind').textContent = 'waiting'; }
}
setInterval(() => { if (!round) return; const t = clock(round.endsAt - Date.now()); $('#hud-timer').textContent = t; $('#now-timer').textContent = t; if (Date.now() > round.endsAt + 3000) { round = null; loadRound(); loadPosts(); } }, 1000);

async function loadPosts() {
  const r = await api('/api/posts?limit=4');
  $('#x-mode').innerHTML = r.x.mode === 'live' ? '<span class="badge">Live</span>' : '<span class="badge amber">Preview, not posted yet</span>';
  if (!r.posts.length) return;
  const lab = (p) => (p.preview ? '<span class="badge amber">Preview</span>' : '<span class="badge">Posted</span>');
  $('#posts').innerHTML = r.posts.map((p) => `<article class="panel post">${p.image && p.kind === 'post' ? `<img class="post-img" src="${esc(p.image)}" alt="${esc(p.persona || 'Round persona')}" loading="lazy" decoding="async">` : ''}<div class="meta mono">${lab(p)}${p.round ? `<span>Round ${p.round}</span>` : ''}<span>${esc(p.persona || '')}</span>${p.kind === 'reply' ? `<span>reply to @${esc(p.to)}</span>` : ''}<span>${ago(p.at)}</span></div><p>${esc(p.text)}</p>${p.url ? `<div class="mono" style="margin-top:10px"><a href="${esc(p.url)}" rel="noopener">View on X</a></div>` : ''}</article>`).join('');
}

const ORDER = ['owl', 'cat', 'pirate', 'degen', 'chef', 'ghost', 'space', 'lord', 'bard', 'ocean', 'dino', 'romantic'];
const PREF = ['Who are you?', 'Describe your perfect weekend.', 'What is the meaning of life?', 'Tell me a fun fact.'];
const flat = (s) => s.replace(/\s+/g, ' ').replace(/\s+\./g, '.').replace(/\.(\s*\.)+/g, '.').trim();
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s\S*$/, '') + '...');
async function loadPresets() {
  const r = await api('/api/presets');
  const ps = r.presets.map((p) => ({ ...p, samples: p.samples.filter((s) => s.good) })).filter((p) => p.samples.length).sort((a, c) => ORDER.indexOf(a.id) - ORDER.indexOf(c.id));
  const owl = ps.find((p) => p.id === 'owl'); const s0 = owl && owl.samples.find((s) => s.prompt === 'Who are you?');
  if (s0) { story = { normal: cut(flat(s0.normal), 200), steered: cut(flat(s0.steered), 200) }; $('#sp-share').href = s0.share; lastStr = -1; }
  const OWN = { lord: 'Describe your perfect weekend.', bard: 'What should I eat for dinner tonight?', chef: 'Who are you?', degen: 'Who are you?', ocean: 'What is the meaning of life?', cat: 'Describe your perfect weekend.', ghost: 'Describe your perfect weekend.' };
  const pick = (p) => { for (const q of [OWN[p.id], ...PREF].filter(Boolean)) { const s = p.samples.find((x) => x.prompt === q); if (s) return s; } return p.samples[0]; };
  $('#track').innerHTML = ps.map((p, i) => { const s = pick(p); const f = p.features[0]; return `<article class="gcard" data-id="${esc(p.id)}"><div class="no"><span>${String(i + 1).padStart(2, '0')}</span><span>L${esc(f.layer.split('-')[0])} / ${esc(f.index)} +${esc(f.strength)}</span></div><figure class="gfig"><img src="/img/minds/${esc(p.id)}.webp" alt="" width="360" height="270" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></figure><h3>${esc(p.name)}</h3><div class="ft">${esc(f.label)}</div><blockquote><small>${esc(s.prompt)}</small>${esc(cut(flat(s.steered), 220))}</blockquote></article>`; }).join('')
    + '<article class="gcard end"><h3>Your pick.</h3><p class="gal-sub">16,384 features per layer. Find one in the Lab, or put it up for the next round.</p><p class="hx-links mono"><a href="/lab">Open the Lab</a></p></article>';
  cards = [...document.querySelectorAll('.gcard[data-id]')]; layout();
}
async function loadConfig() {
  const c = await api('/api/config');
  if (c.mint) { $('#ca').textContent = c.mint; $('#ca').onclick = () => navigator.clipboard.writeText(c.mint); }
  if (c.treasury) $('#treasury').innerHTML = `<a href="https://solscan.io/account/${esc(c.treasury)}" rel="noopener">${esc(c.treasury.slice(0, 6) + '...' + c.treasury.slice(-6))}</a>`;
  $('#network').textContent = c.cluster === 'mainnet' ? 'Solana mainnet' : 'Solana ' + c.cluster;
  $('#perk-min').textContent = fmt(c.holderMin); $('#perk-min2').textContent = fmt(c.holderMin); $('#perk-lab').textContent = c.labPerDay;
}
loadRound().catch(() => {}); loadPosts().catch(() => {}); loadPresets().catch(() => {}); loadConfig().catch(() => {});
setInterval(() => loadPosts().catch(() => {}), 60000);

layout(); addEventListener('load', layout); document.fonts && document.fonts.ready.then(layout);
