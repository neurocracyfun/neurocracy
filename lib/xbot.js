// The crowd-raised X account. Each round the account takes the winning feature mix as its
// personality, writes one post (topic from holder votes, else a fallback), and replies to a few
// mentions in character. Every output goes through 3 candidates -> filter -> pick, no hand edits.
// DRY_RUN=1 (default) only queues previews on the site. Posting needs DRY_RUN=0, X_POSTING_ENABLED=1
// and all four OAuth 1.0a keys.
const { clean, check, score } = require('./filter');
const oauth = require('./oauth1');
const { balanceOf } = require('./solana');
const API = 'https://api.x.com/2';
const { personasOf, roundText, voteShares } = require('./avatar');
function createXBot({ cfg, store, steer, budget, rounds, presets, avatar = null, now = () => Date.now(), fetchImpl = fetch, log = console.log }) {
  const D = store.data; const X = cfg.x;
  const keys = () => !!(X.appKey && X.appSecret && X.accessToken && X.accessSecret);
  const canPost = () => !X.dryRun && X.enabled && keys();
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const postedToday = () => D.xDay[day()] || 0;
  const mode = () => (canPost() ? 'live' : X.dryRun ? 'dry-run' : !X.enabled ? 'paused' : 'missing-keys');

  async function write(question, mix, kind) {
    const out = []; const rejected = [];
    for (let i = 0; i < X.candidates; i++) {
      try {
        const r = await budget.run('x', () => steer(question, mix, { seed: 16 + i, tokens: 72 }));
        const t = clean(r.steered, question); const c = check(t);
        if (c.ok) out.push({ text: t, share: r.share, s: score(t) }); else rejected.push({ text: t.slice(0, 300), why: c.why });
      } catch (e) { rejected.push({ text: '', why: ['steer-error: ' + e.message] }); }
    }
    out.sort((a, b) => b.s - a.s);
    return { pick: out[0] || null, rejected, kept: out.length };
  }

  // Image upload (POST /2/media/upload, multipart, OAuth 1.0a: multipart fields are not signed). Returns a media id.
  async function uploadMedia(file) {
    const url = API + '/media/upload'; const fs = require('fs'); const path = require('path');
    const ext = path.extname(file).slice(1).toLowerCase(); const type = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    const form = new FormData(); form.append('media', new Blob([fs.readFileSync(file)], { type }), path.basename(file)); form.append('media_category', 'tweet_image');
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: oauth.header('POST', url, {}, X) }, body: form, signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    const id = (j.data && (j.data.id || j.data.media_id_string)) || j.media_id_string;
    if (!r.ok || !id) throw new Error('media ' + r.status);
    return String(id);
  }

  async function send(text, replyTo, mediaIds) {
    const url = API + '/tweets';
    const body = { text }; if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo }; if (mediaIds && mediaIds.length) body.media = { media_ids: mediaIds };
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: oauth.header('POST', url, {}, X), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('x ' + r.status + ' ' + (j.title || j.detail || ''));
    return j.data && j.data.id;
  }

  async function publish(entry, replyTo, imageFile) {
    if (!entry.text) { entry.status = 'skipped'; return entry; }
    if (!canPost()) { entry.status = 'preview'; return entry; }
    if (postedToday() >= X.dailyCap) { entry.status = 'capped'; return entry; }
    let media = null;
    if (imageFile) { try { media = [await uploadMedia(imageFile)]; entry.mediaId = media[0]; } catch (e) { entry.mediaError = String(e.message).slice(0, 80); log('[x] media upload failed, posting text only: ' + entry.mediaError); } }
    try { entry.tweetId = await send(entry.text, replyTo, media); entry.status = 'posted'; D.xDay[day()] = postedToday() + 1; }
    catch (e) { entry.status = 'failed'; entry.error = String(e.message).slice(0, 120); }
    return entry;
  }

  function topicFor(round) {
    if (round.topic) return { topic: round.topic, source: 'holders' };
    const pool = require('../data/topics.json').fallback;
    const prev = D.rounds[round.id - 1];
    if (prev && prev.winner.name !== round.winner.name && round.id % 3 === 0) return { topic: `how it feels to stop being ${prev.winner.name.replace(/^The /, 'a ')} and become ${round.winner.name.replace(/^The /, 'a ')}`, source: 'previous round' };
    return { topic: pool[round.id % pool.length], source: 'fallback' };
  }

  async function roundPost(round) {
    if (D.posts.find((p) => p.kind === 'post' && p.round === round.id)) return null;
    const { topic, source } = topicFor(round);
    const q = `Write a short social media post about ${topic}. Use plain words, under 50 words.`;
    const w = await write(q, round.mix, 'post');
    const art = avatar ? avatar.artFor(round.id) : null;   // the round's full illustration, attached to the post
    const entry = { id: 'p' + round.id + '-' + now().toString(36), kind: 'post', round: round.id, persona: round.winner.name, mix: round.mix, topic, topicSource: source, text: roundText(personasOf(round, presets), presets, w.pick ? w.pick.text : '', voteShares(round, personasOf(round, presets)).map((x) => ({ ...x, c: (rounds.candidates ? rounds.candidates(round.id) : []).find((c) => c.id === x.id) }))), image: art ? require('path').basename(art) : null, share: w.pick ? w.pick.share : null, rejected: w.rejected, at: now() };
    await publish(entry, null, art);
    D.posts.unshift(entry); D.posts = D.posts.slice(0, 2000); store.save();
    return entry;
  }

  // Mentions are an owned read (GET /2/users/:id/mentions). Only polled when posting is possible.
  async function fetchMentions() {
    if (!canPost() || !X.userId) return [];
    const url = `${API}/users/${X.userId}/mentions`;
    const query = { max_results: '20', expansions: 'author_id', 'user.fields': 'username', 'tweet.fields': 'author_id,created_at' };
    if (D.mentions.sinceId) query.since_id = D.mentions.sinceId;
    const qs = new URLSearchParams(query).toString();
    const r = await fetchImpl(url + '?' + qs, { headers: { Authorization: oauth.header('GET', url, query, X) }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('mentions ' + r.status);
    const j = await r.json();
    const users = Object.fromEntries(((j.includes && j.includes.users) || []).map((u) => [u.id, u.username]));
    const list = (j.data || []).map((t) => ({ id: t.id, text: t.text, author: users[t.author_id] || '' }));
    if (j.meta && j.meta.newest_id) D.mentions.sinceId = j.meta.newest_id;
    return list;
  }

  async function replies(round, mentions) {
    const done = new Set(D.mentions.seen);
    const fresh = mentions.filter((m) => !done.has(m.id) && ![cfg.xHandle, cfg.botHandle].filter(Boolean).map((h) => String(h).toLowerCase()).includes(m.author.toLowerCase()));
    // holders first: X handle linked to a wallet (signed) that holds >= holderMin
    for (const m of fresh) {
      const wallet = D.links[m.author.toLowerCase()]; m.holder = false;
      if (wallet) { try { m.holder = (await balanceOf(cfg, wallet)) >= cfg.holderMin; } catch {} }
    }
    fresh.sort((a, b) => (b.holder - a.holder));
    const already = D.posts.filter((p) => p.kind === 'reply' && p.round === round.id).length;
    const out = [];
    for (const m of fresh.slice(0, Math.max(0, X.repliesPerRound - already))) {
      D.mentions.seen.push(m.id);
      const said = m.text.replace(/@\w+/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (said.length < 3) continue;
      const q = `Someone wrote to you: "${said}" Write a short friendly reply, under 40 words.`;
      const w = await write(q, round.mix, 'reply');
      const entry = { id: 'r' + m.id, kind: 'reply', round: round.id, persona: round.winner.name, mix: round.mix, inReplyTo: m.id, to: m.author, holder: m.holder, mention: said, text: w.pick ? w.pick.text : null, share: w.pick ? w.pick.share : null, rejected: w.rejected, at: now() };
      await publish(entry, m.id);
      D.posts.unshift(entry); out.push(entry);
    }
    D.mentions.seen = D.mentions.seen.slice(-3000); store.save();
    return out;
  }

  // Paid replies (burn-for-reply). The post itself is not fetched (that would be a paid X read);
  // the account answers in character. Same filter, DRY_RUN, kill switch and daily cap as everything else.
  // A capped job stays queued and is retried later; a job with no passing draft is marked as such.
  async function paidReplies(round, max = 2) {
    // jobs previewed during dry run are answered for real once the account goes live
    const jobs = (D.replyQueue || []).filter((j) => j.status === 'queued' || (canPost() && j.status === 'preview')).reverse().slice(0, max);
    for (const j of jobs) {
      if (canPost() && postedToday() >= X.dailyCap) break;
      const said = String(j.text || '').replace(/@\w+/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const q = said.length >= 3 ? `Someone wrote: "${said}" Write a short friendly reply in your own voice, under 40 words.` : 'Someone asked you to reply to their post. Write a short friendly reply in your own voice, under 40 words.';
      const w = await write(q, round.mix, 'reply');
      const entry = { id: 'pr' + j.tweetId, kind: 'reply', paid: true, round: round.id, persona: round.winner.name, mix: round.mix, inReplyTo: j.tweetId, to: j.author, holder: true, mention: j.text ? String(j.text).slice(0, 200) : null, text: w.pick ? w.pick.text : null, share: w.pick ? w.pick.share : null, rejected: w.rejected, at: now() };
      await publish(entry, j.tweetId);
      if (entry.status === 'capped') break;
      j.status = entry.status === 'posted' ? 'posted' : entry.status === 'preview' ? 'preview' : entry.status === 'skipped' ? 'no-draft-passed' : 'failed';
      j.postId = entry.id; j.doneAt = now();
      D.posts.unshift(entry); store.save();
    }
  }

  // One post read (GET /2/tweets/:id, a paid X read), cached: author and mentioned handles, for paid-reply eligibility.
  const looked = new Map();
  async function lookupPost(id) {
    if (looked.has(id)) return looked.get(id);
    if (!keys()) return null;
    const url = `${API}/tweets/${id}`; const query = { expansions: 'author_id', 'user.fields': 'username', 'tweet.fields': 'entities,author_id,text' };
    const r = await fetchImpl(url + '?' + new URLSearchParams(query), { headers: { Authorization: oauth.header('GET', url, query, X) }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) { looked.set(id, { missing: true }); return looked.get(id); }
    if (!r.ok) throw new Error('x lookup ' + r.status);
    const j = await r.json(); if (!j.data) { looked.set(id, { missing: true }); return looked.get(id); }
    const u = ((j.includes && j.includes.users) || []).find((x) => x.id === j.data.author_id);
    const v = { id, author: u ? u.username : '', mentions: ((j.data.entities && j.data.entities.mentions) || []).map((m) => String(m.username).toLowerCase()), text: String(j.data.text || '') };
    looked.set(id, v); if (looked.size > 5000) looked.clear(); return v;
  }

  let lastPoll = 0;
  async function tick() {
    const round = rounds.live(); if (!round) return;
    await roundPost(round);
    try { await paidReplies(round); } catch (e) { console.log('[x] paid replies:', e.message); }
    if (canPost() && now() - lastPoll > X.mentionsPollMin * 60e3) { lastPoll = now(); try { await replies(round, await fetchMentions()); } catch (e) { console.log('[x] mentions:', e.message); } }
  }
  const linkMessage = (handle, wallet) => `Neurocracy link X\nHandle: @${handle}\nWallet: ${wallet}`;
  const status = () => ({ mode: mode(), dryRun: X.dryRun, enabled: X.enabled, keys: keys(), dailyCap: X.dailyCap, postedToday: postedToday(), repliesPerRound: X.repliesPerRound, handle: cfg.xHandle });
  return { tick, roundPost, replies, paidReplies, write, status, linkMessage, canPost, lookupPost };
}
module.exports = { createXBot };
