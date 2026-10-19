import { $, esc, api, clock, fmt, ago, mixHTML, startBrain, fireFor, reveals } from './common.js';
const b = startBrain($('#grab'));
if (b) $('#hud-n').textContent = fmt(b.stats.neurons);
reveals();

let round = null;
async function loadRound() {
  round = await api('/api/round');
  const live = round.live;
  $('#hud-round').textContent = String(round.round).padStart(4, '0');
  if (live) {
    $('#hud-mind').textContent = live.winner.name; $('#now-persona').textContent = live.winner.name; $('#now-round').textContent = live.id;
    const c = round.candidates.find((x) => x.id === live.winner.id);
    $('#now-note').textContent = (c && c.note ? c.note + ' ' : '') + (live.house ? 'Nobody voted, so the house picked this one.' : `${live.voters} wallet${live.voters === 1 ? '' : 's'} voted.`);
    $('#now-mix').innerHTML = mixHTML(live.mix);
    fireFor(live.winner.id, 2);
  } else { $('#now-persona').textContent = 'First vote open'; $('#hud-mind').textContent = 'waiting'; }
}
setInterval(() => { if (!round) return; const t = clock(round.endsAt - Date.now()); $('#hud-timer').textContent = t; $('#now-timer').textContent = t; if (Date.now() > round.endsAt + 3000) { round = null; loadRound(); loadPosts(); } }, 1000);

async function loadPosts() {
  const r = await api('/api/posts?limit=5');
  $('#x-mode').innerHTML = r.x.mode === 'live' ? '<span class="badge">Live</span>' : '<span class="badge amber">Preview mode, not posted yet</span>';
  if (!r.posts.length) return;
  $('#posts').innerHTML = r.posts.map((p) => `<article class="panel post"><div class="meta mono"><span class="badge${p.status === 'posted' ? '' : ' amber'}">${p.status === 'posted' ? 'Posted' : p.status === 'preview' ? 'Preview' : esc(p.status)}</span><span>Round ${p.round}</span><span>${esc(p.persona)}</span><span>${p.kind === 'reply' ? 'reply to @' + esc(p.to) : 'topic: ' + esc(p.topic)}</span><span>${ago(p.at)}</span></div><p>${esc(p.text)}</p>${p.tweetId ? `<div class="mono" style="margin-top:10px"><a href="https://x.com/neurocracyfun/status/${esc(p.tweetId)}" rel="noopener">View on X</a></div>` : ''}</article>`).join('');
}

// compare gallery
let presets = []; let cur = 0; let qi = 0;
async function loadPresets() {
  const r = await api('/api/presets');
  presets = r.presets.map((p) => ({ ...p, samples: p.samples.filter((s) => s.good) })).filter((p) => p.samples.length);
  $('#chips').innerHTML = presets.map((p, i) => `<button class="chip" data-i="${i}">${esc(p.name)}</button>`).join('');
  $('#chips').onclick = (e) => { const i = e.target.dataset.i; if (i != null) { cur = +i; qi = 0; show(); } };
  show();
}
function show() {
  const p = presets[cur]; if (!p) return; const s = p.samples[qi % p.samples.length];
  document.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', i === cur));
  $('#cmp-q').textContent = s.prompt; $('#cmp-n').textContent = s.normal; $('#cmp-s').textContent = s.steered;
  $('#cmp-label').textContent = `Steered: ${p.features.map((f) => f.label + ' +' + f.strength).join(', ')}`;
  $('#cmp-share').href = s.share || 'https://www.neuronpedia.org/gemma-2-9b-it';
  fireFor('p:' + p.id, 1.3);
}
$('#cmp-next').onclick = () => { qi++; show(); }; $('#cmp-prev').onclick = () => { qi = (qi + presets[cur].samples.length - 1); show(); };

async function loadConfig() {
  const c = await api('/api/config');
  if (c.mint) { $('#ca').textContent = c.mint; $('#ca').onclick = () => navigator.clipboard.writeText(c.mint); }
  if (c.treasury) $('#treasury').innerHTML = `<a href="https://solscan.io/account/${esc(c.treasury)}" rel="noopener">${esc(c.treasury.slice(0, 6) + '...' + c.treasury.slice(-6))}</a>`;
  $('#network').textContent = c.cluster === 'mainnet' ? 'Solana mainnet' : 'Solana ' + c.cluster;
  $('#perk-min').textContent = fmt(c.holderMin); $('#perk-lab').textContent = c.labPerDay;
}
loadRound().catch(() => {}); loadPosts().catch(() => {}); loadPresets().catch(() => {}); loadConfig().catch(() => {});
setInterval(() => loadPosts().catch(() => {}), 60000);
