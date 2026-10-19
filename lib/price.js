// NCRACY price in USD for burn quotes. Never guesses: if no source answers, burn actions are disabled.
//   1. pump.fun bonding curve (before graduation): price = virtual SOL reserves / virtual token reserves,
//      times SOL/USD from Jupiter.
//   2. after graduation (curve complete or missing): Jupiter price API for the token,
//      falling back to the DexScreener pair with the most liquidity.
// Results are cached for PRICE_TTL (default 3 minutes).
const { rpc } = require('./solana');
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const WSOL = 'So11111111111111111111111111111111111111112';

function bondingCurveAddress(mint) {
  const { PublicKey } = require('@solana/web3.js');
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], new PublicKey(PUMP))[0].toBase58();
}
// layout: 8 byte discriminator, virtualTokenReserves u64, virtualSolReserves u64, realTokenReserves u64,
// realSolReserves u64, tokenTotalSupply u64, complete bool
function parseCurve(buf) {
  if (!buf || buf.length < 49) return null;
  const vTok = buf.readBigUInt64LE(8), vSol = buf.readBigUInt64LE(16), complete = buf[48] === 1;
  return { vTok, vSol, complete };
}
const curvePriceSol = (c, decimals) => (Number(c.vSol) / 1e9) / (Number(c.vTok) / 10 ** decimals);

function createPrice({ cfg, fetchImpl = fetch, now = () => Date.now(), rpcImpl = rpc }) {
  const ttl = cfg.price.ttlMs; let cache = null;
  const getJson = async (url) => { const r = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); };
  async function jupiter(ids) {
    const j = await getJson(`https://lite-api.jup.ag/price/v3?ids=${ids.join(',')}`);
    return Object.fromEntries(ids.map((id) => [id, j[id] && Number(j[id].usdPrice) > 0 ? Number(j[id].usdPrice) : null]));
  }
  async function dexscreener(mint) {
    const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const pairs = (j.pairs || []).filter((p) => p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint && Number(p.priceUsd) > 0);
    pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    return pairs[0] ? Number(pairs[0].priceUsd) : null;
  }
  async function fresh() {
    const mint = cfg.mint; if (!mint) return null;
    // 1. bonding curve
    try {
      const acc = await rpcImpl(cfg.rpc, 'getAccountInfo', [bondingCurveAddress(mint), { encoding: 'base64', commitment: 'confirmed' }]);
      const c = acc && acc.value && parseCurve(Buffer.from(acc.value.data[0], 'base64'));
      if (c && !c.complete && c.vTok > 0n) {
        const solUsd = (await jupiter([WSOL]).catch(() => ({})))[WSOL];
        if (solUsd) return { usd: curvePriceSol(c, cfg.decimals) * solUsd, source: 'pump.fun bonding curve', solUsd };
        return null;   // curve found but no SOL price: do not guess
      }
    } catch { /* fall through to DEX sources */ }
    // 2. DEX
    try { const p = (await jupiter([mint]))[mint]; if (p) return { usd: p, source: 'Jupiter' }; } catch {}
    try { const p = await dexscreener(mint); if (p) return { usd: p, source: 'DexScreener' }; } catch {}
    return null;
  }
  async function get() {
    if (cache && now() - cache.at < ttl) return cache.value;
    const value = await fresh(); cache = { value, at: now() }; return value;
  }
  return { get, _set: (v) => (cache = { value: v, at: now() }) };
}
// token amount for a USD target, rounded up to a whole token, then clamped
function tokensFor(usd, priceUsd, min, max) {
  if (!(priceUsd > 0)) return null;
  return Math.min(max, Math.max(min, Math.ceil(usd / priceUsd)));
}
module.exports = { createPrice, tokensFor, parseCurve, curvePriceSol, bondingCurveAddress, PUMP };
