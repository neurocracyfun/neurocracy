# Zero-knowledge tally verification

Neurocracy counts votes on its server. To make that count checkable, every closed round gets a Groth16 proof that the winner and the weighted totals were computed correctly from the published votes.

## What is proven

For a round `r` the circuit (`zk/tally.circom`, `Tally(128, 7, 32)`, about 111,000 constraints) has four public inputs: `round`, `root`, `winner` and `totalsCommit`. A valid proof shows that the prover knows up to 128 vote leaves such that:

1. The leaves hash to `root`. Each leaf is `Poseidon(walletHigh, walletLow, candidateIndex, rawBalance)` and the leaves form a binary Poseidon Merkle tree of depth 7. Unused slots are zero leaves.
2. Every weight is exactly the integer square root of the raw balance: `w*w <= raw < (w+1)*(w+1)`.
3. Every candidate index is below 32, and the per-candidate totals are the sums of those weights.
4. `totalsCommit` is the Poseidon hash chain of the round number and all 32 totals.
5. The total of `winner` is greater than or equal to every other total.

The root, the totals and the winner are all recomputable from the public snapshot, so anyone can check that the proof is about that snapshot and not some other set of votes. Votes that were ineligible at close (below the minimum balance) are committed with balance 0 and count for nothing.

## What is not proven

- **Signatures.** The circuit does not check ed25519 signatures. Every signed vote message and signature is in the snapshot and can be checked with any ed25519 library.
- **Balances.** The raw balance at close is read by the server from Solana RPC. The proof shows the weights follow from those numbers, not that the numbers match the chain. Anyone can recheck them against the chain at the closing slot.
- **Completeness.** A vote the server never recorded is not in the snapshot. Voters can check their own vote is there.
- **Ties.** If two candidates share the top total, the proof accepts either one. The server breaks ties deterministically, and the snapshot shows which.
- **Feature eligibility.** Which features were on the ballot is a server decision (nominations by burn are verified separately, see `docs/fees-and-burns.md`).

## Trusted setup

The proving key comes from the public Perpetual Powers of Tau ceremony (`ppot_0080_17.ptau`), followed by one circuit-specific contribution and a public random beacon. If the circuit-specific contribution were compromised, someone could forge a proof. Before mainnet use, the plan is a multi-party phase 2 ceremony that any holder can join.

Files: `zk/vkey.json` (verification key, in git), `zk/build/tally_js/tally.wasm` (witness generator, in git). The proving key `zk/build/tally.zkey` is 96 MB and is not in git. Its sha256 is in `zk/zkey.sha256`. Set `ZK_ZKEY_URL` and `npm run build` fetches and checks it.

## Proving on the server

With `ZK_PROVE=1`, the server proves the newest unproven round after close, one at a time, in a child process (`lib/zk-worker.js`) with a heap cap (`ZK_HEAP_MB`, default 300) and a timeout (`ZK_TIMEOUT_MS`, default 180000). Rounds over the limits are marked not proven, with the reason.

Measured for a full 128-vote round:

| Setup | Time | Peak memory |
| --- | --- | --- |
| 8 cores, multithreaded | 5.9 s | 1.16 GB |
| 1 core, multithreaded | 20 s | 1.15 GB |
| 1 core, single thread, 300 MB heap | 18 s | 429 MB |

A Render Starter instance (512 MB, 0.5 CPU) should take about 40 s per proof, well inside a 30-minute round, but with a thin memory margin. The Standard plan (2 GB) is recommended.

Endpoints: `/api/rounds/:r/proof`, `/api/rounds/:r/verify` (the server rechecks from the snapshot), `/api/zk/vkey`. The `/verify` page checks the proof in the browser.

## On-chain record

`program/` is a Solana program built on `groth16-solana`. Instruction data is a tag byte, the proof (A negated, 256 bytes) and the four public inputs (385 bytes in total). The program verifies the proof and writes a 117-byte record at the PDA `["tally", authority, round]`: round, root, winner, totals commitment, slot and authority. A second write for the same round is refused. Because the publisher key is part of the seed, nobody else can take a round's address.

Local validator test (`node scripts/zk-localnet.js`): a tampered proof is rejected, a valid proof is accepted at about 104,000 compute units, the record matches, and a duplicate is refused. Record rent is about 0.0017 SOL per round.

Enable with `ZK_ONCHAIN=1`, `NC_ZK_PROGRAM_ID`, `NC_ZK_AUTHORITY_KEY` and optionally `NC_ZK_RPC`. Not deployed to mainnet yet.

## Roadmap: anonymous voting

Today every vote is public. The path to private votes, all in the same proof system:

1. Voters commit `Poseidon(wallet, candidate, salt)` instead of a plain choice, and the circuit opens commitments privately.
2. Balances are proven against a published Merkle tree of holder balances at the closing slot, so the server no longer needs to see who voted for what.
3. A nullifier per wallet and round prevents double votes without revealing the wallet.
4. Signature checks move into the circuit, or into a lighter signed-commitment scheme, so the snapshot no longer has to list wallets.

Each step makes the proof and the proving cost larger, so they come one at a time.
