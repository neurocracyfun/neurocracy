// Creator-fee sweeper. OFF unless NC_FEESWEEP_ENABLED=1 and NC_TOKEN_MINT is set.
// pump.fun creator fees for the coin are locked on chain by a Pump Fees sharing config
// (PDA ['sharing-config', mint]) to a single shareholder: the distributor wallet, 10,000 bps, admin revoked.
// Every NC_FEESWEEP_MIN minutes (default 10) this module:
//   1. reads the sharing config on chain and refuses to act unless it is exactly
//      [ distributor, 10,000 bps ] and locked (admin revoked). No config: log and do nothing
//      (fees then stay with the coin creator).
//   2. reads the distributable amount (bonding curve vault, plus the AMM vault once graduated).
//   3. above NC_FEESWEEP_MIN_LAMPORTS (default 0.01 SOL) sends the permissionless
//      distribute_creator_fees_v2 transaction (with transfer_creator_fees_to_pump_v2 first for a
//      graduated coin), paid by the distributor wallet. The SOL lands in the distributor, where the
//      payout engine (lib/payouts.js) counts it as available at the next voted round.
// PAYOUT_DRY_RUN=1 or no NC_PAYOUT_KEY: checks and logs only, sends nothing.
// Each sweep is recorded in store.data.feesweeps (signature, lamports) and served at /api/feesweeps.
const DEFAULT_TREASURY = 'EoiYniMMajEdhryrwfsXroz48Yn81z14tB2hejj7Zuh1';

// Pure check of a decoded sharing config. Returns null when it is safe to sweep, else a reason.
function checkConfig(sc, treasury) {
  if (!sc) return 'no fee sharing config for this coin: fees stay with the creator, nothing to sweep';
  const sh = sc.shareholders || [];
  if (sh.length !== 1) return `sharing config has ${sh.length} shareholders, expected only the distributor`;
  const addr = String(sh[0].address && sh[0].address.toBase58 ? sh[0].address.toBase58() : sh[0].address);
  if (addr !== treasury) return `sharing config pays ${addr}, expected the distributor ${treasury}`;
  if (Number(sh[0].shareBps) !== 10000) return `distributor share is ${sh[0].shareBps} bps, expected 10000`;
  if (!sc.adminRevoked) return 'sharing config is not locked yet (admin not revoked)';
  return null;
}

function createFeeSweep({ cfg, store, adapter, now = () => Date.now(), log = () => {} }) {
  const F = cfg.feesweep || {}; const D = store.data;
  const treasury = () => F.treasury || (adapter && adapter.payer()) || DEFAULT_TREASURY;
  const active = () => !!(F.enabled && cfg.mint && adapter);
  const dry = () => !!(cfg.payout && cfg.payout.dryRun) || !adapter || !adapter.canSend();
  const state = () => (D.feesweep ||= { lastCheck: 0, lastReason: null, lastDistributable: null });
  const list = () => (D.feesweeps ||= []);
  let busy = false;

  async function run() {
    const st = state(); st.lastCheck = now();
    const sc = await adapter.readConfig(cfg.mint);
    const bad = checkConfig(sc, treasury());
    if (bad) { if (st.lastReason !== bad) log('[feesweep] ' + bad); st.lastReason = bad; store.save(); return { swept: false, reason: bad }; }
    const d = await adapter.distributable(cfg.mint);
    const amt = BigInt(d.lamports); st.lastDistributable = amt.toString();
    if (amt < BigInt(F.minLamports)) { st.lastReason = 'below minimum'; store.save(); return { swept: false, reason: 'below minimum', lamports: amt.toString() }; }
    if (dry()) { st.lastReason = 'dry run: would sweep ' + amt; log('[feesweep] dry run, would sweep ' + amt + ' lamports'); store.save(); return { swept: false, reason: 'dry run', lamports: amt.toString() }; }
    const before = BigInt(await adapter.balance());
    const r = await adapter.sweep(cfg.mint);                       // signs, sends, confirms
    const after = BigInt(await adapter.balance());
    const row = { at: now(), sig: r.sig, lamports: amt.toString(), received: (after - before).toString(), graduated: !!d.graduated };
    list().unshift(row); D.feesweeps = list().slice(0, 500); st.lastReason = 'swept'; store.save();
    log('[feesweep] swept ' + amt + ' lamports ' + r.sig);
    return { swept: true, ...row };
  }

  async function tick() {
    if (!active() || busy) return null;
    if (now() - state().lastCheck < F.minutes * 60e3) return null;
    busy = true;
    try { return await run(); } catch (e) { state().lastReason = 'error: ' + e.message; log('[feesweep] ' + e.message); return null; } finally { busy = false; }
  }
  const total = () => list().reduce((a, r) => a + BigInt(r.lamports), 0n).toString();
  const status = () => ({ enabled: active(), dryRun: dry(), everyMinutes: F.minutes, minLamports: String(F.minLamports), distributor: treasury(), lastCheck: state().lastCheck || null, lastReason: state().lastReason, lastDistributable: state().lastDistributable, totalLamports: total(), sweeps: list().slice(0, 100) });
  return { tick, run, status, active };
}

// Real adapter on @pump-fun/pump-sdk (pinned). Built only when a key or address is configured.
function pumpAdapter(cfg) {
  const P = cfg.payout; if (!P.key && !P.address) return null;
  const web3 = require('@solana/web3.js'); const bs58 = (require('bs58').default || require('bs58'));
  const sdk = require('@pump-fun/pump-sdk');
  let kp = null; try { if (P.key) kp = web3.Keypair.fromSecretKey(P.key.trim().startsWith('[') ? Uint8Array.from(JSON.parse(P.key)) : bs58.decode(P.key.trim())); } catch { kp = null; }
  const addr = kp ? kp.publicKey.toBase58() : P.address;
  const conn = new web3.Connection((cfg.feesweep && cfg.feesweep.rpc) || P.rpc || cfg.rpc, 'confirmed');
  const online = new sdk.OnlinePumpSdk(conn);
  const NATIVE_MINT = new web3.PublicKey('So11111111111111111111111111111111111111112');
  return {
    payer: () => addr,
    canSend: () => !!kp,
    balance: async () => BigInt(await conn.getBalance(new web3.PublicKey(addr), 'confirmed')),
    async readConfig(mint) {
      const pda = sdk.feeSharingConfigPda(new web3.PublicKey(mint));
      const info = await conn.getAccountInfo(pda, 'confirmed');
      if (!info) return null;
      if (!info.owner.equals(sdk.PUMP_FEE_PROGRAM_ID)) throw new Error('sharing config owner is not the Pump Fees program');
      const sc = sdk.PUMP_SDK.decodeSharingConfig(info);
      return { address: pda.toBase58(), adminRevoked: !!sc.adminRevoked, shareholders: sc.shareholders.map((s) => ({ address: s.address.toBase58(), shareBps: Number(s.shareBps) })) };
    },
    async distributable(mint) {
      const r = await online.getMinimumDistributableFee(new web3.PublicKey(mint), new web3.PublicKey(addr), { quoteMint: NATIVE_MINT, payer: new web3.PublicKey(addr) });
      return { lamports: r.canDistribute ? BigInt(r.distributableFees.toString()) : 0n, graduated: r.isGraduated };
    },
    async sweep(mint) {
      const { instructions } = await online.buildDistributeCreatorFeesInstructions(new web3.PublicKey(mint), { quoteMint: NATIVE_MINT, payer: kp.publicKey });
      const ixs = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }), ...instructions];
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
      tx.sign([kp]);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 });
      const c = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      if (c.value.err) throw new Error('sweep failed ' + sig + ' ' + JSON.stringify(c.value.err));
      return { sig };
    },
  };
}
module.exports = { createFeeSweep, pumpAdapter, checkConfig, DEFAULT_TREASURY };
