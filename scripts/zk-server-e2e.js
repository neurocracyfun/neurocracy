// Server-side ZK path end to end: snapshot, child-process proof, /api/rounds/:r/verify, /verify page, scripts/zk-verify.js.
const os = require('os'); const path = require('path'); const fs = require('fs');
const cfg = require('../lib/config'); const { createApp } = require('../server');
const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58')); const { snapshot } = require('../lib/snapshot'); const { isqrt } = require('../lib/solana');
(async () => {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nczk-')), 'db.json');
  const a = createApp({ ...cfg, db }, { zkProve: true }); const D = a.store.data; const votes = {};
  for (let i = 0; i < 128; i++) { const raw = BigInt(1e6 * (1 + (i * 37) % 91)); votes[bs58.encode(nacl.sign.keyPair().publicKey)] = { candidate: ['a', 'b', 'c'][i % 3], message: 'm', signature: 's', rawAtClose: raw.toString(), weightInt: isqrt(raw).toString() }; }
  const tot = { a: 0n, b: 0n, c: 0n }; for (const v of Object.values(votes)) tot[v.candidate] += BigInt(v.weightInt);
  const w = Object.keys(tot).sort((x, y) => (tot[y] > tot[x] ? 1 : -1))[0];
  D.snapshots = { 9: snapshot({ cfg: { mint: 'M', decimals: 6, voteMin: 1 }, round: 9, bounds: { startsAt: 1, endsAt: 2 }, candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], votes, winner: w, house: false }).json }; D.proofs = {};
  const srv = a.app.listen(0); await new Promise((r) => srv.on('listening', r)); const base = 'http://localhost:' + srv.address().port;
  const t = Date.now(); await a.prover.tick(); console.log('proof', D.proofs[9].status, D.proofs[9].error || '', 'prove ms', D.proofs[9].ms, 'wall ms', Date.now() - t);
  const r = await (await fetch(base + '/api/rounds/9/verify')).json(); console.log('verify endpoint', r.ok, r.reason);
  console.log('verify page HTTP', (await fetch(base + '/verify?round=9')).status);
  const out = await new Promise((res) => require('child_process').exec(`node ${path.join(__dirname, 'zk-verify.js')} 9 ${base}`, (e, so) => res({ code: e ? e.code : 0, so })));
  console.log(out.so.trim()); srv.close(); process.exit(r.ok && out.code === 0 ? 0 : 1);
})();
