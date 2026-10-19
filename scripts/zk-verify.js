// Independent check of a round's tally proof. Usage: node scripts/zk-verify.js ROUND [BASE_URL]
// Downloads the snapshot and proof, rebuilds the Poseidon vote tree and totals commitment locally,
// checks they equal the proof's public inputs, and verifies the proof with zk/vkey.json from this repo.
// Optional: NC_ZK_PROGRAM_ID + NC_ZK_RPC also compares against the on-chain record.
const zk = require('../lib/zk');
(async () => {
  const round = Number(process.argv[2]); const base = (process.argv[3] || 'https://neurocracy.fun').replace(/\/$/, '');
  if (!(round > 0)) { console.log('usage: node scripts/zk-verify.js ROUND [BASE_URL]'); process.exit(2); }
  const get = async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.text(); };
  const snap = await get(`/api/rounds/${round}/snapshot`); const rec = JSON.parse(await get(`/api/rounds/${round}/proof`));
  const s = JSON.parse(snap); let fail = 0; const say = (ok, t) => { console.log((ok ? 'PASS ' : 'FAIL ') + t); if (!ok) fail++; };
  console.log(`round ${round}: ${s.votes.length} votes, ${s.candidates.length} candidates, snapshot winner ${s.winner}`);
  if (rec.status !== 'proven') { console.log('no proof for this round: ' + (rec.reason || rec.error || rec.status)); process.exit(1); }
  const b = await zk.buildInput(snap); if (b.skip) { say(false, b.skip); process.exit(1); }
  say(rec.publicSignals[0] === String(round), 'proof is for this round');
  say(rec.publicSignals[1] === b.root, 'vote tree root rebuilt from the snapshot matches ' + b.root.slice(0, 20) + '...');
  say(rec.publicSignals[2] === String(b.winnerIndex) && s.candidates[b.winnerIndex] === s.winner, 'proven winner is ' + s.winner);
  say(rec.publicSignals[3] === b.totalsCommit, 'totals commitment matches (totals ' + s.candidates.map((c, i) => `${c}=${b.totals[i]}`).join(' ') + ')');
  say(await zk.verify(rec.publicSignals, rec.proof), 'Groth16 proof valid against zk/vkey.json');
  if (process.env.NC_ZK_PROGRAM_ID && process.env.NC_ZK_RPC && rec.onchain) {
    const { createZkChain } = require('../lib/zkchain'); const c = createZkChain({ rpc: process.env.NC_ZK_RPC, programId: process.env.NC_ZK_PROGRAM_ID });
    const authority = process.env.NC_ZK_AUTHORITY; const r = authority ? await c.read(round, authority) : null;
    say(!!r && r.root === b.root && String(r.winner) === String(b.winnerIndex) && r.totalsCommit === b.totalsCommit, 'on-chain record matches (program verified the same proof)');
  }
  console.log(fail ? `${fail} check(s) failed` : 'all checks passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('error: ' + e.message); process.exit(1); });
