// Zero-knowledge tally proofs (Groth16 over BN254, circuit zk/tally.circom).
// From a round snapshot (lib/snapshot.js) we build a Poseidon Merkle tree of the votes and prove, without
// revealing anything beyond the snapshot itself, that the published winner and per-candidate totals follow
// from exactly those leaves with weight = floor(sqrt(raw balance at close)).
// Limits of this circuit: 128 votes and 32 candidates per round. Larger rounds are not proven (marked so).
const path = require('path'); const fs = require('fs');
const bs58 = (require('bs58').default || require('bs58'));
const N = 128, DEPTH = 7, C = 32;
const DIR = process.env.ZK_DIR || path.join(__dirname, '..', 'zk');
const files = () => ({ wasm: path.join(DIR, 'build', 'tally_js', 'tally.wasm'), zkey: path.join(DIR, 'build', 'tally.zkey'), vkey: path.join(DIR, 'vkey.json') });
const available = () => { const f = files(); return fs.existsSync(f.wasm) && fs.existsSync(f.zkey) && fs.existsSync(f.vkey); };
let poseidonP = null; const poseidon = () => (poseidonP ||= require('circomlibjs').buildPoseidon());

const halves = (wallet) => { const b = Buffer.from(bs58.decode(wallet)); if (b.length !== 32) throw new Error('bad wallet'); return [BigInt('0x' + b.subarray(0, 16).toString('hex')), BigInt('0x' + b.subarray(16).toString('hex'))]; };

// Deterministic circuit input from the canonical snapshot JSON. Ineligible votes (weight 0) are committed with raw 0.
async function buildInput(snapJson) {
  const s = typeof snapJson === 'string' ? JSON.parse(snapJson) : snapJson;
  if (s.house || !s.votes.length) return { skip: 'house pick, nothing to prove' };
  if (s.votes.length > N) return { skip: `more than ${N} votes` };
  if (s.candidates.length > C) return { skip: `more than ${C} candidates` };
  const idx = Object.fromEntries(s.candidates.map((c, i) => [c, i]));
  const P = await poseidon(); const F = P.F; const H = (xs) => F.toObject(P(xs));
  const rows = s.votes.map(([wallet, cand, , , , raw, weight]) => { const [hi, lo] = halves(wallet); const w = BigInt(weight); return { hi, lo, cand: BigInt(idx[cand]), raw: w > 0n ? BigInt(raw) : 0n, weight: w }; });
  while (rows.length < N) rows.push({ hi: 0n, lo: 0n, cand: 0n, raw: 0n, weight: 0n });
  let level = rows.map((r) => H([r.hi, r.lo, r.cand, r.raw]));
  while (level.length > 1) { const nx = []; for (let i = 0; i < level.length; i += 2) nx.push(H([level[i], level[i + 1]])); level = nx; }
  const totals = Array(C).fill(0n); for (const r of rows) totals[Number(r.cand)] += r.weight;
  let h = BigInt(s.round); for (let c = 0; c < C; c++) h = H([h, totals[c]]);
  const winner = idx[s.winner]; if (winner === undefined) return { skip: 'winner not on the ballot' };
  const input = { round: String(s.round), root: level[0].toString(), winner: String(winner), totalsCommit: h.toString(),
    wHi: rows.map((r) => r.hi.toString()), wLo: rows.map((r) => r.lo.toString()), cand: rows.map((r) => r.cand.toString()), raw: rows.map((r) => r.raw.toString()), weight: rows.map((r) => r.weight.toString()) };
  return { input, root: input.root, totalsCommit: input.totalsCommit, winnerIndex: winner, totals: totals.map(String) };
}

async function prove(snapJson) {
  const b = await buildInput(snapJson); if (b.skip) return { status: 'skipped', reason: b.skip };
  const snarkjs = require('snarkjs'); const f = files(); const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(b.input, f.wasm, f.zkey, undefined, {}, { singleThread: process.env.ZK_SINGLE_THREAD !== '0' });
  const ms = Date.now() - t0;
  const ok = await snarkjs.groth16.verify(JSON.parse(fs.readFileSync(f.vkey)), publicSignals, proof);
  return { status: ok ? 'proven' : 'failed', ms, proof, publicSignals, root: b.root, totalsCommit: b.totalsCommit, winnerIndex: b.winnerIndex, totals: b.totals };
}
async function verify(publicSignals, proof) { return require('snarkjs').groth16.verify(JSON.parse(fs.readFileSync(files().vkey)), publicSignals, proof); }
// public signals order: round, root, winner, totalsCommit (circuit declaration order)
const signalsMatch = (sig, b, round) => sig[0] === String(round) && sig[1] === b.root && sig[2] === String(b.winnerIndex) && sig[3] === b.totalsCommit;

// Proves in a child process (lib/zk-worker.js) with a heap cap, so a 512 MB instance keeps serving.
function proveInChild(snapJson, { heapMb = Number(process.env.ZK_HEAP_MB) || 300, timeoutMs = Number(process.env.ZK_TIMEOUT_MS) || 180000 } = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, path.join(__dirname, 'zk-worker.js')], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ZK_SINGLE_THREAD: process.env.ZK_SINGLE_THREAD || '1' } });
    let out = ''; const t = setTimeout(() => ch.kill('SIGKILL'), timeoutMs);
    ch.stdout.on('data', (d) => (out += d));
    ch.on('close', (code, sig) => { clearTimeout(t); try { resolve(JSON.parse(out)); } catch { resolve({ status: 'failed', error: sig ? 'prover killed (' + sig + '), likely time or memory limit' : 'prover exited ' + code }); } });
    ch.stdin.end(typeof snapJson === 'string' ? snapJson : JSON.stringify(snapJson));
  });
}

// Queue: newest unproven round first, one proof at a time, then the optional on-chain record.
function createProver({ store, enabled, chain = null, log = () => {}, proveFn = proveInChild }) {
  const D = store.data; let busy = false;
  async function tick() {
    if (!enabled || busy || !available()) return; D.proofs ||= {};
    const r = Object.keys(D.snapshots || {}).map(Number).sort((a, b) => b - a).find((x) => !D.proofs[x]); if (!r) return;
    busy = true;
    try {
      const out = await proveFn(D.snapshots[r]); D.proofs[r] = { ...out, at: Date.now() }; store.save();
      log(`[zk] round ${r} ${out.status}${out.ms ? ' in ' + out.ms + ' ms' : ''}${out.error ? ': ' + out.error : ''}`);
      if (chain && out.status === 'proven') {
        try { D.proofs[r].onchain = await chain.submit(r, out.proof, out.publicSignals); log(`[zk] round ${r} recorded on chain`); }
        catch (e) {
          // the record may already exist (a retry after a crash, or state restored from backup): accept it only if it matches
          let rec = null; try { rec = chain.mode && chain.mode() === 'verify' ? null : await chain.read(r); } catch {}
          if (rec && rec.root === out.root && String(rec.winner) === String(out.winnerIndex) && rec.totalsCommit === out.totalsCommit) D.proofs[r].onchain = { sig: null, record: rec.address, existing: true };
          else D.proofs[r].onchainError = rec ? 'a different record already exists on chain for this round' : String(e.message).slice(0, 200);
        }
      }
    } catch (e) { D.proofs[r] = { status: 'failed', error: String(e.message).slice(0, 200), at: Date.now() }; log('[zk] ' + e.message); }
    finally { busy = false; store.save(); }
  }
  return { tick, available, busy: () => busy };
}

// Full recheck from the snapshot alone: rebuild the tree, compare the public signals, verify the proof.
async function check(snapJson, rec) {
  if (!rec || rec.status !== 'proven') return { ok: false, reason: rec ? rec.status : 'no proof' };
  const b = await buildInput(snapJson); if (b.skip) return { ok: false, reason: b.skip };
  const round = JSON.parse(snapJson).round;
  if (!signalsMatch(rec.publicSignals, b, round)) return { ok: false, reason: 'public signals do not match the snapshot' };
  const ok = await verify(rec.publicSignals, rec.proof);
  return { ok, reason: ok ? 'proof valid for this snapshot' : 'proof invalid', root: b.root, totalsCommit: b.totalsCommit, winnerIndex: b.winnerIndex };
}
module.exports = { buildInput, prove, proveInChild, check, verify, signalsMatch, createProver, available, N, C, DEPTH, files };
