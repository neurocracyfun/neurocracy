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
  rpcRps: num(env.NC_RPC_RPS, 8),                   // pace for balance reads at round close
  closeConcurrency: num(env.NC_CLOSE_CONCURRENCY, 8),   // parallel balance reads at round close (Helius free tier is about 10 RPS)
  roundMinutes: num(env.ROUND_MINUTES, 30),
  roundEpoch: Date.parse(env.ROUND_EPOCH || '2026-10-01T00:00:00Z'),
  npKey: env.NEURONPEDIA_API_KEY || '',
  npPerHour: num(env.NP_PER_HOUR, 150),         // global Neuronpedia steer budget (site + X + Lab)
  npSearchPerHour: num(env.NP_SEARCH_PER_HOUR, 60),
  site: env.SITE_URL || 'https://neurocracy.fun',
  github: env.GITHUB_URL || 'https://github.com/neurocracyfun',
  xHandle: env.X_HANDLE || 'neurocracyfun',
  // posts by these accounts that mention the bot get a free reply first (still counted in X_REPLIES_PER_ROUND)
  freeReplyHandles: String(env.NC_FREE_REPLY_HANDLES ?? 'neurocracyfun').split(',').map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean),
  freeReplyIds: String(env.NC_FREE_REPLY_IDS || '').split(',').map((h) => h.trim()).filter(Boolean),
  botHandle: (env.NC_BOT_HANDLE || '').replace(/^@/, ''),   // the account that posts (the bot); replies and mentions count for both
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
  // Creator-fee share, 70 / 10 / 20 (OFF by default). NC_PAYOUT_KEY is the distributor wallet secret: server only, never logged.
  payout: {
    enabled: flag(env.NC_PAYOUT_ENABLED, false),
    dryRun: flag(env.PAYOUT_DRY_RUN, true),
    key: env.NC_PAYOUT_KEY || '',
    address: env.NC_PAYOUT_ADDRESS || '',              // optional: watch a distributor in dry-run without its key
    rpc: env.NC_PAYOUT_RPC || '',                      // defaults to NC_RPC
    roundBps: num(env.NC_PAYOUT_ROUND_BPS, 1000),       // each voted round pays 10% of the unallocated pool
    shareBps: num(env.NC_PAYOUT_SHARE_BPS, 7000),      // winning voters (70%)
    nominatorBps: num(env.NC_NOMINATOR_BPS, 1000),     // nominator of the winning feature (10%), else rolls to voters
    opsBps: num(env.NC_OPS_BPS, 2000),                 // operations (20%)
    opsAddress: env.NC_OPS_ADDRESS || '',              // where the operations share is paid
    minLamports: num(env.NC_PAYOUT_MIN_LAMPORTS, 1000000),       // 0.001 SOL; smaller amounts accrue
    reserveLamports: num(env.NC_PAYOUT_RESERVE_LAMPORTS, 10000000), // kept for fees and rent
    dailyCapLamports: num(env.NC_PAYOUT_DAILY_CAP_LAMPORTS, 2000000000), // 2 SOL per UTC day
    maxPerTx: num(env.NC_PAYOUT_MAX_PER_TX, 18),
  },
  // Nomination by burn (OFF by default)
  nominate: {
    enabled: flag(env.NC_NOMINATE_ENABLED, false),
    usd: num(env.NC_NOMINATE_USD, 5),                  // burn worth this many USD, priced live
    min: num(env.NC_NOMINATE_MIN, 100),              // clamps, whole tokens
    max: num(env.NC_NOMINATE_MAX_TOKENS, 20000000),
    maxPerRound: num(env.NC_NOMINATE_MAX, 6),
  },
  // Burn for an AI reply on X (OFF by default)
  replyBurn: {
    enabled: flag(env.NC_REPLY_BURN_ENABLED, false),
    usd: num(env.NC_REPLY_USD, 1.5),
    min: num(env.NC_REPLY_MIN, 30),
    max: num(env.NC_REPLY_MAX_TOKENS, 6000000),
    perWalletPerDay: num(env.NC_REPLY_PER_WALLET_DAY, 3),
  },
  price: { ttlMs: num(env.PRICE_TTL_SEC, 180) * 1000, windowMs: num(env.PRICE_WINDOW_MIN, 30) * 60e3 },  // price cache; burns are off when no price is available
  quotes: { secret: env.NC_QUOTE_SECRET || '', ttlMs: num(env.NC_QUOTE_TTL_SEC, 300) * 1000 },
  testMode: flag(env.NC_TEST, false),
};
