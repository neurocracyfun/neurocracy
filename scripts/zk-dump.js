// Writes a sample proof as program instruction bytes (for the host-side Rust test). node scripts/zk-dump.js out.bin
const fs = require('fs'); const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58'));
const { snapshot } = require('../lib/snapshot'); const zk = require('../lib/zk'); const { isqrt } = require('../lib/solana'); const { encode } = require('../lib/zkchain');
(async () => {
  const cands = [{ id: 'a' }, { id: 'b' }]; const votes = {};
  for (let i = 0; i < 3; i++) { const raw = BigInt(1000000 * (i + 1)); votes[bs58.encode(nacl.sign.keyPair().publicKey)] = { candidate: i ? 'b' : 'a', message: 'm', signature: 's', rawAtClose: raw.toString(), weightInt: isqrt(raw).toString() }; }
  const snap = snapshot({ cfg: { mint: 'M', decimals: 6, voteMin: 1 }, round: 5, bounds: { startsAt: 1, endsAt: 2 }, candidates: cands, votes, winner: 'b', house: false });
  const p = await zk.prove(snap.json); fs.writeFileSync(process.argv[2], encode(p.proof, p.publicSignals)); console.log(p.status, p.publicSignals); process.exit(0);
})();
