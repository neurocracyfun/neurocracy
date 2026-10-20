// Local simulated rounds for the bot (several scenarios: single, pair, 3+, tie, no votes, long text),
// X and the image provider are mocked, nothing leaves the box. Writes the would-be post, image and avatar.
// Usage: node scripts/bot-sim-round.js [out.md]
const fs = require('fs'); const os = require('os'); const path = require('path');
const sol = require('../lib/solana');
sol.balanceInfo = async () => ({ ui: 1000000, raw: 1000000n * 1000000n });   // equal balances, so equal sqrt weight
const baseCfg = require('../lib/config');
const { createApp } = require('../server');
const out = process.argv[2] || path.join(os.homedir(), '..', '..', 'workspace', 'neurocracy-brand', 'bot', 'sim-round.md');
const W = (n) => 'Wallet' + String(n).padStart(2, '0') + 'x'.repeat(36);
const LONG = 'I have a very long thought today about tides and broth and the way a kitchen at midnight feels like the bottom of the sea, quiet and full of small lights, and I want to tell every one of you about it in detail before the round ends.';
const SCENARIOS = [
  { name: 'Single persona (all vote Owl)', votes: [['p:owl', 1], ['p:owl', 1]] },
  { name: 'Pair 50/50 (Octopus and Chef)', votes: [['p:ocean', 1], ['p:chef', 1]] },
  { name: 'Three or more personas', votes: [['p:pirate', 1], ['p:ghost', 1], ['p:bard', 1]] },
  { name: 'Tie, uneven thirds (2/2/1 wallets)', votes: [['p:cat', 1], ['p:cat', 1], ['p:space', 1], ['p:space', 1], ['p:dino', 1]] },
  { name: 'No votes', votes: [] },
  { name: 'Long model line (trim to 280)', votes: [['p:ocean', 1], ['p:chef', 1], ['p:lord', 1], ['p:romantic', 1]], steer: LONG + ' ' + LONG },
  { name: 'Model line rejected by filter (post still goes out)', votes: [['p:ocean', 1], ['p:chef', 1]], steer: '' },
];
async function run(sc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-botsim-'));
  const cfg = { ...baseCfg, db: path.join(dir, 'db.json'), mint: 'MintNcracy1111111111111111111111111111111111',
    x: { ...baseCfg.x, dryRun: false, enabled: true, appKey: 'mock', appSecret: 'mock', accessToken: 'mock', accessSecret: 'mock', candidates: 1, userId: '' } };
  const calls = [];
  const fetchImpl = async (url, opt = {}) => {   // every X / image call is answered locally, nothing leaves the box
    calls.push({ url, opt });
    if (url.includes('/images/generations')) throw new Error('image API not configured in sim');
    if (url.endsWith('/2/media/upload')) return { ok: true, status: 200, json: async () => ({ data: { id: 'mock-media-1' } }) };
    if (url.endsWith('/2/tweets')) return { ok: true, status: 201, json: async () => ({ data: { id: 'mock-tweet-1' } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  let t = cfg.roundEpoch + 10 * 30 * 60e3 + 60e3;
  const text = sc.steer === undefined ? 'Eight arms, one kitchen. Tonight I am stirring a seaweed broth.' : sc.steer;
  const g = createApp(cfg, { now: () => t, chain: null, zkProve: false, fetchImpl, avatarFetch: fetchImpl, log: () => {},
    env: { NC_AVATAR: '1' }, steer: async () => ({ steered: text, share: null }) });
  const D = g.store.data; const r = g.rounds.current();
  const ballot = g.rounds.candidates(r).map((c) => c.id);
  D.votes[r] = {}; sc.votes.forEach(([c], i) => { if (!ballot.includes(c)) throw new Error(c + ' not on ballot'); D.votes[r][W(i)] = { candidate: c, topic: '-', balanceAtVote: 1e6, t }; });
  t += 30 * 60e3; await g.tickOnce();
  const closed = D.rounds[r]; const post = D.posts.find((p) => p.kind === 'post' && p.round === r);
  const av = g.avatar.forRound(r) || {}; const art = g.avatar.artFor(r);
  const tw = calls.find((c) => c.url.endsWith('/2/tweets')); const tweet = tw ? JSON.parse(tw.opt.body) : {};
  const ren = calls.find((x) => x.url.includes('update_profile.json'));
  const rel = (p) => (p ? path.relative(path.join(__dirname, '..'), p) : 'none');
  return `## ${sc.name}

- Votes: ${sc.votes.length ? sc.votes.map((v) => v[0]).join(', ') : 'none'}. Tally: ${JSON.stringify(closed.tally || {})}
- Winner: ${closed.winner.name}. Personas: ${(av.personas || []).join(' + ') || 'none'} (key ${av.key || '-'})
- Post status: ${post ? post.status : 'no post'}. Media attached: ${(tweet.media && tweet.media.media_ids.join(',')) || 'none'}. Image: ${rel(art)}
- Avatar: ${calls.some((c) => c.url.includes('update_profile_image')) ? 'would change' : 'unchanged'} (${av.url || 'none'}). Display name: ${ren ? new URLSearchParams(ren.opt.body).get('name') : 'unchanged'}
- Image API calls: ${calls.filter((c) => c.url.includes('/images/generations')).length}. Bio changes: ${calls.filter((c) => c.url.includes('update_profile.json') && new URLSearchParams(c.opt.body).has('description')).length}

\`\`\`
${post && post.text} 
\`\`\`
(${post && post.text ? post.text.length : 0} chars)
`;
}
(async () => {
  const parts = []; for (const sc of SCENARIOS) parts.push(await run(sc));
  const md = '# Bot simulated rounds\n\nRun: ' + new Date().toISOString() + '. Local only: X and image API are mocked, nothing is posted.\n\n' + parts.join('\n');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, md);
  console.log(md);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
