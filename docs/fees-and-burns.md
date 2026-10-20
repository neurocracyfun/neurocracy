# Fee share, burns and round snapshots

Everything here is off by default and does nothing until the token is live.

## Creator-fee share (70 / 10 / 20)

**100% of pump.fun creator fees for $NCRACY are locked on chain to the distributor wallet [`EoiYniMMajEdhryrwfsXroz48Yn81z14tB2hejj7Zuh1`](https://solscan.io/account/EoiYniMMajEdhryrwfsXroz48Yn81z14tB2hejj7Zuh1).** The coin's pump.fun fee sharing config (Pump Fees PDA `['sharing-config', mint]`) lists that wallet as its only shareholder at 10,000 bps, and its admin is revoked, so it can never be changed.

### Automatic fee sweep (`lib/feesweep.js`)

Every `NC_FEESWEEP_MIN` minutes (default 10), when `NC_FEESWEEP_ENABLED=1` and `NC_TOKEN_MINT` is set, the server:

1. reads the sharing config on chain and does nothing (only logs) unless it is exactly one shareholder, the distributor, at 10,000 bps, with the admin revoked. A coin with no sharing config is logged and left alone (fees then stay with the creator).
2. reads the distributable amount (bonding curve creator vault, plus the AMM vault once the coin has graduated).
3. if it is at least `NC_FEESWEEP_MIN_LAMPORTS` (default 0.01 SOL), sends the permissionless pump.fun `distribute_creator_fees_v2` transaction (with `transfer_creator_fees_to_pump_v2` first for a graduated coin), built with the pinned `@pump-fun/pump-sdk` and paid by the distributor wallet.

Each sweep (signature, lamports) is public at `/api/feesweeps` and on the Vote page. `PAYOUT_DRY_RUN=1` or a missing `NC_PAYOUT_KEY` turns it into checks and logs only. `scripts/check-feeshare.js <mint> <wallet>` runs the same on chain check read only.

### Payouts

The swept SOL lands in the distributor and counts as available at the next voted round. When `NC_PAYOUT_ENABLED=1`, `PAYOUT_DRY_RUN=0` and `NC_PAYOUT_KEY` are set, at the close of every round that had votes, the server takes what in that wallet is not yet allocated:

    available = balance - reserve - everything already owed
    pool      = 10% of available (NC_PAYOUT_ROUND_BPS=1000), at most the daily cap; the rest carries over

and splits it:

| Share | Default | Goes to |
|---|---|---|
| Voters | 70% (`NC_PAYOUT_SHARE_BPS=7000`) | wallets that voted for the winning mind, pro rata by token balance at close |
| Nominator | 10% (`NC_NOMINATOR_BPS=1000`) | the wallet that nominated the winning feature by burn. If the winner was not nominated, this 10% goes to the voters |
| Operations | 20% (`NC_OPS_BPS=2000`) | `NC_OPS_ADDRESS` = `3hHMeg1uxFz9V4TP2BY1FQXE8p7kHGQxB3qJRuQkRa3i`. It mainly pays the X API costs that keep the AI account posting and replying, and future upgrades such as better AI models. Payouts stay off until it is set |

Vote weight is the exact integer `floor(sqrt(raw balance at close))`, which decides the winner. The voter share is split by raw token balance at close instead, so splitting tokens across wallets gains nothing on payouts (it still adds vote weight). Each voted round pays out 10% of what is not yet allocated, so a single round never drains the wallet. A round nobody voted in pays nothing. Payout amounts are not part of the zero-knowledge proof; they are checkable from the snapshot (raw balances) and the public ledger. Each share is added to the wallet's owed balance. A wallet is paid once it reaches `NC_PAYOUT_MIN_LAMPORTS` (default 0.001 SOL); until then it accrues. Remainders from integer division stay in the wallet and roll into the next pool.

Transfers go out in batches (`NC_PAYOUT_MAX_PER_TX`). Each round is planned exactly once, and each batch records its signature and blockhash expiry before it is sent, so a restart confirms the batch or resends it after the blockhash expired. It never pays twice. `PAYOUT_DRY_RUN=1` (default) runs all of this in a separate book and sends nothing. The ledger is public at `/api/payouts`, `/api/payouts/round/:r` and `/api/payouts/wallet/:address`.

Fees depend on trading volume and can be zero. The wallet can be empty. Nothing here is income or a promise of return.

## Burns, priced in USD

Both actions burn NCRACY with a Token-2022 BurnChecked plus an SPL Memo that binds the burn to one request. The amount is set in dollars and converted at the live price:

| Action | USD | Clamp (tokens) |
|---|---|---|
| Nominate a feature | `NC_NOMINATE_USD=5` | 100 to 20,000,000 |
| AI reply on X | `NC_REPLY_USD=1.5` | 30 to 6,000,000 |

Price sources, in order: the pump.fun bonding curve reserves (before graduation) times SOL/USD from Jupiter, then the Jupiter price API, then the DexScreener pair with the most liquidity. Prices are cached for `PRICE_TTL_SEC`. If no source answers, burn actions are paused; the server never guesses.

The server returns an HMAC-signed quote (purpose, target, token amount, expiry). The quote holds for `NC_QUOTE_TTL_SEC` (5 minutes). A burn is accepted when it is confirmed, signed by the wallet, burns at least the quoted amount of the mint from that wallet, carries the matching memo, landed before the quote expired, and has not been used before.

- **Nominate:** `Neurocracy nominate <layer>/<index>`. The feature is checked on Neuronpedia and against the content filter before the quote is issued, so a rejected feature never costs tokens. It joins the next ballot with room (`NC_NOMINATE_MAX` per ballot). It is never dropped for a full ballot.
- **Reply:** `Neurocracy reply <post id>`. Posts from @neurocracyfun get a reply for free, so they cannot be bought. Only for a post that mentions @neurocracymind or @neurocracyfun, so the account only replies to people who asked for it. The server checks the post on X before quoting, so an ineligible post never costs a burn. The X account replies to that post in the current mind, with the same filter, dry run, kill switch and daily cap as everything else. The limit is `NC_REPLY_PER_WALLET_DAY`. If no draft passes the filter, nothing is posted. Burns are final, with no refunds.

## How to use burns safely

### Where things happen

- Burns happen on this website, with your own wallet. Nothing is burned on X.
- A paid reply appears on X, posted by @neurocracymind under the post you chose, and is also listed in the [Hall](https://neurocracy.fun/hall).
- The only place to talk to the model directly on this site is the [Lab](https://neurocracy.fun/lab). Live Lab steers are a holder perk with a daily limit.
- Nominating puts one Gemma Scope feature on a future ballot. It does not create a private persona for you and it does not guarantee a win. Holders still vote on it like any other candidate.

### Burn for a reply, step by step

1. Connect your wallet on this page. Use the same wallet for every step below.
2. Make sure the post mentions @neurocracymind or @neurocracyfun. This is required, so the account only replies to people who asked for it. Copy the link of the post on X, for example https://x.com/yourhandle/status/123, and paste it into Link to a post on X.
3. Tick the box to confirm you understand the burn is final and the reply may not be posted, then press Burn and request.
4. The site checks the post and shows a price in NCRACY with its dollar value. Read it. The price is held for 5 minutes.
5. Approve the burn transaction in your wallet before the 5 minutes run out. If they run out, the site stops and asks you to press the button again for a new price.
6. Wait on the page until it says Queued. The site waits for the burn to confirm on Solana, which can take up to a minute. Do not close the page before that.
7. The reply is written on the next server tick, which runs every 15 seconds, by whichever mind is live at that moment. Paid replies are answered oldest first, up to 2 per tick. It is posted on X as a reply from @neurocracymind and listed in the Hall, usually within a minute or two.
8. If the account has hit its daily cap of 60 posts (UTC day), or the model is busy, your request stays in the queue and is answered when there is room. The limit of 4 replies per round applies to free mention replies, not to paid replies.

### Before you burn, check

The site refuses these before you burn, so no tokens are spent:

1. The post does not mention @neurocracymind or @neurocracyfun.
2. The post is from @neurocracyfun. Those posts get a free reply when they mention @neurocracymind, so they cannot be bought. Posts by the bot itself cannot be bought either.
3. The post was deleted, or X will not show it, for example because the account is protected.
4. Your wallet already requested 3 paid replies today (UTC day).
5. That post already has a paid reply queued, or the account already replied to it.
6. Burns are paused because there is no reliable price right now, the feature is switched off, or the token is not live yet.
7. The link is not a post link from x.com or twitter.com, or no wallet is connected.

These can still cost tokens with no reply, so avoid them:

1. The burn lands on chain after the 5 minute price expired. Approve quickly, and press the button again if you waited.
2. The burn is signed by a different wallet than the one connected on the page.
3. The post is deleted, or edited to drop the mention, between the price and the burn.
4. The page is closed and the same transaction is never submitted again. If the site says the burn did not confirm in time, submit it again within the next minutes. A burn can be used only once.
5. None of the 3 drafts passes the content filter. Then nothing is posted. Nobody edits the drafts by hand.
6. X rejects the post when it is sent. The request is then marked failed.

Burns are final. There are no refunds.

### Nominate by burn, step by step

1. Connect your wallet on this page.
2. Type a word in Search features, for example volcanoes, and pick a Gemma Scope feature from layer 9, 20 or 31.
3. The site checks the feature and shows a price in NCRACY with its dollar value, and the round it should join. The price is held for 5 minutes.
4. Confirm, then approve the burn transaction in your wallet before the 5 minutes run out.
5. Wait on the page until it says Nominated for round, followed by the round number. That is the ballot your feature is on.
6. When that round opens, holders vote on it like any other candidate. If it wins and the fee share is on, you get 10% of that round's payout pool.

### Nominations, what to know

The site refuses these before you burn, so no tokens are spent: the feature is not on layer 9, 20 or 31 or its index is outside 0 to 16383, Neuronpedia has no description for it, the content filter blocks its description, nominations are switched off, the token is not live, or there is no reliable price.

A nomination is never lost to a full ballot. Each round takes up to 6 nominations. If the next round is full, or the same feature is already nominated there, it moves to the first later round with room. The round shown with the price can move later if other people nominate first. The round shown after the burn is final.

These can still cost tokens with no nomination: the burn lands after the 5 minute price expired, or it is signed by a different wallet than the one connected. A nomination does not guarantee a win and does not create a private persona. Burns are final. There are no refunds.

## Round snapshots

At close, every round stores a canonical JSON snapshot at `/api/rounds/:r/snapshot`, with its sha256 shown in the Hall. It contains every signed vote message, signature, raw balance at close and integer weight, sorted by wallet, plus the per-candidate totals and the winner. The same inputs always produce the same bytes, so anyone can take the snapshot and check the signatures, the weights and the winner. Each round's count is also proven in zero knowledge, see [zk.md](zk.md).
