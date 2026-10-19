// 30-minute vote rounds. Votes are wallet-signed messages; weight = sqrt(token balance),
// re-read from chain when the round closes, so a wallet that sold before close loses its weight.
const { balanceOf, balanceInfo, isqrt, verify, isAddress } = require('./solana');
const { snapshot } = require('./snapshot');
function createRounds({ cfg, store, presets, now = () => Date.now() }) {
  const D = store.data; const len = cfg.roundMinutes * 60e3;
  const current = () => Math.floor((now() - cfg.roundEpoch) / len) + 1;
  const bounds = (r) => ({ startsAt: cfg.roundEpoch + (r - 1) * len, endsAt: cfg.roundEpoch + r * len });
  const presetCands = () => presets.list().map((p) => ({ id: 'p:' + p.id, name: p.name, note: p.note, features: p.features }));
  const candidates = (r) => [...presetCands(), ...((D.candidates[r] || []))];
  const voteMessage = ({ round, candidate, topic, wallet }) => `Neurocracy vote\nRound: ${round}\nCandidate: ${candidate}\nTopic: ${topic || '-'}\nWallet: ${wallet}`;
  const cleanTopic = (t) => String(t || '').replace(/[^\p{L}\p{N} .,'?!-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);

  async function vote(body) {
    const { wallet, candidate, signature } = body; const round = Number(body.round); const topic = cleanTopic(body.topic);
    if (!isAddress(wallet)) throw bad('bad wallet');
    if (round !== current()) throw bad('round is closed, refresh');
    if (!candidates(round).find((c) => c.id === candidate)) throw bad('unknown candidate');
    const msg = voteMessage({ round, candidate, topic, wallet });
    if (!verify(msg, signature, wallet)) throw bad('signature does not match');
    const bal = await balanceOf(cfg, wallet, { fresh: true });
    if (bal < cfg.voteMin) throw bad(`hold at least ${cfg.voteMin} ${cfg.ticker} to vote`);
    (D.votes[round] ||= {})[wallet] = { candidate, topic, signature, message: msg, balanceAtVote: bal, t: now() };
    store.save();
    return { ok: true, weight: Math.sqrt(bal) };
  }

  async function submit(body, featureInfo) {
    const { wallet, signature, layer } = body; const index = Number(body.index); const round = Number(body.round);
    if (!isAddress(wallet)) throw bad('bad wallet');
    if (round !== current()) throw bad('round is closed, refresh');
    if (!/^(9|20|31)-gemmascope-res-16k$/.test(layer) || !Number.isInteger(index) || index < 0 || index >= 16384) throw bad('unsupported feature');
    const msg = `Neurocracy feature\nRound: ${round}\nFeature: ${layer}/${index}\nWallet: ${wallet}`;
    if (!verify(msg, signature, wallet)) throw bad('signature does not match');
    const bal = await balanceOf(cfg, wallet, { fresh: true });
    if (bal < cfg.holderMin) throw bad(`submitting a feature needs ${cfg.holderMin.toLocaleString('en-US')} ${cfg.ticker}`);
    const list = (D.candidates[round] ||= []);
    const id = `f:${layer}:${index}`;
    if (list.find((c) => c.id === id)) return { ok: true, id };
    if (list.length >= 12) throw bad('this round already has 12 community features');
    if (list.filter((c) => c.by === wallet).length >= 2) throw bad('two submissions per wallet per round');
    const label = (await featureInfo(layer, index)) || `feature ${index}`;
    list.push({ id, name: label.slice(0, 48), note: `Community pick, ${layer} #${index}`, features: [{ layer, index, label, strength: defaultStrength(layer) }], by: wallet });
    store.save();
    return { ok: true, id };
  }

  function tally(r, weights) {
    const t = {}; const topics = {};
    for (const [w, v] of Object.entries(D.votes[r] || {})) {
      const wt = weights ? (weights[w] || 0) : Math.sqrt(v.balanceAtVote || 0);
      if (!wt) continue;
      t[v.candidate] = (t[v.candidate] || 0) + wt;
      if (v.topic && v.topic !== '-') topics[v.topic.toLowerCase()] = (topics[v.topic.toLowerCase()] || 0) + wt;
    }
    return { t, topics };
  }

  async function close(r) {
    if (D.rounds[r]) return D.rounds[r];
    const votes = D.votes[r] || {}; const weights = {};
    for (const w of Object.keys(votes)) {
      let b = { ui: 0, raw: 0n }; try { b = await balanceInfo(cfg, w, { fresh: true }); } catch { /* unreadable at close counts as zero */ }
      const ok = b.ui >= cfg.voteMin;
      votes[w].balanceAtClose = b.ui; votes[w].rawAtClose = b.raw.toString();
      votes[w].weightInt = ok ? isqrt(b.raw).toString() : '0';   // exact weight used for payouts and the snapshot
      weights[w] = ok ? Math.sqrt(b.ui) : 0;
    }
    const { t, topics } = tally(r, weights);
    const cands = candidates(r);
    const ranked = Object.entries(t).sort((a, b) => b[1] - a[1]);
    let winner; let mix;
    if (ranked.length) {
      winner = cands.find((c) => c.id === ranked[0][0]);
      const top = ranked[0][1];
      mix = winner.features.map((f) => ({ ...f }));
      for (const [id, w] of ranked.slice(1)) {
        if (mix.length >= 3 || w < top * 0.5) break;
        const c = cands.find((x) => x.id === id); if (!c) continue;
        for (const f of c.features) if (mix.length < 3) mix.push({ ...f, strength: Math.round(f.strength * (w / top) * 0.8) });
      }
    } else {
      // nobody voted: the house rotates through the presets
      const pc = presetCands(); winner = pc[(r - 1) % pc.length]; mix = winner.features.map((f) => ({ ...f }));
    }
    const topTopic = Object.entries(topics).sort((a, b) => b[1] - a[1])[0];
    const nominator = (cands.find((c) => c.id === winner.id) || {}).nominator || null;
    D.rounds[r] = { id: r, ...bounds(r), closedAt: now(), winner: { id: winner.id, name: winner.name }, mix, tally: t, topic: topTopic ? topTopic[0] : null, voters: Object.keys(votes).length, house: !ranked.length, nominator };
    // deterministic snapshot of every signed vote and its exact weight, hashed for a future tally proof
    const snap = snapshot({ cfg, round: r, bounds: bounds(r), candidates: cands, votes, winner: winner.id, house: !ranked.length });
    D.snapshots ||= {}; D.snapshots[r] = snap.json; D.rounds[r].snapshotHash = snap.hash;
    store.save();
    return D.rounds[r];
  }
  const live = () => { const r = current(); for (let i = r - 1; i > 0 && i > r - 500; i--) if (D.rounds[i]) return D.rounds[i]; return null; };
  function publicRound() {
    const r = current(); const { t, topics } = tally(r);
    return { round: r, ...bounds(r), now: now(), candidates: candidates(r).map((c) => ({ id: c.id, name: c.name, note: c.note, features: c.features, weight: Math.round((t[c.id] || 0) * 100) / 100 })),
      topics: Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([topic, w]) => ({ topic, weight: Math.round(w * 100) / 100 })),
      voters: Object.keys(D.votes[r] || {}).length, live: live() };
  }
  return { current, bounds, candidates, vote, submit, close, live, publicRound, voteMessage, tally };
}
const defaultStrength = (layer) => (layer.startsWith('9-') ? 60 : 40);
const bad = (m) => Object.assign(new Error(m), { status: 400 });
module.exports = { createRounds, defaultStrength };
