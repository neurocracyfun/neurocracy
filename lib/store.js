// Tiny JSON store with atomic writes. Path from env DB (e.g. /var/data/db.json on a persistent disk).
const fs = require('fs'); const path = require('path');
function open(file) {
  const blank = { rounds: {}, votes: {}, candidates: {}, lab: [], labUse: {}, posts: [], links: {}, mentions: { sinceId: null, seen: [] }, xDay: {}, feats: {} };
  let data = blank;
  try { data = { ...blank, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  let timer = null;
  const flush = () => {
    timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file);
  };
  return { data, save: () => { if (!timer) timer = setTimeout(flush, 50); }, flush };
}
module.exports = { open };
