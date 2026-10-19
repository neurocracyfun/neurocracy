# Fee share, burns and round snapshots

Everything here is off by default and does nothing until the token is live.

## Creator-fee share (70 / 10 / 20)

Creator fees from pump.fun are moved by hand into a distributor wallet. When `NC_PAYOUT_ENABLED=1`, at the close of every round that had votes, the server takes what in that wallet is not yet allocated:

    available = balance - reserve - everything already owed
    pool      = available, at most the daily cap

and splits it:

| Share | Default | Goes to |
|---|---|---|
| Voters | 70% (`NC_PAYOUT_SHARE_BPS=7000`) | wallets that voted for the winning mind, pro rata by vote weight |
| Nominator | 10% (`NC_NOMINATOR_BPS=1000`) | the wallet that nominated the winning feature by burn. If the winner was not nominated, this 10% goes to the voters |
| Operations | 20% (`NC_OPS_BPS=2000`) | `NC_OPS_ADDRESS` (hosting, model API, X API). Payouts stay off until it is set |

Vote weight is the exact integer `floor(sqrt(raw balance at close))`. A round nobody voted in pays nothing. Each share is added to the wallet's owed balance. A wallet is paid once it reaches `NC_PAYOUT_MIN_LAMPORTS` (default 0.001 SOL); until then it accrues. Remainders from integer division stay in the wallet and roll into the next pool.

Transfers go out in batches (`NC_PAYOUT_MAX_PER_TX`). Each round is planned exactly once, and each batch records its signature and blockhash expiry before it is sent, so a restart confirms the batch or resends it after the blockhash expired. It never pays twice. `PAYOUT_DRY_RUN=1` (default) runs all of this in a separate book and sends nothing. The ledger is public at `/api/payouts`, `/api/payouts/round/:r` and `/api/payouts/wallet/:address`.

Fees depend on trading volume and can be zero. The wallet can be empty. Nothing here is income or a promise of return.

## Burns, priced in USD

Both actions burn NCRACY with a Token-2022 BurnChecked plus an SPL Memo that binds the burn to one request. The amount is set in dollars and converted at the live price:

| Action | USD | Clamp (tokens) |
|---|---|---|
| Nominate a feature | `NC_NOMINATE_USD=5` | 10,000 to 500,000 |
| AI reply on X | `NC_REPLY_USD=1.5` | 3,000 to 150,000 |

Price sources, in order: the pump.fun bonding curve reserves (before graduation) times SOL/USD from Jupiter, then the Jupiter price API, then the DexScreener pair with the most liquidity. Prices are cached for `PRICE_TTL_SEC`. If no source answers, burn actions are paused; the server never guesses.

The server returns an HMAC-signed quote (purpose, target, token amount, expiry). The quote holds for `NC_QUOTE_TTL_SEC` (5 minutes). A burn is accepted when it is confirmed, signed by the wallet, burns at least the quoted amount of the mint from that wallet, carries the matching memo, landed before the quote expired, and has not been used before.

- **Nominate:** `Neurocracy nominate <layer>/<index>`. The feature is checked on Neuronpedia and against the content filter before the quote is issued, so a rejected feature never costs tokens. It joins the next ballot with room (`NC_NOMINATE_MAX` per ballot). It is never dropped for a full ballot.
- **Reply:** `Neurocracy reply <post id>`. The X account replies to that post in the current mind, with the same filter, dry run, kill switch and daily cap as everything else. The limit is `NC_REPLY_PER_WALLET_DAY`. If no draft passes the filter, nothing is posted. Burns are final, with no refunds.

## Round snapshots (hook for a tally proof)

At close, every round stores a canonical JSON snapshot at `/api/rounds/:r/snapshot`, with its sha256 shown in the Hall. It contains every signed vote message, signature, raw balance at close and integer weight, sorted by wallet, plus the per-candidate totals and the winner. The same inputs always produce the same bytes, so a future verifier (plain or zero-knowledge) can take the snapshot as public input and check the signatures, the weights and the winner.
