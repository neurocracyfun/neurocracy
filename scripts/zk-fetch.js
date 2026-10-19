// Fetches the Groth16 proving key (zk/build/tally.zkey, 96 MB) from ZK_ZKEY_URL and checks it against zk/zkey.sha256.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const dest = path.join(__dirname, '..', 'zk', 'build', 'tally.zkey'); const want = fs.readFileSync(path.join(__dirname, '..', 'zk', 'zkey.sha256'), 'utf8').trim();
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
(async () => {
  if (fs.existsSync(dest) && sha(dest) === want) return console.log('zkey present');
  const url = process.env.ZK_ZKEY_URL; if (!url) return console.log('zkey absent and ZK_ZKEY_URL not set; proving stays off');
  const r = await fetch(url); if (!r.ok) throw new Error('zkey download HTTP ' + r.status);
  fs.mkdirSync(path.dirname(dest), { recursive: true }); const tmp = dest + '.part'; fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  if (sha(tmp) !== want) { fs.rmSync(tmp); throw new Error('zkey checksum mismatch, not used'); }
  fs.renameSync(tmp, dest); console.log('zkey fetched and verified');
})().catch((e) => { console.log('[zk-fetch] ' + e.message); });
