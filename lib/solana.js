// Server-side Solana reads. Balances come from getTokenAccountsByOwner filtered by mint, which
// covers Token-2022 (pump.fun) and classic SPL accounts alike.
const nacl = require('tweetnacl');
const bs58 = (require('bs58').default || require('bs58'));
async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const j = await r.json(); if (j.error) throw new Error('rpc: ' + (j.error.message || 'error')); return j.result;
}
const cache = new Map();
async function balanceOf(cfg, owner, { fresh = false } = {}) {
  if (!cfg.mint || !cfg.rpc) return 0;
  const k = owner; const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.t < 60e3) return hit.v;
  const res = await rpc(cfg.rpc, 'getTokenAccountsByOwner', [owner, { mint: cfg.mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  let v = 0; for (const a of res.value || []) v += Number(a.account.data.parsed.info.tokenAmount.uiAmountString || 0);
  cache.set(k, { v, t: Date.now() }); return v;
}
function isAddress(s) { try { return typeof s === 'string' && bs58.decode(s).length === 32; } catch { return false; } }
function verify(message, sigB58, owner) {
  try { return nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(sigB58), bs58.decode(owner)); } catch { return false; }
}
module.exports = { rpc, balanceOf, isAddress, verify, _cache: cache };
