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
    const [p, vk, snap] = await Promise.all([api(`/api/rounds/${r}/proof`), api('/api/zk/vkey'), api(`/api/rounds/${r}/snapshot`)]);
    if (p.status !== 'proven') { out.innerHTML = `<div class="panel">${line(null, 'Round ' + esc(r) + ' has no proof: ' + esc(p.reason || p.error || p.status))}</div>`; return; }
    rows += line(p.publicSignals[0] === String(r), `Proof is for round ${esc(p.publicSignals[0])}`);
    const w = snap.candidates[Number(p.publicSignals[2])];
    rows += line(w === snap.winner, `Proven winner is candidate ${esc(p.publicSignals[2])} (${esc(w)}), snapshot winner ${esc(snap.winner)}`);
    const t0 = performance.now(); const ok = await (await snark()).groth16.verify(vk, p.publicSignals, p.proof);
    rows += line(ok, `Groth16 proof ${ok ? 'valid' : 'invalid'} in your browser (${Math.round(performance.now() - t0)} ms)`);
    rows += line(null, `Vote tree root ${esc(p.publicSignals[1].slice(0, 24))}..., totals commitment ${esc(p.publicSignals[3].slice(0, 24))}...`);
    try { const s = await api(`/api/rounds/${r}/verify`); rows += line(s.ok, 'Server rebuilt the tree from the snapshot: ' + esc(s.reason)); } catch (e) { rows += line(null, 'Server recheck unavailable: ' + esc(e.message)); }
    if (p.onchain) rows += line(true, `Recorded on Solana, account <a href="https://solscan.io/account/${esc(p.onchain.record)}" rel="noopener">${esc(p.onchain.record.slice(0, 12))}</a>, transaction <a href="https://solscan.io/tx/${esc(p.onchain.sig)}" rel="noopener">${esc(p.onchain.sig.slice(0, 12))}</a>`);
    if (p.totals) rows += line(null, 'Weighted totals: ' + snap.candidates.map((c, i) => `${esc(c)} ${esc(p.totals[i])}`).join(', '));
    out.innerHTML = `<div class="panel">${rows}</div>`;
  } catch (e) { out.innerHTML = `<div class="panel">${rows}${line(false, esc(e.message))}</div>`; }
}
$('#vf').addEventListener('submit', (e) => { e.preventDefault(); const r = Number($('#vr').value); if (r > 0) run(r); });
const q = Number(new URLSearchParams(location.search).get('round')); if (q > 0) { $('#vr').value = q; run(q); }
