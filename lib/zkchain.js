// On-chain record of tally proofs (program/ = neurocracy-tally-verifier). Optional: needs
// ZK_ONCHAIN=1, NC_ZK_PROGRAM_ID and NC_ZK_AUTHORITY_KEY (the publisher wallet, server only, never logged).
// ZK_ONCHAIN_MODE=verify (default): the program checks the proof and logs it, no account and no rent; the
// transaction carries the proof and public inputs, so anyone can re-check it from its signature.
// ZK_ONCHAIN_MODE=record: also stores a 117-byte record per round (about 0.0017 SOL rent each, ~30 SOL a year).
const web3 = require('@solana/web3.js'); const bs58 = (require('bs58').default || require('bs58'));
const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n; // BN254 base field
const be = (n) => Buffer.from(BigInt(n).toString(16).padStart(64, '0'), 'hex');
// proof_a negated, G2 limbs swapped (c1 before c0), public inputs as 32-byte big-endian
function encode(proof, publicSignals, tag = 0) {
  const a = Buffer.concat([be(proof.pi_a[0]), be((P - BigInt(proof.pi_a[1])) % P)]);
  const b = Buffer.concat([be(proof.pi_b[0][1]), be(proof.pi_b[0][0]), be(proof.pi_b[1][1]), be(proof.pi_b[1][0])]);
  const c = Buffer.concat([be(proof.pi_c[0]), be(proof.pi_c[1])]);
  return Buffer.concat([Buffer.from([tag]), a, b, c, ...publicSignals.map(be)]);
}
const recordAddress = (programId, authority, round) => { const r = Buffer.alloc(8); r.writeBigUInt64LE(BigInt(round)); return web3.PublicKey.findProgramAddressSync([Buffer.from('tally'), new web3.PublicKey(authority).toBuffer(), r], new web3.PublicKey(programId))[0]; };
function parseRecord(data) {
  if (!data || data.length < 117 || data[0] !== 1) return null;
  return { round: Number(data.readBigUInt64LE(1)), root: BigInt('0x' + data.subarray(9, 41).toString('hex')).toString(), winner: data.readUInt32LE(41), totalsCommit: BigInt('0x' + data.subarray(45, 77).toString('hex')).toString(), slot: Number(data.readBigUInt64LE(77)), authority: new web3.PublicKey(data.subarray(85, 117)).toBase58() };
}
function createZkChain({ rpc, programId, authorityKey, mode = 'verify' }) {
  if (!programId || !rpc) return null;
  const conn = new web3.Connection(rpc, 'confirmed'); const pid = new web3.PublicKey(programId);
  let kp = null; try { if (authorityKey) kp = web3.Keypair.fromSecretKey(authorityKey.trim().startsWith('[') ? Uint8Array.from(JSON.parse(authorityKey)) : bs58.decode(authorityKey.trim())); } catch { kp = null; }
  return {
    authority: () => (kp ? kp.publicKey.toBase58() : null),
    mode: () => mode,
    async submit(round, proof, publicSignals) {
      if (!kp) throw new Error('no authority key');
      const cu = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
      if (mode !== 'record') {
        const ix = new web3.TransactionInstruction({ programId: pid, keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: true }], data: encode(proof, publicSignals, 1) });
        const sig = await web3.sendAndConfirmTransaction(conn, new web3.Transaction().add(cu, web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.NC_ZK_PRIORITY_MICROLAMPORTS || 5000) }), ix), [kp], { commitment: 'confirmed' });
        return { sig, record: null, mode: 'verify' };
      }
      const rec = recordAddress(pid, kp.publicKey, round);
      const ix = new web3.TransactionInstruction({ programId: pid, keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: true }, { pubkey: rec, isSigner: false, isWritable: true }, { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }], data: encode(proof, publicSignals, 0) });
      const sig = await web3.sendAndConfirmTransaction(conn, new web3.Transaction().add(cu, web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.NC_ZK_PRIORITY_MICROLAMPORTS || 5000) }), ix), [kp], { commitment: 'confirmed' });
      return { sig, record: rec.toBase58(), mode: 'record' };
    },
    // re-check a verify-mode transaction: it succeeded, called this program, and carried these public inputs
    async checkTx(sig) {
      const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx || tx.meta.err) return null;
      const keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
      const ix = (tx.transaction.message.compiledInstructions || tx.transaction.message.instructions).find((i) => keys[i.programIdIndex].equals(pid));
      if (!ix) return null; const d = Buffer.from(ix.data instanceof Uint8Array ? ix.data : bs58.decode(ix.data));
      const n = (o) => BigInt('0x' + d.subarray(o, o + 32).toString('hex')).toString();
      return { signer: keys[0].toBase58(), round: Number(n(257)), root: n(289), winner: Number(n(321)), totalsCommit: n(353), slot: tx.slot };
    },
    async read(round, authority) { if (mode !== 'record' && !authority) return null; const a = recordAddress(pid, authority || kp.publicKey, round); const i = await conn.getAccountInfo(a, 'confirmed'); return i && i.owner.equals(pid) ? { address: a.toBase58(), ...parseRecord(i.data) } : null; },
  };
}
module.exports = { encode, recordAddress, parseRecord, createZkChain };
