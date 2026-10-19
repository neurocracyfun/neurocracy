// Child process for one tally proof. Reads the snapshot JSON on stdin, writes the result JSON on stdout.
// Running it out of process keeps the web server's heap small and lets the parent cap memory and time.
const zk = require('./zk');
let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', async () => {
  try { const r = await zk.prove(s); process.stdout.write(JSON.stringify(r)); process.exit(0); }
  catch (e) { process.stdout.write(JSON.stringify({ status: 'failed', error: String(e.message).slice(0, 200) })); process.exit(0); }
});
