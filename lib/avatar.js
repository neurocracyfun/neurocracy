// Round avatar: after each round closes, the bot account (NC_BOT_HANDLE, keys X_APP_KEY etc.) takes the face of the winning persona(s), and the
// round post uses roundText ("This round's vote: ... So right now I am ..."), used by xbot. The bio is fixed and set by hand.
// One library persona uses a pre-made square image (public/img/avatars/{id}.png). A mix of personas gets a
// pre-drawn hybrid from public/img/hybrids (all 66 two-persona pairs, names in names.json). NC_IMAGE_PROVIDER is optional:
// only a 3+ persona mix can use it; without it that mix shows the top-weighted persona's library image.
// OFF by default (NC_AVATAR=0). Under DRY_RUN nothing is sent to X and no image API is called unless
// NC_AVATAR_GEN_IN_DRY=1. Keys come from env only and are never logged.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const oauth = require('./oauth1');

const LIBRARY = ['owl', 'cat', 'pirate', 'degen', 'dino', 'space', 'ocean', 'chef', 'ghost', 'bard', 'lord', 'romantic'];
// what each persona looks like in a drawing (used for hybrids)
const SUBJECT = { owl: 'a barn owl', cat: 'a tabby cat', pirate: 'a ship captain with a spyglass', degen: 'a hooded crypto trader hugging a laptop',
  dino: 'a tyrannosaurus skull with ferns', space: 'an astronomer with a brass telescope', ocean: 'an octopus with waves and a nautilus shell',
  chef: 'a chef in a tall hat', ghost: 'a ghost under a white sheet holding a candle', bard: 'a bard playing a lute',
  lord: 'a powdered wig lord in ermine holding a quill', romantic: 'a rose and a wax sealed letter' };
const DEFAULT_PERSONA = 'The Octopus Chef';
const DEFAULT_COMBO = 'chef+ocean';
// hand-named hybrids; any other mix lists the personas
// display names for every two-persona hybrid, keyed by sorted combo ('chef+ocean' -> 'The Octopus Chef').
// Ships with the pre-drawn library in public/img/hybrids, so a two-persona round needs no image API.
const HYBRID_NAMES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'hybrids', 'names.json'), 'utf8')); } catch { return { 'chef+ocean': 'The Octopus Chef' }; } })();
const X1 = 'https://api.x.com/1.1';

function promptFor(ids) {
  const subj = ids.map((i) => SUBJECT[i] || i);
  return 'A single hand drawn character portrait that fuses ' + subj.join(' and ') + ' into one creature or person, for example an octopus chef is an octopus wearing a chef hat. '
    + 'Landscape 4:3 composition, subject centered so a square center crop also works, head and shoulders. Style: wobbly hand drawn ink lines, sparse loose hatching, visible paper grain, '
    + 'light ochre and sage watercolor wash, cream paper background #f3f0e8, lots of empty paper around the subject. '
    + 'No text, no letters, no logos, no frame, no border.';
}

// Image providers. Each returns { buf, ext }.
const providers = {
  async openai({ prompt, key, model, fetchImpl }) {
    // 1536x1024 (3:2) is the closest gpt-image-1 size to the 4:3 card illustrations
    const r = await fetchImpl('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'gpt-image-1', prompt, size: '1536x1024', quality: 'medium', output_format: 'jpeg', output_compression: 85, n: 1 }), signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data || !j.data[0] || !j.data[0].b64_json) throw new Error('openai image ' + r.status);
    return { buf: Buffer.from(j.data[0].b64_json, 'base64'), ext: 'jpg' };
  },
  async xai({ prompt, key, model, fetchImpl }) {
    const r = await fetchImpl('https://api.x.ai/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'grok-imagine-image', prompt, n: 1, aspect_ratio: '3:2', response_format: 'b64_json' }), signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data || !j.data[0] || !j.data[0].b64_json) throw new Error('xai image ' + r.status);
    return { buf: Buffer.from(j.data[0].b64_json, 'base64'), ext: 'jpg' };
  },
};

// Which library personas a round's mix contains, in mix order (winner first).
function personasOf(round, presets) {
  const out = [];
  if (!presets || !presets.list) return out;
  const byFeat = new Map(); for (const p of presets.list()) for (const f of p.features || []) byFeat.set(f.layer + '/' + f.index, p.id);
  for (const f of round.mix || []) { const id = byFeat.get(f.layer + '/' + f.index); if (id && LIBRARY.includes(id) && !out.includes(id)) out.push(id); }
  return out;
}
const comboKey = (ids) => [...ids].sort().join('+');
// Round post format (exact):
//   This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. {optional model line} Got a question or something you want me to do?
// Must fit max chars (X: 280). Shortening order: drop the model line, then list fewer personas
// ('The Owl, The Cat and 3 more'). The vote line and the closing question are never dropped.
const SHORT = { owl: 'Owl', cat: 'Cat', pirate: 'Pirate', degen: 'Degen', dino: 'Fossil', space: 'Astronomer', ocean: 'Octopus', chef: 'Chef', ghost: 'Ghost', bard: 'Bard', lord: 'Lord', romantic: 'Romantic' };
const CLOSER = 'Got a question or something you want me to do?';
// vote shares by candidate, largest first; a round nobody voted on counts as 100% for the persona(s) it wears
function voteShares(round, ids = []) {
  const t = (round && round.tally) || {}; const total = Object.values(t).reduce((a, b) => a + b, 0);
  if (!total) return ids.length ? [{ id: 'p:' + ids[0], pct: 100 }] : [];
  // largest remainder: floors first, then the leftover points go to the biggest fractions, so the shares always sum to 100
  const rows = Object.entries(t).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([id, w], i) => { const raw = (w / total) * 100; return { id, pct: Math.floor(raw), rem: raw - Math.floor(raw), i }; });
  let left = 100 - rows.reduce((a, r) => a + r.pct, 0);
  for (const r of [...rows].sort((a, b) => b.rem - a.rem || a.i - b.i)) { if (left <= 0) break; r.pct += 1; left -= 1; }
  return rows.sort((a, b) => b.pct - a.pct || a.i - b.i).map(({ id, pct }) => ({ id, pct })).filter((x) => x.pct > 0);
}
function shortName(id, c) {
  const k = String(id).startsWith('p:') ? String(id).slice(2) : null;
  return (k && SHORT[k]) || (c && c.name ? String(c.name).replace(/^The /, '') : 'Community pick');
}
// X display name for the round (max 50): single 'The Owl', pair from names.json, 3+ 'The Owl and friends'.
function displayName(ids, presets) {
  const nm = (i) => (presets.find(i) || {}).name || i;
  const n = !ids.length ? DEFAULT_PERSONA : ids.length === 1 ? nm(ids[0]) : ids.length === 2 ? (HYBRID_NAMES[comboKey(ids)] || nm(ids[0]) + ' and ' + nm(ids[1]).replace(/^The /, '')) : nm(ids[0]) + ' and friends';
  return n.slice(0, 50).trim();
}
function roundText(ids, presets, body, shares = [], max = 280) {
  const nm = (i) => (presets.find(i) || {}).name || i;
  const names = !ids.length ? [DEFAULT_PERSONA] : HYBRID_NAMES[comboKey(ids)] ? [HYBRID_NAMES[comboKey(ids)]] : ids.map(nm);
  const join = (l) => (l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l[0]);
  const vote = shares === 'random' ? "This round's vote: nobody voted, so I was picked at random." : "This round's vote: " + (shares.length ? shares.map((x) => x.pct + '% ' + shortName(x.id, x.c)).join(', ') : '100% ' + (ids.length ? ids.map((i) => SHORT[i] || i).join(', ') : 'Octopus, Chef')) + '.';
  let line = String(body || '').replace(/\s+/g, ' ').trim();
  if (line.endsWith(CLOSER)) line = line.slice(0, -CLOSER.length).trim();
  const build = (n, withLine) => [vote, 'So right now I am ' + (n === names.length ? join(names) : names.slice(0, n).join(', ') + ' and ' + (names.length - n) + ' more') + '.', withLine && line ? line : '', CLOSER].filter(Boolean).join(' ');
  let out = build(names.length, true); if (out.length <= max) return out;
  for (let n = names.length; n > 0; n--) { out = build(n, false); if (out.length <= max) return out; }
  return out;
}

function createAvatar({ cfg, store, presets, now = () => Date.now(), fetchImpl = fetch, env = process.env, log = console.log, publicDir = path.join(__dirname, '..', 'public') }) {
  const D = store.data; const X = cfg.x;
  const on = /^(1|true|yes|on)$/i.test(env.NC_AVATAR || '0');
  const rename = on && !/^(0|false|no|off)$/i.test(env.NC_BOT_RENAME || '1');   // display name follows the avatar, bio is never touched
  const genInDry = /^(1|true|yes|on)$/i.test(env.NC_AVATAR_GEN_IN_DRY || '0');
  const minMs = (Number(env.NC_AVATAR_MIN_MINUTES) || 30) * 60e3;
  const dailyMax = env.NC_AVATAR_DAILY_MAX === undefined || env.NC_AVATAR_DAILY_MAX === '' ? 24 : Number(env.NC_AVATAR_DAILY_MAX);
  const provider = (env.NC_IMAGE_PROVIDER || '').toLowerCase(); const imgKey = env.NC_IMAGE_API_KEY || ''; const imgModel = env.NC_IMAGE_MODEL || '';
  const cacheDir = env.NC_AVATAR_DIR || path.join(path.dirname(path.resolve(cfg.db)), 'avatars');
  const keys = () => !!(X.appKey && X.appSecret && X.accessToken && X.accessSecret);
  const dry = () => !!X.dryRun;
  const A = () => (D.avatar ||= { current: null, at: 0, days: {}, rounds: {} });
  const day = () => new Date(now()).toISOString().slice(0, 10);

  const libFile = (id) => { for (const e of ['png', 'jpg']) { const f = path.join(publicDir, 'img', 'avatars', id + '.' + e); if (fs.existsSync(f)) return f; } return null; };
  // seeded hybrids ship in public/img/hybrids, generated ones live on the data disk
  const cacheFile = (key) => { for (const d of [path.join(publicDir, 'img', 'hybrids'), cacheDir]) for (const e of ['jpg', 'png', 'webp']) { const f = path.join(d, key + '.' + e); if (fs.existsSync(f)) return f; } return null; };
  // full 4:3 illustration for the round post (not the square avatar crop)
  const mindFile = (id) => { for (const e of ['webp', 'jpg', 'png']) { const f = path.join(publicDir, 'img', 'minds', id + '.' + e); if (fs.existsSync(f)) return f; } return null; };
  const urlFor = (file) => { if (!file) return null; const rel = path.relative(publicDir, file); return !rel.startsWith('..') && !path.isAbsolute(rel) ? '/' + rel.split(path.sep).map(encodeURIComponent).join('/') : '/api/avatar/' + encodeURIComponent(path.basename(file)); };

  const canGen = () => !!(providers[provider] && imgKey);
  // which personas the round's picture shows: 1 or 2 use the pre-drawn library; 3+ only get a generated hybrid
  // when an image provider is configured, otherwise the top-weighted (winning) persona's library image
  const pictured = (ids) => (ids.length > 2 && !canGen() ? ids.slice(0, 1) : ids);

  async function hybrid(ids) {
    const key = comboKey(ids); const hit = cacheFile(key);
    if (hit) return { file: hit, cached: true };
    if (dry() && !genInDry) { log('[avatar] dry-run: would generate ' + key); return { file: null, skipped: 'dry-run' }; }
    const fn = providers[provider];
    if (!fn || !imgKey) return { file: null, skipped: 'no image provider' };
    const { buf, ext } = await fn({ prompt: promptFor(ids), key: imgKey, model: imgModel, fetchImpl });
    fs.mkdirSync(cacheDir, { recursive: true });
    const f = path.join(cacheDir, key + '.' + ext); fs.writeFileSync(f, buf);
    const s = A(); (s.generated ||= []).push({ key, at: now(), provider }); store.save();
    log('[avatar] generated ' + key + ' via ' + provider);
    return { file: f, cached: false };
  }

  async function xPost(endpoint, params) {
    const url = X1 + endpoint;
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: oauth.header('POST', url, params, X), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Object.entries(params).map(([k, v]) => oauth.enc(k) + '=' + oauth.enc(v)).join('&'), signal: AbortSignal.timeout(30000) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('x ' + endpoint + ' ' + r.status + ' ' + ((j.errors && j.errors[0] && j.errors[0].message) || j.error || '')); }
    return true;
  }

  async function onRoundClosed(round) {
    if (!round) return { skipped: 'no round' };
    if (!on) { const a = A(); if (!a.rounds[round.id]) { const ids = personasOf(round, presets); const pic = pictured(ids); a.rounds[round.id] = { key: ids.length ? comboKey(ids) : 'none', personas: ids, url: null, art: pic.length === 1 ? mindFile(pic[0]) : cacheFile(pic.length ? comboKey(pic) : DEFAULT_COMBO) }; } return { skipped: 'off' }; }
    const s = A(); const ids = personasOf(round, presets); const key = ids.length ? comboKey(ids) : 'none';
    // the round's picture, kept even when the X profile is not changed, so the site can show this round's mind
    let file = null; let art = null;
    const pic = pictured(ids);
    try { if (pic.length === 1) { file = libFile(pic[0]); art = mindFile(pic[0]); } else if (pic.length > 1) { file = art = (await hybrid(pic)).file; } else { file = libFile('default'); art = cacheFile(DEFAULT_COMBO); } }
    catch (e) { log('[avatar] image failed: ' + e.message); }
    s.rounds[round.id] = { key, personas: ids, url: urlFor(file, key, ids.length <= 1), art };
    const old = Object.keys(s.rounds).map(Number).sort((a, b) => a - b); while (old.length > 500) delete s.rounds[old.shift()];
    store.save();
    if (s.current === key) return { skipped: 'same' };
    // a round close always updates the profile (voted, random or no-vote rounds alike); the min interval only guards
    // against changes faster than the round length, so it never blocks a normal round or one after a manual swap
    if (now() - (s.at || 0) < Math.min(minMs, (Number(cfg.roundMinutes) || 30) * 60e3 / 2)) return { skipped: 'interval' };
    if ((s.days[day()] || 0) >= dailyMax) return { skipped: 'daily cap' };
    if (!file) return { skipped: 'no image' };
    if (dry()) { log('[avatar] dry-run: would set avatar to ' + key + (rename ? ' and name to ' + displayName(ids, presets) : '')); return { skipped: 'dry-run', key, name: rename ? displayName(ids, presets) : null }; }
    if (!keys()) return { skipped: 'missing keys' };
    // image and name are independent: if X rejects the picture the name still follows the round
    let imgErr = null;
    try {
      const buf = fs.readFileSync(file);
      if (buf.length > 700 * 1024) throw new Error('image too large');
      await xPost('/account/update_profile_image.json', { image: buf.toString('base64'), skip_status: 'true' });
    } catch (e) { imgErr = e.message; log('[avatar] ' + e.message); }
    let name = null;
    if (rename) { try { name = displayName(ids, presets); await xPost('/account/update_profile.json', { name }); } catch (e) { name = null; log('[avatar] rename ' + e.message); } }
    if (imgErr) return { error: imgErr, name };
    s.current = key; s.at = now(); s.days[day()] = (s.days[day()] || 0) + 1;
    for (const d of Object.keys(s.days)) if (d < day()) delete s.days[d];
    store.save(); log('[avatar] profile set to ' + key);
    return { ok: true, key, name };
  }

  function forRound(r) { const x = A().rounds[r]; if (!x) return null; const { art, ...pub } = x; return pub; }
  function artFor(r) { const x = A().rounds[r]; return (x && x.art && fs.existsSync(x.art)) ? x.art : null; }
  function status() { const s = A(); return { enabled: on, handle: env.NC_BOT_HANDLE || null, mode: !on ? 'off' : dry() ? 'dry-run' : keys() ? 'live' : 'missing-keys', current: s.current, provider: provider || null }; }
  function serve(req, res) {
    const f = String(req.params.file || ''); if (!/^[a-z+]+\.(jpg|png)$/.test(f)) return res.status(404).end();
    const p = path.join(cacheDir, f); if (!fs.existsSync(p)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400'); res.sendFile(p);
  }
  return { onRoundClosed, forRound, artFor, status, serve };
}
module.exports = { createAvatar, personasOf, comboKey, roundText, displayName, voteShares, SHORT, CLOSER, promptFor, providers, LIBRARY, DEFAULT_PERSONA, HYBRID_NAMES };
