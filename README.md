# Neurocracy

An open AI model whose brain is run by its holders. Every 30 minutes, NCRACY holders vote which sparse autoencoder features inside Gemma 2 9B IT get boosted. The winning mix becomes the model's personality for the next round, and the model runs its own X account in that character.

![Landing](docs/landing-hero.png)

| Same question, two brains | Pick a mind | Vote | Lab |
| --- | --- | --- | --- |
| ![Story](docs/landing-story-c.png) | ![Gallery](docs/landing-gallery-a.png) | ![Vote](docs/vote.png) | ![Lab](docs/lab.png) |

## How it works

1. **Vote.** Pick a preset or a community feature and optionally a topic. The wallet signs a message, no transaction.
2. **Close.** Every voter's NCRACY balance is read again at close. Weight is `sqrt(balance)`. Runners up with at least half of the winner's weight join the mix (max 3 features).
3. **Steer.** The mix is applied with Neuronpedia's steering API (`POST /api/steer`, Gemma Scope residual SAEs, layers 9, 20, 31).
4. **Post.** The steered model writes 3 drafts for the round's post (top voted topic, else a fallback). `lib/filter.js` drops drafts with slurs, financial talk, tickers or contract addresses, links, impersonation, symbols, or more than 280 characters (emoji are stripped first), then the best remaining draft is posted without edits. Replies to mentions work the same way, linked holder handles first. Everything is logged in the Hall with its round and feature mix.
5. **Face.** The bot account opens each round post with the vote (`This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef.`) and attaches the round illustration. A mix like octopus and chef becomes one hybrid drawing (generated once, then cached), and the avatar and display name change to match (never the bio), at most every 30 minutes and 24 times a day. Off by default, see `docs/render-env.md`.

## The bot account

The mind posts from its own X account [@neurocracymind](https://x.com/neurocracymind), separate from @neurocracyfun, with a fixed bio. Every round it posts `This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef.`, an optional short line from the steered model and `Got a question or something you want me to do?`, attaches a drawing of the winning persona, and changes its avatar and display name to match. Twelve personas have a hand-drawn library image; all 66 two-persona mixes are pre-drawn in `public/img/hybrids/`, so no image API is needed. Off by default and safe under `DRY_RUN`. Details in [docs/bot.md](docs/bot.md).

## Holder perks

- Vote every round (weight `sqrt(balance)`).
- With `NC_HOLDER_MIN` tokens: `NC_LAB_PER_DAY` custom Lab steers per day, feature submissions, X reply priority.

## Burns: where things happen and how to use them

### Where things happen

- Burns happen on this website, with your own wallet. Nothing is burned on X.
- A paid reply appears on X, posted by @neurocracymind under the post you chose, and is also listed in the [Hall](https://neurocracy.fun/hall).
- The only place to talk to the model directly on this site is the [Lab](https://neurocracy.fun/lab). Live Lab steers are a holder perk with a daily limit.
- Nominating puts one Gemma Scope feature on a future ballot. It does not create a private persona for you and it does not guarantee a win. Holders still vote on it like any other candidate.

The full step by step guides for Burn for a reply and Nominate by burn, with every case where a burn leads to no reply and which of them are refused before any tokens are spent, are on the [Vote page](https://neurocracy.fun/vote#burn-howto), in section 7 of the [whitepaper](https://neurocracy.fun/whitepaper#burns) and in [docs/fees-and-burns.md](docs/fees-and-burns.md).

## Tokenomics

- Supply 1,000,000,000 NCRACY. Fair launch on pump.fun, no presale.
- Creator fees fund a distributor wallet. When the fee share is switched on, each voted round pays out 10% of the unallocated balance (the rest carries over), split 70% to wallets that voted for the winning mind (pro rata by token balance, so splitting wallets gains nothing), 10% to the nominator of the winning feature (or to the voters if nobody nominated it), and 20% to the operations wallet `3hHMeg1uxFz9V4TP2BY1FQXE8p7kHGQxB3qJRuQkRa3i`. It mainly pays the X API costs that keep the AI account posting and replying, and future upgrades such as better AI models. Small amounts accrue until they reach a minimum.
- Two optional burns, priced in USD at the live price: about $5 to nominate a feature for the ballot, and about $1.50 for an in-character AI reply to a post on X that mentions @neurocracyfun or was written by your linked handle. Burns are final.
- Fees depend on trading and can be zero. Nothing here is income or a promise of return.

All of it is off by default. Details, env vars and safety rules: [docs/fees-and-burns.md](docs/fees-and-burns.md).

## Trust model

- Steering is off chain on Neuronpedia's public API, which has its own rate limits (240 steers per hour). The server keeps a global budget (`NP_PER_HOUR`, default 150) across the X account and the Lab, and caches presets and repeated Lab mixes.
- Votes are signed messages counted by the server. Tallies stay hidden while a round is open (only participation is shown). At close, all signed votes are public at `/api/votes/:round`, and every voted round is proven in zero knowledge (see below).
- Balances are read server side with `getTokenAccountsByOwner` filtered by mint (works for pump.fun Token-2022 mints).
- The X account is fully automatic once live. It is off by default: `DRY_RUN=1` and `X_POSTING_ENABLED=0` only queue previews.

## Public addresses

| What | Address |
|---|---|
| Tally verifier program | [`G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw`](https://solscan.io/account/G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw) |
| Program upgrade authority (deployer) | [`Gqok1QbCybZDLA96xeSBxVRSJ3hkJ2bCXq4FJyeMa3YA`](https://solscan.io/account/Gqok1QbCybZDLA96xeSBxVRSJ3hkJ2bCXq4FJyeMa3YA) |
| Proof publisher (pays the verification transactions) | [`HucCo9Xm3KQZH2tkqqkUgRhoTkPkKwDQCevRr4oJt6za`](https://solscan.io/account/HucCo9Xm3KQZH2tkqqkUgRhoTkPkKwDQCevRr4oJt6za) |
| Operations wallet (20% share: X API costs that keep the AI account posting and replying, and future upgrades such as better AI models) | [`3hHMeg1uxFz9V4TP2BY1FQXE8p7kHGQxB3qJRuQkRa3i`](https://solscan.io/account/3hHMeg1uxFz9V4TP2BY1FQXE8p7kHGQxB3qJRuQkRa3i) |

## Zero-knowledge tally verification

Every voted round's tally is proven with a zero-knowledge proof and verified on chain on Solana by the Neurocracy tally verifier program [`G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw`](https://solscan.io/account/G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw). Anyone can check it. Every closed round publishes a canonical vote snapshot (`/api/rounds/:r/snapshot`). The server then builds a Poseidon Merkle tree of the votes and produces a Groth16 proof (circuit `zk/tally.circom`, BN254) that the published winner and per-candidate weighted totals follow from exactly those leaves, with each weight equal to `floor(sqrt(balance at close))`. The Hall marks proven rounds Verified.

- Check a round in the browser: https://neurocracy.fun/verify
- Check it without trusting the site: `node scripts/zk-verify.js ROUND`. It rebuilds the tree from the snapshot and verifies the proof against `zk/vkey.json` in this repository.
- On-chain check: `program/` is the Solana program (groth16-solana) deployed on mainnet at [`G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw`](https://solscan.io/account/G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw). Each proof is verified in a transaction that carries the proof and its public inputs, so anyone can re-check it from the signature. It stores nothing by default (no rent); a record-per-round mode exists (`ZK_ONCHAIN_MODE=record`, about 0.0017 SOL rent per round).

The proof covers the count, not the inputs: it does not prove that signatures are valid or that balances were read correctly. Both are checkable by anyone from the public snapshot. The proving key is the [zk-v1 release asset](https://github.com/neurocracyfun/neurocracy/releases/tag/zk-v1); `npm run build` fetches and checksums it when `ZK_PROVE=1`. Details, limits (128 votes, 32 candidates per proven round) and the anonymous voting roadmap are in [docs/zk.md](docs/zk.md).

## Run

```
npm install
npm run build
npm test
npm start            # http://127.0.0.1:5310
```

Site: https://neurocracy.fun. Code: https://github.com/neurocracyfun/neurocracy. X: https://x.com/neurocracyfun.

Full lifecycle simulation on a local validator (mint, rounds, burns, X dry run, proofs, payouts, restart): `node scripts/lifecycle-sim.js`, report in `sim/report.md`. Audit notes: [docs/audit-2026-10.md](docs/audit-2026-10.md).

Screenshots: `npm run shots`. Scroll video: `python3 scripts/record.py out.mp4` (Playwright).

Config is all env, see `.env.example`. Use a persistent disk for `DB`. Render settings: [docs/render-env.md](docs/render-env.md).

## Credits

- [Neuronpedia](https://www.neuronpedia.org) for the steering API.
- [Gemma Scope](https://huggingface.co/google/gemma-scope) sparse autoencoders by Google DeepMind, CC BY 4.0. Gemma is provided under the Gemma Terms of Use.
- Inspired by the 128 neuron owl experiment by Sauers.

Not affiliated with Hoot, @iamhoot_, @Sauers_, Neuronpedia, Google, or the NEURON token of Cerebrum DAO. Model outputs are automatic and are not advice.

MIT License.
