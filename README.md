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

## Holder perks

- Vote every round (weight `sqrt(balance)`).
- With `NC_HOLDER_MIN` tokens: `NC_LAB_PER_DAY` custom Lab steers per day, feature submissions, X reply priority.

## Tokenomics

- Supply 1,000,000,000 NCRACY. Fair launch on pump.fun, no presale.
- Creator fees fund a distributor wallet. When the fee share is switched on, each voted round pays out 10% of the unallocated balance (the rest carries over), split 70% to wallets that voted for the winning mind (pro rata by token balance, so splitting wallets gains nothing), 10% to the nominator of the winning feature (or to the voters if nobody nominated it), and 20% to operations. Small amounts accrue until they reach a minimum.
- Two optional burns, priced in USD at the live price: about $5 to nominate a feature for the ballot, and about $1.50 for an in-character AI reply to a post on X that mentions @neurocracyfun or was written by your linked handle. Burns are final.
- Fees depend on trading and can be zero. Nothing here is income or a promise of return.

All of it is off by default. Details, env vars and safety rules: [docs/fees-and-burns.md](docs/fees-and-burns.md).

## Trust model

- Steering is off chain on Neuronpedia's public API, which has its own rate limits (240 steers per hour). The server keeps a global budget (`NP_PER_HOUR`, default 150) across the X account and the Lab, and caches presets and repeated Lab mixes.
- Votes are signed messages counted by the server. Tallies stay hidden while a round is open (only participation is shown). At close, all signed votes are public at `/api/votes/:round`, and every voted round is proven in zero knowledge (in testing, see below).
- Balances are read server side with `getTokenAccountsByOwner` filtered by mint (works for pump.fun Token-2022 mints).
- The X account is fully automatic once live. It is off by default: `DRY_RUN=1` and `X_POSTING_ENABLED=0` only queue previews.

## Zero-knowledge tally verification

In testing until the mainnet launch. Every closed round publishes a canonical vote snapshot (`/api/rounds/:r/snapshot`). The server then builds a Poseidon Merkle tree of the votes and produces a Groth16 proof (circuit `zk/tally.circom`, BN254) that the published winner and per-candidate weighted totals follow from exactly those leaves, with each weight equal to `floor(sqrt(balance at close))`. The Hall marks proven rounds Verified.

- Check a round in the browser: https://neurocracy.fun/verify
- Check it without trusting the site: `node scripts/zk-verify.js ROUND`. It rebuilds the tree from the snapshot and verifies the proof against `zk/vkey.json` in this repository.
- Optional on-chain check: `program/` is a Solana program (groth16-solana) that verifies each proof in a transaction. By default it stores nothing (no rent): the transaction carries the proof and its public inputs. A record-per-round mode exists (`ZK_ONCHAIN_MODE=record`, about 0.0017 SOL rent per round). It is tested on a local validator and not deployed to mainnet yet.

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
