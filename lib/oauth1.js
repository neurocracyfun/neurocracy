// OAuth 1.0a (HMAC-SHA1) signing for X API v2 user-context calls. Keys come from env only.
const crypto = require('crypto');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function header(method, url, query, k) {
  const o = { oauth_consumer_key: k.appKey, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: k.accessToken, oauth_version: '1.0' };
  const all = { ...query, ...o };
  const base = [method.toUpperCase(), enc(url), enc(Object.keys(all).sort().map((x) => enc(x) + '=' + enc(all[x])).join('&'))].join('&');
  o.oauth_signature = crypto.createHmac('sha1', enc(k.appSecret) + '&' + enc(k.accessSecret)).update(base).digest('base64');
  return 'OAuth ' + Object.keys(o).sort().map((x) => enc(x) + '="' + enc(o[x]) + '"').join(', ');
}
module.exports = { header, enc };
