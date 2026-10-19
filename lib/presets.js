// Curated presets: normal vs steered answers generated ahead of time (scripts/gen-presets.js).
const fs = require('fs');
const { garbled } = require('./filter');
function tidy(s, q) {
  let t = String(s || '').replace(/<[^>]{1,20}>/g, '');
  for (let k = 0; k < 2; k++) { t = t.trim(); if (q && t.startsWith(q)) t = t.slice(q.length); t = t.replace(/^\s*(Answer|Question)\s*:\s*/i, ''); }
  t = t.replace(/\n?\s*(Question|Answer)\s*:[\s\S]*$/i, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const end = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'));
  if (end > 40 && end < t.length - 1) t = t.slice(0, end + 1);
  return t;
}
function loadPresets(file) {
  let raw = { model: 'gemma-2-9b-it', normals: {}, presets: [] };
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const normals = Object.fromEntries(Object.entries(raw.normals || {}).map(([q, v]) => [q, tidy(v, q)]));
  const presets = (raw.presets || []).map((p) => ({ id: p.id, name: p.name, note: p.note, features: p.features, samples: (p.samples || []).map((s) => ({ prompt: s.prompt, steered: tidy(s.steered, s.prompt), normal: normals[s.prompt] || '', share: s.share, good: !garbled(tidy(s.steered, s.prompt)) && tidy(s.steered, s.prompt).length > 40 })) }));
  return { model: raw.model, generatedAt: raw.generatedAt, list: () => presets, prompts: Object.keys(normals), find: (id) => presets.find((p) => p.id === id) };
}
module.exports = { loadPresets, tidy };
