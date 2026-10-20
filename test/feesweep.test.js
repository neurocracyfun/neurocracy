// Fee sweeper + payout engine with a mocked chain (no network).
const test = require('node:test'); const assert = require('node:assert');
const { createFeeSweep, checkConfig } = require('../lib/feesweep');
const { createPayouts } = require('../lib/payouts');
const T = 'EoiYniMMajEdhryrwfsXroz48Yn81z14tB2hejj7Zuh1';
const good = { adminRevoked: true, shareholders: [{ address: T, shareBps: 10000 }] };

function world(sc, vault) {
  let t = 1_000_000; const s = { bal: 50_000_000n, vault: BigInt(vault), sent: [], paid: [] };
  const adapter = { payer: () => T, canSend: () => true, balance: async () => s.bal, readConfig: async () => sc,
    distributable: async () => ({ lamports: s.vault, graduated: false }),
    sweep: async () => { s.bal += s.vault - 5000n; s.sent.push(s.vault); s.vault = 0n; return { sig: 'sig' + s.sent.length }; } };
  const store = { data: { votes: {}, rounds: {} }, save() {} };
  const cfg = { mint: 'Mint111', feesweep: { enabled: true, minutes: 10, minLamports: 10_000_000 }, payout: { enabled: true, dryRun: false, shareBps: 7000, nominatorBps: 1000, opsBps: 2000, opsAddress: 'Ops1', roundBps: 1000, minLamports: 1_000_000, reserveLamports: 10_000_000, dailyCapLamports: 2_000_000_000, maxPerTx: 18 } };
  const fs = createFeeSweep({ cfg, store, adapter, now: () => t });
  const chain = { address: () => T, canSend: () => true, balance: async () => s.bal, blockHeight: async () => 1, status: async () => 'confirmed',
    prepare: async (items) => ({ sig: 'pay' + s.paid.length, lastValid: 100, send: async () => { for (const [, l] of items) s.bal -= BigInt(l); s.paid.push(items); } }) };
  const pay = createPayouts({ cfg, store, chain, now: () => t });
  return { fs, pay, s, store, cfg, adv: (ms) => (t += ms) };
}

test('checkConfig accepts only 100% to the distributor and locked', () => {
  assert.equal(checkConfig(good, T), null);
  assert.match(checkConfig(null, T), /no fee sharing config/);
  assert.match(checkConfig({ ...good, adminRevoked: false }, T), /not locked/);
  assert.match(checkConfig({ adminRevoked: true, shareholders: [{ address: 'Other', shareBps: 10000 }] }, T), /expected the distributor/);
  assert.match(checkConfig({ adminRevoked: true, shareholders: [{ address: T, shareBps: 5000 }, { address: 'X', shareBps: 5000 }] }, T), /2 shareholders/);
});

test('no sharing config or unlocked config: nothing is sent', async () => {
  for (const sc of [null, { ...good, adminRevoked: false }]) { const w = world(sc, 500_000_000); const r = await w.fs.tick(); assert.equal(r.swept, false); assert.equal(w.s.sent.length, 0); }
});

test('below minimum is skipped, above is swept, recorded, throttled to every 10 minutes', async () => {
  const w = world(good, 5_000_000); assert.equal((await w.fs.tick()).reason, 'below minimum');
  w.s.vault = 200_000_000n; assert.equal(await w.fs.tick(), null, 'throttled');
  w.adv(10 * 60e3); const r = await w.fs.tick(); assert.equal(r.swept, true); assert.equal(r.sig, 'sig1');
  assert.equal(w.fs.status().sweeps[0].lamports, '200000000'); assert.equal(w.fs.status().totalLamports, '200000000');
});

test('dry run checks but sends nothing', async () => {
  const w = world(good, 200_000_000); w.cfg.payout.dryRun = true; const r = await w.fs.tick(); assert.equal(r.reason, 'dry run'); assert.equal(w.s.sent.length, 0);
});

test('swept SOL counts toward the next voted round and is paid out automatically, reserve kept', async () => {
  const w = world(good, 1_000_000_000); await w.fs.tick();
  const A = 'VoterA', B = 'VoterB';
  w.store.data.votes[7] = { [A]: { candidate: 'p:owl', weightInt: '10', rawAtClose: '3000' }, [B]: { candidate: 'p:owl', weightInt: '10', rawAtClose: '1000' } };
  const e = await w.pay.onRoundClosed({ id: 7, winner: { id: 'p:owl' }, house: false });
  const avail = 50_000_000n + 1_000_000_000n - 5000n - 10_000_000n;
  assert.equal(BigInt(e.pool), avail / 10n);
  assert.equal(e.status, 'sending'); assert.equal(w.s.paid.length, 1);
  await w.pay.tick(); assert.equal(w.pay.forRound(7).status, 'settled'); assert.equal(w.pay.forRound(7).batches[0].status, 'paid');
  const paid = Object.fromEntries(w.s.paid[0]); assert.ok(BigInt(paid[A]) > BigInt(paid[B]) * 2n); assert.ok(paid.Ops1);
  assert.ok(w.s.bal > 10_000_000n, 'reserve stays');
});
