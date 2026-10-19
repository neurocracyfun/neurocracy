import { $, esc, api, startBrain, reveals } from './common.js';
startBrain(); reveals();
const line = (ok, t) => `<div class="mono" style="margin:6px 0"><span class="badge${ok ? '' : ' amber'}">${ok ? 'pass' : ok === null ? 'info' : 'fail'}</span> ${t}</div>`;
let lib = null;
const snark = () => (lib ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/snarkjs.min.js'; s.onload = () => res(window.snarkjs); s.onerror = rej; document.head.appendChild(s); }));
async function run(r) {
  const out = $('#vout'); out.innerHTML = '<div class="panel">Checking round ' + esc(r) + '...</div>';
  history.replaceState(null, '', '/verify?round=' + r);
  let rows = '';
  try {
    const snap = await api(`/api/rounds/${r}/snapshot`).catch(() => null);
    if (!snap) { out.innerHTML = `<div class="panel">${line(null, 'Round ' + esc(r) + ' has not closed yet, or does not exist. Pick a closed round from the <a href="/hall">Hall</a>.')}</div>`; return; }
    const p = await api(`/api/rounds/${r}/proof`).catch(() => null);
    if (!p) { out.innerHTML = `<div class="panel">${line(null, 'Round ' + esc(r) + ' has closed and its proof is still being made. This takes about a minute, try again shortly.')}</div>`; return; }
    const vk = await api('/api/zk/vkey');
    if (p.status !== 'proven') { out.innerHTML = `<div class="panel">${line(null, 'Round ' + esc(r) + ' is not proven: ' + esc(p.reason || p.error || p.status) + '. Its votes are still public in the <a href="/api/rounds/' + esc(r) + '/snapshot">snapshot</a>.')}</div>`; return; }
    rows += line(p.publicSignals[0] === String(r), `Proof is for round ${esc(p.publicSignals[0])}`);
    const w = snap.candidates[Number(p.publicSignals[2])];
    rows += line(w === snap.winner, `Proven winner is candidate ${esc(p.publicSignals[2])} (${esc(w)}), snapshot winner ${esc(snap.winner)}`);
    const t0 = performance.now(); const ok = await (await snark()).groth16.verify(vk, p.publicSignals, p.proof);
    rows += line(ok, `Groth16 proof ${ok ? 'valid' : 'invalid'} in your browser (${Math.round(performance.now() - t0)} ms)`);
    rows += line(null, `Vote tree root ${esc(p.publicSignals[1].slice(0, 24))}..., totals commitment ${esc(p.publicSignals[3].slice(0, 24))}...`);
    try { const s = await api(`/api/rounds/${r}/verify`); rows += line(s.ok, 'Server rebuilt the tree from the snapshot: ' + esc(s.reason)); } catch (e) { rows += line(null, 'Server recheck unavailable: ' + esc(e.message)); }
    if (p.onchain && p.onchain.sig) rows += line(true, `Checked by the verifier program on Solana (in testing), transaction <a href="https://solscan.io/tx/${esc(p.onchain.sig)}" rel="noopener">${esc(p.onchain.sig.slice(0, 12))}</a>${p.onchain.record ? `, record <a href="https://solscan.io/account/${esc(p.onchain.record)}" rel="noopener">${esc(p.onchain.record.slice(0, 12))}</a>` : ''}`);
    if (p.totals) rows += line(null, 'Weighted totals: ' + snap.candidates.map((c, i) => `${esc(c)} ${esc(p.totals[i])}`).join(', '));
    out.innerHTML = `<div class="panel">${rows}</div>`;
  } catch (e) { out.innerHTML = `<div class="panel">${rows}${line(false, esc(e.message))}</div>`; }
}
$('#vf').addEventListener('submit', (e) => { e.preventDefault(); const r = Number($('#vr').value); if (r > 0) run(r); });
const q = Number(new URLSearchParams(location.search).get('round'));
if (q > 0) { $('#vr').value = q; run(q); }
else api('/api/hall').then((h) => { const r = h.rounds.find((x) => x.zk && x.zk.status === 'proven'); if (r) { $('#vr').value = r.id; $('#vout').innerHTML = `<div class="panel">${line(null, 'Latest proven round is ' + r.id + '. Press Verify to check it.')}</div>`; } else $('#vout').innerHTML = `<div class="panel">${line(null, 'No proven rounds yet. The first proof appears shortly after the first voted round closes.')}</div>`; }).catch(() => {});
