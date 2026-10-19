// Thin client for Neuronpedia's public steering API.
const NP = process.env.NP_BASE || 'https://www.neuronpedia.org';
const MODEL = process.env.NP_MODEL || 'gemma-2-9b-it';
const fmt = (q) => `Question: ${q}\nAnswer:`;
async function steer(question, features, { tokens = 56, seed = 16, key = process.env.NEURONPEDIA_API_KEY } = {}) {
  const body = {
    prompt: fmt(question), modelId: MODEL,
    features: features.map((f) => ({ modelId: MODEL, layer: f.layer, index: Number(f.index), strength: Number(f.strength) })),
    temperature: 0.5, n_tokens: tokens, freq_penalty: 1, seed, strength_multiplier: 4, steer_special_tokens: false,
  };
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  const t0 = Date.now();
  const r = await fetch(NP + '/api/steer', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const remaining = r.headers.get('x-limit-remaining');
  if (!r.ok) { const e = new Error('neuronpedia ' + r.status); e.status = r.status; e.remaining = remaining; throw e; }
  const j = await r.json();
  const clean = (s) => String(s || '').replace(/<[^>]{1,20}>/g, '').replace(/\n?Question:[\s\S]*$/, '').trim();
  return { steered: clean(j.STEERED), normal: clean(j.DEFAULT), share: j.shareUrl || null, ms: Date.now() - t0, remaining };
}
async function searchFeatures(query) {
  const r = await fetch(NP + '/api/explanation/search-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: MODEL, query }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const e = new Error('neuronpedia ' + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  const seen = new Set();
  return (j.results || []).filter((x) => /^(9|20|31)-gemmascope-res-16k$/.test(x.layer)).filter((x) => { const k = x.layer + '/' + x.index; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8).map((x) => ({ layer: x.layer, index: Number(x.index), label: String(x.description || '').trim().slice(0, 80) }));
}
module.exports = { steer, searchFeatures, MODEL, NP };
