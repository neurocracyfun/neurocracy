// On-chain burn receipts. A burn counts only if the confirmed transaction:
//   - succeeded, is recent (default 24 h), and was signed by the wallet that claims it,
//   - burns at least `minRaw` base units of cfg.mint (classic SPL or Token-2022, Burn or BurnChecked,
//     outer or inner instruction) from an account whose authority is that wallet,
//   - carries an SPL Memo equal to `memo`, which binds the burn to one purpose (one nomination,
//     one reply) so it cannot be replayed for something else,
//   - has never been used before (signature ledger in the DB).
const { rpc } = require('./solana');
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const MEMO_PROGRAMS = new Set(['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']);
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const toRaw = (ui, decimals) => BigInt(Math.round(Number(ui))) * 10n ** BigInt(decimals);

// Pure check on a jsonParsed getTransaction result. Exported for tests.
function inspectBurn(tx, { mint, wallet, minRaw, memo, maxAgeSec = 86400, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!tx) throw bad('transaction not found or not confirmed yet, try again in a few seconds', 404);
  if (tx.meta && tx.meta.err) throw bad('that transaction failed on chain');
  if (tx.blockTime && nowSec - tx.blockTime > maxAgeSec) throw bad('that burn is too old');
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? { pubkey: k, signer: false } : k));
  if (!keys.some((k) => k.pubkey === wallet && k.signer)) throw bad('that transaction was not signed by your wallet');
  const all = [...tx.transaction.message.instructions, ...((tx.meta && tx.meta.innerInstructions) || []).flatMap((x) => x.instructions)];
  let burned = 0n;
  for (const ix of all) {
    if (!TOKEN_PROGRAMS.has(ix.programId) || !ix.parsed) continue;
    const { type, info } = ix.parsed; if (type !== 'burn' && type !== 'burnChecked') continue;
    if (info.mint !== mint) continue;
    if ((info.authority || info.multisigAuthority) !== wallet) continue;
    burned += BigInt(info.amount || (info.tokenAmount && info.tokenAmount.amount) || 0);
  }
  if (burned < minRaw) throw bad(burned ? 'that burn is smaller than required' : 'no burn of the token found in that transaction');
  const memos = all.filter((ix) => MEMO_PROGRAMS.has(ix.programId)).map((ix) => (typeof ix.parsed === 'string' ? ix.parsed : ''));
  if (!memos.includes(memo)) throw bad('the burn memo does not match this request');
  return { burned: burned.toString(), slot: tx.slot, blockTime: tx.blockTime || null };
}

async function verifyBurn(cfg, D, { signature, wallet, minUi, memo, purpose, getTx }) {
  if (!cfg.mint) throw bad('the token is not live yet', 409);
  if (!SIG_RE.test(String(signature || ''))) throw bad('bad transaction signature');
  D.burns ||= {};
  if (D.burns[signature]) throw bad('that burn was already used', 409);
  const fetchTx = getTx || ((s) => rpc(cfg.rpc, 'getTransaction', [s, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]));
  const tx = await fetchTx(signature);
  const r = inspectBurn(tx, { mint: cfg.mint, wallet, minRaw: toRaw(minUi, cfg.decimals), memo });
  if (D.burns[signature]) throw bad('that burn was already used', 409); // re-check after the await
  D.burns[signature] = { wallet, purpose, memo, ...r, at: Date.now() };
  return r;
}
module.exports = { inspectBurn, verifyBurn, toRaw, TOKEN_PROGRAMS, MEMO_PROGRAMS };
