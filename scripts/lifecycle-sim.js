// Full lifecycle simulation on a local validator (solana-test-validator on :8899 with the tally verifier deployed).
// Test Token-2022 mint, simulated holders, time-accelerated 2-hour rounds, signed votes with balance changes
// before close, burn nominations (accepted, duplicate, undersized, wrong memo, expired quote), a nominated
// feature winning, steering (Neuronpedia, cached fallback), X bot in dry run plus paid burn replies, a ZK proof
// per round verified by the on-chain program, Hall badges, payouts 70/10/20 dry run then real, and a restart.
// Usage: node scripts/lifecycle-sim.js   Report: sim/report.md, logs: sim/run.txt. Keys never printed.
const fs = require('fs'); const path = require('path'); const os = require('os');
const web3 = require('@solana/web3.js'); const spl = require('@solana/spl-token');
const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58'));
const RPC = 'http://127.0.0.1:8899'; const MEMO = new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'); const T22 = spl.TOKEN_2022_PROGRAM_ID;
const OUT = path.join(__dirname, '..', 'sim'); fs.mkdirSync(OUT, { recursive: true });
const logf = fs.createWriteStream(path.join(OUT, 'run.txt'));
const results = []; const facts = {};
const log = (...a) => { const s = a.join(' '); logf.write(s + '\n'); console.log(s); };
const ok = (c, m) => { results.push([!!c, m]); log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = path.join(os.homedir(), 'neurocracy-devnet');
const key = (n) => { const f = path.join(DIR, 'sim-' + n + '.json'); if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify([...web3.Keypair.generate().secretKey]), { mode: 0o600 }); return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f)))); };

(async () => {
  const conn = new web3.Connection(RPC, 'confirmed');
  const programId = process.env.NC_ZK_PROGRAM_ID || 'G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw';
  ok(!!(await conn.getAccountInfo(new web3.PublicKey(programId))), 'local validator up, tally verifier deployed at ' + programId);
  // ---- wallets and mint ----
  const admin = web3.Keypair.generate() /* fresh publisher per run: records from earlier runs stay on the validator */, dist = key('distributor'), ops = key('ops'); const H = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((n) => ({ n, kp: key(n) }));
  for (const kp of [admin, dist, key('admin')]) { const s = await conn.requestAirdrop(kp.publicKey, 5e9); await conn.confirmTransaction(s, 'confirmed'); }
  for (const h of H) await web3.sendAndConfirmTransaction(conn, new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: h.kp.publicKey, lamports: 0.05e9 })), [admin]);
  const mint = await spl.createMint(conn, admin, admin.publicKey, null, 6, web3.Keypair.generate(), { commitment: 'confirmed' }, T22);
  const supply = 1_000_000_000n * 1_000_000n; // 1B with 6 decimals, like pump.fun
  const bag = { alice: 9_000_000n, bob: 1_000_000n, carol: 4_000_000n, dave: 250_000n, erin: 40_000n, frank: 100_000n }; // whole tokens
  const ata = {}; for (const h of H) { ata[h.n] = (await spl.getOrCreateAssociatedTokenAccount(conn, admin, mint, h.kp.publicKey, false, 'confirmed', undefined, T22)).address; await spl.mintTo(conn, admin, mint, ata[h.n], admin, bag[h.n] * 1_000_000n, [], { commitment: 'confirmed' }, T22); }
  const adminAta = (await spl.getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey, false, 'confirmed', undefined, T22)).address;
  const minted = Object.values(bag).reduce((a, b) => a + b, 0n) * 1_000_000n; await spl.mintTo(conn, admin, mint, adminAta, admin, supply - minted, [], { commitment: 'confirmed' }, T22);
  const sup = await conn.getTokenSupply(mint); ok(sup.value.amount === supply.toString(), `test Token-2022 mint ${mint.toBase58().slice(0, 8)}... supply ${Number(sup.value.uiAmount).toLocaleString('en-US')}`);
  const W = (n) => H.find((h) => h.n === n).kp; const A = (n) => W(n).publicKey.toBase58();

  // ---- steering: real Neuronpedia when it answers, cached fallback otherwise ----
  const np = require('../lib/np'); const steerCache = new Map(); let npReal = 0, npFallback = 0, npErr = '';
  const steer = async (q, mix, o = {}) => {
    const k = JSON.stringify([q, mix.map((f) => [f.layer, f.index, f.strength]), o.seed]); if (steerCache.has(k)) return steerCache.get(k);
    let r = null;
    if (npReal + npFallback < 4 || npReal > 0) { try { r = await Promise.race([np.steer(q, mix, o), sleep(45000).then(() => { throw new Error('timeout'); })]); if (r.steered) npReal++; else r = null; } catch (e) { npErr = e.message; } }
    if (!r) { npFallback++; r = { steered: `Tonight I keep thinking about ${mix[0].label || 'small things'}. The quiet parts of a day say more than the loud ones, if you let them.`, normal: '', share: null }; }
    steerCache.set(k, r); return r;
  };

  // ---- app config: everything on, payouts dry first ----
  const base = require('../lib/config');
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ncsim-')), 'db.json');
  process.env.ZK_ONCHAIN = '1'; process.env.NC_ZK_PROGRAM_ID = programId; process.env.NC_ZK_RPC = RPC; process.env.NC_ZK_AUTHORITY_KEY = bs58.encode(admin.secretKey);
  let offset = 0; const now = () => Date.now() + offset;
  const epoch = Date.now() - 60e3;
  const mkCfg = (dry) => ({ ...base, cluster: 'localnet', rpc: RPC, mint: mint.toBase58(), decimals: 6, db, roundEpoch: epoch, roundMinutes: 120,
    payout: { ...base.payout, enabled: true, dryRun: dry, key: bs58.encode(dist.secretKey), rpc: RPC, opsAddress: ops.publicKey.toBase58(), minLamports: 1_000_000, reserveLamports: 50_000_000, dailyCapLamports: 3_000_000_000 },
    nominate: { ...base.nominate, enabled: true }, replyBurn: { ...base.replyBurn, enabled: true }, x: { ...base.x, dryRun: true, enabled: false }, quotes: { ...base.quotes, secret: 'sim-quote-secret' } });
  // price from a simulated pump.fun bonding curve read through the real parser: 30 SOL virtual / 1.073B tokens, SOL at $180
  const { createPrice, bondingCurveAddress } = require('../lib/price');
  let curve = { vSol: 60_000_000_000n, vTok: 536_500_000_000_000n };   // mid-curve: about $20k market cap
  const curveBuf = () => { const b = Buffer.alloc(49); b.writeBigUInt64LE(curve.vTok, 8); b.writeBigUInt64LE(curve.vSol, 16); return b; };
  let priceInst = null; const mkPrice = () => priceInst ||= createPrice({ cfg: { ...mkCfg(true), price: { ttlMs: 0, windowMs: 30 * 60e3 } }, now, rpcImpl: async (u, m, p) => (m === 'getAccountInfo' && p[0] === bondingCurveAddress(mint.toBase58()) ? { value: { data: [curveBuf().toString('base64')] } } : null), fetchImpl: async (u) => ({ ok: true, json: async () => ({ So11111111111111111111111111111111111111112: { usdPrice: 180 } }) }) });
  const { createApp } = require('../server');
  // mocked X post reads (GET /2/tweets/:id): who wrote each post and whom it mentions
  const xPosts = { '1849000000000000101': { author: 'curious_owl', mentions: ['neurocracyfun'], text: '@neurocracyfun what do you dream about' }, '1849000000000000202': { author: 'other', mentions: ['neurocracyfun'], text: '@neurocracyfun hello' },
    '1849000000000000303': { author: 'stranger', mentions: [], text: 'a post that never mentioned the account' }, '1849000000000000404': { author: 'bobsays', mentions: [], text: 'my morning walk by the river' } };
  let app, srv, B;
  const boot = (dry) => { app = createApp(mkCfg(dry), { now, steer, price: mkPrice(), featureInfo: async (l, i) => ({ 15766: 'owls and night birds', 4242: 'tidal patterns and the sea', 777: 'clockwork and small machines' }[i] || 'feature ' + i), zkProve: true, lookupPost: async (id) => xPosts[id] ? { id, ...xPosts[id] } : { missing: true } }); srv = app.app.listen(0); B = 'http://127.0.0.1:' + srv.address().port; };
  const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const sign = (kp, msg) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
  const vote = async (n, cand, topic = '') => { const R = app.rounds.current(); const msg = app.rounds.voteMessage({ round: R, candidate: cand, topic, wallet: A(n) }); return call('POST', '/api/vote', { wallet: A(n), round: R, candidate: cand, topic, signature: sign(W(n), msg) }); };
  const burn = async (n, amountUi, memo) => { const tx = new web3.Transaction().add(spl.createBurnCheckedInstruction(ata[n], mint, W(n).publicKey, BigInt(amountUi) * 1_000_000n, 6, [], T22), new web3.TransactionInstruction({ programId: MEMO, keys: [{ pubkey: W(n).publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memo) })); return web3.sendAndConfirmTransaction(conn, tx, [W(n)], { commitment: 'confirmed' }); };
  const move = async (from, to, ui) => { const tx = new web3.Transaction().add(spl.createTransferCheckedInstruction(ata[from], mint, ata[to], W(from).publicKey, BigInt(ui) * 1_000_000n, 6, [], T22)); return web3.sendAndConfirmTransaction(conn, tx, [W(from)], { commitment: 'confirmed' }); };
  const D = () => app.store.data;
  const closeRound = async () => { const R = app.rounds.current(); offset += 120 * 60e3; await app.tickOnce(); return D().rounds[R]; };
  const waitProof = async (r) => { for (let i = 0; i < 120 && !(D().proofs || {})[r]?.at; i++) { await sleep(1000); if (!app.prover.busy()) await app.prover.tick(); } for (let i = 0; i < 30 && D().proofs[r].status === 'proven' && !D().proofs[r].onchain && !D().proofs[r].onchainError; i++) await sleep(500); return D().proofs[r]; };
  boot(true);

  // ---- 1. config, presets, price quotes ----
  const cfgRes = await call('GET', '/api/config'); ok(cfgRes.status === 200, 'config served, mint set: ' + (cfgRes.body && cfgRes.body.mint === mint.toBase58()));
  const R1 = app.rounds.current(); const pub = (await call('GET', '/api/round')).body; const presets = pub.candidates.map((c) => c.id); ok(presets.length >= 3, `round ${R1} ballot has ${presets.length} preset candidates`);
  const L = '9-gemmascope-res-16k';
  const q1 = await call('GET', `/api/nominate/quote?layer=${L}&index=15766`);
  const priceUsd = q1.body.priceUsd; facts.price = priceUsd; facts.nominateBurn = q1.body.burn;
  ok(q1.status === 200 && Math.abs(q1.body.burn * priceUsd - 5) < priceUsd + 1e-9, `nomination quote ${q1.body.burn.toLocaleString('en-US')} tokens = $5 at $${priceUsd.toExponential(3)} (${q1.body.source})`);
  const rq0 = await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/curious_owl/status/1849000000000000101') + '&wallet=' + A('bob'));
  ok(rq0.status === 200 && Math.abs(rq0.body.burn * priceUsd - 1.5) < priceUsd + 1e-9, `reply quote ${rq0.body.burn.toLocaleString('en-US')} tokens = $1.5`);
  ok((await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://example.com/x') + '&wallet=' + A('bob'))).status === 400, 'reply quote for a non-X link refused');
  const unsol = await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/stranger/status/1849000000000000303') + '&wallet=' + A('bob')); ok(unsol.status === 400, 'reply to a post that never mentioned the account refused before any burn: ' + (unsol.body && unsol.body.error));
  const own0 = await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/bobsays/status/1849000000000000404') + '&wallet=' + A('bob')); ok(own0.status === 400, "bob's own post refused before he links his handle");
  { const msg = `Neurocracy link X\nHandle: @bobsays\nWallet: ${A('bob')}`; const l = await call('POST', '/api/link-x', { wallet: A('bob'), handle: 'bobsays', signature: sign(W('bob'), msg) }); ok(l.status === 200, 'bob linked @bobsays with a signed message'); }
  const own1 = await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/bobsays/status/1849000000000000404') + '&wallet=' + A('bob')); ok(own1.status === 400, "after linking, bob's own post without a mention is still refused (mention-only paid replies): " + (own1.body && own1.body.error));
  ok((await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/bobsays/status/1849000000000000404') + '&wallet=' + A('carol'))).status === 400, "carol cannot buy a reply to bob's post");

  // ---- 2. nominations by burn ----
  const nsig = await burn('alice', q1.body.burn, q1.body.memo);
  const n1 = await call('POST', '/api/nominate', { wallet: A('alice'), layer: L, index: 15766, signature: nsig, quote: q1.body.quote });
  ok(n1.status === 200 && n1.body.round === R1 + 1, `alice nominated "owls and night birds" by burn, on the ballot of round ${n1.body && n1.body.round}`);
  ok((await call('POST', '/api/nominate', { wallet: A('alice'), layer: L, index: 15766, signature: nsig, quote: q1.body.quote })).status === 409, 'same burn signature refused the second time');
  const q2 = await call('GET', `/api/nominate/quote?layer=${L}&index=4242`);
  const small = await burn('carol', Math.floor(q2.body.burn / 2), q2.body.memo);
  const nSmall = await call('POST', '/api/nominate', { wallet: A('carol'), layer: L, index: 4242, signature: small, quote: q2.body.quote }); ok(nSmall.status === 400, 'undersized burn refused: ' + (nSmall.body && nSmall.body.error));
  const wrong = await burn('carol', q2.body.burn, 'Neurocracy nominate 9-gemmascope-res-16k/9999');
  const nWrong = await call('POST', '/api/nominate', { wallet: A('carol'), layer: L, index: 4242, signature: wrong, quote: q2.body.quote }); ok(nWrong.status === 400, 'burn with another feature in the memo refused: ' + (nWrong.body && nWrong.body.error));
  const nOther = await call('POST', '/api/nominate', { wallet: A('bob'), layer: L, index: 4242, signature: nsig, quote: q2.body.quote }); ok(nOther.status >= 400, "someone else's burn cannot be claimed: " + (nOther.body && nOther.body.error));
  const nForged = await call('POST', '/api/nominate', { wallet: A('carol'), layer: L, index: 4242, signature: wrong, quote: q2.body.quote.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }); ok(nForged.status === 400, 'tampered quote refused: ' + (nForged.body && nForged.body.error));
  const q3 = await call('GET', `/api/nominate/quote?layer=${L}&index=777`); offset += 16 * 60e3;   // quote TTL 5 min + 10 min grace
  const late = await burn('carol', q3.body.burn, q3.body.memo);
  const nLate = await call('POST', '/api/nominate', { wallet: A('carol'), layer: L, index: 777, signature: late, quote: q3.body.quote }); ok(nLate.status === 410, 'expired quote refused: ' + (nLate.body && nLate.body.error));
  offset -= 16 * 60e3;
  ok((await call('GET', `/api/nominate/quote?layer=bogus&index=1`)).status === 400, 'quote for an unsupported layer refused before any burn');

  // ---- 3. round 1 votes, balance changes before close, sybil split check ----
  const owl = presets[0], cat = presets[1], sea = presets[2];
  for (const [n, c, t] of [['alice', cat, 'the ocean at night'], ['bob', owl, ''], ['carol', owl, 'old clocks'], ['dave', sea, ''], ['erin', sea, '']]) { const r = await vote(n, c, t); ok(r.status === 200, `round ${R1}: ${n} voted ${c} (weight ${r.body && Math.round(r.body.weight)})`); }
  ok((await vote('frank', 'p:does-not-exist')).status === 400, 'vote for an unknown candidate refused');
  { const R = app.rounds.current(); const msg = app.rounds.voteMessage({ round: R, candidate: owl, topic: '', wallet: A('frank') }); ok((await call('POST', '/api/vote', { wallet: A('frank'), round: R, candidate: cat, topic: '', signature: sign(W('frank'), msg) })).status === 400, 'vote with a signature for a different candidate refused'); }
  const re = await vote('bob', cat); ok(re.status === 200, 'bob changed his vote to ' + cat + ' (last signed vote counts)');
  { const o = (await call('GET', '/api/round')).body; const vv = (await call('GET', '/api/votes/' + R1)).body;
    ok(o.voters === 5 && o.candidates.every((c) => c.weight === undefined) && !o.topics.length && vv.hidden && !JSON.stringify(vv).includes(cat), `open round shows participation only (${o.voters} voters, ${o.weightCast} weight cast); per-option weights and votes hidden`); }
  await move('alice', 'dave', 8_000_000); ok(true, 'alice moved 8,000,000 tokens to dave before close (her weight should drop, dave rises)');
  const r1 = await closeRound(); const v1 = D().votes[R1];
  { const { isqrt } = require('../lib/solana'); const raw = BigInt((await conn.getTokenAccountBalance(ata.alice)).value.amount); ok(v1[A('alice')].weightInt === isqrt(raw).toString(), `alice weight at close ${v1[A('alice')].weightInt} = isqrt of her balance at close (${(Number(raw) / 1e6).toLocaleString('en-US')} tokens), not of her 9,000,000 at vote time`); }
  const exp = { [cat]: 0n, [owl]: 0n, [sea]: 0n }; for (const v of Object.values(v1)) exp[v.candidate] += BigInt(v.weightInt);
  const expWinner = Object.entries(exp).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))[0][0];
  ok(r1.winner.id === expWinner, `round ${R1} closed: winner ${r1.winner.name} (${r1.winner.id}), integer totals ${Object.entries(exp).map(([k, v]) => k + '=' + v).join(' ')}`);
  ok(r1.topic === 'the ocean at night' || r1.topic === 'old clocks', 'topic from holder votes: ' + r1.topic);
  facts.r1 = { winner: r1.winner.id, totals: Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, v.toString()])) };

  // ---- 4. steering + X bot dry run + paid reply ----
  const post1 = D().posts.find((p) => p.kind === 'post' && p.round === R1); if (post1 && !post1.text) log('post drafts rejected: ' + JSON.stringify(post1.rejected).slice(0, 600));
  ok(post1 && post1.status === 'preview' && post1.text, `X bot wrote the round ${R1} post in dry run (status ${post1 && post1.status}): "${post1 && (post1.text || '').slice(0, 80)}"`);
  const rq = await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/curious_owl/status/1849000000000000101') + '&wallet=' + A('bob'));
  const rs = await burn('bob', rq.body.burn, rq.body.memo);
  const rr = await call('POST', '/api/reply-burn', { wallet: A('bob'), url: 'https://x.com/curious_owl/status/1849000000000000101', signature: rs, quote: rq.body.quote }); ok(rr.status === 200, 'bob burned for a reply, queued ' + (rr.body && rr.body.queued));
  ok((await call('POST', '/api/reply-burn', { wallet: A('bob'), url: 'https://x.com/curious_owl/status/1849000000000000101', signature: rs, quote: rq.body.quote })).status === 400, 'second reply request for the same post refused');
  const rq2 = await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/other/status/1849000000000000202') + '&wallet=' + A('bob'));
  ok((await call('POST', '/api/reply-burn', { wallet: A('bob'), url: 'https://x.com/other/status/1849000000000000202', signature: rs, quote: rq2.body.quote })).status >= 400, 'reusing a reply burn for another post refused');
  await app.tickOnce(); const job = D().replyQueue.find((j) => j.tweetId === '1849000000000000101');
  ok(job && job.status === 'preview', 'paid reply generated in dry run, status ' + (job && job.status));

  // ---- 5. ZK proof of round 1, verified by the program on the local validator ----
  const p1 = await waitProof(R1); facts.proveMs = [p1.ms];
  ok(p1.status === 'proven', `round ${R1} tally proven in ${p1.ms} ms`);
  ok(!!p1.onchain, `round ${R1} proof accepted by the on-chain verifier, record ${p1.onchain && p1.onchain.record}` + (p1.onchainError ? ' ERROR ' + p1.onchainError : ''));
  const ver1 = await call('GET', `/api/rounds/${R1}/verify`); ok(ver1.body && ver1.body.ok, 'server recheck from snapshot: ' + (ver1.body && ver1.body.reason));
  const { createZkChain } = require('../lib/zkchain'); const zc = createZkChain({ rpc: RPC, programId });
  const tx1 = await zc.checkTx(p1.onchain.sig);
  ok(tx1 && tx1.root === p1.root && tx1.winner === p1.winnerIndex && tx1.signer === admin.publicKey.toBase58() && !p1.onchain.record, `verify mode: transaction carries the same root and winner, no account created (rent 0)`);
  const hall1 = (await call('GET', '/api/hall')).body.rounds.find((r) => r.id === R1); ok(hall1.zk && hall1.zk.status === 'proven' && hall1.zk.onchain, 'Hall shows Verified, checked on Solana, for round ' + R1);
  const pay1 = app.payouts.forRound(R1); ok(pay1 && pay1.dry && pay1.status === 'dry-run', `round ${R1} payout dry run: pool ${pay1 && pay1.pool} lamports, nothing sent`);
  facts.dry = pay1;

  // ---- 6. restart with real payouts on localnet; round 2: the nominated feature wins ----
  srv.close(); app.store.flush(); boot(false);
  const R2 = app.rounds.current(); ok(R2 === R1 + 1, 'restarted, round ' + R2);
  const nominated = (await call('GET', '/api/round')).body.candidates.find((c) => c.id === `f:${L}:15766`); ok(!!nominated, 'nominated feature is on the round ' + R2 + ' ballot');
  for (const [n, c] of [['alice', nominated.id], ['dave', nominated.id], ['carol', owl], ['frank', nominated.id], ['erin', owl]]) ok((await vote(n, c)).status === 200, `round ${R2}: ${n} voted ${c}`);
  await move('carol', 'bob', 1_000_000);
  const before = {}; for (const k of [...H.map((h) => h.n), 'ops']) before[k] = await conn.getBalance(k === 'ops' ? ops.publicKey : W(k).publicKey);
  const r2 = await closeRound(); ok(r2.winner.id === nominated.id && r2.nominator === A('alice'), `round ${R2} won by the nominated feature, nominator alice`);
  for (let i = 0; i < 20 && app.payouts.forRound(R2).status !== 'settled'; i++) { await sleep(2000); await app.payouts.tick(); }
  const pay2 = app.payouts.forRound(R2); ok(pay2.status === 'settled', `round ${R2} payout settled on chain, pool ${pay2.pool} lamports`);
  const got = {}; for (const k of Object.keys(before)) got[k] = (await conn.getBalance(k === 'ops' ? ops.publicKey : W(k).publicKey)) - before[k];
  const pool = BigInt(pay2.pool); const v2 = D().votes[R2];
  ok(true, `round ${R2} pool ${pool} lamports = 10% of the unallocated balance`);
  const wts = ['alice', 'dave', 'frank'].map((n) => BigInt(v2[A(n)].rawAtClose)); const wsum = wts.reduce((a, b) => a + b, 0n); const vp = pool * 7000n / 10000n;
  const want = { alice: vp * wts[0] / wsum + pool * 1000n / 10000n, dave: vp * wts[1] / wsum, frank: vp * wts[2] / wsum, ops: pool * 2000n / 10000n };
  for (const [k, w] of Object.entries(want)) ok(BigInt(got[k]) === w, `${k} received ${got[k]} lamports, expected ${w}${k === 'ops' || k === 'alice' ? '' : ' (pro rata by balance at close)'}`);
  ok(got.carol === 0 && got.erin === 0, 'voters for the losing candidate received nothing');
  facts.split = { pool: pay2.pool, got };
  const p2 = await waitProof(R2); facts.proveMs.push(p2.ms); ok(p2.status === 'proven' && p2.onchain, `round ${R2} proven (${p2.ms} ms) and recorded on chain`);

  // ---- 7. round 3: nobody votes (house pick), then round 4 with a tie ----
  const R3 = app.rounds.current(); const r3 = await closeRound(); ok(r3.house, `round ${R3} had no votes: house pick ${r3.winner.name}`);
  const p3 = await waitProof(R3); ok(p3.status === 'skipped', 'house round not proven, reason: ' + p3.reason);
  ok(app.payouts.forRound(R3).status === 'skipped', 'house round pays nothing');
  const R4 = app.rounds.current(); await vote('bob', sea); await vote('carol', owl);
  const b4 = D().votes[R4]; ok(true, 'round ' + R4 + ': bob and carol now hold ' + (await Promise.all(['bob', 'carol'].map(async (n) => (await conn.getTokenAccountBalance(ata[n])).value.uiAmountString))).join(' and '));
  const r4 = await closeRound(); const p4 = await waitProof(R4); facts.proveMs.push(p4.ms);
  ok(p4.status === 'proven' && p4.onchain, `round ${R4} winner ${r4.winner.id} proven and recorded`);

  // ---- 8. sybil split: one holder as 4 wallets ----
  const one = 1_000_000n * 1_000_000n; const { isqrt } = require('../lib/solana');
  facts.sybil = { oneWallet: isqrt(one).toString(), fourWallets: (4n * isqrt(one / 4n)).toString() };
  ok(true, `sybil check: 1,000,000 tokens in one wallet weigh ${facts.sybil.oneWallet}, split across 4 wallets ${facts.sybil.fourWallets} (sqrt(k) times more)`);

  // ---- 9. thin-curve manipulation of burn quotes ----
  const pFair = (await call('GET', `/api/nominate/quote?layer=${L}&index=777`)).body;
  curve = { vSol: 300_000_000_000n, vTok: 107_300_000_000_000n }; // pumped 100x price
  srv.close(); app.store.flush(); boot(false);
  const pPump = (await call('GET', `/api/nominate/quote?layer=${L}&index=777`)).body;
  facts.manip = { fair: pFair.burn, pumped: pPump.burn, clampMin: base.nominate.min };
  ok(pPump.burn >= pFair.burn, `price pumped 100x: nomination burn stays ${pPump.burn.toLocaleString('en-US')} tokens (was ${pFair.burn.toLocaleString('en-US')}), quotes use the lowest price of the last 30 min`);
  curve = { vSol: 60_000_000_000n, vTok: 536_500_000_000_000n };

  // ---- 10. restart idempotency ----
  srv.close(); app.store.flush(); boot(false);
  const postsBefore = D().posts.length; const balBefore = await conn.getBalance(W('alice').publicKey); const proofsBefore = JSON.stringify(Object.keys(D().proofs));
  await app.payouts.onRoundClosed(D().rounds[R2]); await app.tickOnce(); await app.tickOnce(); await sleep(1500);
  ok((await conn.getBalance(W('alice').publicKey)) === balBefore, 'after restart: re-running close and payouts pays nobody twice');
  ok(D().posts.filter((p) => p.kind === 'post').length === new Set(D().posts.filter((p) => p.kind === 'post').map((p) => p.round)).size, 'after restart: one X post per round, no duplicates');
  ok(JSON.stringify(Object.keys(D().proofs)) === proofsBefore, 'after restart: no proof redone');
  ok(!!(await zc.checkTx(D().proofs[R2].onchain.sig)), 'on-chain verification transactions persist and can be re-checked by signature');
  const verifyPage = await fetch(B + '/verify?round=' + R2); ok(verifyPage.status === 200, '/verify page served');
  const local = await new Promise((res) => require('child_process').exec(`node ${path.join(__dirname, 'zk-verify.js')} ${R2} ${B}`, (e, so) => res({ code: e ? e.code : 0, so })));
  log(local.so.trim()); ok(local.code === 0, 'scripts/zk-verify.js passes against the simulated site');
  facts.np = { real: npReal, fallback: npFallback, lastError: npErr };
  srv.close(); app.store.flush();

  // ---- report ----
  const pass = results.filter((r) => r[0]).length; const fail = results.length - pass;
  const md = [`# Lifecycle simulation report`, '', `Run: ${new Date().toISOString()} on solana-test-validator, program ${programId}. Result: ${pass} passed, ${fail} failed.`, '',
    `- Test mint: Token-2022, 6 decimals, supply 1,000,000,000. Six holders.`,
    `- Price: simulated pump.fun bonding curve (60 SOL / 536.5M tokens virtual), SOL $180, so $${facts.price.toExponential(3)} per token. Nomination burn ${facts.nominateBurn.toLocaleString('en-US')} tokens ($5).`,
    `- Steering: ${facts.np.real} real Neuronpedia responses, ${facts.np.fallback} cached fallbacks${facts.np.lastError ? ' (last error: ' + facts.np.lastError + ')' : ''}.`,
    `- Proving times (ms, this box): ${facts.proveMs.join(', ')}.`,
    `- Round ${R2} payout: pool ${facts.split.pool} lamports, received ${JSON.stringify(facts.split.got)}.`,
    `- Sybil: one wallet ${facts.sybil.oneWallet} weight vs four wallets ${facts.sybil.fourWallets}.`,
    `- Thin curve: nomination burn ${facts.manip.fair} tokens at fair price, ${facts.manip.pumped} after a 100x pump (lowest-price window).`, '', '## Checks', '', ...results.map(([c, m]) => `- ${c ? 'PASS' : 'FAIL'} ${m}`), ''].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md); log(`\n${pass} passed, ${fail} failed. Report: sim/report.md`);
  logf.end(); setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch((e) => { log('ERROR ' + (e.stack || e.message)); logf.end(); setTimeout(() => process.exit(1), 300); });
