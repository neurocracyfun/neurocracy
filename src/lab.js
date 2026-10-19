import { $, esc, api, fmt, wallet, startBrain, fireFor, reveals } from './common.js';
startBrain(); reveals();
let slots = []; let presets = []; let cfg = null;
const st = (m, c = '') => { $('#lstatus').textContent = m; $('#lstatus').className = 'status ' + c; };
function render() {
  $('#slots').innerHTML = slots.map((f, i) => `<div class="slot"><div class="top"><span>${esc(f.label || 'feature ' + f.index)} <small class="mono" style="color:var(--dim)">${esc(f.layer)} #${f.index}</small></span><button class="iconbtn" data-x="${i}">Remove</button></div><input type="range" min="-150" max="150" step="5" value="${f.strength}" data-r="${i}"><div class="mono" style="color:var(--cy)">strength ${f.strength}</div></div>`).join('')
    + (slots.length < 3 && searchOpen ? `<div class="slot"><input type="text" id="sq" placeholder="search features, for example owls"><div class="results" id="sres" hidden></div></div>` : '');
  $('#add').hidden = slots.length >= 3;
  if (searchOpen) { const q = $('#sq'); if (q) { q.focus(); q.oninput = onSearch; } }
}
let searchOpen = false;
$('#add').onclick = () => { searchOpen = true; render(); };
$('#slots').oninput = (e) => { const i = e.target.dataset.r; if (i != null) { slots[i].strength = +e.target.value; e.target.nextElementSibling.textContent = 'strength ' + e.target.value; } };
$('#slots').onclick = (e) => {
  const x = e.target.dataset.x; if (x != null) { slots.splice(+x, 1); render(); return; }
  const b = e.target.closest('#sres button'); if (b) { slots.push({ layer: b.dataset.l, index: +b.dataset.i, label: b.dataset.t, strength: b.dataset.l.startsWith('9-') ? 60 : 40 }); searchOpen = false; render(); }
};
let tmr; function onSearch(e) { clearTimeout(tmr); tmr = setTimeout(async () => {
  const q = e.target.value.trim(); const box = $('#sres'); if (q.length < 2) { box.hidden = true; return; }
  try { const r = await api('/api/features/search?q=' + encodeURIComponent(q)); box.hidden = !r.results.length; box.innerHTML = r.results.map((f) => `<button data-l="${esc(f.layer)}" data-i="${f.index}" data-t="${esc(f.label)}">${esc(f.label)}<br><small>${esc(f.layer)} #${f.index}</small></button>`).join(''); }
  catch (err) { st(err.message, 'err'); } }, 450); }
function usePreset(p) { slots = p.features.map((f) => ({ ...f })); searchOpen = false; render(); fireFor('p:' + p.id, 1.5); }
async function init() {
  const [r, c] = await Promise.all([api('/api/presets'), api('/api/config')]); cfg = c; presets = r.presets;
  $('#lab-n').textContent = c.labPerDay; $('#lab-min').textContent = fmt(c.holderMin);
  $('#presetchips').innerHTML = presets.map((p, i) => `<button class="chip" data-i="${i}">${esc(p.name)}</button>`).join('');
  $('#pchips').innerHTML = r.prompts.slice(0, 6).map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  $('#presetchips').onclick = (e) => { const i = e.target.dataset.i; if (i != null) usePreset(presets[+i]); };
  $('#pchips').onclick = (e) => { const q = e.target.dataset.q; if (q) $('#prompt').value = q; };
  render();
}
async function pass() {
  const day = new Date().toISOString().slice(0, 10); const k = 'nc.lab.' + day + '.' + wallet.address; let sig = localStorage.getItem(k);
  if (!sig) { sig = await wallet.sign(`Neurocracy lab\nDay: ${day}\nWallet: ${wallet.address}`); localStorage.setItem(k, sig); }
  return sig;
}
async function run(auth) {
  const prompt = $('#prompt').value.trim(); if (!slots.length) return st('Add at least one feature.', 'err');
  const body = { prompt, features: slots.map(({ layer, index, strength }) => ({ layer, index, strength })) };
  if (auth) { body.wallet = wallet.address; body.signature = await pass(); }
  st('Steering, this takes about 5 seconds...'); slots.forEach((f) => fireFor(f.layer + f.index, 2));
  const r = await api('/api/lab', body);
  $('#out-n').textContent = r.normal; $('#out-s').textContent = r.steered;
  $('#out-src').textContent = r.cached ? 'cached result, free' : `live steer, ${r.left} left today`;
  if (r.share) { $('#out-share').href = r.share; $('#out-share').hidden = false; }
  st('Done.', 'ok');
}
$('#run').onclick = async () => {
  try { await run(!!wallet.address); }
  catch (e) { if (/wallet|pass|holder/i.test(e.message) && !wallet.address) st('That mix is not cached. Connect a holder wallet for a live steer, or pick a preset with a sample prompt.', 'err'); else st(e.message, 'err'); }
};
$('#connect').onclick = async () => { try { await wallet.connect(); $('#connect').textContent = wallet.short(wallet.address); } catch (e) { st(e.message, 'err'); } };
if (wallet.address) $('#connect').textContent = wallet.short(wallet.address);
window.__demo = async () => { usePreset(presets.find((p) => p.id === 'owl') || presets[0]); $('#prompt').value = 'Who are you?'; await run(false).catch((e) => st(e.message, 'err')); };
init().catch((e) => st(e.message, 'err'));
