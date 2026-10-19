// Builds HTML pages from pages/ (shared head + foot) and bundles browser code from src/ with esbuild.
const fs = require('fs'); const path = require('path'); const esbuild = require('esbuild');
const root = path.join(__dirname, '..'); const P = (...a) => path.join(root, ...a);
const head = fs.readFileSync(P('pages/_head.html'), 'utf8'); const foot = fs.readFileSync(P('pages/_foot.html'), 'utf8');
for (const f of fs.readdirSync(P('pages')).filter((f) => !f.startsWith('_') && f.endsWith('.html'))) {
  const src = fs.readFileSync(P('pages', f), 'utf8'); const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = Object.fromEntries(m[1].split('\n').map((l) => [l.split(':')[0].trim(), l.slice(l.indexOf(':') + 1).trim()]));
  const fill = (t) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => meta[k] || '');
  fs.writeFileSync(P('public', f), fill(head) + src.slice(m[0].length) + fill(foot));
}
fs.rmSync(P('public/js'), { recursive: true, force: true });
esbuild.buildSync({ entryPoints: ['landing', 'lab', 'vote', 'hall', 'verify'].map((n) => P('src', n + '.js')), bundle: true, minify: true, format: 'esm', splitting: true, outdir: P('public/js'), target: ['es2020'], legalComments: 'none' });
fs.mkdirSync(P('public/vendor'), { recursive: true });
fs.copyFileSync(P('node_modules/snarkjs/build/snarkjs.min.js'), P('public/vendor/snarkjs.min.js')); // browser proof check on /verify
console.log('built pages + public/js');
