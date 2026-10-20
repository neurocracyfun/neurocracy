// Read only. Exit 0 only if the coin's pump.fun fee sharing config pays 100% (10,000 bps) to TREASURY
// and is locked (admin revoked). Usage: node scripts/check-feeshare.js <MINT> <TREASURY> [rpc]
const web3 = require('@solana/web3.js'); const sdk = require('@pump-fun/pump-sdk'); const { checkConfig } = require('../lib/feesweep');
const [mint, treasury, rpc = 'https://api.mainnet-beta.solana.com'] = process.argv.slice(2);
(async () => {
  const conn = new web3.Connection(rpc, 'confirmed'); const pda = sdk.feeSharingConfigPda(new web3.PublicKey(mint));
  const info = await conn.getAccountInfo(pda, 'confirmed');
  let sc = null;
  if (info) { if (!info.owner.equals(sdk.PUMP_FEE_PROGRAM_ID)) { console.log('REFUSED: sharing config account is not owned by the Pump Fees program'); process.exit(1); }
    const d = sdk.PUMP_SDK.decodeSharingConfig(info); sc = { adminRevoked: d.adminRevoked, shareholders: d.shareholders.map((s) => ({ address: s.address.toBase58(), shareBps: Number(s.shareBps) })) }; }
  const bad = checkConfig(sc, treasury);
  if (bad) { console.log('REFUSED: ' + bad + '. In pump.fun, set Creator Fee Sharing to 100% for ' + treasury + ' and confirm, then run again.'); process.exit(1); }
  console.log('fee sharing ok: ' + pda.toBase58() + ' pays 100% to ' + treasury + ', locked');
})().catch((e) => { console.log('REFUSED: could not read the sharing config (' + e.message + ')'); process.exit(1); });
