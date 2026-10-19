// Round snapshot: a canonical, deterministic serialization of everything needed to recount a round.
// Same inputs always give the same bytes and the same sha256, so a future zero-knowledge (or plain)
// verifier can take the snapshot as its public input and prove: every signature is valid for its
// message, every weight is floor(sqrt(balance at close)), and the winner has the largest weight sum.
// Format v1 (JSON, keys in fixed order, arrays sorted, integers as decimal strings):
//   { v, round, startsAt, endsAt, mint, decimals, voteMinRaw, candidates: [id...] sorted,
//     votes: [[wallet, candidate, topic, message, signature, rawAtClose, weightInt]...] sorted by wallet,
//     totals: [[candidate, weightSum]...] sorted by candidate, winner, house }
const crypto = require('crypto');
const { toRaw } = require('./burns');
function snapshot({ cfg, round, bounds, candidates, votes, winner, house }) {
  const rows = Object.keys(votes).sort().map((w) => { const v = votes[w]; return [w, v.candidate, v.topic || '', v.message, v.signature, String(v.rawAtClose || '0'), String(v.weightInt || '0')]; });
  const sums = {}; for (const r of rows) sums[r[1]] = (sums[r[1]] || 0n) + BigInt(r[6]);
  const totals = Object.keys(sums).sort().map((c) => [c, sums[c].toString()]);
  const obj = { v: 1, round, startsAt: bounds.startsAt, endsAt: bounds.endsAt, mint: cfg.mint || '', decimals: cfg.decimals, voteMinRaw: toRaw(cfg.voteMin, cfg.decimals).toString(), candidates: candidates.map((c) => c.id).sort(), votes: rows, totals, winner, house: !!house };
  const json = JSON.stringify(obj);
  return { json, hash: crypto.createHash('sha256').update(json).digest('hex') };
}
module.exports = { snapshot };
