// Creator-fee share. OFF unless NC_PAYOUT_ENABLED=1 and a mint is set.
// PAYOUT_DRY_RUN=1 (default) computes and records everything in a separate "dry" book and sends nothing.
//
// The distributor wallet is funded by hand from pump.fun creator fees. At each closed, non-house round
// everything that is not yet allocated is split:
//   available  = distributor balance - reserve - everything already owed (accrued, unpaid)
//   pool       = ROUND_BPS (10%) of available, limited by the daily cap; the rest carries over to later rounds
//   voters     = SHARE_BPS (70%) of the pool, plus the nominator share when the winner was not nominated,
//                split pro rata by RAW BALANCE AT CLOSE among wallets that voted for the winning candidate
//                (vote weight is still sqrt(balance); paying by balance means splitting a bag across wallets
//                gains nothing on payouts)
//   nominator  = NOMINATOR_BPS (10%) to the wallet that nominated the winning feature by burn
//   operations = OPS_BPS (20%) owed to NC_OPS_ADDRESS
// Each share is added to that wallet's owed balance. Wallets whose owed balance reaches MIN_LAMPORTS
// are paid in batched SystemProgram transfers; smaller amounts keep accruing. Integer remainders (dust)
// stay unallocated in the distributor and roll into the next pool.
// Idempotent: a round is planned once (ledger entry), and each batch records its signature and
// blockhash expiry before it is sent, so a restart confirms or safely re-sends instead of paying twice.
const SOL = 1_000_000_000n;

function split(pool, entries) {
  pool = BigInt(pool); const total = entries.reduce((a, e) => a + BigInt(e.weight), 0n);
  const out = {}; let used = 0n;
  if (pool <= 0n || total <= 0n) return { shares: out, dust: pool > 0n ? pool : 0n };
  for (const e of entries) { const s = (pool * BigInt(e.weight)) / total; if (s > 0n) { out[e.wallet] = (out[e.wallet] || 0n) + s; used += s; } }
  return { shares: out, dust: pool - used };
}

function createPayouts({ cfg, store, chain, now = () => Date.now(), log = () => {} }) {
  const P = cfg.payout; const D = store.data;
  const dry = () => P.dryRun || !chain || !chain.canSend();
  const bookName = () => (dry() ? 'dry' : 'live');
  const book = () => { D.payout ||= {}; return (D.payout[bookName()] ||= { owed: {}, paidDay: {}, rounds: {}, history: {} }); };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const active = () => !!(P.enabled && cfg.mint && P.shareBps > 0 && P.shareBps + P.nominatorBps + P.opsBps <= 10000 && (P.opsBps === 0 || !!P.opsAddress) && chain && chain.address());
  const owedTotal = (b) => Object.values(b.owed).reduce((a, v) => a + BigInt(v), 0n);
  const hist = (b, w, row) => { (b.history[w] ||= []).unshift(row); b.history[w] = b.history[w].slice(0, 200); };

  async function plan(round) {
    const b = book(); if (b.rounds[round.id]) return b.rounds[round.id];
    const base = { round: round.id, at: now(), dry: dry() };
    if (round.house) return (b.rounds[round.id] = { ...base, status: 'skipped', reason: 'house pick, nobody voted' });
    const votes = D.votes[round.id] || {};
    const winners = Object.entries(votes).filter(([, v]) => v.candidate === round.winner.id && BigInt(v.weightInt || '0') > 0n).map(([wallet, v]) => ({ wallet, weight: BigInt(v.rawAtClose || '0') })).filter((e) => e.weight > 0n);
    if (!winners.length) return (b.rounds[round.id] = { ...base, status: 'skipped', reason: 'no weighted votes for the winner' });
    const bal = BigInt(await chain.balance());
    const available = bal - BigInt(P.reserveLamports) - owedTotal(b);
    let pool = available > 0n ? (available * BigInt(P.roundBps ?? 10000)) / 10000n : 0n;   // a share per round, the rest carries over
    const capLeft = BigInt(P.dailyCapLamports) - BigInt(b.paidDay[day()] || 0);
    if (pool > capLeft) pool = capLeft > 0n ? capLeft : 0n;
    if (pool <= 0n) return (b.rounds[round.id] = { ...base, status: 'skipped', reason: capLeft <= 0n ? 'daily cap reached' : 'distributor is empty' });
    const opsLamports = (pool * BigInt(P.opsBps)) / 10000n;   // payouts stay off until NC_OPS_ADDRESS is set
    let nominator = null; let nomLamports = (pool * BigInt(P.nominatorBps)) / 10000n;
    if (round.nominator && nomLamports > 0n) nominator = { wallet: round.nominator, lamports: nomLamports.toString() };
    const voterPool = (pool * BigInt(P.shareBps)) / 10000n + (nominator ? 0n : nomLamports);   // no winning nomination: 10% rolls to voters
    const { shares, dust: splitDust } = split(voterPool, winners);
    if (nominator) shares[nominator.wallet] = (shares[nominator.wallet] || 0n) + nomLamports;
    if (opsLamports > 0n) shares[P.opsAddress] = (shares[P.opsAddress] || 0n) + opsLamports;
    const allocated = Object.values(shares).reduce((x, y) => x + y, 0n); const dust = pool - allocated;
    for (const [w, s] of Object.entries(shares)) { b.owed[w] = (BigInt(b.owed[w] || 0) + s).toString(); hist(b, w, { round: round.id, kind: w === P.opsAddress ? 'operations' : nominator && w === nominator.wallet ? 'nominator' : 'voter', lamports: s.toString(), at: now() }); }
    b.paidDay[day()] = (BigInt(b.paidDay[day()] || 0) + allocated).toString();
    const entry = { ...base, status: 'planned', balance: bal.toString(), pool: pool.toString(), voterPool: voterPool.toString(), opsLamports: opsLamports.toString(), dust: dust.toString(), nominator, voters: winners.length, shares: Object.fromEntries(Object.entries(shares).map(([w, s]) => [w, s.toString()])), batches: [] };
    b.rounds[round.id] = entry; store.save(); return entry;
  }

  // pay every wallet whose accrued balance reached the minimum, in batches
  async function settle(roundId) {
    const b = book(); const entry = b.rounds[roundId]; if (!entry || entry.status === 'skipped') return entry;
    // 1. resolve batches already in flight
    for (const bt of entry.batches.filter((x) => x.status === 'sent')) {
      const st = await chain.status(bt.sig);
      if (st === 'confirmed') { bt.status = 'paid'; for (const [w, l] of bt.items) { b.owed[w] = (BigInt(b.owed[w] || 0) - BigInt(l)).toString(); if (b.owed[w] === '0') delete b.owed[w]; hist(b, w, { round: roundId, kind: 'paid', lamports: l, sig: bt.sig, at: now() }); } }
      else if (st === 'failed' || (st === null && (await chain.blockHeight()) > bt.lastValid)) bt.status = 'expired';
      else return entry; // still pending, check again next tick
    }
    store.save();
    // 2. new batches for wallets that are due and not already in a pending batch
    const inFlight = new Set(Object.values(b.rounds).flatMap((r) => (r.batches || []).filter((x) => x.status === 'sent').flatMap((x) => x.items.map((i) => i[0]))));
    const due = Object.entries(b.owed).filter(([w, l]) => BigInt(l) >= BigInt(P.minLamports) && !inFlight.has(w));
    for (let i = 0; i < due.length; i += P.maxPerTx) {
      const items = due.slice(i, i + P.maxPerTx);
      if (dry()) { entry.batches.push({ status: 'dry-run', items, at: now() }); continue; }
      const prepared = await chain.prepare(items);            // signs, returns { sig, lastValid, send() }
      const bt = { status: 'sent', sig: prepared.sig, lastValid: prepared.lastValid, items, at: now() };
      entry.batches.push(bt); store.save();                    // record before sending
      try { await prepared.send(); } catch (e) { log('[payout] send ' + e.message); }
    }
    entry.status = entry.batches.some((x) => x.status === 'sent') ? 'sending' : dry() ? 'dry-run' : 'settled';
    store.save(); return entry;
  }

  async function onRoundClosed(round) {
    if (!active()) return null;
    try { await plan(round); return await settle(round.id); } catch (e) { log('[payout] ' + e.message); return null; }
  }
  async function tick() { if (!active()) return; const b = book(); for (const r of Object.values(b.rounds)) if (r.status === 'sending') await settle(r.round).catch((e) => log('[payout] ' + e.message)); }

  const pub = (e) => e && { round: e.round, status: e.status, reason: e.reason, dry: e.dry, pool: e.pool, voterPool: e.voterPool, opsLamports: e.opsLamports, dust: e.dust, voters: e.voters, nominator: e.nominator, shares: e.shares, batches: (e.batches || []).map((x) => ({ status: x.status, sig: x.sig || null, count: x.items.length })) };
  function status() {
    const b = book(); const last = Object.values(b.rounds).sort((x, y) => y.round - x.round)[0];
    return { enabled: active(), dryRun: dry(), shareBps: P.shareBps, nominatorBps: P.nominatorBps, opsBps: P.opsBps, minLamports: String(P.minLamports), dailyCapLamports: String(P.dailyCapLamports), distributor: chain && chain.address ? chain.address() : null, last: pub(last) || null };
  }
  const forRound = (r) => pub(book().rounds[r]) || null;
  const wallet = (w) => { const b = book(); return { wallet: w, owed: b.owed[w] || '0', history: b.history[w] || [] }; };
  return { split, plan, settle, onRoundClosed, tick, status, forRound, wallet, active };
}

// Real chain adapter (web3.js). Only built when a key is configured; the key never leaves this module.
function solanaChain(cfg) {
  const P = cfg.payout; if (!P.key && !P.address) return null;
  const web3 = require('@solana/web3.js'); const bs58 = (require('bs58').default || require('bs58'));
  let kp = null; try { if (P.key) kp = web3.Keypair.fromSecretKey(P.key.trim().startsWith('[') ? Uint8Array.from(JSON.parse(P.key)) : bs58.decode(P.key.trim())); } catch { kp = null; }
  const addr = kp ? kp.publicKey.toBase58() : P.address;
  const conn = new web3.Connection(P.rpc || cfg.rpc, 'confirmed');
  return {
    address: () => addr,
    canSend: () => !!kp,
    balance: async () => BigInt(await conn.getBalance(new web3.PublicKey(addr), 'confirmed')),
    blockHeight: () => conn.getBlockHeight('confirmed'),
    async status(sig) { const s = (await conn.getSignatureStatuses([sig])).value[0]; if (!s) return null; if (s.err) return 'failed'; return s.confirmationStatus === 'processed' ? null : 'confirmed'; },
    async prepare(items) {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new web3.Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight });
      for (const [w, l] of items) tx.add(web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new web3.PublicKey(w), lamports: BigInt(l) }));
      tx.sign(kp); const raw = tx.serialize();
      return { sig: bs58.encode(tx.signature), lastValid: lastValidBlockHeight, send: () => conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 }) };
    },
  };
}
module.exports = { createPayouts, solanaChain, split, SOL };
