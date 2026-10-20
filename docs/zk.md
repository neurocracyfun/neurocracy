> Mainnet: every voted round's tally is proven with a zero-knowledge proof and verified on chain by the tally verifier program [`G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw`](https://solscan.io/account/G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw) (upgrade authority `Gqok1QbCybZDLA96xeSBxVRSJ3hkJ2bCXq4FJyeMa3YA`).

# Zero-knowledge tally verification

Neurocracy counts votes on its server. To make that count checkable, every voted round gets a Groth16 proof that the winner and the weighted totals were computed correctly from the published votes.

## What is proven

For a round `r` the circuit (`zk/tally.circom`, `Tally(128, 7, 32)`, about 111,000 constraints) has four public inputs: `round`, `root`, `winner` and `totalsCommit`. A valid proof shows that the prover knows up to 128 vote leaves such that:

1. The leaves hash to `root`. Each leaf is `Poseidon(walletHigh, walletLow, candidateIndex, rawBalance)` and the leaves form a binary Poseidon Merkle tree of depth 7. Unused slots are zero leaves.
2. Every weight is exactly the integer square root of the raw balance: `w*w <= raw < (w+1)*(w+1)`.
3. Every candidate index is below 32, and the per-candidate totals are the sums of those weights.
4. `totalsCommit` is the Poseidon hash chain of the round number and all 32 totals.
5. The total of `winner` is greater than or equal to every other total.

The root, the totals and the winner are all recomputable from the public snapshot, so anyone can check that the proof is about that snapshot and not some other set of votes. Votes that were ineligible at close (below the minimum balance) are committed with balance 0 and count for nothing.

## What is not proven

- **Payouts.** The fee share (paid pro rata by raw balance at close) is not in the circuit. It is checkable from the snapshot's raw balances and the public payout ledger.

- **Signatures.** The circuit does not check ed25519 signatures. Every signed vote message and signature is in the snapshot and can be checked with any ed25519 library.
- **Balances.** The raw balance at close is read by the server from Solana RPC. The proof shows the weights follow from those numbers, not that the numbers match the chain. Anyone can recheck them against the chain at the closing slot.
- **Completeness.** A vote the server never recorded is not in the snapshot. Voters can check their own vote is there.
- **Ties.** If two candidates share the top total, the proof accepts either one. The server breaks ties deterministically, and the snapshot shows which.
- **Feature eligibility.** Which features were on the ballot is a server decision (nominations by burn are verified separately, see `docs/fees-and-burns.md`).

## Trusted setup

The proving key comes from the public Perpetual Powers of Tau ceremony (`ppot_0080_17.ptau`), followed by one circuit-specific contribution and a public random beacon. If the circuit-specific contribution were compromised, someone could forge a proof. Before mainnet use, the plan is a multi-party phase 2 ceremony that any holder can join.

Files: `zk/vkey.json` (verification key, in git), `zk/build/tally_js/tally.wasm` (witness generator, in git). The proving key `zk/build/tally.zkey` is 96 MB and is not in git. Its sha256 is in `zk/zkey.sha256`. It is published as the [zk-v1 release asset](https://github.com/neurocracyfun/neurocracy/releases/tag/zk-v1) (sha256 `d1cd52e9...c46b` in the release notes). With `ZK_PROVE=1`, `npm run build` downloads it (from `ZK_ZKEY_URL`, default that release) and refuses it if the checksum differs.

## Proving on the server

With `ZK_PROVE=1`, the server proves the newest unproven round after close, one at a time, in a child process (`lib/zk-worker.js`) with a heap cap (`ZK_HEAP_MB`, default 300) and a timeout (`ZK_TIMEOUT_MS`, default 180000). Rounds over the limits are marked not proven, with the reason.

Measured for a full 128-vote round:

| Setup | Time | Peak memory |
| --- | --- | --- |
| 8 cores, multithreaded | 5.9 s | 1.16 GB |
| 1 core, multithreaded | 20 s | 1.15 GB |
| 1 core, single thread, 300 MB heap | 18 s | 429 MB |

A Render Starter instance (512 MB, 0.5 CPU) should take about 40 s per proof, well inside a 2-hour round, but with a thin memory margin. The Standard plan (2 GB) is recommended.

Endpoints: `/api/rounds/:r/proof`, `/api/rounds/:r/verify` (the server rechecks from the snapshot), `/api/zk/vkey`. The `/verify` page checks the proof in the browser.

## On-chain check

`program/` is a Solana program built on `groth16-solana`. Instruction data is a tag byte, the proof (A negated, 256 bytes) and the four public inputs (385 bytes in total). It has two modes:

- **verify (default, `ZK_ONCHAIN_MODE=verify`)**: the program verifies the proof and logs round, winner and publisher. No account is created, so there is no rent. The transaction stays on chain with the proof and public inputs in its data, so anyone can look it up by signature (shown on /verify) and check that the program accepted those exact inputs. `scripts/zk-verify.js` does this when `NC_ZK_RPC` is set. About 99,500 compute units, 5,000 lamports fee.
- **record (`ZK_ONCHAIN_MODE=record`)**: the program also writes a 117-byte record at the PDA `["tally", authority, round]` (round, root, winner, totals commitment, slot, authority). A second write for the same round is refused. Rent is about 0.0017 SOL per round, so about 7.5 SOL a year at 12 rounds a day. That is why it is off by default.

Recommendation: keep verify mode. A transaction is as permanent and public as an account, so the record mode only makes lookups by round easier, at real cost.

Local validator test (`node scripts/zk-localnet.js`) covers both modes: tampered proofs are rejected, valid ones are accepted, records match, duplicates are refused.

Enable with `ZK_ONCHAIN=1`, `NC_ZK_PROGRAM_ID`, `NC_ZK_AUTHORITY_KEY` and optionally `NC_ZK_RPC`. Deployed on mainnet at `G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw` (2026-10-20, signature `2cWTSPzHLdB5RHf4aY1THG3c2swNJpbXZt6LRVvd9yKreQBkUwXgoy6ZVf3DfTbr8mTNpqwBcxCRwYdPJYUDx2eH`). First mainnet verification: `5D11q6VK1p8F75fiTTRMHqafUXJaqBsV4QegcHMkyxuBEoCRemaY3gUnjyiFnKetTPxGFLYpBBeejpErEBYD13Gu` (99,689 compute units, 7,000 lamports). Proofs are published by `HucCo9Xm3KQZH2tkqqkUgRhoTkPkKwDQCevRr4oJt6za`.

Upgraded on 2026-10-20 to a reproducible build with an embedded security.txt (source commit `9d42fc20dea786bda7f7d5c61d2f7593fea1ce30`, tag `tally-verifier-v1`), signature `cqq2D11vp8TtbKEA4NqPCirT4FFsLnVpT2ctQe3MoMJa774mfWb1mGpxGddk49DQVW6Be9xc14csD4rj6b4Ubdu`. The verifying key did not change. The program is verified by OtterSec (https://verify.osec.io/status/G4dJmDirX69n4aKo2fFx3eAnWXnn4NMZigrunpAd1nYw). On chain hash `cd4b2a811f2bd62aec8728517947544639477f7c60c3acbe9ad980a8da934298`. To reproduce: `solana-verify build --arch v3 --base-image solanafoundation/solana-verifiable-build@sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd --library-name neurocracy_tally_verifier` in `program/`, then `solana-verify get-executable-hash target/deploy/neurocracy_tally_verifier.so`.

## Roadmap: anonymous voting

Today every vote is public. The path to private votes, all in the same proof system:

1. Voters commit `Poseidon(wallet, candidate, salt)` instead of a plain choice, and the circuit opens commitments privately.
2. Balances are proven against a published Merkle tree of holder balances at the closing slot, so the server no longer needs to see who voted for what.
3. A nullifier per wallet and round prevents double votes without revealing the wallet.
4. Signature checks move into the circuit, or into a lighter signed-commitment scheme, so the snapshot no longer has to list wallets.

Each step makes the proof and the proving cost larger, so they come one at a time.
