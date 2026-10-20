// Burn verification, payout math, payout idempotency, snapshot determinism, burn-gated endpoints.
const test = require('node:test'); const assert = require('node:assert');
const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58'));
const { inspectBurn, verifyBurn } = require('../lib/burns');
const { createPayouts, split } = require('../lib/payouts');
const { snapshot } = require('../lib/snapshot');
const { createBurnFeatures, nominateMemo, replyMemo } = require('../lib/burnfeatures');
const { createApp } = require('../server');
const { tokensFor, parseCurve, curvePriceSol } = require('../lib/price');
const { createQuotes } = require('../lib/quotes');

const FIXED_T = Math.floor(Date.parse('2026-10-20T00:05:00Z') / 1000);   // matches the fixed app clock below
const MINT = 'MintNcracy1111111111111111111111111111111111';
const W = () => bs58.encode(nacl.sign.keyPair().publicKey);
const SIG = (n = 1) => bs58.encode(Buffer.alloc(64, n));
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'; const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
function burnTx({ wallet, amount, memo, mint = MINT, signer = true, err = null, inner = false, blockTime = Math.floor(Date.now() / 1000), authority }) {
  const burn = { programId: T22, parsed: { type: 'burnChecked', info: { account: W(), mint, authority: authority || wallet, tokenAmount: { amount: String(amount), decimals: 6 } } } };
  const memoIx = { programId: MEMO, parsed: memo };
  return { slot: 1, blockTime, meta: { err, innerInstructions: inner ? [{ index: 0, instructions: [burn] }] : [] }, transaction: { message: { accountKeys: [{ pubkey: wallet, signer }, { pubkey: W(), signer: false }], instructions: inner ? [memoIx] : [burn, memoIx] } } };
}
const base = { mint: MINT, minRaw: 50000n * 1000000n, memo: 'Neurocracy nominate 9-gemmascope-res-16k/15766' };

test('burn verification: accepts a real burn, rejects every way to fake one', () => {
  const w = W(); const ok = { ...base, wallet: w };
  assert.strictEqual(inspectBurn(burnTx({ wallet: w, amount: 50000e6, memo: base.memo }), ok).burned, '50000000000');
  assert.ok(inspectBurn(burnTx({ wallet: w, amount: 60000e6, memo: base.memo, inner: true }), ok));            // inner instruction
  const no = (tx, re) => assert.throws(() => inspectBurn(tx, ok), re);
  no(null, /not found/);
  no(burnTx({ wallet: w, amount: 49999e6, memo: base.memo }), /smaller/);
  no(burnTx({ wallet: w, amount: 50000e6, memo: base.memo, mint: W() }), /no burn/);                          // other token
  no(burnTx({ wallet: w, amount: 50000e6, memo: base.memo, signer: false }), /not signed/);
  no(burnTx({ wallet: w, amount: 50000e6, memo: base.memo, authority: W() }), /no burn/);                     // someone else's tokens
  no(burnTx({ wallet: w, amount: 50000e6, memo: 'Neurocracy reply 123' }), /memo/);                           // burn bound to another purpose
  no(burnTx({ wallet: w, amount: 50000e6, memo: base.memo, err: { InstructionError: [0, 'x'] } }), /failed/);
  no(burnTx({ wallet: w, amount: 50000e6, memo: base.memo, blockTime: Math.floor(Date.now() / 1000) - 90000 }), /too old/);
});

test('burn verification: a signature can be used only once', async () => {
  const w = W(); const D = {}; const cfg = { mint: MINT, decimals: 6, rpc: 'x' };
  const getTx = async () => burnTx({ wallet: w, amount: 50000e6, memo: base.memo });
  await verifyBurn(cfg, D, { signature: SIG(3), wallet: w, minUi: 50000, memo: base.memo, purpose: 'nominate', getTx });
  await assert.rejects(verifyBurn(cfg, D, { signature: SIG(3), wallet: w, minUi: 50000, memo: base.memo, purpose: 'nominate', getTx }), /already used/);
  await assert.rejects(verifyBurn({ ...cfg, mint: '' }, D, { signature: SIG(4), wallet: w, minUi: 1, memo: 'm', getTx }), /not live/);
});

test('payout math: pro rata by integer weight, remainder is dust, nothing is created', () => {
  const r = split(1000n, [{ wallet: 'a', weight: 1n }, { wallet: 'b', weight: 2n }, { wallet: 'c', weight: 0n }]);
  assert.deepStrictEqual(r.shares, { a: 333n, b: 666n }); assert.strictEqual(r.dust, 1n);
  const big = split(123456789n, Array.from({ length: 50 }, (_, i) => ({ wallet: 'w' + i, weight: BigInt(i * 7 + 1) })));
  assert.strictEqual(Object.values(big.shares).reduce((a, b) => a + b, 0n) + big.dust, 123456789n);
  assert.deepStrictEqual(split(0n, [{ wallet: 'a', weight: 1n }]).shares, {});
});

function payoutRig({ balance = 10_000_000_000n, over = {} } = {}) {
  const sent = []; const statuses = {}; let height = 100; let n = 0;
  const chain = { address: () => 'Dist1111111111111111111111111111111111111111', canSend: () => true, balance: async () => balance,
    blockHeight: async () => height, status: async (s) => statuses[s] ?? null,
    prepare: async (items) => { const sig = 'sig' + (++n); return { sig, lastValid: height + 150, send: async () => { sent.push({ sig, items }); } }; } };
  const OPS = 'Ops11111111111111111111111111111111111111111';
  const cfg = { mint: MINT, payout: { enabled: true, dryRun: false, shareBps: 7000, nominatorBps: 1000, opsBps: 2000, opsAddress: OPS, roundBps: 10000, minLamports: 1_000_000, reserveLamports: 10_000_000, dailyCapLamports: 100_000_000_000, maxPerTx: 2, ...over } };
  const a = W(), b = W(), c = W();
  const store = { data: { votes: { 7: { [a]: { candidate: 'p:owl', weightInt: '1000', rawAtClose: '1000000' }, [b]: { candidate: 'p:owl', weightInt: '3000', rawAtClose: '9000000' }, [c]: { candidate: 'p:cat', weightInt: '9000', rawAtClose: '81000000' } } } }, save() {} };
  const p = createPayouts({ cfg, store, chain, now: () => Date.parse('2026-10-20T00:00:00Z') });
  return { p, OPS, store, sent, statuses, a, b, c, setHeight: (h) => (height = h), round: { id: 7, winner: { id: 'p:owl' }, house: false, nominator: null } };
}

test('payouts: 70% voters + 10% nominator roll-over + 20% operations, cap, accrual below the minimum', async () => {
  const g = payoutRig();
  const e = await g.p.plan(g.round);
  // pool = 10 SOL - 0.01 reserve = 9.99 SOL. No nomination: voters get 70% + 10% = 7.992 SOL, split by balance 1:9. Ops 20%.
  assert.strictEqual(e.pool, '9990000000'); assert.strictEqual(e.voterPool, '7992000000'); assert.strictEqual(e.opsLamports, '1998000000');
  assert.strictEqual(e.shares[g.a], '799200000'); assert.strictEqual(e.shares[g.b], '7192800000'); assert.strictEqual(e.shares[g.OPS], '1998000000'); assert.ok(!e.shares[g.c]);
  assert.strictEqual(BigInt(e.shares[g.a]) + BigInt(e.shares[g.b]) + BigInt(e.shares[g.OPS]) + BigInt(e.dust), 9990000000n);
  const e2 = await g.p.plan({ ...g.round, id: 8 }); assert.strictEqual(e2.status, 'skipped');   // nothing is allocated twice
  const capped = payoutRig({ over: { dailyCapLamports: 100_000_000 } }); assert.strictEqual((await capped.p.plan(capped.round)).pool, '100000000');
  const tiny = payoutRig({ balance: 11_000_000n });               // pool 0.001 SOL: every share is below the minimum
  await tiny.p.onRoundClosed(tiny.round);
  assert.strictEqual(tiny.sent.length, 0); assert.ok(BigInt(tiny.p.wallet(tiny.b).owed) > 0n);
  const house = payoutRig(); assert.strictEqual((await house.p.plan({ ...house.round, house: true })).status, 'skipped');
  assert.strictEqual(payoutRig({ over: { opsAddress: '' } }).p.active(), false);   // stays off without an ops wallet
  assert.strictEqual(payoutRig({ over: { shareBps: 9000 } }).p.active(), false);   // shares above 100% are refused
});

test('payouts: 10% of the pool per round, the rest carries over; split by balance, so splitting wallets gains nothing', async () => {
  const g = payoutRig({ over: { roundBps: 1000 } });
  const e = await g.p.plan(g.round); assert.strictEqual(e.pool, '999000000');                       // 10% of 9.99 SOL
  g.store.data.votes[8] = g.store.data.votes[7]; const e2 = await g.p.plan({ ...g.round, id: 8 }); assert.strictEqual(e2.pool, '899100000');        // 10% of what is left
  const s = payoutRig({ over: { roundBps: 10000 } }); const v = s.store.data.votes[7];
  const parts = Array.from({ length: 9 }, () => W()); delete v[s.b]; for (const w of parts) v[w] = { candidate: 'p:owl', weightInt: '1000', rawAtClose: '1000000' };   // b's 9M split over 9 wallets
  const es = await s.p.plan(s.round); const sum = parts.reduce((x, w) => x + BigInt(es.shares[w] || 0), 0n);
  assert.ok(sum <= 7192800000n && sum > 7192799990n, 'same payout as one wallet, up to rounding: ' + sum);
});

test('payouts: winning nominator gets 10%, voters keep 70%', async () => {
  const g = payoutRig(); const nom = W();
  const e = await g.p.plan({ ...g.round, nominator: nom });
  assert.strictEqual(e.nominator.lamports, '999000000'); assert.strictEqual(e.shares[nom], '999000000');
  assert.strictEqual(e.voterPool, '6993000000'); assert.strictEqual(e.shares[g.OPS], '1998000000');
});

test('payouts: idempotent per round, confirmed batches never resent, expired ones retried once', async () => {
  const g = payoutRig();
  await g.p.onRoundClosed(g.round); await g.p.onRoundClosed(g.round);    // closed twice (restart)
  assert.strictEqual(g.sent.length, 2); assert.strictEqual(g.sent[0].items.length + g.sent[1].items.length, 3);   // a, b, ops in batches of 2
  await g.p.tick(); assert.strictEqual(g.sent.length, 2);                // pending: wait, no resend
  g.statuses.sig1 = 'confirmed'; g.statuses.sig2 = 'confirmed'; await g.p.tick();
  for (const w of [g.a, g.b, g.OPS]) assert.strictEqual(g.p.wallet(w).owed, '0');
  assert.strictEqual(g.p.wallet(g.a).history[0].kind, 'paid');
  await g.p.tick(); await g.p.onRoundClosed(g.round); assert.strictEqual(g.sent.length, 2);
  const h = payoutRig(); await h.p.onRoundClosed(h.round); h.setHeight(1000); await h.p.tick();
  assert.strictEqual(h.sent.length, 4); h.statuses.sig3 = 'confirmed'; h.statuses.sig4 = 'confirmed'; await h.p.tick();
  assert.strictEqual(h.p.wallet(h.b).owed, '0'); assert.strictEqual(h.sent.length, 4);
});

test('payouts: dry run sends nothing and keeps a separate book', async () => {
  const g = payoutRig({ over: { dryRun: true } });
  const e = await g.p.onRoundClosed(g.round);
  assert.strictEqual(e.status, 'dry-run'); assert.strictEqual(g.sent.length, 0); assert.ok(g.store.data.payout.dry && !g.store.data.payout.live);
});

test('snapshot is deterministic and independent of insertion order', () => {
  const cfg = { mint: MINT, decimals: 6, voteMin: 1 }; const bounds = { startsAt: 1, endsAt: 2 };
  const v1 = { a: { candidate: 'p:owl', message: 'm1', signature: 's1', rawAtClose: '4000000', weightInt: '2000' }, b: { candidate: 'p:cat', topic: 'x', message: 'm2', signature: 's2', rawAtClose: '9000000', weightInt: '3000' } };
  const v2 = { b: v1.b, a: v1.a };
  const s1 = snapshot({ cfg, round: 5, bounds, candidates: [{ id: 'p:owl' }, { id: 'p:cat' }], votes: v1, winner: 'p:cat' });
  const s2 = snapshot({ cfg, round: 5, bounds, candidates: [{ id: 'p:cat' }, { id: 'p:owl' }], votes: v2, winner: 'p:cat' });
  assert.strictEqual(s1.json, s2.json); assert.match(s1.hash, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(JSON.parse(s1.json).totals, [['p:cat', '3000'], ['p:owl', '2000']]);
});

function burnRig(over = {}, priceUsd = 0.0001) {
  let tx = null; let px = priceUsd;
  const cfg = { ...require('../lib/config'), mint: MINT, rpc: 'http://127.0.0.1:1', decimals: 6, presetsFile: __dirname + '/../data/presets.json', roundEpoch: Date.parse('2026-10-01T00:00:00Z'), roundMinutes: 30,
    nominate: { enabled: true, usd: 5, min: 10000, max: 2000000, maxPerRound: 1 }, replyBurn: { enabled: true, usd: 1.5, min: 3000, max: 600000, perWalletPerDay: 1 }, payout: { ...require('../lib/config').payout }, ...over };
  const store = { data: { rounds: {}, votes: {}, candidates: {}, lab: [], labUse: {}, posts: [], links: {}, mentions: { sinceId: null, seen: [] }, xDay: {}, feats: {} }, save() {}, flush() {} };
  const posts = { '1849000000000000001': { author: 'someone', mentions: ['neurocracyfun'], text: 'hey @neurocracyfun what do you think' }, '1849000000000000002': { author: 'someone', mentions: ['neurocracyfun'], text: '@neurocracyfun again' }, '1849000000000000009': { author: 'a', mentions: ['neurocracyfun'], text: '@neurocracyfun' }, '1849000000000000003': { author: 'stranger', mentions: [], text: 'unrelated' }, '1849000000000000004': { author: 'mehandle', mentions: [], text: 'my own post' } };
  const a = createApp(cfg, { store, chain: null, lookupPost: async (id) => (posts[id] ? { id, ...posts[id] } : { missing: true }), steer: async () => ({ steered: 'The river is calm tonight and I am listening to the water as it moves past the stones.', normal: 'n', share: 's' }), featureInfo: async (l, i) => (i === 666 ? 'black people' : 'birds of prey'), getTx: async () => tx, price: { get: async () => (px ? { usd: px, source: 'test' } : null) }, now: () => Date.parse('2026-10-20T00:05:00Z') });
  return { ...a, D: store.data, setTx: (t) => (tx = t), setPrice: (p) => (px = p) };
}
async function call(app, method, path, body) {
  const srv = app.listen(0); try { const r = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; } finally { srv.close(); }
}

test('nomination by burn: USD quote, verified burn joins the next ballot with room, filter blocks bad features', async () => {
  const g = burnRig(); const w = W(); const L = '9-gemmascope-res-16k';
  const q = await call(g.app, 'GET', `/api/nominate/quote?layer=${L}&index=15766`);
  assert.strictEqual(q.status, 200, JSON.stringify(q.body)); assert.strictEqual(q.body.memo, nominateMemo(L, 15766));
  assert.strictEqual(q.body.burn, 50000); assert.strictEqual(q.body.usd, 5);             // $5 at $0.0001
  assert.strictEqual((await call(g.app, 'GET', `/api/nominate/quote?layer=${L}&index=666`)).status, 400);
  g.setTx(burnTx({ wallet: w, amount: 49999e6, memo: nominateMemo(L, 15766), blockTime: FIXED_T }));
  assert.match((await call(g.app, 'POST', '/api/nominate', { wallet: w, layer: L, index: 15766, signature: SIG(8), quote: q.body.quote })).body.error, /smaller/);
  g.setTx(burnTx({ wallet: w, amount: 50000e6, memo: nominateMemo(L, 15766), blockTime: FIXED_T }));
  assert.strictEqual((await call(g.app, 'POST', '/api/nominate', { wallet: w, layer: L, index: 15766, signature: SIG(9) })).status, 400);  // no quote
  const r = await call(g.app, 'POST', '/api/nominate', { wallet: w, layer: L, index: 15766, signature: SIG(9), quote: q.body.quote });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); const first = r.body.round;
  assert.strictEqual(g.D.candidates[first][0].nominator, w);
  assert.strictEqual((await call(g.app, 'POST', '/api/nominate', { wallet: w, layer: L, index: 15766, signature: SIG(9), quote: q.body.quote })).status, 409); // reused
  assert.strictEqual((await call(g.app, 'POST', '/api/nominate', { wallet: w, layer: L, index: 100, signature: SIG(11), quote: q.body.quote })).status, 400); // quote for another feature
  const q2 = await call(g.app, 'GET', `/api/nominate/quote?layer=${L}&index=100`);
  g.setTx(burnTx({ wallet: w, amount: 50000e6, memo: nominateMemo(L, 100), blockTime: FIXED_T }));
  const r2 = await call(g.app, 'POST', '/api/nominate', { wallet: w, layer: L, index: 100, signature: SIG(10), quote: q2.body.quote });
  assert.strictEqual(r2.body.round, first + 1);                                   // ballot full (max 1): next round, never lost
  g.setPrice(null);
  assert.strictEqual((await call(g.app, 'GET', `/api/nominate/quote?layer=${L}&index=200`)).status, 503);   // no price, no burns
  const c = await call(g.app, 'GET', '/api/config'); assert.strictEqual(c.body.burns.nominate.priced, false);
});

test('burn for reply: USD quote, verified burn queues a reply, per-wallet limit, dry run only previews', async () => {
  const g = burnRig(); const w = W(); const url = 'https://x.com/someone/status/1849000000000000001';
  assert.strictEqual((await call(g.app, 'GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://evil.example/x'))).status, 400);
  const qx = (u, wl = w) => call(g.app, 'GET', '/api/reply-burn/quote?url=' + encodeURIComponent(u) + '&wallet=' + wl);
  const no = await qx('https://x.com/stranger/status/1849000000000000003'); assert.strictEqual(no.status, 400); assert.match(no.body.error, /mention/);   // unsolicited: refused before any burn
  assert.strictEqual((await qx('https://x.com/mehandle/status/1849000000000000004')).status, 400);
  g.D.links.mehandle = w; assert.strictEqual((await qx('https://x.com/mehandle/status/1849000000000000004')).status, 200);   // own linked handle: allowed
  assert.strictEqual((await qx('https://x.com/someone/status/1849000000000000001', W())).status, 200);                          // mentions the account: allowed for anyone
  const q = await qx(url);
  assert.strictEqual(q.body.burn, 15000);                                          // $1.5 at $0.0001
  g.setTx(burnTx({ wallet: w, amount: 15000e6, memo: replyMemo('1849000000000000001'), blockTime: FIXED_T }));
  const r = await call(g.app, 'POST', '/api/reply-burn', { wallet: w, url, signature: SIG(21), quote: q.body.quote });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const url2 = url.replace('01', '02'); const q3 = await qx(url2);
  assert.strictEqual(q3.status, 429); assert.match(q3.body.error, /per wallet per day/);   // daily limit refused at the quote, before any burn
  assert.strictEqual((await qx(url, W())).status, 400);                                      // already queued: refused at the quote
  g.D.posts.unshift({ id: 'r9', kind: 'reply', inReplyTo: '1849000000000000005', status: 'posted' });
  assert.match((await qx('https://x.com/someone/status/1849000000000000005', W())).body.error || '', /already replied/);
  g.D.rounds[1] = { id: 1, winner: { id: 'p:owl', name: 'The Owl' }, mix: [], house: true };
  await g.xbot.paidReplies(g.D.rounds[1]);
  assert.strictEqual(g.D.replyQueue[0].status, 'preview');
});

test('USD conversion: rounds up to whole tokens and clamps to min and max', () => {
  assert.strictEqual(tokensFor(5, 0.0001, 10000, 500000), 50000);
  assert.strictEqual(tokensFor(5, 0.00003, 10000, 500000), 166667);
  assert.strictEqual(tokensFor(5, 0.01, 10000, 500000), 10000);
  assert.strictEqual(tokensFor(5, 0.000001, 10000, 500000), 500000);
  assert.strictEqual(tokensFor(1.5, 0.0001, 3000, 150000), 15000);
  assert.strictEqual(tokensFor(1.5, 0, 3000, 150000), null); assert.strictEqual(tokensFor(1.5, NaN, 3000, 150000), null);
  const buf = Buffer.alloc(49); buf.writeBigUInt64LE(1073000000000000n, 8); buf.writeBigUInt64LE(30000000000n, 16);
  const c = parseCurve(buf); assert.strictEqual(c.complete, false);
  assert.ok(Math.abs(curvePriceSol(c, 6) - 30 / 1073000000) < 1e-15);
  buf[48] = 1; assert.strictEqual(parseCurve(buf).complete, true);
});

test('quotes: signed, bound to purpose and ref, expire after ttl plus grace', () => {
  let t = 1000000; const Q = createQuotes({ secret: 's', ttlMs: 300000, graceMs: 600000, now: () => t });
  const q = Q.issue({ purpose: 'reply', ref: '123', amount: 15000 });
  assert.strictEqual(Q.open(q.quote, { purpose: 'reply', ref: '123' }).amount, 15000);
  assert.throws(() => Q.open(q.quote, { purpose: 'nominate', ref: '123' }), /something else/);
  const [p, sig] = q.quote.split('.'); const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), amount: 1 })).toString('base64url');
  assert.throws(() => Q.open(forged + '.' + sig, { purpose: 'reply', ref: '123' }), /invalid/);
  assert.throws(() => createQuotes({ secret: 'other' }).open(q.quote, { purpose: 'reply', ref: '123' }), /invalid/);
  t += 300000 + 600000 + 1; assert.throws(() => Q.open(q.quote, { purpose: 'reply', ref: '123' }), /expired/);
});

test('quotes: a burn that landed after the quote expired is refused', async () => {
  const g = burnRig(); const w = W(); const url = 'https://x.com/a/status/1849000000000000009';
  const q = await call(g.app, 'GET', '/api/reply-burn/quote?url=' + encodeURIComponent(url) + '&wallet=' + w);
  g.setTx(burnTx({ wallet: w, amount: 15000e6, memo: replyMemo('1849000000000000009'), blockTime: Math.floor((q.body.expiresAt + 60000) / 1000) }));
  const r = await call(g.app, 'POST', '/api/reply-burn', { wallet: w, url, signature: SIG(30), quote: q.body.quote });
  assert.strictEqual(r.status, 410, JSON.stringify(r.body));
});

test('all burn and payout features are off by default', async () => {
  const cfg = require('../lib/config');
  assert.strictEqual(cfg.payout.enabled, false); assert.strictEqual(cfg.payout.dryRun, true); assert.strictEqual(cfg.payout.shareBps, 7000); assert.strictEqual(cfg.payout.nominatorBps, 1000); assert.strictEqual(cfg.payout.opsBps, 2000);
  assert.strictEqual(cfg.nominate.enabled, false); assert.strictEqual(cfg.replyBurn.enabled, false);
  const g = burnRig({ nominate: { ...cfg.nominate }, replyBurn: { ...cfg.replyBurn } });
  assert.strictEqual((await call(g.app, 'POST', '/api/reply-burn', {})).status, 409);
  assert.strictEqual((await call(g.app, 'GET', '/api/nominate/quote?layer=9-gemmascope-res-16k&index=1')).status, 409);
  const c = await call(g.app, 'GET', '/api/config'); assert.strictEqual(c.body.payout.enabled, false);
  assert.ok(!JSON.stringify(c.body).match(/key/i) || !JSON.stringify(c.body.payout).includes('key'));
});
