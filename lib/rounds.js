// 30-minute vote rounds. Votes are wallet-signed messages; weight = sqrt(token balance),
// re-read from chain when the round closes, so a wallet that sold before close loses its weight.
const { balanceOf, balanceInfo, isqrt, verify, isAddress } = require('./solana');
const { snapshot } = require('./snapshot');
const crypto = require('crypto');
const LIBRARY = ['owl', 'cat', 'pirate', 'degen', 'dino', 'space', 'ocean', 'chef', 'ghost', 'bard', 'lord', 'romantic'];
function createRounds({ cfg, store, presets, now = () => Date.now() }) {
  const closeReads = {};
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
    // read every balance at once (not one after another), so moving tokens between wallets during the read is not double counted
    // Bounded concurrency plus retries with backoff: an RPC 429 at close must not silently zero a voter. If some balances
    // are still unreadable the close is retried on the next tick (CLOSE_TRIES times) before they finally count as zero.
    // Reads are paced to NC_RPC_RPS so a free RPC plan (Helius free is about 10 RPS) is not flooded, and balances already
    // read are kept across retries of the same close.
    const reads = (closeReads[r] ||= {}); const ws = Object.keys(votes); const conc = Math.max(1, cfg.closeConcurrency || 8); const rps = Math.max(1, cfg.rpcRps || 8);
    const read = async (w) => { for (let k = 0; k < 4; k++) { try { return await balanceInfo(cfg, w, { fresh: true }); } catch { await sleep(250 * 2 ** k); } } return null; };
    const todo = ws.filter((w) => !reads[w]);
    for (let i = 0; i < todo.length; i += conc) { const t0 = Date.now(); await Promise.all(todo.slice(i, i + conc).map(async (w) => { const b = await read(w); if (b) reads[w] = b; })); const wait = (conc / rps) * 1000 - (Date.now() - t0); if (wait > 0 && i + conc < todo.length) await sleep(wait); }
    const unread = ws.filter((w) => !reads[w]).length;
    D.closeTries ||= {};
    if (unread && (D.closeTries[r] = (D.closeTries[r] || 0) + 1) < CLOSE_TRIES) throw new Error(`round ${r}: ${unread} balances unreadable, close retried next tick`);
    delete D.closeTries[r]; delete closeReads[r];
    for (const w of ws) {
      const b = reads[w] || { ui: 0, raw: 0n };
      const ok = b.ui >= cfg.voteMin;
      votes[w].balanceAtClose = b.ui; votes[w].rawAtClose = b.raw.toString();
      votes[w].weightInt = ok ? isqrt(b.raw).toString() : '0';   // exact weight used for payouts and the snapshot
      weights[w] = ok ? Number(isqrt(b.raw)) / 10 ** (cfg.decimals / 2) : 0;   // same integer weight as payouts and the tally proof
    }
    const { t, topics } = tally(r, weights);
    const cands = candidates(r);
    const order = Object.fromEntries(cands.map((c, i) => [c.id, i]));   // ties go to the earlier ballot entry, deterministically
    const ranked = Object.entries(t).sort((a, b) => b[1] - a[1] || (order[a[0]] ?? 1e9) - (order[b[0]] ?? 1e9));
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
      // nobody voted: a random library persona, never the same as the previous round. The seed is the round number,
      // so a restart or a retried close always lands on the same pick.
      const prev = (() => { for (let i = r - 1; i > 0 && i > r - 500; i--) if (D.rounds[i]) return D.rounds[i].winner.id; return null; })();
      let pc = presetCands().filter((c) => LIBRARY.includes(c.id.slice(2))); if (!pc.length) pc = presetCands();
      const pool = pc.filter((c) => c.id !== prev).length ? pc.filter((c) => c.id !== prev) : pc;
      const h = crypto.createHash('sha256').update('neurocracy-random-round-' + r).digest();
      winner = pool[h.readUInt32BE(0) % pool.length]; mix = winner.features.map((f) => ({ ...f }));
    }
    const topTopic = Object.entries(topics).sort((a, b) => b[1] - a[1])[0];
    const nominator = (cands.find((c) => c.id === winner.id) || {}).nominator || null;
    D.rounds[r] = { id: r, ...bounds(r), closedAt: now(), winner: { id: winner.id, name: winner.name }, mix, tally: t, topic: topTopic ? topTopic[0] : null, voters: Object.keys(votes).length, unreadAtClose: unread, house: !ranked.length, random: !ranked.length || undefined, nominator };
    // deterministic snapshot of every signed vote and its exact weight, hashed for a future tally proof
    const snap = snapshot({ cfg, round: r, bounds: bounds(r), candidates: cands, votes, winner: winner.id, house: !ranked.length });
    D.snapshots ||= {}; D.snapshots[r] = snap.json; D.rounds[r].snapshotHash = snap.hash;
    store.save();
    return D.rounds[r];
  }
  const live = () => { const r = current(); for (let i = r - 1; i > 0 && i > r - 500; i--) if (D.rounds[i]) return D.rounds[i]; return null; };
  // While a round is open, per-candidate and per-topic weights stay hidden (no herding, no checkable bribes):
  // only participation is public. Everything is revealed at close in the Hall, the votes API and the snapshot.
  function publicRound() {
    const r = current(); const { t, topics } = tally(r); const cast = Object.values(t).reduce((a, b) => a + b, 0);
    return { round: r, ...bounds(r), now: now(), hidden: true, candidates: candidates(r).map((c) => ({ id: c.id, name: c.name, note: c.note, features: c.features })),
      topics: [], topicsSuggested: Object.keys(topics).length, voters: Object.keys(D.votes[r] || {}).length, weightCast: Math.round(cast), live: live() };
  }
  return { current, bounds, candidates, vote, submit, close, live, publicRound, voteMessage, tally };
}
const CLOSE_TRIES = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defaultStrength = (layer) => (layer.startsWith('9-') ? 60 : 40);
const bad = (m) => Object.assign(new Error(m), { status: 400 });
module.exports = { createRounds, defaultStrength };
