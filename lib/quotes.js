// Signed burn quotes. The server prices the burn, then signs {purpose, ref, amount, exp} with HMAC so
// the amount cannot be changed by the client. A burn is accepted when it is >= the quoted amount, its
// memo matches the purpose and ref, it landed on chain before the quote expired, and it is submitted
// within a grace period after expiry (to allow for confirmation time).
const crypto = require('crypto');
const b64 = (s) => Buffer.from(s).toString('base64url');
function createQuotes({ secret, ttlMs = 5 * 60e3, graceMs = 10 * 60e3, now = () => Date.now() }) {
  const key = secret || crypto.randomBytes(32).toString('hex'); // random per boot if unset: quotes die on restart
  const mac = (p) => crypto.createHmac('sha256', key).update(p).digest('base64url');
  function issue({ purpose, ref, amount, usd, priceUsd, source }) {
    const body = { v: 1, purpose, ref: String(ref), amount: Number(amount), usd, priceUsd, source, iat: now(), exp: now() + ttlMs };
    const p = b64(JSON.stringify(body)); return { ...body, quote: p + '.' + mac(p) };
  }
  function open(token, { purpose, ref }) {
    const [p, sig] = String(token || '').split('.');
    if (!p || !sig) throw Object.assign(new Error('missing quote, ask for a new one'), { status: 400 });
    const a = Buffer.from(mac(p)), b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('invalid quote'), { status: 400 });
    const q = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (q.purpose !== purpose || q.ref !== String(ref)) throw Object.assign(new Error('that quote is for something else'), { status: 400 });
    if (now() > q.exp + graceMs) throw Object.assign(new Error('that quote expired, ask for a new one'), { status: 410 });
    return q;
  }
  return { issue, open, ttlMs, graceMs };
}
module.exports = { createQuotes };
