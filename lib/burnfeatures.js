// Two burn-gated actions. Both are OFF by default and need a live mint.
// Burn amounts are USD-pegged: NC_NOMINATE_USD / NC_REPLY_USD divided by the live price, clamped to
// [min, max] whole tokens, and locked in a signed quote for NC_QUOTE_TTL_SEC. No price means no burns.
//  nominate: burn the quoted amount with memo "Neurocracy nominate <layer>/<index>" and the feature
//            joins the next ballot that has room (never lost to a full ballot). If it wins, the
//            nominator gets NC_NOMINATOR_BPS of that round's payout pool.
//  reply:    burn the quoted amount with memo "Neurocracy reply <tweet id>" and the X bot queues an
//            in-character reply to that post. Only for posts that mention the account, or that were written
//            by the X handle the requesting wallet linked (signed). Checked with one X read before any quote. Burns are final, there are no refunds.
const { verifyBurn } = require('./burns');
const { check } = require('./filter');
const { isAddress } = require('./solana');
const { defaultStrength } = require('./rounds');
const { tokensFor } = require('./price');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const nominateMemo = (layer, index) => `Neurocracy nominate ${layer}/${index}`;
const replyMemo = (tweetId) => `Neurocracy reply ${tweetId}`;
const tweetIdFrom = (url) => { const m = String(url || '').trim().match(/^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/); return m ? { user: m[1], id: m[2] } : null; };

function createBurnFeatures({ cfg, store, rounds, featureInfo, getTx, price, quotes, lookupPost, now = () => Date.now() }) {
  const D = store.data; const N = cfg.nominate; const R = cfg.replyBurn;
  async function priced(kind) {
    const C = kind === 'nominate' ? N : R; const p = price ? await price.get() : null;
    const amount = p ? tokensFor(C.usd, p.usd, C.min, C.max) : null;
    if (!amount) throw bad('burns are paused: no reliable price right now', 503);
    return { amount, usd: C.usd, priceUsd: p.usd, source: p.source, clamped: amount === C.min || amount === C.max };
  }
  const landedInTime = (r, q) => { if (r.blockTime && r.blockTime * 1000 > q.exp) throw bad('that burn landed after the quote expired, ask for a new quote', 410); };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const validFeature = (layer, index) => /^(9|20|31)-gemmascope-res-16k$/.test(layer) && Number.isInteger(index) && index >= 0 && index < 16384;
  const nomsIn = (r) => (D.candidates[r] || []).filter((c) => c.nominator).length;
  const slotFor = (id) => { let r = rounds.current() + 1; while (nomsIn(r) >= N.maxPerRound || (D.candidates[r] || []).some((c) => c.id === id)) r++; return r; };
  const blocked = (label) => { const c = check(label); return !c.ok && c.why.some((w) => /slur|group-target/.test(w)); };

  // checked before the wallet burns anything, so a bad feature never costs tokens
  async function quoteNomination(layer, index) {
    if (!N.enabled) throw bad('nominations are off', 409); if (!cfg.mint) throw bad('the token is not live yet', 409);
    index = Number(index); if (!validFeature(layer, index)) throw bad('unsupported feature');
    const label = await featureInfo(layer, index); if (!label) throw bad('Neuronpedia has no description for that feature');
    if (blocked(label)) throw bad('that feature is blocked by the content filter');
    const id = `f:${layer}:${index}`; const r = slotFor(id);
    const pr = await priced('nominate');
    const q = quotes.issue({ purpose: 'nominate', ref: `${layer}/${index}`, amount: pr.amount, usd: pr.usd, priceUsd: pr.priceUsd, source: pr.source });
    return { layer, index, label, round: r, memo: nominateMemo(layer, index), burn: pr.amount, usd: pr.usd, priceUsd: pr.priceUsd, source: pr.source, quote: q.quote, expiresAt: q.exp };
  }
  async function nominate(body) {
    const { wallet, layer, signature } = body; const index = Number(body.index);
    if (!N.enabled) throw bad('nominations are off', 409); if (!cfg.mint) throw bad('the token is not live yet', 409);
    if (!isAddress(wallet)) throw bad('bad wallet');
    if (!validFeature(layer, index)) throw bad('unsupported feature');
    const qt = quotes.open(body.quote, { purpose: 'nominate', ref: `${layer}/${index}` });   // amount comes from the signed quote
    const label = await featureInfo(layer, index); if (!label || blocked(label)) throw bad('that feature cannot be nominated');
    const q = { label };
    const br = await verifyBurn(cfg, D, { signature, wallet, minUi: qt.amount, memo: nominateMemo(layer, index), purpose: 'nominate', getTx });
    landedInTime(br, qt);
    const id = `f:${layer}:${index}`; const r = slotFor(id);   // recomputed after the await: never collides
    (D.candidates[r] ||= []).push({ id, name: q.label.slice(0, 48), note: `Nominated by burn, ${layer} #${index}`, features: [{ layer, index, label: q.label, strength: defaultStrength(layer) }], nominator: wallet, burnSig: signature });
    store.save();
    return { ok: true, id, round: r, label: q.label };
  }

  // a paid reply is allowed only to a post that mentions the account or was written by the wallet's linked handle
  async function eligible(t, wallet) {
    if (!isAddress(wallet)) throw bad('connect your wallet first');
    let p = null; try { p = lookupPost ? await lookupPost(t.id) : null; } catch { throw bad('could not check that post on X right now, try again later', 503); }
    if (!p) throw bad('paid replies need the live X account to check the post', 503);
    if (p.missing) throw bad('that post was not found on X');
    const me = String(cfg.xHandle).toLowerCase();
    if (p.author.toLowerCase() === me) throw bad('that is one of our own posts');
    if (p.mentions.includes(me)) return p;
    if (D.links[p.author.toLowerCase()] === wallet) return p;
    throw bad(`paid replies are only for posts that mention @${cfg.xHandle}, or posts by the X handle you linked to this wallet`);
  }
  async function quoteReply(url, wallet) {
    if (!R.enabled) throw bad('burn-for-reply is off', 409); if (!cfg.mint) throw bad('the token is not live yet', 409);
    const t = tweetIdFrom(url); if (!t) throw bad('paste a link to a post on x.com');
    await eligible(t, wallet);
    const pr = await priced('reply');
    const q = quotes.issue({ purpose: 'reply', ref: t.id, amount: pr.amount, usd: pr.usd, priceUsd: pr.priceUsd, source: pr.source });
    return { tweetId: t.id, memo: replyMemo(t.id), burn: pr.amount, usd: pr.usd, priceUsd: pr.priceUsd, source: pr.source, quote: q.quote, expiresAt: q.exp };
  }
  async function replyRequest({ wallet, url, signature, quote }) {
    if (!R.enabled) throw bad('burn-for-reply is off', 409); if (!cfg.mint) throw bad('the token is not live yet', 409);
    if (!isAddress(wallet)) throw bad('bad wallet');
    const t = tweetIdFrom(url); if (!t) throw bad('paste a link to a post on x.com');
    D.replyQueue ||= []; D.replyUse ||= {};
    const used = ((D.replyUse[day()] ||= {})[wallet] || 0);
    if (used >= R.perWalletPerDay) throw bad(`limit of ${R.perWalletPerDay} paid replies per wallet per day`, 429);
    if (D.replyQueue.some((q) => q.tweetId === t.id && q.status !== 'failed')) throw bad('that post already has a reply queued');
    const post = await eligible(t, wallet);   // checked again: links can change after the quote
    const qt = quotes.open(quote, { purpose: 'reply', ref: t.id });
    const br = await verifyBurn(cfg, D, { signature, wallet, minUi: qt.amount, memo: replyMemo(t.id), purpose: 'reply', getTx });
    landedInTime(br, qt);
    D.replyUse[day()][wallet] = used + 1;
    const job = { id: 'b' + t.id, tweetId: t.id, author: post.author, text: post.text.slice(0, 280), wallet, burnSig: signature, status: 'queued', at: now() };
    D.replyQueue.unshift(job); D.replyQueue = D.replyQueue.slice(0, 2000); store.save();
    return { ok: true, queued: job.id };
  }
  // live display amounts; a feature shows as paused when there is no price
  async function status() {
    let p = null; try { p = price && cfg.mint && (N.enabled || R.enabled) ? await price.get() : null; } catch {}
    const one = (C, on) => ({ enabled: on && !!cfg.mint, priced: !!p, usd: C.usd, min: C.min, max: C.max, burn: p ? tokensFor(C.usd, p.usd, C.min, C.max) : null });
    return { price: p ? { usd: p.usd, source: p.source } : null, nominate: { ...one(N, N.enabled), maxPerRound: N.maxPerRound }, reply: { ...one(R, R.enabled), perWalletPerDay: R.perWalletPerDay } };
  }
  return { quoteNomination, quoteReply, nominate, replyRequest, status, nominateMemo, replyMemo, tweetIdFrom };
}
module.exports = { createBurnFeatures, nominateMemo, replyMemo, tweetIdFrom };
