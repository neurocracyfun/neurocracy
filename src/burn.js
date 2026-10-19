// Builds and sends a burn in the user's wallet: BurnChecked of the token plus an SPL Memo that binds
// the burn to one request. Reads go through the site's /api/rpc proxy; the wallet signs and sends.
import { wallet } from './common.js';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const rpc = async (method, params) => { const r = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result; };
const provider = () => window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana || null;

export async function burnWithMemo({ mint, decimals, amountUi, memo }) {
  const { PublicKey, Transaction, TransactionInstruction } = await import('@solana/web3.js');
  if (!wallet.address) await wallet.connect();
  const owner = new PublicKey(wallet.address); const mintKey = new PublicKey(mint);
  const accs = await rpc('getTokenAccountsByOwner', [wallet.address, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const raw = BigInt(Math.round(amountUi)) * 10n ** BigInt(decimals);
  const acc = (accs.value || []).find((a) => BigInt(a.account.data.parsed.info.tokenAmount.amount) >= raw);
  if (!acc) throw new Error(`You need at least ${Number(amountUi).toLocaleString('en-US')} tokens in one account.`);
  const programId = new PublicKey(acc.account.owner);           // Token-2022 or classic SPL, whichever holds it
  const data = new Uint8Array(10); data[0] = 15;                // BurnChecked
  new DataView(data.buffer).setBigUint64(1, raw, true); data[9] = decimals;
  const burn = new TransactionInstruction({ programId, keys: [{ pubkey: new PublicKey(acc.pubkey), isSigner: false, isWritable: true }, { pubkey: mintKey, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data });
  const memoIx = new TransactionInstruction({ programId: new PublicKey(MEMO), keys: [{ pubkey: owner, isSigner: true, isWritable: false }], data: new TextEncoder().encode(memo) });
  const { blockhash, lastValidBlockHeight } = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(burn, memoIx);
  const p = provider(); if (!p) throw new Error('No Solana wallet found.');
  const r = await p.signAndSendTransaction(tx);
  return r.signature || r;
}
// the server answers 404 until the transaction is confirmed; retry for about a minute
export async function submitWithRetry(fn, onWait) {
  for (let i = 0; i < 20; i++) {
    try { return await fn(); } catch (e) { if (!/not found|not confirmed/i.test(e.message)) throw e; onWait && onWait(i); await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw new Error('The burn did not confirm in time. Submit the same transaction again in a minute; it can only be used once.');
}
