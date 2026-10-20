// One-off live test for the bot account. Uses the real bot keys from env (never printed):
// X_APP_KEY, X_APP_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET. Sets the avatar to the default octopus chef,
// sets the display name to The Octopus Chef (name only, never the bio), uploads the octopus chef illustration and posts one test post with it.
// Usage: CONFIRM=1 node scripts/bot-test-post.js   (without CONFIRM=1 it only prints what it would do)
const fs = require('fs'); const path = require('path');
const oauth = require('../lib/oauth1');
const K = { appKey: process.env.X_APP_KEY, appSecret: process.env.X_APP_SECRET, accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET };
const ROOT = path.join(__dirname, '..');
const AVATAR = path.join(ROOT, 'public/img/avatars/default.png');
const IMAGE = path.join(ROOT, 'public/img/hybrids/chef+ocean.jpg');
const { roundText } = require('../lib/avatar'); const { loadPresets } = require('../lib/presets');
// same format as a real round post, prefixed with 'Test post. '
const TEXT = 'Test post. ' + roundText(['ocean', 'chef'], loadPresets(path.join(ROOT, 'data/presets.json')), '', [{ id: 'p:ocean', pct: 50 }, { id: 'p:chef', pct: 50 }]);
(async () => {
  const missing = Object.entries(K).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error('missing env: X_APP_KEY, X_APP_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET');
  for (const f of [AVATAR, IMAGE]) if (!fs.existsSync(f)) throw new Error('missing file ' + path.relative(ROOT, f));
  console.log('name: The Octopus Chef | avatar:', path.relative(ROOT, AVATAR), '| image:', path.relative(ROOT, IMAGE), '| text (' + TEXT.length + ' chars):', TEXT);
  if (process.env.CONFIRM !== '1') { console.log('dry: set CONFIRM=1 to send'); return; }

  // 1. avatar (v1.1, form-encoded, body params are signed)
  const u1 = 'https://api.x.com/1.1/account/update_profile_image.json';
  const p1 = { image: fs.readFileSync(AVATAR).toString('base64'), skip_status: 'true' };
  const r1 = await fetch(u1, { method: 'POST', headers: { Authorization: oauth.header('POST', u1, p1, K), 'Content-Type': 'application/x-www-form-urlencoded' }, body: Object.entries(p1).map(([k, v]) => oauth.enc(k) + '=' + oauth.enc(v)).join('&') });
  console.log('avatar:', r1.status);

  // 1b. display name only (v1.1 account/update_profile with just name)
  const un = 'https://api.x.com/1.1/account/update_profile.json'; const pn = { name: 'The Octopus Chef' };
  const rn = await fetch(un, { method: 'POST', headers: { Authorization: oauth.header('POST', un, pn, K), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=' + oauth.enc(pn.name) });
  console.log('name:', rn.status);

  // 2. media upload (v2, multipart)
  const u2 = 'https://api.x.com/2/media/upload';
  const form = new FormData(); form.append('media', new Blob([fs.readFileSync(IMAGE)], { type: 'image/jpeg' }), 'chef+ocean.jpg'); form.append('media_category', 'tweet_image');
  const r2 = await fetch(u2, { method: 'POST', headers: { Authorization: oauth.header('POST', u2, {}, K) }, body: form });
  const j2 = await r2.json().catch(() => ({})); const mediaId = (j2.data && j2.data.id) || j2.media_id_string;
  console.log('media:', r2.status, mediaId ? 'ok' : 'failed, posting text only');

  // 3. post
  const u3 = 'https://api.x.com/2/tweets';
  const body = { text: TEXT }; if (mediaId) body.media = { media_ids: [String(mediaId)] };
  const r3 = await fetch(u3, { method: 'POST', headers: { Authorization: oauth.header('POST', u3, {}, K), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j3 = await r3.json().catch(() => ({}));
  console.log('post:', r3.status, j3.data ? 'id ' + j3.data.id : (j3.title || j3.detail || ''));
})().catch((e) => { console.error(e.message); process.exit(1); });
