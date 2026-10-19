// Tally proofs: deterministic circuit input, real Groth16 proof (when the proving key is present), tamper checks.
const test = require('node:test'); const assert = require('node:assert');
const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58'));
const { snapshot } = require('../lib/snapshot'); const { isqrt } = require('../lib/solana');
const zk = require('../lib/zk'); const { encode } = require('../lib/zkchain');

function snap(winner = 'b', n = 5) {
  const votes = {};
  for (let i = 0; i < n; i++) { const raw = BigInt(1000000 * (i + 1) ** 3); votes[bs58.encode(nacl.sign.keyPair().publicKey)] = { candidate: i % 2 ? 'b' : 'a', message: 'm', signature: 's', rawAtClose: raw.toString(), weightInt: isqrt(raw).toString() }; }
  return snapshot({ cfg: { mint: 'M', decimals: 6, voteMin: 1 }, round: 7, bounds: { startsAt: 1, endsAt: 2 }, candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], votes, winner, house: false }).json;
}

test('buildInput is deterministic and skips what the circuit cannot prove', async () => {
  const s = snap(); const a = await zk.buildInput(s); const b = await zk.buildInput(s);
  assert.strictEqual(a.root, b.root); assert.strictEqual(a.totalsCommit, b.totalsCommit); assert.strictEqual(a.input.raw.length, zk.N);
  const j = JSON.parse(s); j.votes[0][5] = String(BigInt(j.votes[0][5]) + 1n); assert.notStrictEqual((await zk.buildInput(JSON.stringify(j))).root, a.root);
  assert.match((await zk.buildInput(JSON.stringify({ ...j, house: true }))).skip, /house/);
});

test('prover queue proves the newest round once and records the result', async () => {
  const D = { snapshots: { 3: 'x', 4: 'y' } }; const seen = [];
  const p = zk.createProver({ store: { data: D, save() {} }, enabled: true, proveFn: async (s) => { seen.push(s); return { status: 'skipped', reason: 'test' }; } });
  if (!p.available()) return;
  await p.tick(); await p.tick(); await p.tick();
  assert.deepStrictEqual(seen, ['y', 'x']); assert.strictEqual(D.proofs[4].status, 'skipped');
});

test('real proof verifies, tampering fails', { skip: !zk.available() && 'proving key not present (zk/build/tally.zkey)', timeout: 240000 }, async () => {
  const s = snap('a'); const r = await zk.proveInChild(s);
  assert.strictEqual(r.status, 'proven', r.error); assert.strictEqual(encode(r.proof, r.publicSignals).length, 385);
  assert.ok((await zk.check(s, r)).ok);
  const other = snap('a'); assert.match((await zk.check(other, r)).reason, /do not match/);           // proof for different votes
  const bad = { ...r, publicSignals: [...r.publicSignals] }; bad.publicSignals[2] = '1';
  assert.strictEqual(await zk.verify(bad.publicSignals, bad.proof), false);                           // claim another winner
  const lie = await zk.proveInChild(snap('b'));                                                       // b has fewer weighted votes: cannot be proven
  assert.notStrictEqual(lie.status, 'proven');
});

test.after(async () => { if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate(); }); // snarkjs worker threads
