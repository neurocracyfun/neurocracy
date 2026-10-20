// Payout carry-over check with production defaults (lib/config.js): 1 SOL in the distributor,
// round 1 pays 0.1, round 2 pays 0.09, round 3 0.081, a no-vote round pays nothing, small shares accrue
// below 0.001 SOL, and the daily cap limits the pool. Fake chain, no network. Usage: node scripts/payout-carry-sim.js
const assert = require('assert'); const web3 = require('@solana/web3.js');
const { createPayouts } = require('../lib/payouts'); const cfgBase = require('../lib/config');
const W = () => web3.Keypair.generate().publicKey.toBase58();
const OPS = W(); const MINT = W(); let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('PASS ' + m); };
function rig(balance, over = {}) {
  let bal = BigInt(balance); let n = 0; const st = {};
  const chain = { address: () => 'EoiYniMMajEdhryrwfsXroz48Yn81z14tB2hejj7Zuh1', canSend: () => true, balance: async () => bal, blockHeight: async () => 100, status: async (s) => st[s] ?? null,
    prepare: async (items) => { const sig = 's' + (++n); return { sig, lastValid: 250, send: async () => { for (const [, l] of items) bal -= BigInt(l); st[sig] = 'confirmed'; } }; } };
  const cfg = { mint: MINT, payout: { ...cfgBase.payout, enabled: true, dryRun: false, opsAddress: OPS, reserveLamports: 0, ...over } };
  const a = W(), b = W(); const store = { data: { votes: {} }, save() {} };
  const p = createPayouts({ cfg, store, chain, now: () => Date.parse('2026-10-20T16:00:00Z') });
  const round = (id, house = false) => { store.data.votes[id] = house ? {} : { [a]: { candidate: 'p:owl', weightInt: '1000', rawAtClose: '1000000' }, [b]: { candidate: 'p:owl', weightInt: '3000', rawAtClose: '9000000' } }; return { id, winner: { id: 'p:owl' }, house, nominator: null }; };
  return { p, round, bal: () => bal, a, b, cfg };
}
(async () => {
  ok(cfgBase.payout.roundBps === 1000 && cfgBase.payout.shareBps === 7000 && cfgBase.payout.nominatorBps === 1000 && cfgBase.payout.opsBps === 2000 && cfgBase.payout.minLamports === 1000000, 'defaults: 10% per round, 70/10/20, 0.001 SOL minimum');
  const g = rig(1_000_000_000n); const pools = [];
  for (const id of [1, 2, 3]) { await g.p.onRoundClosed(g.round(id)); await g.p.tick(); pools.push(BigInt(g.p.forRound(id).pool)); }
  ok(pools[0] === 100_000_000n && pools[1] === 90_000_000n && pools[2] === 81_000_000n, `pools 0.1 / 0.09 / 0.081 SOL: ${pools.map((x) => Number(x) / 1e9).join(' / ')}`);
  const e1 = g.p.forRound(1); ok(BigInt(e1.opsLamports) === 20_000_000n && BigInt(e1.voterPool) === 80_000_000n, 'round 1: ops 20%, voters 70% + 10% unclaimed nominator share');
  ok(g.bal() === 1_000_000_000n - 271_000_000n, 'distributor paid exactly the three pools, 72.9% carried over: ' + Number(g.bal()) / 1e9);
  const h = await g.p.plan(g.round(4, true)); ok(h.status === 'skipped', 'no-vote round pays nothing: ' + h.reason);
  const s = rig(5_000_000n); await s.p.onRoundClosed(s.round(1)); const es = s.p.forRound(1);
  ok(s.bal() === 5_000_000n, 'pool of 0.0005 SOL: every share under 0.001 SOL accrues, nothing sent (pool ' + es.pool + ')');
  const c = rig(100_000_000_000n); const ec = await c.p.plan(c.round(1)); ok(BigInt(ec.pool) === BigInt(cfgBase.payout.dailyCapLamports), 'daily cap: 100 SOL pool of 10 SOL capped at ' + Number(ec.pool) / 1e9 + ' SOL');
  console.log(`\n${pass} checks passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
