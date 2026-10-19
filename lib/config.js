// All runtime config comes from env. Secrets are read here and never sent to browsers or logs.
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const flag = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const env = process.env;
module.exports = {
  port: num(env.PORT, 5310),
  cluster: env.CLUSTER || 'mainnet',
  db: env.DB || './data/db.json',
  presetsFile: env.PRESETS || './data/presets.json',
  rpc: env.NC_RPC || '',                       // server-side only (may contain an API key)
  mint: env.NC_TOKEN_MINT || '',               // pump.fun Token-2022 mint, set after launch
  treasury: env.NC_TREASURY || '',
  tokenName: 'Neurocracy',
  ticker: 'NCRACY',
  decimals: num(env.NC_DECIMALS, 6),
  holderMin: num(env.NC_HOLDER_MIN, 100000),    // tokens needed for the Lab perk and X priority
  voteMin: num(env.NC_VOTE_MIN, 1),             // any balance above this can vote
  labPerDay: num(env.NC_LAB_PER_DAY, 5),
  roundMinutes: num(env.ROUND_MINUTES, 30),
  roundEpoch: Date.parse(env.ROUND_EPOCH || '2026-10-01T00:00:00Z'),
  npKey: env.NEURONPEDIA_API_KEY || '',
  npPerHour: num(env.NP_PER_HOUR, 150),         // global Neuronpedia steer budget (site + X + Lab)
  npSearchPerHour: num(env.NP_SEARCH_PER_HOUR, 60),
  site: env.SITE_URL || 'https://neurocracy.fun',
  github: env.GITHUB_URL || 'https://github.com/neurocracyfun',
  xHandle: env.X_HANDLE || 'neurocracyfun',
  x: {
    dryRun: flag(env.DRY_RUN, true),                  // default: generate + preview, never post
    enabled: flag(env.X_POSTING_ENABLED, false),      // kill switch, must be on to post
    dailyCap: num(env.X_DAILY_POST_CAP, 60),
    repliesPerRound: num(env.X_REPLIES_PER_ROUND, 4),
    candidates: num(env.X_CANDIDATES, 3),
    mentionsPollMin: num(env.X_MENTIONS_POLL_MIN, 10),
    userId: env.X_USER_ID || '',
    appKey: env.X_APP_KEY || '', appSecret: env.X_APP_SECRET || '',
    accessToken: env.X_ACCESS_TOKEN || '', accessSecret: env.X_ACCESS_SECRET || '',
  },
  testMode: flag(env.NC_TEST, false),
};
