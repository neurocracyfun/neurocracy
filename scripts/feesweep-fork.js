// Mainnet-fork test of the fee sweeper with the real pump.fun programs.
// Start a local validator that clones the Pump and Pump Fees programs plus a mainnet coin that has a locked
// single-shareholder sharing config (see the comment at the end), then:
//   FORK_RPC=http://127.0.0.1:18899 MINT=<coin> node scripts/feesweep-fork.js
// Uses throwaway local keys only. Refuses any RPC that is not on 127.0.0.1.
const web3 = require('@solana/web3.js'); const bs58 = require('bs58').default || require('bs58');
const { createFeeSweep, pumpAdapter } = require('../lib/feesweep');
const { createPayouts, solanaChain } = require('../lib/payouts');
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:18899'; if (!/^http:\/\/127\.0\.0\.1:/.test(RPC)) throw new Error('local validator only');
const MINT = process.env.MINT;
(async () => {
  const conn = new web3.Connection(RPC, 'confirmed'); const kp = web3.Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 2e9), 'confirmed');
  const key = bs58.encode(kp.secretKey);
  const sdk = require('@pump-fun/pump-sdk'); const sc = sdk.PUMP_SDK.decodeSharingConfig(await conn.getAccountInfo(sdk.feeSharingConfigPda(new web3.PublicKey(MINT))));
  const holder = sc.shareholders[0].address; const vault = sdk.creatorVaultPda(sdk.feeSharingConfigPda(new web3.PublicKey(MINT)));
  const cfg = { mint: MINT, rpc: RPC, feesweep: { enabled: true, minutes: 10, minLamports: 10_000_000, treasury: holder.toBase58() }, payout: { key, rpc: RPC, dryRun: false } };
  const store = { data: { votes: {}, rounds: {} }, save() {} }; const logs = [];
  const adapter = pumpAdapter(cfg);
  // 1. wrong treasury: refused, nothing sent
  const refuse = createFeeSweep({ cfg: { ...cfg, feesweep: { ...cfg.feesweep, treasury: kp.publicKey.toBase58() } }, store: { data: {}, save() {} }, adapter, log: (m) => logs.push(m) });
  console.log('wrong treasury ->', (await refuse.tick()).reason);
  // 2. real sweep
  const before = { holder: await conn.getBalance(holder), vault: await conn.getBalance(vault) };
  const fs = createFeeSweep({ cfg, store, adapter, log: (m) => logs.push(m) });
  const r = await fs.tick(); console.log('sweep ->', JSON.stringify(r));
  const after = { holder: await conn.getBalance(holder), vault: await conn.getBalance(vault) };
  console.log('vault', before.vault, '->', after.vault, '| shareholder +' + (after.holder - before.holder), 'lamports');
  console.log('second tick right away ->', await fs.tick(), '(throttled)');
  const again = createFeeSweep({ cfg, store: { data: {}, save() {} }, adapter }); console.log('after sweep ->', (await again.tick()).reason);
  // 3. payout engine paying a round from a local distributor funded like a sweep would
  const dist = web3.Keypair.generate(); await conn.confirmTransaction(await conn.requestAirdrop(dist.publicKey, Number(r.received > 0 ? r.lamports : 1e9) + 1e7), 'confirmed');
  const voters = [web3.Keypair.generate().publicKey.toBase58(), web3.Keypair.generate().publicKey.toBase58()]; const ops = web3.Keypair.generate().publicKey.toBase58();
  const pcfg = { mint: MINT, rpc: RPC, payout: { enabled: true, dryRun: false, key: bs58.encode(dist.secretKey), rpc: RPC, shareBps: 7000, nominatorBps: 1000, opsBps: 2000, opsAddress: ops, roundBps: 1000, minLamports: 1_000_000, reserveLamports: 10_000_000, dailyCapLamports: 2e9, maxPerTx: 18 } };
  const ps = { data: { votes: { 5: { [voters[0]]: { candidate: 'p:owl', weightInt: '1', rawAtClose: '3000' }, [voters[1]]: { candidate: 'p:owl', weightInt: '1', rawAtClose: '1000' } } }, rounds: {} }, save() {} };
  const pay = createPayouts({ cfg: pcfg, store: ps, chain: solanaChain(pcfg), log: console.log });
  const e = await pay.onRoundClosed({ id: 5, winner: { id: 'p:owl' }, house: false }); console.log('round 5 pool', e.pool, 'status', e.status);
  for (let i = 0; i < 20 && pay.forRound(5).status !== 'settled'; i++) { await new Promise((s) => setTimeout(s, 1000)); await pay.tick(); }
  console.log('round 5 ->', pay.forRound(5).status, 'voters', await conn.getBalance(new web3.PublicKey(voters[0])), await conn.getBalance(new web3.PublicKey(voters[1])), 'ops', await conn.getBalance(new web3.PublicKey(ops)), 'distributor left', await conn.getBalance(dist.publicKey));
  console.log('logs:', logs.join(' | '));
})().catch((e) => { console.error(e); process.exit(1); });
// Validator used:
// solana-test-validator --reset --url https://api.mainnet-beta.solana.com --clone-upgradeable-program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P \
//   --clone-upgradeable-program pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ --clone <mint> --clone <bonding curve> --clone <sharing config> \
//   --clone <creator vault> --clone <pump global> --clone <shareholder> --rpc-port 18899
