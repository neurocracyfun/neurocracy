// Regression tests for audit fixes: emoji cleanup, lowest-price quotes, integer winner, paid replies after going live.
const test = require('node:test'); const assert = require('node:assert');
const { clean, check } = require('../lib/filter');
const { createPrice } = require('../lib/price');
const { createXBot } = require('../lib/xbot');

test('emoji are removed, not a reason to drop a draft', () => {
  assert.ok(check('What a lovely morning in the forest with all my friends \u{1F989}').why.includes('symbols'));   // raw text still fails the check
  const t = clean('Old clocks are lovely! 🕰️ They keep time for us all day long, steady and patient 👀.');
  assert.strictEqual(t, 'Old clocks are lovely! They keep time for us all day long, steady and patient.'); assert.ok(check(t).ok);
});

test('burn quotes use the lowest price in the window, so a short pump does not make burns cheap', async () => {
  let t = 0; let px = 1e-5;
  const p = createPrice({ cfg: { mint: 'So11111111111111111111111111111111111111112', rpc: 'x', decimals: 6, price: { ttlMs: 0, windowMs: 30 * 60e3 } }, now: () => t, rpcImpl: async () => null,
    fetchImpl: async () => ({ ok: true, json: async () => ({ So11111111111111111111111111111111111111112: { usdPrice: px } }) }) });
  assert.strictEqual((await p.get()).usd, 1e-5);
  px = 1e-3; t += 60e3; const pumped = await p.get(); assert.strictEqual(pumped.usd, 1e-5); assert.strictEqual(pumped.spotUsd, 1e-3);
  t += 31 * 60e3; assert.strictEqual((await p.get()).usd, 1e-3);   // a lasting price change is picked up after the window
});

test('paid replies previewed in dry run are answered once the account goes live', async () => {
  const D = { posts: [], xDay: {}, mentions: { seen: [] }, links: {}, replyQueue: [{ id: 'b1', tweetId: '123456', author: 'a', status: 'preview' }] };
  const cfg = { xHandle: 'n', holderMin: 1, x: { dryRun: false, enabled: true, appKey: 'k', appSecret: 's', accessToken: 't', accessSecret: 'u', dailyCap: 5, candidates: 1, repliesPerRound: 1 } };
  const bot = createXBot({ cfg, store: { data: D, save() {} }, steer: async () => ({ steered: 'The tide comes in slowly tonight and the shore listens to every small wave.', share: null }), budget: { run: (k, f) => f() }, rounds: {}, presets: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: '999' } }) }) });
  await bot.paidReplies({ id: 1, mix: [], winner: { name: 'x' } });
  assert.strictEqual(D.replyQueue[0].status, 'posted');
});
