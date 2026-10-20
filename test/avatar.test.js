// Round avatar + bio: persona detection, caching, interval/cap, dry run, mocked image providers and X.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createAvatar, personasOf, roundText, voteShares, comboKey, CLOSER, promptFor } = require('../lib/avatar');
const { loadPresets } = require('../lib/presets');
const presets = loadPresets(path.join(__dirname, '..', 'data', 'presets.json'));
const feat = (id) => presets.find(id).features[0];
const round = (id, ...ps) => ({ id, mix: ps.map(feat) });

function setup({ env = {}, dryRun = false, keys = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-av-'));
  const pub = path.join(dir, 'public'); fs.mkdirSync(path.join(pub, 'img', 'avatars'), { recursive: true });
  for (const id of ['owl', 'chef', 'default']) fs.writeFileSync(path.join(pub, 'img', 'avatars', id + '.png'), Buffer.from('png-' + id));
  const store = { data: {}, save() {} }; let t = Date.parse('2026-10-20T00:00:00Z');
  const calls = { x: [], img: 0 };
  const fetchImpl = async (url, opt) => {
    if (url.includes('/images/generations')) { calls.img++; return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from('jpg').toString('base64') }] }) }; }
    calls.x.push({ url, body: new URLSearchParams(opt.body), auth: opt.headers.Authorization }); return { ok: true, status: 200, json: async () => ({}) };
  };
  const x = keys ? { appKey: 'a', appSecret: 'b', accessToken: 'c', accessSecret: 'd' } : {};
  const cfg = { db: path.join(dir, 'db.json'), x: { dryRun, ...x } };
  const av = createAvatar({ cfg, store, presets, now: () => t, fetchImpl, env: { NC_AVATAR: '1', NC_IMAGE_PROVIDER: 'openai', NC_IMAGE_API_KEY: 'k', ...env }, log: () => {}, publicDir: pub });
  return { av, calls, store, dir, tick: (m) => { t += m * 60e3; } };
}

test('persona detection, combo key, post prefix and the length rule', () => {
  assert.deepStrictEqual(personasOf(round(1, 'ocean', 'chef'), presets), ['ocean', 'chef']);
  assert.strictEqual(comboKey(['ocean', 'chef']), comboKey(['chef', 'ocean']));
  const sh = [{ id: 'p:ocean', pct: 50 }, { id: 'p:chef', pct: 50 }];
  assert.strictEqual(roundText(['ocean', 'chef'], presets, '', sh), "This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. Got a question or something you want me to do?");
  assert.strictEqual(roundText(['ocean', 'chef'], presets, 'Eight arms, one kitchen.', sh), "This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. Eight arms, one kitchen. Got a question or something you want me to do?");
  assert.strictEqual(roundText(['owl'], presets, 'Hoo.', voteShares({ tally: {} }, ['owl'])), "This round's vote: 100% Owl. So right now I am The Owl. Hoo. Got a question or something you want me to do?");
  assert.strictEqual(roundText(['owl', 'chef'], presets, '', [{ id: 'p:owl', pct: 60 }, { id: 'p:chef', pct: 40 }]), "This round's vote: 60% Owl, 40% Chef. So right now I am The Owl Chef. Got a question or something you want me to do?");
  assert.match(roundText(['dino', 'space'], presets, '', [{ id: 'p:dino', pct: 50 }, { id: 'p:space', pct: 50 }]), /^This round's vote: 50% Fossil, 50% Astronomer\. So right now I am The Astro Rex\./);
  assert.match(roundText([], presets, ''), /So right now I am The Octopus Chef\./);
  assert.ok(roundText(['owl'], presets, 'Hi. ' + CLOSER).endsWith('Hi. ' + CLOSER), 'closer not doubled');
  // shortening: model line goes first, then the persona list; vote line and closer stay
  const long = 'word '.repeat(60).trim();
  const t1 = roundText(['ocean', 'chef'], presets, long, sh);
  assert.strictEqual(t1, "This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. " + CLOSER);
  const all = presets.list().map((p) => p.id); const shAll = all.map((id) => ({ id: 'p:' + id, pct: 8 }));
  const t2 = roundText(all, presets, long, shAll);
  assert.ok(t2.length <= 280, String(t2.length)); assert.ok(t2.startsWith("This round's vote: 8% Owl, 8% Cat,")); assert.ok(t2.endsWith(CLOSER)); assert.ok(!t2.includes('word'));
  assert.match(t2, /So right now I am The Owl, .*and \d+ more\. Got a question/);
  for (const ids of [['owl'], ['owl', 'cat', 'romantic'], all]) assert.ok(roundText(ids, presets, long, ids.map((i) => ({ id: 'p:' + i, pct: 33 }))).length <= 280);
  assert.deepStrictEqual(voteShares({ tally: { 'p:ocean': 3, 'p:chef': 1 } }).map((x) => x.pct), [75, 25]);
  const p = promptFor(['ocean', 'chef']); assert.match(p, /octopus/); assert.match(p, /No text/);
});

test('single persona uses the library, mixes generate once and hit the cache', async () => {
  const { av, calls, tick } = setup();
  assert.ok((await av.onRoundClosed(round(1, 'owl'))).ok);
  assert.strictEqual(calls.img, 0);
  assert.ok(calls.x[0].url.endsWith('/1.1/account/update_profile_image.json'));
  assert.strictEqual(calls.x[0].body.get('image'), Buffer.from('png-owl').toString('base64'));
  assert.strictEqual(calls.x.length, 2, 'avatar then display name');
  assert.ok(calls.x[1].url.endsWith('/1.1/account/update_profile.json'));
  assert.deepStrictEqual([...calls.x[1].body.keys()], ['name'], 'only the name, never the bio');
  assert.strictEqual(calls.x[1].body.get('name'), 'The Owl');
  assert.match(calls.x[0].auth, /^OAuth .*oauth_signature=/);
  assert.strictEqual(av.forRound(1).url, '/img/avatars/owl.png');
  tick(31); assert.ok((await av.onRoundClosed(round(2, 'ocean', 'chef'))).ok); assert.strictEqual(calls.img, 1);
  assert.match(av.forRound(2).url, /^\/api\/avatar\/chef%2Bocean\.jpg$/);
  tick(31); await av.onRoundClosed(round(3, 'owl'));
  tick(31); await av.onRoundClosed(round(4, 'chef', 'ocean')); assert.strictEqual(calls.img, 1, 'cached combo');
});

test('same persona set, min interval and daily cap block updates', async () => {
  const { av, calls, tick } = setup({ env: { NC_AVATAR_DAILY_MAX: '2' } });
  await av.onRoundClosed(round(1, 'owl')); const n = calls.x.length;
  tick(5); assert.strictEqual((await av.onRoundClosed(round(2, 'owl'))).skipped, 'same');
  tick(5); assert.strictEqual((await av.onRoundClosed(round(3, 'chef'))).skipped, 'interval');
  assert.strictEqual(calls.x.length, n);
  tick(31); assert.ok((await av.onRoundClosed(round(4, 'chef'))).ok);
  tick(31); assert.strictEqual((await av.onRoundClosed(round(5, 'owl'))).skipped, 'daily cap');
});

test('no persona: octopus chef default avatar', async () => {
  const { av, calls } = setup();
  const r = await av.onRoundClosed({ id: 1, mix: [{ layer: '20-gemmascope-res-16k', index: 9999, strength: 40 }] });
  assert.ok(r.ok); assert.strictEqual(calls.x.length, 2);
  assert.strictEqual(calls.x[0].body.get('image'), Buffer.from('png-default').toString('base64'));
  assert.strictEqual(calls.x[1].body.get('name'), 'The Octopus Chef');
  assert.strictEqual(av.forRound(1).url, '/img/avatars/default.png');
  assert.ok(!calls.x.some((c) => c.body.has('description')));
});

test('off by default, dry run never calls X or the image API, GEN_IN_DRY allows generation only', async () => {
  const off = setup({ env: { NC_AVATAR: '' } });
  assert.strictEqual((await off.av.onRoundClosed(round(1, 'owl'))).skipped, 'off');
  const d = setup({ dryRun: true });
  assert.strictEqual((await d.av.onRoundClosed(round(1, 'ocean', 'chef'))).skipped, 'no image');
  assert.strictEqual((await d.av.onRoundClosed(round(2, 'owl'))).skipped, 'dry-run');
  assert.strictEqual(d.calls.img + d.calls.x.length, 0);
  assert.strictEqual(d.av.forRound(2).url, '/img/avatars/owl.png');
  const g = setup({ dryRun: true, env: { NC_AVATAR_GEN_IN_DRY: '1', NC_IMAGE_PROVIDER: 'xai' } });
  assert.strictEqual((await g.av.onRoundClosed(round(1, 'ocean', 'chef'))).skipped, 'dry-run');
  assert.strictEqual(g.calls.img, 1); assert.strictEqual(g.calls.x.length, 0);
  const k = setup({ keys: false });
  assert.strictEqual((await k.av.onRoundClosed(round(1, 'owl'))).skipped, 'missing keys');
});

test('missing library file and provider errors are tolerated', async () => {
  const { av, calls } = setup({ env: { NC_IMAGE_PROVIDER: 'none' } });
  assert.strictEqual((await av.onRoundClosed(round(1, 'cat'))).skipped, 'no image');
  assert.strictEqual((await av.onRoundClosed(round(2, 'cat', 'owl'))).skipped, 'no image');
  assert.strictEqual(calls.x.length, 0); assert.strictEqual(av.forRound(1).url, null);
});

test('round post: prefix, hybrid name, full illustration attached, text only when media upload fails', async () => {
  const { createXBot } = require('../lib/xbot');
  for (const mediaOk of [true, false]) {
    const { av, dir } = setup({ env: { NC_AVATAR: '' } });   // avatar off: the post still gets the round art
    const pub = path.join(dir, 'public'); fs.mkdirSync(path.join(pub, 'img', 'hybrids'), { recursive: true });
    fs.writeFileSync(path.join(pub, 'img', 'hybrids', 'chef+ocean.jpg'), 'art');
    const av2 = createAvatar({ cfg: { db: path.join(dir, 'db.json'), x: {} }, store: { data: {}, save() {} }, presets, env: {}, log: () => {}, publicDir: pub });
    const r = { id: 7, winner: { id: 'p:ocean', name: 'The Sea' }, mix: [feat('ocean'), feat('chef')], topic: 'dinner', tally: { 'p:ocean': 1000, 'p:chef': 1000 } };
    await av2.onRoundClosed(r);
    const calls = []; const logs = [];
    const fetchImpl = async (url, opt) => {
      calls.push({ url, opt });
      if (url.endsWith('/2/media/upload')) return mediaOk ? { ok: true, status: 200, json: async () => ({ data: { id: '555' } }) } : { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 201, json: async () => ({ data: { id: '999' } }) };
    };
    const D = { posts: [], xDay: {}, rounds: { 7: r }, mentions: { seen: [] } };
    const cfg = { x: { dryRun: false, enabled: true, appKey: 'a', appSecret: 'b', accessToken: 'c', accessSecret: 'd', candidates: 1, dailyCap: 60 } };
    const bot = createXBot({ cfg, store: { data: D, save() {} }, steer: async () => ({ steered: 'The soup is warm and every arm of mine is stirring a different pot tonight.', share: null }), budget: { run: (k, f) => f() }, rounds: {}, presets, avatar: av2, fetchImpl, log: (m) => logs.push(m) });
    const e = await bot.roundPost(r);
    assert.strictEqual(e.status, 'posted');
    assert.strictEqual(e.text, "This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. The soup is warm and every arm of mine is stirring a different pot tonight. Got a question or something you want me to do?");
    assert.strictEqual(e.image, 'chef+ocean.jpg');
    const up = calls.find((c) => c.url.endsWith('/2/media/upload')); assert.ok(up); assert.ok(up.opt.body instanceof FormData); assert.match(up.opt.headers.Authorization, /^OAuth /);
    const tw = JSON.parse(calls.find((c) => c.url.endsWith('/2/tweets')).opt.body);
    if (mediaOk) assert.deepStrictEqual(tw.media, { media_ids: ['555'] });
    else { assert.strictEqual(tw.media, undefined); assert.ok(logs.some((l) => /media upload failed/.test(l))); }
    void av;
  }
});

test('pre-drawn hybrid library: 66 named pairs, 3+ mix falls back to the winner without a provider', async () => {
  const { HYBRID_NAMES, LIBRARY } = require('../lib/avatar');
  const hy = path.join(__dirname, '..', 'public', 'img', 'hybrids');
  let n = 0; for (let i = 0; i < LIBRARY.length; i++) for (let j = i + 1; j < LIBRARY.length; j++) { const k = comboKey([LIBRARY[i], LIBRARY[j]]); n++; assert.ok(HYBRID_NAMES[k], k); assert.ok(fs.existsSync(path.join(hy, k + '.jpg')), k); assert.ok(fs.existsSync(path.join(hy, k + '.webp')), k); }
  assert.strictEqual(n, 66);
  const { av, calls } = setup({ env: { NC_IMAGE_PROVIDER: '', NC_IMAGE_API_KEY: '' } });
  assert.ok((await av.onRoundClosed(round(1, 'owl', 'cat', 'chef'))).ok);
  assert.strictEqual(calls.img, 0); assert.strictEqual(calls.x[0].body.get('image'), Buffer.from('png-owl').toString('base64'));
});

test('display name: single, pair from names.json, 3+ and friends, 50 chars, rename off, dry run', async () => {
  const { displayName, HYBRID_NAMES } = require('../lib/avatar');
  assert.strictEqual(displayName(['owl'], presets), 'The Owl');
  assert.strictEqual(displayName(['chef', 'ocean'], presets), HYBRID_NAMES['chef+ocean']);
  assert.strictEqual(displayName(['ocean', 'chef'], presets), 'The Octopus Chef');
  assert.strictEqual(displayName(['owl', 'pirate'], presets), HYBRID_NAMES['owl+pirate']);
  assert.strictEqual(displayName(['owl', 'cat', 'chef'], presets), 'The Owl and friends');
  assert.strictEqual(displayName([], presets), 'The Octopus Chef');
  for (const k of Object.keys(HYBRID_NAMES)) assert.ok(displayName(k.split('+'), presets).length <= 50, k);
  const off = setup({ env: { NC_BOT_RENAME: '0' } });
  await off.av.onRoundClosed(round(1, 'owl')); assert.strictEqual(off.calls.x.length, 1);
  const d = setup({ dryRun: true });
  const r = await d.av.onRoundClosed(round(1, 'owl')); assert.strictEqual(r.name, 'The Owl'); assert.strictEqual(d.calls.x.length, 0);
  const s2 = setup(); await s2.av.onRoundClosed(round(1, 'owl')); s2.tick(5);
  assert.strictEqual((await s2.av.onRoundClosed(round(2, 'chef'))).skipped, 'interval'); assert.strictEqual(s2.calls.x.length, 2);
});

test('vote shares use largest remainder and sum to 100', () => {
  const { voteShares } = require('../lib/avatar');
  const s = voteShares({ tally: { 'p:owl': 1, 'p:cat': 1, 'p:chef': 1 } });
  assert.equal(s.reduce((a, x) => a + x.pct, 0), 100);
  assert.deepEqual(s.map((x) => x.pct), [34, 33, 33]);
  const t = voteShares({ tally: { 'p:ocean': 2, 'p:chef': 2 } });
  assert.deepEqual(t.map((x) => x.pct), [50, 50]);
  assert.deepEqual(voteShares({ tally: {} }, ['owl']), [{ id: 'p:owl', pct: 100 }]);
});
