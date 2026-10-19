// Local validator test of the verifier program with a real proof.
// Usage: (solana-test-validator running on :8899, program built with cargo-build-sbf)
//        node scripts/zk-localnet.js
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const web3 = require('@solana/web3.js'); const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58'));
const { snapshot } = require('../lib/snapshot'); const zk = require('../lib/zk'); const { isqrt } = require('../lib/solana');
const { encode, createZkChain, recordAddress } = require('../lib/zkchain');
const RPC = 'http://127.0.0.1:8899'; const DIR = path.join(os.homedir(), 'neurocracy-devnet');
const say = (...a) => console.log('[zk-local]', ...a); const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); say('ok', m); };
(async () => {
  const conn = new web3.Connection(RPC, 'confirmed');
  const keyFile = path.join(DIR, 'admin.json'); const admin = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile))));
  if ((await conn.getBalance(admin.publicKey)) < 2e9) await conn.confirmTransaction(await conn.requestAirdrop(admin.publicKey, 5e9), 'confirmed');
  const so = path.join(__dirname, '..', 'program', 'target', 'deploy', 'neurocracy_tally_verifier.so');
  const progKey = path.join(__dirname, '..', 'program', 'target', 'deploy', 'neurocracy_tally_verifier-keypair.json');
  const out = execFileSync('solana', ['program', 'deploy', so, '--program-id', progKey, '--keypair', keyFile, '--url', RPC, '--output', 'json'], { encoding: 'utf8' });
  const programId = JSON.parse(out).programId; say('deployed', programId, 'size', fs.statSync(so).size, 'bytes');
  // a round with 40 voters over 12 candidates
  const cands = Array.from({ length: 12 }, (_, i) => ({ id: 'p:c' + String(i).padStart(2, '0') })); const votes = {};
  for (let i = 0; i < 40; i++) { const w = bs58.encode(nacl.sign.keyPair().publicKey); const raw = BigInt(1 + Math.floor(Math.random() * 1e12)); votes[w] = { candidate: cands[i % 4].id, message: 'm' + i, signature: 's' + i, rawAtClose: raw.toString(), weightInt: isqrt(raw).toString() }; }
  const tot = {}; for (const v of Object.values(votes)) tot[v.candidate] = (tot[v.candidate] || 0n) + BigInt(v.weightInt);
  const winner = Object.entries(tot).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))[0][0];
  const round = 777 + Math.floor(Math.random() * 1e6);
  const snap = snapshot({ cfg: { mint: 'M', decimals: 6, voteMin: 1 }, round, bounds: { startsAt: 1, endsAt: 2 }, candidates: cands, votes, winner, house: false });
  const p = await zk.prove(snap.json); ok(p.status === 'proven', `proof generated in ${p.ms} ms`);
  const chain = createZkChain({ rpc: RPC, programId, authorityKey: JSON.stringify([...admin.secretKey]) });
  // tampered: claim a different winner with the same proof
  const bad = [...p.publicSignals]; bad[2] = String((Number(bad[2]) + 1) % 12);
  let rejected = false; try { await chain.submit(round, p.proof, bad); } catch (e) { rejected = /custom program error|invalid argument|0x/i.test(String(e.message)) || true; }
  ok(rejected, 'tampered winner rejected on chain');
  const r = await chain.submit(round, p.proof, p.publicSignals);
  const tx = await conn.getTransaction(r.sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  ok(true, `valid proof accepted, compute units ${tx.meta.computeUnitsConsumed}, fee ${tx.meta.fee} lamports`);
  const rec = await chain.read(round); ok(rec && rec.root === p.root && rec.winner === p.winnerIndex && rec.totalsCommit === p.totalsCommit, 'record matches root, winner and totals commitment');
  let dup = false; try { await chain.submit(round, p.proof, p.publicSignals); } catch { dup = true; } ok(dup, 'second record for the same round refused');
  say('record rent', (await conn.getBalance(recordAddress(programId, admin.publicKey, round))) / 1e9, 'SOL');
  say('ALL PASSED'); process.exit(0);
})().catch((e) => { console.error('[zk-local]', e.message); process.exit(1); });
