import { $, esc, api, clock, fmt, wallet, startBrain, fireFor, reveals } from './common.js';
startBrain(); reveals();
let R = null; let pick = null; let cfg = null;
const st = (el, m, cls = '') => { el.textContent = m; el.className = 'status ' + cls; };
async function load() {
  R = await api('/api/round');
  $('#r-id').textContent = R.round; $('#r-voters').textContent = `${R.voters} voter${R.voters === 1 ? '' : 's'}`; $('#r-live').textContent = R.live ? R.live.winner.name : 'none';
  $('#votes-link').href = '/api/votes/' + R.round; $('#votes-link').textContent = '/api/votes/' + R.round;
  const max = Math.max(1, ...R.candidates.map((c) => c.weight));
  $('#cands').innerHTML = R.candidates.map((c) => `<button class="panel cand${pick === c.id ? ' on' : ''}" data-id="${esc(c.id)}"><h3>${esc(c.name)}</h3><small>${esc(c.note || '')}</small><div class="mono" style="color:var(--dim);margin-top:10px;font-size:11px">${c.features.map((f) => esc(f.layer) + ' #' + esc(f.index) + ' +' + esc(f.strength)).join('<br>')}</div><div class="w"><i style="width:${(c.weight / max) * 100}%"></i></div><small class="mono">weight ${c.weight}</small></button>`).join('');
  $('#topics').innerHTML = R.topics.length ? R.topics.map((t) => `<span class="badge">${esc(t.topic)} ${t.weight}</span>`).join('') : '<span class="badge">none yet</span>';
}
$('#cands').onclick = (e) => { const b = e.target.closest('.cand'); if (!b) return; pick = b.dataset.id; document.querySelectorAll('.cand').forEach((x) => x.classList.toggle('on', x === b)); fireFor(pick, 1.5); $('#cast').disabled = !wallet.address; };
const showWallet = () => { if (cfg && cfg.preview) return; if (wallet.address) { $('#connect').textContent = wallet.short(wallet.address); $('#cast').disabled = !pick; } };
$('#connect').onclick = async () => { try { await wallet.connect(); showWallet(); } catch (e) { st($('#vstatus'), e.message, 'err'); } };
$('#cast').onclick = async () => {
  const s = $('#vstatus');
  try {
    const topic = $('#topic').value.replace(/[^\p{L}\p{N} .,'?!-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const msg = `Neurocracy vote\nRound: ${R.round}\nCandidate: ${pick}\nTopic: ${topic || '-'}\nWallet: ${wallet.address}`;
    st(s, 'Waiting for your wallet...'); const signature = await wallet.sign(msg);
    const r = await api('/api/vote', { wallet: wallet.address, round: R.round, candidate: pick, topic, signature });
    st(s, `Vote counted with weight ${r.weight.toFixed(2)}. You can change it until the round closes.`, 'ok'); fireFor(pick, 3); load();
  } catch (e) { st(s, e.message, 'err'); }
};
let tmr; $('#fq').oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
  const q = $('#fq').value.trim(); const box = $('#fres'); if (q.length < 2) { box.hidden = true; return; }
  try { const r = await api('/api/features/search?q=' + encodeURIComponent(q)); box.hidden = !r.results.length;
    box.innerHTML = r.results.map((f) => `<button data-l="${esc(f.layer)}" data-i="${f.index}">${esc(f.label)}<br><small>${esc(f.layer)} #${f.index}</small></button>`).join('');
    if (!r.results.length) st($('#fstatus'), 'No features found for that word.');
  } catch (e) { st($('#fstatus'), e.message, 'err'); } }, 450); };
$('#fres').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return; const s = $('#fstatus');
  try { if (!wallet.address) await wallet.connect(); showWallet();
    const msg = `Neurocracy feature\nRound: ${R.round}\nFeature: ${b.dataset.l}/${b.dataset.i}\nWallet: ${wallet.address}`;
    const signature = await wallet.sign(msg); await api('/api/feature/submit', { wallet: wallet.address, round: R.round, layer: b.dataset.l, index: +b.dataset.i, signature });
    st(s, 'Added as a candidate for this round.', 'ok'); load();
  } catch (e2) { st(s, e2.message, 'err'); }
};
$('#link').onclick = async () => {
  const s = $('#lstatus'); const h = $('#handle').value.trim().replace(/^@/, '');
  try { if (!/^\w{1,15}$/.test(h)) throw new Error('That is not a valid X handle.'); if (!wallet.address) await wallet.connect(); showWallet();
    const signature = await wallet.sign(`Neurocracy link X\nHandle: @${h}\nWallet: ${wallet.address}`);
    await api('/api/link-x', { wallet: wallet.address, handle: h, signature }); st(s, `Linked @${h}.`, 'ok');
  } catch (e) { st(s, e.message, 'err'); }
};
setInterval(() => { if (!R) return; $('#r-timer').textContent = clock(R.endsAt - Date.now()); if (Date.now() > R.endsAt + 2000) { pick = null; load(); } }, 1000);
api('/api/config').then((c) => {
  cfg = c; $('#min1').textContent = fmt(c.holderMin); $('#min2').textContent = fmt(c.holderMin);
  if (c.preview) {   // no mint yet: show the ballot, close the actions
    document.body.classList.add('preview');
    st($('#vstatus'), 'Preview. The token is not live yet, so voting opens at launch. The house picks each round until then.', '');
    for (const id of ['cast', 'connect']) { const el = $('#' + id); if (el) { el.disabled = true; el.title = 'Opens when the token is live'; } }
    if ($('#cast')) $('#cast').textContent = 'Voting opens at launch';
  }
}).catch(() => {});
showWallet(); load().catch(() => {}); setInterval(() => load().catch(() => {}), 20000);
