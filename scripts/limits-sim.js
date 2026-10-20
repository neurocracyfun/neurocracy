// Launch-day limits simulation. Everything local: a mocked Solana RPC (with a Helius-like RPS limit and 429s),
// a mocked X API, a mocked distributor wallet. No real posts, no transactions, no spending.
// Usage: node scripts/limits-sim.js [part...]   parts: day scale lab burns payout restart (default all). Prints JSON.
const fs = require('fs'); const os = require('os'); const path = require('path');
const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58'));
const RPC = 'http://mock-rpc.local/';
const M = { calls: 0, r429: 0, byMethod: {}, rps: 10, latency: 25, outage: false, stamps: [], bal: new Map(), txs: new Map() };
const realFetch = globalThis.fetch;
const jres = (status, j) => ({ ok: status < 400, status, json: async () => j, text: async () => JSON.stringify(j) });
globalThis.fetch = async (url, opt = {}) => {
  if (String(url) !== RPC) return realFetch(url, opt);
  const b = JSON.parse(opt.body); M.calls++; M.byMethod[b.method] = (M.byMethod[b.method] || 0) + 1;
  await new Promise((r) => setTimeout(r, M.latency));
  const t = Date.now(); M.stamps = M.stamps.filter((x) => t - x < 1000);
  if (M.outage || (M.rps && M.stamps.length >= M.rps)) { M.r429++; return jres(429, { jsonrpc: '2.0', id: b.id, error: { code: 429, message: 'Too many requests' } }); }
  M.stamps.push(t);
  if (b.method === 'getTokenAccountsByOwner') { const raw = M.bal.get(b.params[0]) || 0n; return jres(200, { result: { value: raw ? [{ account: { data: { parsed: { info: { tokenAmount: { amount: raw.toString(), uiAmountString: (Number(raw) / 1e6).toString() } } } } } }] : [] } }); }
  if (b.method === 'getTransaction') return jres(200, { result: M.txs.get(b.params[0]) || null });
  return jres(200, { result: null });
};
const base = require('../lib/config');
const { createApp } = require('../server');
const { split } = (() => { const { createPayouts } = require('../lib/payouts'); return { split: createPayouts({ cfg: base, store: { data: {} }, chain: null }).split }; })();
const { tokensFor } = require('../lib/price');
const MINT = 'MintNcracy1111111111111111111111111111111111';
const kp = () => { const k = nacl.sign.keyPair(); return { pk: bs58.encode(k.publicKey), sk: k.secretKey }; };
const sign = (k, msg) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), k.sk));
const epoch = Date.parse('2026-10-20T15:00:00Z');
function mkCfg(extra = {}) {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nc-limits-')), 'db.json');
  return { ...base, db, mint: MINT, rpc: RPC, botHandle: 'neurocracymind', roundEpoch: epoch, quotes: { ...base.quotes, secret: 'sim' },
    x: { ...base.x, dryRun: false, enabled: true, appKey: 'm', appSecret: 'm', accessToken: 'm', accessSecret: 'm', userId: '1165034468966617089', candidates: 1 },
    payout: { ...base.payout, enabled: true, dryRun: true, opsAddress: 'Ops1111111111111111111111111111111111111111' },
    replyBurn: { ...base.replyBurn, enabled: true }, nominate: { ...base.nominate, enabled: true }, ...extra };
}
function xMock() {
  const X = { calls: {}, byDay: {}, fail429: 0, mentionSeq: 0 };
  X.fetch = async (url, opt = {}) => {
    const u = String(url).replace(/\?.*/, ''); const k = (opt.method || 'GET') + ' ' + u.replace(/\d{6,}/g, ':id');
    X.calls[k] = (X.calls[k] || 0) + 1;
    if (u.endsWith('/2/tweets') && X.fail429 > 0) { X.fail429--; X.calls['429 POST /2/tweets'] = (X.calls['429 POST /2/tweets'] || 0) + 1; return jres(429, { title: 'Too Many Requests' }); }
    if (u.endsWith('/2/tweets')) return jres(201, { data: { id: String(1e18 + (X.calls[k])) } });
    if (u.endsWith('/2/media/upload')) return jres(200, { data: { id: 'm' + X.calls[k] } });
    if (u.includes('/mentions')) { const d = []; for (let i = 0; i < 3; i++) { X.mentionSeq++; d.push({ id: String(2e18 + X.mentionSeq), text: '@neurocracymind what are you today', author_id: 'u' + (X.mentionSeq % 50) }); } return jres(200, { data: d, includes: { users: d.map((x) => ({ id: x.author_id, username: 'fan' + x.author_id })) }, meta: { newest_id: d[d.length - 1].id } }); }
    return jres(200, {});
  };
  return X;
}
const chainMock = (lamports) => ({ address: () => 'Dist111111111111111111111111111111111111111', canSend: () => false, balance: async () => BigInt(lamports), blockHeight: async () => 1, status: async () => null });
const steer = async () => ({ steered: 'The tide is low tonight and I am sorting shells by the color of their insides.', share: null });
const out = {};

async function day() {
  // 48 rounds with the real tick loop and an accelerated clock. 100 voters per round, mentions every poll, paid replies queued.
  const X = xMock(); const cfg = mkCfg(); let t = epoch + 60e3;
  const g = createApp(cfg, { now: () => t, chain: chainMock(5e9), zkProve: false, fetchImpl: X.fetch, avatarFetch: X.fetch, log: () => {}, env: { NC_AVATAR: '1' }, steer, price: { get: async () => ({ usd: 0.00002, source: 'sim' }) } });
  const D = g.store.data; const voters = Array.from({ length: 100 }, kp);
  voters.forEach((v, i) => M.bal.set(v.pk, BigInt(1000 + i * 37) * 1000000n));
  const presets = g.rounds.candidates(1).map((c) => c.id);
  M.rps = 0; const rpc0 = M.calls; const errs = [];
  const log0 = console.log; console.log = (...a) => errs.push(a.join(' '));
  for (let r = 1; r <= 49; r++) {
    for (const [i, v] of voters.entries()) { const cand = presets[(i * 7 + r * 3) % (r % 5 === 0 ? 2 : presets.length)]; const msg = g.rounds.voteMessage({ round: r, candidate: cand, topic: '-', wallet: v.pk }); try { await g.rounds.vote({ wallet: v.pk, candidate: cand, signature: sign(v, msg), round: r, topic: '-' }); } catch (e) { errs.push('vote ' + e.message); } }
    (D.replyQueue ||= []).push(...[1, 2, 3].map((j) => ({ id: 'bq' + r + j, tweetId: String(3e18 + r * 10 + j), author: 'buyer', text: 'hey bot', status: 'queued', at: t })));
    if (r === 20) X.fail429 = 2;   // X returns 429 twice at the start of round 21
    if (r === 30) M.outage = true;   // RPC fully down when round 30 closes
    for (let s = 0; s < 30; s++) { t += 60e3; if (r === 30 && s === 3) M.outage = false; await g.tickOnce(); }
  }
  console.log = log0;
  const rounds = Object.values(D.rounds); const posts = D.posts.filter((p) => p.kind === 'post'); const reps = D.posts.filter((p) => p.kind === 'reply');
  const st = (l) => l.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});
  g.store.flush();
  out.day = { roundsClosed: rounds.length, xDay: D.xDay, roundPosts: st(posts), replies: st(reps), x: X.calls, avatar: D.avatar && { changesByDay: D.avatar.days, current: D.avatar.current }, rpcCallsDay: M.calls - rpc0,
    round30: { unreadAtClose: D.rounds[30] && D.rounds[30].unreadAtClose, closed: !!D.rounds[30] }, round21post: posts.find((p) => p.round === 21) && { status: posts.find((p) => p.round === 21).status, tries: posts.find((p) => p.round === 21).tries || 1 },
    payout: Object.values((D.payout && D.payout.dry && D.payout.dry.rounds) || {}).slice(0, 3).map((e) => ({ round: e.round, status: e.status, pool: e.pool, voters: e.voters })), dbBytes: fs.statSync(cfg.db).size, errorsSample: [...new Set(errs.map((e) => e.replace(/\d+/g, 'N')))].slice(0, 8) };
}

async function scale() {
  out.scale = [];
  for (const [N, rps] of (process.env.SCALE ? JSON.parse(process.env.SCALE) : [[10, 10], [100, 10], [1000, 10], [5000, 10], [5000, 50]])) {
    const cfg = mkCfg({ rpcRps: Math.floor(rps * 0.8), closeConcurrency: Math.max(1, Math.floor(rps * 0.8)) }); let t = epoch + 60e3;
    const g = createApp(cfg, { now: () => t, chain: null, zkProve: false, fetchImpl: xMock().fetch, avatarFetch: xMock().fetch, log: () => {}, env: {}, steer });
    const vs = Array.from({ length: N }, kp); vs.forEach((v, i) => M.bal.set(v.pk, BigInt(1 + (i % 1000) * 1000) * 1000000n));
    const c = g.rounds.candidates(1).map((x) => x.id);
    M.rps = 0; M.latency = 2; const t0 = Date.now(); for (const [i, v] of vs.entries()) { const cand = c[i % 3]; await g.rounds.vote({ wallet: v.pk, candidate: cand, signature: sign(v, g.rounds.voteMessage({ round: 1, candidate: cand, topic: '-', wallet: v.pk })), round: 1, topic: '-' }); }
    const voteMs = Date.now() - t0;
    M.latency = 25; M.rps = rps; M.r429 = 0; const c0 = M.calls; t += 30 * 60e3; const t1 = Date.now(); let tries = 0; let closed = null;
    while (!closed && tries < 8) { tries++; try { closed = await g.rounds.close(1); } catch (e) { /* retried next tick */ } }
    const closeMs = Date.now() - t1;
    // sqrt weighting check: recompute the tally from raw balances
    let ok = true; const exp = {}; for (const [i, v] of vs.entries()) { const raw = M.bal.get(v.pk); const { isqrt } = require('../lib/solana'); exp[c[i % 3]] = (exp[c[i % 3]] || 0) + Number(isqrt(raw)) / 1e3; }
    for (const k of Object.keys(exp)) if (Math.abs(exp[k] - (closed.tally[k] || 0)) > 1e-6 * exp[k]) ok = false;
    const ts = Date.now(); g.store.flush(); const saveMs = Date.now() - ts;
    out.scale.push({ voters: N, rpsLimit: rps, voteRpcCalls: N, castMsTotal: voteMs, closeRpcCalls: M.calls - c0, close429: M.r429, closeTries: tries, closeSec: +(closeMs / 1000).toFixed(1), unreadAtClose: closed.unreadAtClose, sqrtTallyOk: ok, dbBytes: fs.statSync(cfg.db).size, snapshotBytes: closed && g.store.data.snapshots[1].length, flushMs: saveMs, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6) }); console.error(JSON.stringify(out.scale[out.scale.length - 1]));
  }
  M.rps = 0;
}

async function lab() {
  const cfg = mkCfg(); let t = epoch + 60e3; const g = createApp(cfg, { now: () => t, chain: null, zkProve: false, fetchImpl: xMock().fetch, log: () => {}, env: {}, steer: async () => ({ steered: 'ok then', normal: 'n', share: null }) });
  const srv = g.app.listen(0); const port = srv.address().port; const h = kp(); M.bal.set(h.pk, 200000n * 1000000n);
  const day = new Date(t).toISOString().slice(0, 10); const sig = sign(h, `Neurocracy lab\nDay: ${day}\nWallet: ${h.pk}`);
  const codes = []; for (let i = 0; i < 7; i++) { const r = await realFetch(`http://127.0.0.1:${port}/api/lab`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'tell me about the sea ' + i, features: [{ layer: '20-gemmascope-res-16k', index: 100 + i, strength: 40 }], wallet: h.pk, signature: sig }) }); codes.push(r.status); }
  const poor = kp(); M.bal.set(poor.pk, 10n * 1000000n);
  const rp = await realFetch(`http://127.0.0.1:${port}/api/lab`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'hello there', features: [{ layer: '20-gemmascope-res-16k', index: 5, strength: 40 }], wallet: poor.pk, signature: sign(poor, `Neurocracy lab\nDay: ${day}\nWallet: ${poor.pk}`) }) });
  srv.close();
  out.lab = { holderStatusCodes: codes, belowHolderMin: rp.status, labPerDay: cfg.labPerDay, npPerHourGlobal: cfg.npPerHour, steersPerDayGlobalMax: cfg.npPerHour * 24, holdersFullUseAt100k: 100000 * cfg.labPerDay };
}

async function burns() {
  const R = base.replyBurn, N = base.nominate;
  out.burns = { table: [1e-7, 1e-6, 5e-6, 2e-5, 1e-4, 1e-3, 0.01].map((p) => ({ priceUsd: p, mcapUsd: Math.round(p * 1e9), nominateTokens: tokensFor(N.usd, p, N.min, N.max), nominateUsd: +(tokensFor(N.usd, p, N.min, N.max) * p).toFixed(3), replyTokens: tokensFor(R.usd, p, R.min, R.max), replyUsd: +(tokensFor(R.usd, p, R.min, R.max) * p).toFixed(3) })) };
  // replay + price outage through the real endpoints
  const cfg = mkCfg(); let t = Date.now(); let px = 2e-5;
  const w = kp(); const sigTx = bs58.encode(nacl.randomBytes(64));
  const g = createApp(cfg, { now: () => t, chain: null, zkProve: false, fetchImpl: xMock().fetch, log: () => {}, env: {}, steer, featureInfo: async () => 'birds of prey', price: { get: async () => (px ? { usd: px, source: 'sim' } : null) },
    lookupPost: async (id) => ({ id, author: 'someone', mentions: ['neurocracymind'], text: 'hi @neurocracymind' }), getTx: async () => ({ slot: 1, blockTime: Math.floor(t / 1000), meta: { err: null, innerInstructions: [] }, transaction: { message: { accountKeys: [{ pubkey: w.pk, signer: true }], instructions: [
      { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', parsed: { type: 'burnChecked', info: { mint: MINT, authority: w.pk, tokenAmount: { amount: String(BigInt(75000) * 1000000n) } } } },
      { programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: 'Neurocracy reply 1849000000000000001' }] } } }) });
  const url = 'https://x.com/someone/status/1849000000000000001';
  const q = await g.burns.quoteReply(url, w.pk); const res = [];
  for (let i = 0; i < 2; i++) { try { await g.burns.replyRequest({ wallet: w.pk, url, signature: sigTx, quote: q.quote }); res.push('ok'); } catch (e) { res.push(e.message); } }
  px = null; let outage; try { await g.burns.quoteReply('https://x.com/someone/status/1849000000000000002', w.pk); outage = 'quoted'; } catch (e) { outage = e.message; }
  out.burns.replyQuoteAt2e5 = q.burn; out.burns.replay = res; out.burns.priceOutage = outage;
}

async function payout() {
  const SOLUSD = 180; out.payout = { creatorFeeBps: 30, volumes: [] };
  for (const vol of [1e4, 1e5, 1e6]) {
    const feeSol = (vol * 0.003) / SOLUSD; // bonding curve creator fee 0.30%
    // steady state with 48 rounds/day at 10% of available each: each round pays ~10% of what is there
    let bal = 0, paid = 0; for (let r = 0; r < 48 * 3; r++) { bal += feeSol / 48; let pool = bal * 0.1; const capLeft = 2 - (paid % 1e9); pool = Math.min(pool, 2 / 48 * 3); bal -= pool; paid += pool; }
    const perRoundSol = paid / (48 * 3);
    out.payout.volumes.push({ dailyVolumeUsd: vol, creatorFeeSolPerDay: +feeSol.toFixed(3), poolPerRoundSolSteady: +perRoundSol.toFixed(4), votersPerRoundSol: +(perRoundSol * 0.8).toFixed(4), dailyCapBinds: feeSol > 2 });
  }
  out.payout.batches = [];
  for (const N of [10, 100, 1000, 5000]) {
    const cfg = mkCfg(); let t = epoch + 60e3; const g = createApp(cfg, { now: () => t, chain: chainMock(10e9), zkProve: false, fetchImpl: xMock().fetch, log: () => {}, env: {}, steer });
    const D = g.store.data; const vs = Array.from({ length: N }, (_, i) => 'W' + String(i).padStart(43, '1'));
    D.votes[1] = Object.fromEntries(vs.map((w, i) => [w, { candidate: 'p:owl', weightInt: '1', rawAtClose: String(BigInt(1000 + (i * 9973) % 2e6) * 1000000n) }]));
    const e = await g.payouts.plan({ id: 1, house: false, winner: { id: 'p:owl' }, nominator: null }); await g.payouts.settle(1);
    const due = (e.batches || []).reduce((a, b) => a + b.items.length, 0); const owed = Object.keys(D.payout.dry.owed).length;
    out.payout.batches.push({ winners: N, poolSol: Number(e.pool) / 1e9, walletsPaidNow: due, walletsAccruing: owed - due, txs: e.batches.length, feeSolBase: e.batches.length * 5000 / 1e9, minPayoutSol: base.payout.minLamports / 1e9 });
  }
}

async function restart() {
  const cfg = mkCfg(); let t = epoch + 60e3; const mk = () => createApp(cfg, { now: () => t, chain: null, zkProve: false, fetchImpl: xMock().fetch, avatarFetch: xMock().fetch, log: () => {}, env: {}, steer });
  let g = mk(); const v = kp(); M.bal.set(v.pk, 5000n * 1000000n); M.rps = 0;
  await g.rounds.vote({ wallet: v.pk, candidate: 'p:owl', signature: sign(v, g.rounds.voteMessage({ round: 1, candidate: 'p:owl', topic: '-', wallet: v.pk })), round: 1, topic: '-' });
  g.store.flush(); g = mk(); const kept = !!(g.store.data.votes[1] && g.store.data.votes[1][v.pk]);
  t += 30 * 60e3 + 1000; await g.tickOnce(); g.store.flush(); g = mk();
  t += 2 * 30 * 60e3; await g.tickOnce();   // server was down for 2 whole rounds
  out.restart = { voteSurvivesRestart: kept, round1ClosedAfterRestart: !!g.store.data.rounds[1], round1Winner: g.store.data.rounds[1] && g.store.data.rounds[1].winner.id, roundsClosed: Object.keys(g.store.data.rounds) };
}


async function queue() {
  // 50 paid reply burns land in one round, plus 6 mentions (one from the main account, one from the bot itself), 2 of the paid posts get deleted.
  const X = xMock(); const deleted = new Set([String(4n * 10n ** 18n + 7n), String(4n * 10n ** 18n + 21n)]);
  const f0 = X.fetch; X.fetch = async (url, opt = {}) => { if (String(url).endsWith('/2/tweets')) { const b = JSON.parse(opt.body); if (b.reply && deleted.has(b.reply.in_reply_to_tweet_id)) { X.calls['403 deleted'] = (X.calls['403 deleted'] || 0) + 1; return jres(403, { title: 'Forbidden', detail: 'reply target deleted' }); } } return f0(url, opt); };
  let steers = 0; const cfg = mkCfg({ freeReplyHandles: ['neurocracyfun'] }); cfg.x = { ...cfg.x, candidates: 3, repliesPerRound: 4 }; let t = epoch + 60e3;
  const g = createApp(cfg, { now: () => t, chain: null, zkProve: false, fetchImpl: X.fetch, avatarFetch: X.fetch, log: () => {}, env: {}, steer: async (q, mix, o) => { steers++; return { steered: 'Short answer from the deep: I am listening, and the water says yes ' + (steers % 97) + ' times.', share: null }; } });
  const D = g.store.data; t += 30 * 60e3;
  D.replyQueue = Array.from({ length: 50 }, (_, i) => ({ id: 'b' + i, tweetId: String(4n * 10n ** 18n + BigInt(i)), author: 'buyer' + i, text: 'hey bot number ' + i, status: 'queued', at: t + i })).reverse();
  const log0 = console.log; console.log = () => {};
  const timeline = []; let ticks = 0;
  while (ticks < 400) { ticks++; t += 15e3; await g.tickOnce(); const done = D.replyQueue.filter((j) => j.status !== 'queued').length; if (ticks % 20 === 0) timeline.push({ minutes: ticks / 4, done, posted: D.replyQueue.filter((j) => j.status === 'posted').length, steersUsed: g.budget.status().usedLastHour }); if (done === 50) break; }
  console.log = log0;
  const order = D.posts.filter((p) => p.paid).map((p) => Number(BigInt(p.inReplyTo) - 4000000000000000000n)).reverse();
  const ids = D.posts.filter((p) => p.paid).map((p) => p.inReplyTo);
  const free = await g.xbot.replies(D.rounds[g.rounds.current() - 1] || g.rounds.live(), [{ id: '91', text: '@neurocracymind what do you see today', author: 'neurocracyfun' }, { id: '92', text: '@neurocracymind yo', author: 'neurocracymind' }, ...[3, 4, 5, 6].map((i) => ({ id: '9' + i + '0', text: '@neurocracymind question ' + i, author: 'user' + i }))]);
  out.queue = { jobs: 50, statuses: D.replyQueue.reduce((a, j) => ((a[j.status] = (a[j.status] || 0) + 1), a), {}), ticksRun: ticks, simMinutes: ticks / 4, timeline, firstTenOrder: order.slice(0, 10), duplicates: ids.length - new Set(ids).size, steersTotal: steers, budget: g.budget.status(), xDay: D.xDay, x403: X.calls['403 deleted'] || 0,
    freeReplies: free.map((r) => ({ to: r.to, free: !!r.free, status: r.status })), note: 'steer budget is a real-time sliding hour, so in this accelerated run it never refills' };
}

(async () => {
  const parts = process.argv.slice(2); const all = { day, scale, lab, burns, payout, restart, queue };
  for (const [k, f] of Object.entries(all)) if (!parts.length || parts.includes(k)) { const t0 = Date.now(); await f(); (out.timing ||= {})[k] = Date.now() - t0; }
  const s = JSON.stringify(out, null, 1); fs.writeFileSync(process.env.OUT || '/tmp/limits.json', s); console.log(s); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
