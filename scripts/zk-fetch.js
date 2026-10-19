// Fetches the Groth16 proving key (zk/build/tally.zkey, 96 MB) and checks it against zk/zkey.sha256.
// Source: ZK_ZKEY_URL, default the zk-v1 GitHub release. Runs when ZK_PROVE=1 or ZK_ZKEY_URL is set.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const dest = path.join(__dirname, '..', 'zk', 'build', 'tally.zkey'); const want = fs.readFileSync(path.join(__dirname, '..', 'zk', 'zkey.sha256'), 'utf8').trim();
const DEFAULT_URL = 'https://github.com/neurocracyfun/neurocracy/releases/download/zk-v1/tally.zkey';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
(async () => {
  if (fs.existsSync(dest) && sha(dest) === want) return console.log('zkey present');
  if (process.env.ZK_PROVE !== '1' && !process.env.ZK_ZKEY_URL) return console.log('zkey absent, proving off (set ZK_PROVE=1 to fetch it)');
  const url = process.env.ZK_ZKEY_URL || DEFAULT_URL;
  const r = await fetch(url); if (!r.ok) throw new Error('zkey download HTTP ' + r.status);
  fs.mkdirSync(path.dirname(dest), { recursive: true }); const tmp = dest + '.part'; fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  if (sha(tmp) !== want) { fs.rmSync(tmp); throw new Error('zkey checksum mismatch, not used'); }
  fs.renameSync(tmp, dest); console.log('zkey fetched and verified');
})().catch((e) => { console.log('[zk-fetch] ' + e.message); });
