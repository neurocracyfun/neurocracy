import { $, esc, api, clock, fmt, wallet, startBrain, fireFor, reveals } from './common.js';
const usd = (v) => '$' + Number(v).toFixed(Number(v) % 1 ? 2 : 0);   // value at the price used, also when the amount is clamped
startBrain(); reveals();
let R = null; let pick = null; let cfg = null;
const st = (el, m, cls = '') => { el.textContent = m; el.className = 'status ' + cls; };
async function load() {
  R = await api('/api/round');
  $('#r-id').textContent = R.round; $('#r-voters').textContent = `${R.voters} voter${R.voters === 1 ? '' : 's'}`; $('#r-live').textContent = R.live ? R.live.winner.name : 'none';
  const prev = R.round - 1; $('#votes-link').href = '/api/votes/' + prev; $('#votes-link').textContent = '/api/votes/' + prev;
  $('#cands').innerHTML = R.candidates.map((c) => `<button class="panel cand${pick === c.id ? ' on' : ''}" data-id="${esc(c.id)}"><h3>${esc(c.name)}</h3><small>${esc(c.note || '')}</small><div class="mono" style="color:var(--dim);margin-top:10px;font-size:11px">${c.features.map((f) => esc(f.layer) + ' #' + esc(f.index) + ' +' + esc(f.strength)).join('<br>')}</div></button>`).join('');
  $('#topics').innerHTML = `<span class="badge">${R.topicsSuggested ? R.topicsSuggested + ' suggested, revealed at close' : 'none yet'}</span>`;
  $('#r-hidden').textContent = R.voters ? `${R.voters} voter${R.voters === 1 ? '' : 's'} so far, ${fmt(R.weightCast)} total weight cast. Who is ahead stays hidden until the round closes.` : 'No votes yet. Tallies stay hidden until the round closes.';
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
    st($('#vstatus'), 'Preview. The token is not live yet, so voting opens at launch. Until then a persona is picked at random each round.', '');
    for (const id of ['cast', 'connect']) { const el = $('#' + id); if (el) { el.disabled = true; el.title = 'Opens when the token is live'; } }
    if ($('#cast')) $('#cast').textContent = 'Voting opens at launch';
  }
}).catch(() => {});
showWallet(); load().catch(() => {}); setInterval(() => load().catch(() => {}), 20000);

// ---- fee share, nomination by burn, burn for reply ----
import { burnWithMemo, submitWithRetry } from './burn.js';
const sol = (l) => (Number(BigInt(l || 0)) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 6 });
const short = (a) => (a ? a.slice(0, 4) + '...' + a.slice(-4) : '');
async function extras() {
  const c = await api('/api/config');
  const P = c.payout || {};
  if (P.enabled && P.last) {
    const L = P.last;
    $('#pay-last').innerHTML = L.status === 'skipped' ? `Round ${L.round}: no payout (${esc(L.reason || '')}).` : `Round ${L.round}: ${sol(L.pool)} SOL to ${L.voters} winning voter${L.voters === 1 ? '' : 's'}${L.nominator ? ', nominator ' + esc(short(L.nominator.wallet)) : ''}${L.dry ? ', dry run, nothing was sent' : ''}.`;
  } else if (P.enabled) $('#pay-last').textContent = `Fee share is on${P.dryRun ? ' in dry run' : ''}. No round has paid yet.`;
  const B = c.burns || {};
  const amt = (x) => (x.priced && x.burn ? `${fmt(x.burn)} NCRACY (about ${usd(B.price ? x.burn * B.price.usd : x.usd)})` : `about ${usd(x.usd)} of NCRACY (paused, no reliable price right now)`);
  if (B.nominate && B.nominate.enabled) { $('#nom-panel').hidden = false; $('#nom-burn').textContent = amt(B.nominate); }
  const on = (B.nominate && B.nominate.enabled) || (B.reply && B.reply.enabled);
  $('#howto-note').textContent = on ? 'Burns are open. Follow the steps for the action you want, and check the list before you burn.' : 'Coming at launch. Burns open after the token is live. You can read how they work now.';
  if (B.reply && B.reply.enabled) { $('#rep-panel').hidden = false; $('#rep-burn').textContent = amt(B.reply); if (!B.reply.priced) $('#rep-go').dataset.paused = '1'; }
  return c;
}
let ptmr; $('#pay-w').oninput = () => { clearTimeout(ptmr); ptmr = setTimeout(async () => {
  const w = $('#pay-w').value.trim(); if (w.length < 32) { $('#pay-hist').textContent = ''; return; }
  try { const h = await api('/api/payouts/wallet/' + encodeURIComponent(w));
    $('#pay-hist').innerHTML = `Owed, not yet sent: ${sol(h.owed)} SOL<br>` + (h.history.length ? h.history.slice(0, 20).map((x) => `Round ${x.round}, ${esc(x.kind)}, ${sol(x.lamports)} SOL${x.sig ? ` <a href="https://solscan.io/tx/${esc(x.sig)}" rel="noopener">tx</a>` : ''}`).join('<br>') : 'No history.');
  } catch (e) { $('#pay-hist').textContent = e.message; } }, 400); };

let ntmr; $('#nq').oninput = () => { clearTimeout(ntmr); ntmr = setTimeout(async () => {
  const q = $('#nq').value.trim(); const box = $('#nres'); if (q.length < 2) { box.hidden = true; return; }
  try { const r = await api('/api/features/search?q=' + encodeURIComponent(q)); box.hidden = !r.results.length;
    box.innerHTML = r.results.map((f) => `<button data-l="${esc(f.layer)}" data-i="${f.index}">${esc(f.label)}<br><small>${esc(f.layer)} #${f.index}</small></button>`).join('');
  } catch (e) { st($('#nstatus'), e.message, 'err'); } }, 450); };
$('#nres').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return; const s = $('#nstatus');
  try {
    const q = await api(`/api/nominate/quote?layer=${encodeURIComponent(b.dataset.l)}&index=${b.dataset.i}`);
    if (!confirm(`Burn ${fmt(q.burn)} NCRACY (about ${usd(q.burn * q.priceUsd)}) to nominate "${q.label}" for round ${q.round}? This price is held for 5 minutes. The burn is permanent.`)) return;
    const c = cfg || (await api('/api/config'));
    if (Date.now() > q.expiresAt - 20000) throw new Error('That price expired while you were deciding. Press the button again for a new price.');
    st(s, 'Waiting for your wallet...');
    const signature = await burnWithMemo({ mint: c.mint, decimals: c.decimals ?? 6, amountUi: q.burn, memo: q.memo });
    st(s, 'Burn sent, waiting for confirmation...');
    const r = await submitWithRetry(() => api('/api/nominate', { wallet: wallet.address, layer: q.layer, index: q.index, signature, quote: q.quote }));
    st(s, `Nominated for round ${r.round}.`, 'ok');
  } catch (e2) { st(s, e2.message, 'err'); }
};
$('#rep-ok').onchange = () => { $('#rep-go').disabled = !$('#rep-ok').checked || $('#rep-go').dataset.paused === '1'; };
$('#rep-go').onclick = async () => {
  const s = $('#rstatus'); const url = $('#rep-url').value.trim();
  try {
    const m = url.match(/^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w{1,15}\/status\/(\d{5,25})/); if (!m) throw new Error('Paste a link to a post on x.com.');
    const c = cfg || (await api('/api/config'));
    const q = await api('/api/reply-burn/quote?url=' + encodeURIComponent(url) + '&wallet=' + encodeURIComponent(wallet.address || ''));
    if (!confirm(`Burn ${fmt(q.burn)} NCRACY (about ${usd(q.burn * q.priceUsd)}) for a reply to that post? This price is held for 5 minutes. No refunds.`)) return;
    if (Date.now() > q.expiresAt - 20000) throw new Error('That price expired while you were deciding. Press the button again for a new price.');
    st(s, 'Waiting for your wallet...');
    const signature = await burnWithMemo({ mint: c.mint, decimals: c.decimals ?? 6, amountUi: q.burn, memo: q.memo });
    st(s, 'Burn sent, waiting for confirmation...');
    await submitWithRetry(() => api('/api/reply-burn', { wallet: wallet.address, url, signature, quote: q.quote }));
    st(s, 'Queued. The reply appears in the Hall, and on X when the account is live.', 'ok');
  } catch (e) { st(s, e.message, 'err'); }
};
extras().catch(() => {});
