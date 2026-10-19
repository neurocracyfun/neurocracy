// Devnet end-to-end check: votes, round close, real payouts, real Token-2022 burns with memos.
// Keys live in ~/neurocracy-devnet (created by this script, chmod 600, never printed).
// Usage: DEVNET_RPC=<devnet rpc url> node scripts/devnet-e2e.js
//        LOCALNET=1 node scripts/devnet-e2e.js   (solana-test-validator on :8899, when devnet faucets are down)
// Refuses to run against anything that is not devnet or a local validator.
const fs = require('fs'); const path = require('path'); const os = require('os');
const web3 = require('@solana/web3.js'); const spl = require('@solana/spl-token');
const nacl = require('tweetnacl'); const bs58 = (require('bs58').default || require('bs58'));
const { createApp } = require('../server');
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const LOCAL = process.env.LOCALNET === '1';
const RPC = LOCAL ? 'http://127.0.0.1:8899' : process.env.DEVNET_RPC || 'https://api.devnet.solana.com';
const DIR = path.join(os.homedir(), 'neurocracy-devnet'); fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (n) => { const f = path.join(DIR, n + '.json'); if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify([...web3.Keypair.generate().secretKey]), { mode: 0o600 }); fs.chmodSync(f, 0o600); return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f)))); };
const say = (...a) => console.log('[e2e]', ...a);

(async () => {
  const conn = new web3.Connection(RPC, 'confirmed');
  if (!LOCAL && (await conn.getGenesisHash()) !== DEVNET_GENESIS) throw new Error('not devnet, refusing');
  const admin = key('admin'), dist = key('distributor'), voters = [key('voter1'), key('voter2'), key('voter3')];
  // 1. SOL: airdrop admin + distributor with backoff, then fund voters from admin
  for (const [kp, want] of [[admin, 1.5e9], [dist, 0.5e9]]) {
    for (let i = 0; i < 8 && (await conn.getBalance(kp.publicKey)) < want; i++) {
      try { const s = await conn.requestAirdrop(kp.publicKey, LOCAL ? 2e9 : 0.5e9); await conn.confirmTransaction(s, 'confirmed'); say('airdrop ok'); } catch (e) { say('airdrop retry', String(e.message).slice(0, 60)); await sleep(3000 * (i + 1)); }
    }
  }
  say('admin', (await conn.getBalance(admin.publicKey)) / 1e9, 'SOL, distributor', (await conn.getBalance(dist.publicKey)) / 1e9, 'SOL');
  for (const v of voters) if ((await conn.getBalance(v.publicKey)) < 0.02e9) await web3.sendAndConfirmTransaction(conn, new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: v.publicKey, lamports: 0.03e9 })), [admin]);
  // 2. Token-2022 stand-in for NCRACY, 6 decimals
  const mf = path.join(DIR, LOCAL ? 'mint-local.json' : 'mint.json'); let mint;
  if (fs.existsSync(mf)) mint = new web3.PublicKey(JSON.parse(fs.readFileSync(mf)).mint);
  else { mint = await spl.createMint(conn, admin, admin.publicKey, null, 6, undefined, undefined, spl.TOKEN_2022_PROGRAM_ID); fs.writeFileSync(mf, JSON.stringify({ mint: mint.toBase58() }), { mode: 0o600 }); }
  say('test mint', mint.toBase58());
  const amounts = [1_000_000n, 9_000_000n, 4_000_000n];   // whole tokens: sqrt weights 1000 : 3000 : 2000
  for (let i = 0; i < voters.length; i++) {
    const ata = await spl.getOrCreateAssociatedTokenAccount(conn, admin, mint, voters[i].publicKey, false, 'confirmed', undefined, spl.TOKEN_2022_PROGRAM_ID);
    const have = (await spl.getAccount(conn, ata.address, 'confirmed', spl.TOKEN_2022_PROGRAM_ID)).amount;
    const want = amounts[i] * 1_000_000n; if (have < want) await spl.mintTo(conn, admin, mint, ata.address, admin, want - have, [], undefined, spl.TOKEN_2022_PROGRAM_ID);
  }
  // 3. app on devnet, payouts live (not dry), ops share to the admin wallet, fixed test price
  const base = require('../lib/config');
  const cfg = { ...base, cluster: LOCAL ? 'localnet' : 'devnet', rpc: RPC, mint: mint.toBase58(), decimals: 6, db: path.join(DIR, LOCAL ? 'db-local.json' : 'db.json'), roundEpoch: Date.now() - 30 * 60e3 + 5000, roundMinutes: 30,
    payout: { ...base.payout, enabled: true, dryRun: false, key: bs58.encode(dist.secretKey), rpc: RPC, opsAddress: admin.publicKey.toBase58(), minLamports: 1_000_000, reserveLamports: 50_000_000, dailyCapLamports: 400_000_000 },
    nominate: { ...base.nominate, enabled: true }, replyBurn: { ...base.replyBurn, enabled: true }, x: { ...base.x, dryRun: true, enabled: false } };
  try { fs.unlinkSync(cfg.db); } catch {}
  let offset = 0; const now = () => Date.now() + offset;
  const { app, rounds, tickOnce, payouts, store } = createApp(cfg, { now, price: { get: async () => ({ usd: 0.0001, source: 'devnet fixed test price' }) }, steer: async () => ({ steered: 'The night is quiet and the field below is full of small sounds worth hearing.', normal: 'n', share: '' }) });
  const srv = app.listen(0); const B = `http://127.0.0.1:${srv.address().port}`;
  const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); say('ok', m); };
  // 4. votes: voter1 + voter2 for the owl, voter3 for the cat
  const R = rounds.current();
  for (const [i, cand] of [[0, 'p:owl'], [1, 'p:owl'], [2, 'p:cat']]) {
    const w = voters[i].publicKey.toBase58(); const msg = rounds.voteMessage({ round: R, candidate: cand, topic: '', wallet: w });
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), voters[i].secretKey));
    const r = await call('POST', '/api/vote', { wallet: w, round: R, candidate: cand, topic: '', signature }); ok(r.status === 200, `vote ${i + 1} accepted (weight ${r.body && r.body.weight})`);
  }
  // 5. nomination burn (real devnet tx with memo) before close, so it sits on the next ballot
  const burn = async (kp, amountUi, memo) => {
    const ata = spl.getAssociatedTokenAddressSync(mint, kp.publicKey, false, spl.TOKEN_2022_PROGRAM_ID);
    const tx = new web3.Transaction().add(spl.createBurnCheckedInstruction(ata, mint, kp.publicKey, BigInt(amountUi) * 1_000_000n, 6, [], spl.TOKEN_2022_PROGRAM_ID), new web3.TransactionInstruction({ programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memo) }));
    return web3.sendAndConfirmTransaction(conn, tx, [kp], { commitment: 'confirmed' });
  };
  const L = '9-gemmascope-res-16k';
  const q = await call('GET', `/api/nominate/quote?layer=${L}&index=15766`); ok(q.status === 200, `nominate quote ${q.body && q.body.burn} tokens for $${q.body && q.body.usd}`);
  const nsig = await burn(voters[0], q.body.burn, q.body.memo);
  const nr = await call('POST', '/api/nominate', { wallet: voters[0].publicKey.toBase58(), layer: L, index: 15766, signature: nsig, quote: q.body.quote });
  ok(nr.status === 200, `nomination verified on chain, ballot round ${nr.body && nr.body.round}`);
  ok((await call('POST', '/api/nominate', { wallet: voters[0].publicKey.toBase58(), layer: L, index: 15766, signature: nsig, quote: q.body.quote })).status === 409, 'same burn refused the second time');
  const small = await burn(voters[0], 10, 'Neurocracy reply 1849000000000000077');
  const rq = await call('GET', '/api/reply-burn/quote?url=' + encodeURIComponent('https://x.com/someone/status/1849000000000000077'));
  ok((await call('POST', '/api/reply-burn', { wallet: voters[0].publicKey.toBase58(), url: 'https://x.com/someone/status/1849000000000000077', signature: small, quote: rq.body.quote })).status === 400, 'undersized reply burn refused');
  const rsig = await burn(voters[1], rq.body.burn, rq.body.memo);
  const rr = await call('POST', '/api/reply-burn', { wallet: voters[1].publicKey.toBase58(), url: 'https://x.com/someone/status/1849000000000000077', signature: rsig, quote: rq.body.quote });
  ok(rr.status === 200, 'reply burn verified on chain and queued');
  // 6. close the round, plan + send payouts, confirm on chain
  const before = await Promise.all([voters[0], voters[1], voters[2], admin].map((k) => conn.getBalance(k.publicKey)));
  offset += 30 * 60e3; await tickOnce();
  const D = store.data; const round = D.rounds[R]; ok(round && round.winner.id === 'p:owl', 'round closed, owl won');
  ok(/^[0-9a-f]{64}$/.test(round.snapshotHash), 'snapshot hash ' + round.snapshotHash.slice(0, 16));
  for (let i = 0; i < 20; i++) { await sleep(3000); await payouts.tick(); const e = payouts.forRound(R); if (e.status === 'settled') break; }
  const e = payouts.forRound(R); say('payout', JSON.stringify({ status: e.status, pool: e.pool, voterPool: e.voterPool, ops: e.opsLamports, batches: e.batches }));
  ok(e.status === 'settled', 'payout settled on chain');
  const after = await Promise.all([voters[0], voters[1], voters[2], admin].map((k) => conn.getBalance(k.publicKey)));
  const got = after.map((a, i) => a - before[i]); say('received lamports v1,v2,v3,ops', got.join(', '));
  const v = D.votes[R]; const w0 = Number(v[voters[0].publicKey.toBase58()].weightInt), w1 = Number(v[voters[1].publicKey.toBase58()].weightInt);
  ok(got[0] === Number(e.shares[voters[0].publicKey.toBase58()]) && got[1] === Number(e.shares[voters[1].publicKey.toBase58()]), 'on-chain amounts equal the ledger');
  ok(got[0] > 0 && Math.abs(got[1] / got[0] - w1 / w0) < 0.001 && got[2] === 0, `voters paid pro rata by sqrt weight at close (${w0}:${w1}, after their burns), losing voter unpaid`);
  ok(Math.abs(got[3] / (got[0] + got[1]) - 2000 / 8000) < 0.01, 'operations got 20% (nominator 10% rolled to voters, owl was not nominated)');
  await payouts.onRoundClosed(round); await payouts.tick(); const again = await conn.getBalance(voters[0].publicKey); ok(again === after[0], 'no double payment on re-run');
  srv.close(); store.flush && store.flush(); say('ALL PASSED'); process.exit(0);
})().catch((e) => { console.error('[e2e]', e.message); process.exit(1); });
