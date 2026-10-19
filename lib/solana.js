// Server-side Solana reads. Balances come from getTokenAccountsByOwner filtered by mint, which
// covers Token-2022 (pump.fun) and classic SPL accounts alike.
const nacl = require('tweetnacl');
const bs58 = (require('bs58').default || require('bs58'));
async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const j = await r.json(); if (j.error) throw new Error('rpc: ' + (j.error.message || 'error')); return j.result;
}
const cache = new Map();
// { ui, raw }: ui is a Number for display and thresholds, raw is the exact BigInt base-unit sum.
async function balanceInfo(cfg, owner, { fresh = false } = {}) {
  if (!cfg.mint || !cfg.rpc) return { ui: 0, raw: 0n };
  const k = owner; const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.t < 60e3) return hit.v;
  const res = await rpc(cfg.rpc, 'getTokenAccountsByOwner', [owner, { mint: cfg.mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  let ui = 0; let raw = 0n;
  for (const a of res.value || []) { const t = a.account.data.parsed.info.tokenAmount; ui += Number(t.uiAmountString || 0); raw += BigInt(t.amount || 0); }
  const v = { ui, raw }; cache.set(k, { v, t: Date.now() }); return v;
}
const balanceOf = async (cfg, owner, o) => (await balanceInfo(cfg, owner, o)).ui;
// integer square root (floor) for exact, reproducible vote weights
function isqrt(n) { n = BigInt(n); if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; }
function isAddress(s) { try { return typeof s === 'string' && bs58.decode(s).length === 32; } catch { return false; } }
function verify(message, sigB58, owner) {
  try { return nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(sigB58), bs58.decode(owner)); } catch { return false; }
}
module.exports = { rpc, balanceOf, balanceInfo, isqrt, isAddress, verify, _cache: cache };
