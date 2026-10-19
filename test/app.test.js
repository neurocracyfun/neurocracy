// Local tests with a mock Solana RPC, a mock Neuronpedia steer and a mock X API. No network.
const test = require('node:test'); const assert = require('node:assert');
const http = require('http'); const nacl = require('tweetnacl'); const bs58 = require('bs58').default || require('bs58');
const { createApp } = require('../server');
const { clean, check } = require('../lib/filter');
const sol = require('../lib/solana');

const MINT = 'MintNcracy1111111111111111111111111111111111'.slice(0, 44);
const kp = () => { const k = nacl.sign.keyPair(); return { addr: bs58.encode(k.publicKey), sign: (m) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), k.secretKey)) }; };
const balances = {}; const rpcCalls = [];
let rpcUrl;
const rpcServer = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
  const j = JSON.parse(b); rpcCalls.push(j);
  if (j.method === 'getTokenAccountsByOwner') { const v = balances[j.params[0]] || 0; res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { value: v ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmountString: String(v), amount: String(BigInt(Math.round(v * 1e6))) } } } } } }] : [] } })); }
  else res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { ok: true } }));
}); });

function setup(over = {}) {
  let t = Date.parse('2026-10-20T00:05:00Z');
  const cfg = { ...require('../lib/config'), rpc: rpcUrl, mint: 'mint' in over ? over.mint : MINT, holderMin: 1000, voteMin: 1, labPerDay: 2, npPerHour: 150, roundEpoch: Date.parse('2026-10-01T00:00:00Z'), roundMinutes: 30, presetsFile: __dirname + '/../data/presets.json', testMode: false, x: { ...require('../lib/config').x, ...(over.x || {}) } };
  const store = { data: { rounds: {}, votes: {}, candidates: {}, lab: [], labUse: {}, posts: [], links: {}, mentions: { sinceId: null, seen: [] }, xDay: {}, feats: {} }, save() {}, flush() {} };
  const outputs = over.outputs || [];
  let n = 0; const steer = async (q, mix, o = {}) => { n++; const s = outputs.length ? outputs[(n - 1) % outputs.length] : `I am a calm voice of the wood and I watch the river all night long, thinking about ${q.length} small things.`; return { steered: s, normal: 'I am Gemma, an AI assistant.', share: 'https://www.neuronpedia.org/steer/x' + n, ms: 1 }; };
  const xCalls = []; const fetchImpl = over.fetchImpl || (async (url, init) => { xCalls.push({ url, init }); return { ok: true, status: 201, json: async () => ({ data: { id: String(1000 + xCalls.length) } }) }; });
  const a = createApp(cfg, { store, steer, fetchImpl, now: () => t, featureInfo: async () => 'jazz music', search: async () => [] });
  return { ...a, cfg, D: store.data, advance: (ms) => (t += ms), now: () => t, xCalls, steerCount: () => n };
}
async function call(app, method, path, body) {
  const srv = app.listen(0); const port = srv.address().port;
  try { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }
  finally { srv.close(); }
}
const voteMsg = (r, c, topic, w) => `Neurocracy vote\nRound: ${r}\nCandidate: ${c}\nTopic: ${topic || '-'}\nWallet: ${w}`;

test.before(() => new Promise((r) => rpcServer.listen(0, () => { rpcUrl = `http://127.0.0.1:${rpcServer.address().port}`; r(); })));
test.after(() => rpcServer.close());
test.beforeEach(() => sol._cache.clear());

test('filter rejects slurs, advice, tickers, links, impersonation, symbols', () => {
  for (const [t, why] of [['You should buy now, this goes to the moon and you will love it.', 'financial-advice'], ['Check out $NCRACY today friends, it is a lovely little thing.', 'ticker-or-ca'], ['Visit neurocracy.fun for more of my thoughts on owls and stars.', 'url'], ['I am Hoot and I live in the old oak at the edge of the wood.', 'impersonation'], ['Look over there \u2192 the river is calm and the trees are tall.', 'symbols'], ['owl owl owl owl owl owl owl owl owl owl owl owl', 'garbled']]) assert.ok(check(clean(t)).why.includes(why), t + ' ' + check(clean(t)).why);
  assert.ok(check(clean('**The night is quiet.** I watch the field and listen for small sounds in the grass.')).ok);
  assert.ok(clean('x'.repeat(20) + '. ' + 'word '.repeat(80)).length <= 280);
});

test('balance read uses mint filter (Token-2022 safe) through server RPC', async () => {
  const { cfg } = setup(); const w = kp(); balances[w.addr] = 2500;
  assert.strictEqual(await sol.balanceOf(cfg, w.addr, { fresh: true }), 2500);
  const c = rpcCalls.filter((x) => x.method === 'getTokenAccountsByOwner').pop();
  assert.deepStrictEqual(c.params[1], { mint: MINT });
});

test('signed votes, sqrt weight, recheck at close, runner-up mix, top topic', async () => {
  const s = setup(); const r = s.rounds.current();
  const a = kp(), b = kp(), c = kp(); balances[a.addr] = 10000; balances[b.addr] = 6400; balances[c.addr] = 90000;
  let res = await call(s.app, 'POST', '/api/vote', { wallet: a.addr, round: r, candidate: 'p:owl', topic: 'the moon', signature: a.sign(voteMsg(r, 'p:owl', 'the moon', a.addr)) });
  assert.strictEqual(res.status, 200); assert.strictEqual(res.body.weight, 100);
  res = await call(s.app, 'POST', '/api/vote', { wallet: b.addr, round: r, candidate: 'p:cat', topic: '', signature: b.sign(voteMsg(r, 'p:cat', '', b.addr)) });
  assert.strictEqual(res.status, 200);
  res = await call(s.app, 'POST', '/api/vote', { wallet: c.addr, round: r, candidate: 'p:degen', topic: 'money', signature: c.sign(voteMsg(r, 'p:degen', 'money', c.addr)) });
  assert.strictEqual(res.status, 200);
  // forged and wrong-round votes
  res = await call(s.app, 'POST', '/api/vote', { wallet: a.addr, round: r, candidate: 'p:cat', topic: '', signature: b.sign(voteMsg(r, 'p:cat', '', a.addr)) }); assert.strictEqual(res.status, 400);
  res = await call(s.app, 'POST', '/api/vote', { wallet: a.addr, round: r + 1, candidate: 'p:cat', topic: '', signature: a.sign(voteMsg(r + 1, 'p:cat', '', a.addr)) }); assert.strictEqual(res.status, 400);
  const z = kp(); res = await call(s.app, 'POST', '/api/vote', { wallet: z.addr, round: r, candidate: 'p:cat', topic: '', signature: z.sign(voteMsg(r, 'p:cat', '', z.addr)) }); assert.strictEqual(res.status, 400);
  const open = await call(s.app, 'GET', '/api/round');   // open round: participation only, no per-option weights
  assert.strictEqual(open.body.voters, 3); assert.ok(open.body.candidates.every((x) => x.weight === undefined)); assert.deepStrictEqual(open.body.topics, []);
  const hid = await call(s.app, 'GET', '/api/votes/' + r); assert.strictEqual(hid.body.hidden, true); assert.ok(!JSON.stringify(hid.body).includes('p:owl'));
  balances[c.addr] = 0; // the degen whale sold before close
  s.advance(30 * 60e3); const closed = await s.rounds.close(r);
  assert.strictEqual(closed.winner.id, 'p:owl'); assert.strictEqual(closed.tally['p:degen'], undefined);
  assert.strictEqual(closed.mix.length, 2); assert.strictEqual(closed.mix[1].index, 15585); // cat at 80/100 of owl weight joins the mix
  assert.strictEqual(closed.topic, 'the moon');
  const pub = await call(s.app, 'GET', '/api/votes/' + r); assert.strictEqual(pub.body.length, 3);
});

test('no votes: house rotates presets', async () => {
  const s = setup(); const r = s.rounds.current(); s.advance(30 * 60e3);
  const c = await s.rounds.close(r); assert.ok(c.house); assert.ok(c.mix.length === 1);
});

test('x account dry run: 3 drafts, filter, pick, preview only, nothing sent', async () => {
  const s = setup({ outputs: ['Buy this now, it will moon tomorrow for sure my friends.', 'I am Hoot, the owl of the old oak at the edge of the wood tonight.', 'The night is quiet and the field is silver. I listen for small sounds and count the stars until morning.'] });
  const r = s.rounds.current(); s.advance(30 * 60e3); await s.tickOnce();
  const p = s.D.posts[0]; assert.strictEqual(p.status, 'preview'); assert.strictEqual(p.round, r);
  assert.match(p.text, /night is quiet/); assert.strictEqual(p.rejected.length, 2);
  assert.strictEqual(s.xCalls.length, 0); assert.strictEqual(s.steerCount(), 3);
  await s.tickOnce(); assert.strictEqual(s.D.posts.length, 1); // one post per round
  const hall = await call(s.app, 'GET', '/api/hall'); assert.strictEqual(hall.body.rounds[0].posts[0].text, p.text); assert.ok(hall.body.rounds[0].mix.length);
  const pub = await call(s.app, 'GET', '/api/posts'); assert.ok(!JSON.stringify(pub.body).includes('Hoot, the owl'));
});

test('x account live: posts with OAuth 1.0a, kill switch and daily cap', async () => {
  const keys = { appKey: 'k', appSecret: 's', accessToken: 't', accessSecret: 'x', userId: '42' };
  let s = setup({ x: { ...keys, dryRun: false, enabled: false } }); s.advance(30 * 60e3); await s.tickOnce();
  assert.strictEqual(s.D.posts[0].status, 'preview'); assert.strictEqual(s.xCalls.length, 0);
  s = setup({ x: { ...keys, dryRun: false, enabled: true, dailyCap: 1, mentionsPollMin: 9999 } }); s.advance(30 * 60e3); await s.tickOnce();
  const tw = s.xCalls.filter((c) => /\/2\/tweets$/.test(c.url));
  assert.strictEqual(s.D.posts[0].status, 'posted'); assert.strictEqual(tw.length, 1); assert.strictEqual(tw[0].init.method, 'POST');
  assert.match(tw[0].init.headers.Authorization, /^OAuth .*oauth_signature=/);
  assert.ok(s.xCalls.some((c) => /\/users\/42\/mentions\?/.test(c.url))); // owned read for mentions
  s.advance(30 * 60e3); await s.tickOnce(); assert.strictEqual(s.D.posts[0].status, 'capped');
});

test('replies: holder mentions first, capped per round', async () => {
  const keys = { appKey: 'k', appSecret: 's', accessToken: 't', accessSecret: 'x', userId: '42' };
  const s = setup({ x: { ...keys, dryRun: false, enabled: true, repliesPerRound: 2 } });
  const h = kp(); balances[h.addr] = 5000; s.D.links['fan'] = h.addr;
  s.advance(30 * 60e3); await s.rounds.close(s.rounds.current() - 1);
  const round = s.rounds.live();
  const out = await s.xbot.replies(round, [{ id: '1', text: '@neurocracyfun hello there', author: 'rando' }, { id: '2', text: '@neurocracyfun how are you', author: 'other' }, { id: '3', text: '@neurocracyfun who are you today', author: 'fan' }]);
  assert.strictEqual(out.length, 2); assert.strictEqual(out[0].to, 'fan'); assert.ok(out[0].holder);
  assert.ok(s.xCalls.every((c) => JSON.parse(c.init.body).reply));
});

test('lab: presets free, custom needs holder pass, daily limit', async () => {
  const s = setup(); const p = s.presets.list()[0]; const q = p.samples[0].prompt;
  let r = await call(s.app, 'POST', '/api/lab', { prompt: q, features: p.features });
  assert.strictEqual(r.status, 200); assert.ok(r.body.cached); assert.strictEqual(s.steerCount(), 0);
  const mix = [{ layer: '9-gemmascope-res-16k', index: 1234, strength: 50 }];
  r = await call(s.app, 'POST', '/api/lab', { prompt: 'Tell me a joke', features: mix }); assert.strictEqual(r.status, 401);
  const w = kp(); balances[w.addr] = 10; const day = new Date(s.now()).toISOString().slice(0, 10); const sig = w.sign(`Neurocracy lab\nDay: ${day}\nWallet: ${w.addr}`);
  r = await call(s.app, 'POST', '/api/lab', { prompt: 'Tell me a joke', features: mix, wallet: w.addr, signature: sig }); assert.strictEqual(r.status, 403);
  balances[w.addr] = 5000; sol._cache.clear();
  for (const t of ['a1', 'a2']) { r = await call(s.app, 'POST', '/api/lab', { prompt: 'Joke ' + t, features: mix, wallet: w.addr, signature: sig }); assert.strictEqual(r.status, 200); }
  r = await call(s.app, 'POST', '/api/lab', { prompt: 'Joke a3', features: mix, wallet: w.addr, signature: sig }); assert.strictEqual(r.status, 429);
  r = await call(s.app, 'POST', '/api/lab', { prompt: 'Joke a1', features: mix }); assert.strictEqual(r.status, 200); assert.ok(r.body.cached); // cache hit is free
});

test('global steer budget stops at the hourly cap', async () => {
  const { createBudget } = require('../lib/budget'); const b = createBudget(3); const ok = [];
  for (let i = 0; i < 5; i++) ok.push(await b.run('lab', async () => 1).then(() => 1, (e) => e.status));
  assert.deepStrictEqual(ok, [1, 1, 1, 429, 429]);
});

test('rpc proxy allowlist and public config hides secrets', async () => {
  const s = setup(); let r = await call(s.app, 'POST', '/api/rpc', { jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [] }); assert.strictEqual(r.status, 403);
  r = await call(s.app, 'POST', '/api/rpc', { jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['x'] }); assert.strictEqual(r.status, 200);
  r = await call(s.app, 'GET', '/api/config'); const txt = JSON.stringify(r.body);
  assert.ok(!txt.includes(rpcUrl) && !/appSecret|accessSecret|npKey/.test(txt)); assert.strictEqual(r.body.ticker, 'NCRACY'); assert.strictEqual(r.body.mint, MINT);
});

test('preview mode (no mint): votes closed with 409, Lab gives 3 free live steers per visitor', async () => {
  const a = setup({ mint: null });
  const c = await call(a.app, 'GET', '/api/config'); assert.strictEqual(c.body.preview, true);
  const v = await call(a.app, 'POST', '/api/vote', {}); assert.strictEqual(v.status, 409); assert.match(v.body.error, /not live/);
  const f = (i) => ({ prompt: 'Tell me about rivers ' + i, features: [{ layer: '9-gemmascope-res-16k', index: 15766, strength: 60 }] });
  for (let i = 0; i < 3; i++) { const r = await call(a.app, 'POST', '/api/lab', f(i)); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.preview, true); }
  assert.strictEqual((await call(a.app, 'POST', '/api/lab', f(9))).status, 429);
  assert.strictEqual(a.steerCount(), 3);
});
