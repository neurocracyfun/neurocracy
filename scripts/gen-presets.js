// Pre-generates normal vs steered answers for every preset x prompt via Neuronpedia.
// Resumable: skips pairs already in data/presets.json. Run: node scripts/gen-presets.js
const fs = require('fs'); const path = require('path');
const { steer } = require('../lib/np');
const def = require('./presets-def.json');
const out = path.join(__dirname, '..', 'data', 'presets.json');
const db = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { model: def.model, generatedAt: null, normals: {}, presets: [] };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (const p of def.presets) {
    let row = db.presets.find((x) => x.id === p.id);
    if (!row) { row = { ...p, samples: [] }; db.presets.push(row); }
    Object.assign(row, { name: p.name, note: p.note, features: p.features });
    for (const q of def.prompts) {
      if (row.samples.find((s) => s.prompt === q)) continue;
      try {
        const r = await steer(q, p.features);
        row.samples.push({ prompt: q, steered: r.steered, share: r.share });
        if (!db.normals[q]) db.normals[q] = r.normal;
        console.log(p.id, '|', q.slice(0, 24), '|', r.ms + 'ms rem=' + r.remaining, '|', r.steered.slice(0, 70).replace(/\n/g, ' '));
        if (Number(r.remaining) < 30) { console.log('limit low, stopping'); break; }
      } catch (e) { console.log(p.id, q, 'ERR', e.message); if (e.status === 429) { await wait(60000); } }
      db.generatedAt = new Date().toISOString();
      fs.writeFileSync(out, JSON.stringify(db, null, 1));
      await wait(400);
    }
  }
  console.log('DONE');
})();
