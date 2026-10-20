const test = require('node:test'); const assert = require('node:assert');
const np = require('../lib/np');
test('normFeatures merges duplicates and clamps strength', () => {
  const out = np.normFeatures([{ layer: '9-gemmascope-res-16k', index: 11964, strength: 60 }, { layer: '9-gemmascope-res-16k', index: '11964', strength: 60 }, { layer: '20-gemmascope-res-16k', index: 526, strength: -400 }]);
  assert.strictEqual(out.length, 2); assert.strictEqual(out[0].strength, 100); assert.strictEqual(out[1].strength, -100);
});
test('steer retries once on 5xx', async () => {
  const orig = global.fetch; let n = 0; process.env.NP_RETRY_MS = '1';
  global.fetch = async () => (++n === 1 ? new Response('x', { status: 500 }) : new Response(JSON.stringify({ STEERED: 'a', DEFAULT: 'b' }), { status: 200 }));
  try { const r = await np.steer('hi', [{ layer: '9-gemmascope-res-16k', index: 1, strength: 10 }]); assert.strictEqual(r.steered, 'a'); assert.strictEqual(n, 2); } finally { global.fetch = orig; }
});
