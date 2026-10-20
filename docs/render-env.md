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
| `ROUND_MINUTES` | `120` |
| `ROUND_EPOCH` | `2026-08-03T18:00:00Z` (2-hour rounds on even UTC hours, numbering continues from the 30-minute rounds) |
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
| `X_USER_ID` | numeric id of the account the four X keys belong to. With the bot keys: `1165034468966617089` (@neurocracymind), so mentions are read from the bot |
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
| `NC_NOMINATE_MIN` | `100` |
| `NC_NOMINATE_MAX_TOKENS` | `20000000` |
| `NC_NOMINATE_MAX` | `6` |
| `NC_REPLY_BURN_ENABLED` | `0` (then `1`, needs the X keys to check posts) |
| `NC_REPLY_USD` | `1.5` |
| `NC_REPLY_MIN` | `30` |
| `NC_REPLY_MAX_TOKENS` | `6000000` |
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

## Bot avatar and round images (OFF by default)

After each round closes the bot account (a separate X account, not @neurocracyfun) changes its avatar and display name to the winning persona, and its round post reads `This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. ... Got a question or something you want me to do?` with the round illustration attached. The bio is fixed and set by hand. A single persona uses `public/img/avatars/{id}.png` (built by `python3 scripts/build-avatars.py`) and posts `public/img/minds/{id}.webp`. A mix uses a hybrid illustration: seeded ones live in `public/img/hybrids/` (`chef+ocean.jpg` is The Octopus Chef, also the default when no library persona is steered), the rest are generated once and cached on the disk by sorted combo key. If the media upload fails the post goes out text only. Under `DRY_RUN=1` nothing is sent to X and no image API is called.

| Key | Value |
|---|---|
| `NC_AVATAR` | `0` (set `1` to change the avatar each round) |
| `NC_BOT_HANDLE` | `neurocracymind` ([@neurocracymind](https://x.com/neurocracymind)), shown in status |
| `X_APP_KEY`, `X_APP_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | SECRET, the bot account's keys (same vars as posting) |
| `NC_BOT_RENAME` | `1`, with `NC_AVATAR=1` the display name follows the avatar (name only, never the bio); `0` keeps it fixed |
| `NC_AVATAR_MIN_MINUTES` | `30`, minimum time between avatar changes |
| `NC_AVATAR_DAILY_MAX` | `12`, avatar changes per UTC day |
| `NC_AVATAR_GEN_IN_DRY` | `0`, set `1` to let dry run call the image API (still never X) |
| `NC_AVATAR_DIR` | defaults to `avatars/` next to `DB`, so `/var/data/avatars` |
| `NC_IMAGE_PROVIDER` | `openai` or `xai` (empty: only seeded hybrids are used) |
| `NC_IMAGE_API_KEY` | SECRET, key for that provider |
| `NC_IMAGE_MODEL` | optional, defaults `gpt-image-1` (1536x1024, medium) or `grok-imagine-image` (3:2) |

`/api/round` returns `avatarUrl` and `personas` for the last closed round. `scripts/bot-sim-round.js` runs one mocked round locally. `scripts/bot-test-post.js` sends one real test post with the bot keys and needs `CONFIRM=1`.

## Replies and round close

| Variable | Value |
|---|---|
| `NC_RPC_RPS` | `8` (raise on a paid RPC plan) |
| `NC_FREE_REPLY_HANDLES` | `neurocracyfun` (posts from these accounts that mention the bot get a free reply first) |
| `NC_FREE_REPLY_IDS` | optional numeric user id of @neurocracyfun |
| `NC_CLOSE_CONCURRENCY` | `8` (parallel balance reads at round close; keep under the RPC plan's RPS) |
