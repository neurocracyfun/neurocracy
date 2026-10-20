// Neurocracy server: static site + API (rounds, votes, Lab steering, X account log, RPC proxy).
const path = require('path');
const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const baseCfg = require('./lib/config');
const { open } = require('./lib/store');
const { loadPresets, tidy } = require('./lib/presets');
const { createBudget } = require('./lib/budget');
const { createRounds } = require('./lib/rounds');
const { createXBot } = require('./lib/xbot');
const np = require('./lib/np');
const sol = require('./lib/solana');
const { check } = require('./lib/filter');
const { createPayouts, solanaChain } = require('./lib/payouts');
const { createBurnFeatures } = require('./lib/burnfeatures');
const { createPrice } = require('./lib/price');
const { createQuotes } = require('./lib/quotes');
const zk = require('./lib/zk');
const { createZkChain } = require('./lib/zkchain');
const { createAvatar } = require('./lib/avatar');

const RPC_METHODS = new Set(['getBalance', 'getTokenAccountsByOwner', 'getAccountInfo', 'getLatestBlockhash', 'getSignatureStatuses', 'getTokenSupply', 'getTokenLargestAccounts']);

function bucket(perMin) {
  const hits = new Map();
  return (req, res, next) => {
    const k = req.ip; const t = Date.now(); const a = (hits.get(k) || []).filter((x) => t - x < 60e3);
    if (a.length >= perMin) return res.status(429).json({ error: 'slow down' });
    a.push(t); hits.set(k, a); if (hits.size > 5000) hits.clear(); next();
  };
}

function createApp(cfg = baseCfg, over = {}) {
  let offset = 0; const now = over.now || (() => Date.now() + offset);
  const store = over.store || open(cfg.db);
  const D = store.data;
  const presets = loadPresets(cfg.presetsFile);
  const budget = createBudget(cfg.npPerHour);
  const steer = over.steer || np.steer;
  const rounds = createRounds({ cfg, store, presets, now });
  const avatar = createAvatar({ cfg, store, presets, now, fetchImpl: over.avatarFetch || fetch, env: over.env || process.env, log: over.log || console.log });
  const xbot = createXBot({ cfg, store, steer, budget, rounds, presets, avatar, now, fetchImpl: over.fetchImpl || fetch });
  const payouts = createPayouts({ cfg, store, now, chain: 'chain' in over ? over.chain : solanaChain(cfg), log: console.log });
  const price = over.price || createPrice({ cfg, now });
  const quotes = createQuotes({ secret: cfg.quotes.secret, ttlMs: cfg.quotes.ttlMs, now });
  const burns = createBurnFeatures({ cfg, store, rounds, featureInfo, getTx: over.getTx, price, quotes, lookupPost: over.lookupPost || xbot.lookupPost, now });
  const zkChain = process.env.ZK_ONCHAIN === '1' ? createZkChain({ rpc: process.env.NC_ZK_RPC || cfg.rpc, programId: process.env.NC_ZK_PROGRAM_ID, authorityKey: process.env.NC_ZK_AUTHORITY_KEY, mode: process.env.ZK_ONCHAIN_MODE === 'record' ? 'record' : 'verify' }) : null;
  const prover = zk.createProver({ store, enabled: 'zkProve' in over ? over.zkProve : process.env.ZK_PROVE === '1', chain: zkChain, log: console.log, proveFn: over.proveFn });
  const searchHits = [];
  const today = () => new Date(now()).toISOString().slice(0, 10);

  async function featureInfo(layer, index) {
    const k = `${layer}/${index}`; if (D.feats[k]) return D.feats[k];
    if (over.featureInfo) return (D.feats[k] = await over.featureInfo(layer, index));
    try {
      const r = await fetch(`${np.NP}/api/feature/${np.MODEL}/${layer}/${index}`, { signal: AbortSignal.timeout(20000) });
      const j = await r.json(); const d = (j.explanations && j.explanations[0] && j.explanations[0].description) || '';
      D.feats[k] = d.trim().slice(0, 80) || null; store.save(); return D.feats[k];
    } catch { return null; }
  }

  const zkStatus = (r) => { const p = (D.proofs || {})[r]; return p ? { status: p.status, reason: p.reason || null, onchain: !!p.onchain } : null; };
  const app = express();
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(express.json({ limit: '16kb' }));
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'server error' }));

  app.get('/api/config', wrap(async (req, res) => res.json({
    cluster: cfg.cluster, tokenName: cfg.tokenName, ticker: cfg.ticker, mint: cfg.mint || null, treasury: cfg.treasury || null,
    decimals: cfg.decimals, holderMin: cfg.holderMin, voteMin: cfg.voteMin, labPerDay: cfg.labPerDay, roundMinutes: cfg.roundMinutes, model: np.MODEL,
    x: xbot.status(), payout: payouts.status(), avatar: avatar.status(), burns: await burns.status(), site: cfg.site, github: cfg.github, rpcProxy: !!cfg.rpc, preview: !cfg.mint, budget: budget.status(),
  })));
  app.get('/api/presets', (req, res) => res.json({ model: presets.model, generatedAt: presets.generatedAt, prompts: presets.prompts, presets: presets.list() }));
  app.get('/api/round', (req, res) => { const p = rounds.publicRound(); const a = p.live ? avatar.forRound(p.live.id) : null; res.json({ ...p, avatarUrl: a ? a.url : null, personas: a ? a.personas : [] }); });
  app.get('/api/avatar/:file', (req, res) => avatar.serve(req, res));
  // preview mode: no token mint configured yet. Votes and holder actions are closed; the Lab gets a few free live steers per visitor.
  const preview = () => !cfg.mint;
  const PREVIEW_LAB_PER_DAY = 3;
  const notLive = (req, res, next) => (preview() ? res.status(409).json({ error: 'The token is not live yet. Voting opens at launch.', preview: true }) : next());
  app.post('/api/vote', notLive, bucket(20), wrap(async (req, res) => res.json(await rounds.vote(req.body || {}))));
  app.post('/api/feature/submit', notLive, bucket(10), wrap(async (req, res) => res.json(await rounds.submit(req.body || {}, featureInfo))));
  app.post('/api/link-x', notLive, bucket(10), wrap(async (req, res) => {
    const { wallet, signature } = req.body || {}; const handle = String((req.body || {}).handle || '').replace(/^@/, '');
    if (!/^\w{1,15}$/.test(handle) || !sol.isAddress(wallet)) throw Object.assign(new Error('bad handle or wallet'), { status: 400 });
    if (!sol.verify(xbot.linkMessage(handle, wallet), signature, wallet)) throw Object.assign(new Error('signature does not match'), { status: 400 });
    D.links[handle.toLowerCase()] = wallet; store.save(); res.json({ ok: true });
  }));

  app.get('/api/features/search', bucket(20), wrap(async (req, res) => {
    const q = String(req.query.q || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().toLowerCase().slice(0, 40);
    if (q.length < 2) return res.json({ results: [] });
    const k = 'search:' + q; const hit = D.feats[k];
    if (hit && now() - hit.t < 7 * 864e5) return res.json({ results: hit.v, cached: true });
    const cut = Date.now() - 3600e3; while (searchHits.length && searchHits[0] < cut) searchHits.shift();
    if (searchHits.length >= cfg.npSearchPerHour) throw Object.assign(new Error('feature search is busy, try a preset'), { status: 429 });
    searchHits.push(Date.now());
    const v = over.search ? await over.search(q) : await np.searchFeatures(q);
    D.feats[k] = { v, t: now() }; store.save(); res.json({ results: v });
  }));

  // Lab: presets are free and cached. Custom mixes are a holder perk (signed once per day).
  // Upstream failures get a friendly message instead of the raw "neuronpedia 500".
  const labErr = (e) => { if (/^neuronpedia /.test(e.message) || !e.status || e.name === 'TimeoutError') { const s = e.status === 429 ? 429 : 502; throw Object.assign(new Error(s === 429 ? 'The steering service is busy right now. Please wait a minute and try again.' : 'The steering service did not answer this time. Please try again in a moment, or try a lower strength.'), { status: s }); } throw e; };
  app.post('/api/lab', bucket(12), wrap(async (req, res) => {
    const b = req.body || {}; const prompt = String(b.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const feats = Array.isArray(b.features) ? b.features.slice(0, 3) : [];
    if (prompt.length < 3 || !feats.length) throw Object.assign(new Error('add a prompt and at least one feature'), { status: 400 });
    const mix = feats.map((f) => ({ layer: String(f.layer), index: Number(f.index), strength: Math.max(-np.MAX_STRENGTH, Math.min(np.MAX_STRENGTH, Math.round(Number(f.strength) || 0))) }));
    if (mix.some((f) => !/^(9|20|31)-gemmascope-res-16k$/.test(f.layer) || !Number.isInteger(f.index) || f.index < 0 || f.index >= 16384)) throw Object.assign(new Error('unsupported feature'), { status: 400 });
    for (const p of presets.list()) {
      const same = p.features.length === mix.length && p.features.every((f, i) => f.layer === mix[i].layer && Number(f.index) === mix[i].index && Number(f.strength) === mix[i].strength);
      const s = same && p.samples.find((x) => x.prompt === prompt);
      if (s) return res.json({ normal: s.normal, steered: s.steered, share: s.share, cached: true, source: 'preset' });
    }
    const key = crypto.createHash('sha256').update(JSON.stringify([prompt, mix])).digest('hex').slice(0, 24);
    const hit = D.lab.find((x) => x.key === key);
    if (hit) return res.json({ ...hit.out, cached: true });
    if (preview()) {
      const ipKey = 'ip:' + crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 16);
      const used = ((D.labUse[today()] ||= {})[ipKey] || 0);
      if (used >= PREVIEW_LAB_PER_DAY) throw Object.assign(new Error(`preview limit of ${PREVIEW_LAB_PER_DAY} live steers per day reached`), { status: 429 });
      const r = await budget.run('lab', () => steer(prompt, np.normFeatures(mix))).catch(labErr);
      D.labUse[today()][ipKey] = used + 1;
      const c = check(r.steered.slice(0, 280)); const flagged = !c.ok && /slur|group-target/.test(c.why.join());
      const out = { normal: tidy(r.normal, prompt), steered: flagged ? '[hidden by the content filter]' : tidy(r.steered, prompt), share: r.share, source: 'live', preview: true, left: PREVIEW_LAB_PER_DAY - used - 1 };
      D.lab.unshift({ key, out, t: now() }); D.lab = D.lab.slice(0, 1000); store.save();
      return res.json(out);
    }
    const { wallet, signature } = b;
    if (!sol.isAddress(wallet)) throw Object.assign(new Error('connect a wallet: custom steers are a holder perk'), { status: 401 });
    if (!sol.verify(`Neurocracy lab\nDay: ${today()}\nWallet: ${wallet}`, signature, wallet)) throw Object.assign(new Error('sign the daily Lab pass first'), { status: 401 });
    const bal = await sol.balanceOf(cfg, wallet);
    if (bal < cfg.holderMin) throw Object.assign(new Error(`custom steers need ${cfg.holderMin.toLocaleString('en-US')} ${cfg.ticker}`), { status: 403 });
    const use = ((D.labUse[today()] ||= {})[wallet] || 0);
    if (use >= cfg.labPerDay) throw Object.assign(new Error(`daily limit of ${cfg.labPerDay} custom steers reached`), { status: 429 });
    const r = await budget.run('lab', () => steer(prompt, np.normFeatures(mix))).catch(labErr);
    D.labUse[today()][wallet] = use + 1;
    const flagged = !check(r.steered.slice(0, 280)).ok && /slur|group-target/.test(check(r.steered.slice(0, 280)).why.join());
    const out = { normal: tidy(r.normal, prompt), steered: flagged ? '[hidden by the content filter]' : tidy(r.steered, prompt), share: r.share, source: 'live', left: cfg.labPerDay - use - 1 };
    D.lab.unshift({ key, out, t: now() }); D.lab = D.lab.slice(0, 1000); store.save();
    res.json(out);
  }));

  const publicPost = (p) => ({ id: p.id, kind: p.kind, round: p.round, persona: p.persona, mix: p.mix, topic: p.topic, topicSource: p.topicSource, to: p.to, holder: p.holder, mention: p.mention, text: p.text, share: p.share, status: p.status, tweetId: p.tweetId || null, at: p.at, rejected: (p.rejected || []).map((r) => r.why) });
  // Home page post list: real posts the bot published come first (newest first), previews only fill the rest and are labeled.
  // The first real post (the launch test) is seeded so the list is never empty.
  const SEED_POSTS = [{ id: 'seed-test', kind: 'post', round: null, persona: 'The Octopus Chef', text: "Test post. This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. Got a question or something you want me to do?", image: 'chef+ocean.jpg', status: 'posted', tweetId: '2112415587636777455', at: Date.parse('2026-10-20T05:28:17Z') }];
  const imageUrl = (name) => { if (!name) return null; const b = String(name).replace(/\.(jpg|png|webp)$/, ''); const dir = b.includes('+') ? 'hybrids' : 'minds'; for (const e of ['webp', 'jpg', 'png']) if (require('fs').existsSync(path.join(__dirname, 'public', 'img', dir, b + '.' + e))) return '/img/' + dir + '/' + encodeURIComponent(b) + '.' + e; return null; };
  app.get('/api/posts', (req, res) => {
    const n = Math.min(50, Number(req.query.limit) || 12); const all = D.posts.filter((p) => p.text);
    const real = [...all.filter((p) => p.status === 'posted' && p.tweetId), ...SEED_POSTS.filter((s) => !all.some((p) => p.tweetId === s.tweetId))].sort((a, b) => b.at - a.at);
    const rest = all.filter((p) => !(p.status === 'posted' && p.tweetId) && (p.kind !== 'post' || /^This round's vote: /.test(p.text)));   // old-format previews are hidden
    const handle = cfg.botHandle || 'neurocracymind';
    res.json({ x: xbot.status(), handle, posts: [...real, ...rest].slice(0, n).map((p) => ({ ...publicPost(p), preview: !(p.status === 'posted' && p.tweetId), image: imageUrl(p.image), url: p.tweetId ? `https://x.com/${handle}/status/${p.tweetId}` : null })) });
  });
  app.get('/api/hall', (req, res) => {
    const list = Object.values(D.rounds).sort((a, b) => b.id - a.id).slice(0, 96).map((r) => ({ ...r, payout: payouts.forRound(r.id), posts: D.posts.filter((p) => p.round === r.id).map(publicPost), zk: zkStatus(r.id) }));
    res.json({ rounds: list });
  });
  // fee share ledger, burn actions, round snapshots
  app.get('/api/payouts', (req, res) => res.json(payouts.status()));
  app.get('/api/payouts/round/:r', (req, res) => res.json(payouts.forRound(Number(req.params.r))));
  app.get('/api/payouts/wallet/:w', (req, res) => (sol.isAddress(req.params.w) ? res.json(payouts.wallet(req.params.w)) : res.status(400).json({ error: 'bad wallet' })));
  app.get('/api/nominate/quote', bucket(20), wrap(async (req, res) => res.json(await burns.quoteNomination(String(req.query.layer || ''), Number(req.query.index)))));
  app.post('/api/nominate', bucket(10), wrap(async (req, res) => res.json(await burns.nominate(req.body || {}))));
  app.get('/api/reply-burn/quote', bucket(20), wrap(async (req, res) => res.json(await burns.quoteReply(String(req.query.url || ''), String(req.query.wallet || '')))));
  app.post('/api/reply-burn', bucket(10), wrap(async (req, res) => res.json(await burns.replyRequest(req.body || {}))));
  app.get('/api/reply-burn/queue', (req, res) => res.json((D.replyQueue || []).slice(0, 30).map(({ id, tweetId, author, status, at, doneAt }) => ({ id, tweetId, author, status, at, doneAt }))));
  app.get('/api/rounds/:r/snapshot', (req, res) => { const j = (D.snapshots || {})[Number(req.params.r)]; if (!j) return res.status(404).json({ error: 'no snapshot' }); res.type('json').send(j); });
  // zero-knowledge tally proofs (docs/zk.md)
  app.get('/api/rounds/:r/proof', (req, res) => {
    const p = (D.proofs || {})[Number(req.params.r)]; if (!p) return res.status(404).json({ error: 'no proof' });
    const { status, reason, error, ms, proof, publicSignals, root, totalsCommit, winnerIndex, totals, at, onchain } = p;
    res.json({ round: Number(req.params.r), status, reason, error, ms, proof, publicSignals, root, totalsCommit, winnerIndex, totals, at, onchain: onchain || null, programId: process.env.NC_ZK_PROGRAM_ID || null, authority: zkChain ? zkChain.authority() : null });
  });
  app.get('/api/rounds/:r/verify', bucket(10), wrap(async (req, res) => {
    const r = Number(req.params.r); const s = (D.snapshots || {})[r]; if (!s) return res.status(404).json({ error: 'no snapshot' });
    res.json({ round: r, ...(await zk.check(s, (D.proofs || {})[r])) });
  }));
  app.get('/api/zk/vkey', (req, res) => res.sendFile(zk.files().vkey));
  app.get('/api/votes/:round', (req, res) => {
    const r = Number(req.params.round); const v = D.votes[r] || {};
    if (!D.rounds[r] && r >= rounds.current() - 1) return res.json({ round: r, hidden: true, voters: Object.keys(v).length, revealAt: rounds.bounds(r).endsAt, note: 'votes are revealed when the round closes' });
    res.json(Object.entries(v).map(([wallet, x]) => ({ wallet, ...x })));
  });

  app.post('/api/rpc', bucket(60), wrap(async (req, res) => {
    const b = req.body;
    if (!b || Array.isArray(b) || !RPC_METHODS.has(b.method)) return res.status(403).json({ jsonrpc: '2.0', id: b?.id ?? null, error: { code: -32601, message: 'method not allowed' } });
    if (!cfg.rpc) return res.status(503).json({ jsonrpc: '2.0', id: b.id ?? null, error: { code: -32000, message: 'rpc not configured' } });
    const r = await fetch(cfg.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: b.id ?? 1, method: b.method, params: b.params || [] }), signal: AbortSignal.timeout(15000) });
    res.status(r.status).type('json').send(await r.text());
  }));

  if (cfg.testMode) {
    app.post('/api/test/clock', (req, res) => { offset += Number((req.body || {}).add) || 0; res.json({ round: rounds.current() }); });
    app.post('/api/test/tick', wrap(async (req, res) => { await tickOnce(); res.json({ ok: true }); }));
  }

  const pub = path.join(__dirname, 'public');
  app.use(express.static(pub, { extensions: ['html'], maxAge: '5m' }));
  app.use((req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

  let ticking = false;
  async function tickOnce() {
    if (ticking) return; ticking = true;
    try { const r = rounds.current();
      // rounds missed while the server was down (deploy, crash): close any that got votes, oldest first, so no vote is lost
      for (let i = Math.max(1, r - 7); i < r - 1; i++) if (!D.rounds[i] && D.votes[i] && Object.keys(D.votes[i]).length) { const c = await rounds.close(i); await payouts.onRoundClosed(c); }
      if (r > 1 && !D.rounds[r - 1]) { const closed = await rounds.close(r - 1); await payouts.onRoundClosed(closed); try { await avatar.onRoundClosed(closed); } catch (e) { console.log('[avatar]', e.message); } } await payouts.tick(); await xbot.tick(); prover.tick(); }
    catch (e) { console.log('[tick]', e.message); } finally { ticking = false; }
  }
  return { app, store, rounds, xbot, avatar, budget, tickOnce, presets, payouts, burns, prover };
}

if (require.main === module) {
  const { app, tickOnce, store } = createApp();
  app.listen(baseCfg.port, () => console.log('neurocracy on :' + baseCfg.port, '| x mode:', baseCfg.x.dryRun ? 'dry-run' : 'live-capable'));
  setTimeout(tickOnce, 3000); setInterval(tickOnce, 15000);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { store.flush(); process.exit(0); });
}
module.exports = { createApp };
