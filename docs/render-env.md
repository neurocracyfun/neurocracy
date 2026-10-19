# Render environment

Build command `npm install && npm run build`, start command `npm start`, persistent disk mounted at `/var/data`. Plan: Standard (2 GB) when `ZK_PROVE=1`. Starter works, but with only about 80 MB of memory to spare while proving.

Values marked SECRET go in Render's secret env and are never logged. Everything else is safe to show.

| Name | Value |
| --- | --- |
| `NODE_VERSION` | `20` |
| `DB` | `/var/data/db.json` |
| `CLUSTER` | `mainnet` |
| `SITE_URL` | `https://neurocracy.fun` |
| `GITHUB_URL` | `https://github.com/neurocracyfun` |
| `X_HANDLE` | `neurocracyfun` |
| `ROUND_MINUTES` | `30` |
| `ROUND_EPOCH` | `2026-10-01T00:00:00Z` (or the launch time) |
| `NC_RPC` | SECRET (mainnet RPC URL with its key, not the ZKDLE key) |
| `NC_TOKEN_MINT` | the pump.fun mint address, at launch |
| `NC_TREASURY` | public treasury address, at launch |
| `NC_DECIMALS` | `6` |
| `NC_VOTE_MIN` | `1` |
| `NC_HOLDER_MIN` | `100000` |
| `NC_LAB_PER_DAY` | `5` |
| `NEURONPEDIA_API_KEY` | SECRET (optional, raises limits) |
| `NP_PER_HOUR` | `150` |
| `NP_SEARCH_PER_HOUR` | `60` |
| `DRY_RUN` | `1` until the account goes live, then `0` |
| `X_POSTING_ENABLED` | `0` until live, then `1` |
| `X_APP_KEY`, `X_APP_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | SECRET |
| `X_USER_ID` | numeric id of @neurocracyfun |
| `X_DAILY_POST_CAP` | `60` |
| `X_REPLIES_PER_ROUND` | `4` |
| `X_CANDIDATES` | `3` |
| `X_MENTIONS_POLL_MIN` | `10` |
| `NC_PAYOUT_ENABLED` | `0` (then `1`) |
| `PAYOUT_DRY_RUN` | `1` (then `0`) |
| `NC_PAYOUT_KEY` | SECRET (distributor wallet) |
| `NC_PAYOUT_RPC` | empty (uses `NC_RPC`) |
| `NC_PAYOUT_ROUND_BPS` | `1000` |
| `NC_PAYOUT_SHARE_BPS` | `7000` |
| `NC_NOMINATOR_BPS` | `1000` |
| `NC_OPS_BPS` | `2000` |
| `NC_OPS_ADDRESS` | operations wallet address (public) |
| `NC_PAYOUT_MIN_LAMPORTS` | `1000000` |
| `NC_PAYOUT_RESERVE_LAMPORTS` | `10000000` |
| `NC_PAYOUT_DAILY_CAP_LAMPORTS` | `2000000000` |
| `NC_PAYOUT_MAX_PER_TX` | `18` |
| `NC_NOMINATE_ENABLED` | `0` (then `1`) |
| `NC_NOMINATE_USD` | `5` |
| `NC_NOMINATE_MIN` | `10000` |
| `NC_NOMINATE_MAX_TOKENS` | `2000000` |
| `NC_NOMINATE_MAX` | `6` |
| `NC_REPLY_BURN_ENABLED` | `0` (then `1`, needs the X keys to check posts) |
| `NC_REPLY_USD` | `1.5` |
| `NC_REPLY_MIN` | `3000` |
| `NC_REPLY_MAX_TOKENS` | `600000` |
| `NC_REPLY_PER_WALLET_DAY` | `3` |
| `PRICE_TTL_SEC` | `180` |
| `PRICE_WINDOW_MIN` | `30` |
| `NC_QUOTE_SECRET` | SECRET (random 32+ bytes, so quotes survive restarts) |
| `NC_QUOTE_TTL_SEC` | `300` |
| `ZK_PROVE` | `1` |
| `ZK_ZKEY_URL` | `https://github.com/neurocracyfun/neurocracy/releases/download/zk-v1/tally.zkey` |
| `ZK_HEAP_MB` | `300` |
| `ZK_TIMEOUT_MS` | `180000` |
| `ZK_SINGLE_THREAD` | `1` |
| `ZK_ONCHAIN` | `0` until the verifier is on mainnet, then `1` |
| `ZK_ONCHAIN_MODE` | `verify` |
| `NC_ZK_PROGRAM_ID` | program id, after the mainnet deploy |
| `NC_ZK_AUTHORITY_KEY` | SECRET (publisher wallet, a small hot wallet; about 0.09 SOL a year in fees) |
| `NC_ZK_RPC` | empty (uses `NC_RPC`) |

Do not set `NC_TEST` or `PORT` (Render sets `PORT`).
