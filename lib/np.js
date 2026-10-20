// Thin client for Neuronpedia's public steering API.
const NP = process.env.NP_BASE || 'https://www.neuronpedia.org';
const MODEL = process.env.NP_MODEL || 'gemma-2-9b-it';
// Neuronpedia returns 500 when the same feature appears twice in one request, and very high strengths only produce noise.
// Merge duplicates (strengths add up) and clamp each strength to the supported range.
const MAX_STRENGTH = 100;
const normFeatures = (features) => { const m = new Map(); for (const f of features) { const k = f.layer + '/' + Number(f.index); const s = Number(f.strength) || 0; if (m.has(k)) m.get(k).strength += s; else m.set(k, { modelId: MODEL, layer: f.layer, index: Number(f.index), strength: s }); }
  return [...m.values()].map((f) => ({ ...f, strength: Math.max(-MAX_STRENGTH, Math.min(MAX_STRENGTH, Math.round(f.strength))) })); };
// One retry on 5xx or network errors after a short pause.
async function post(url, init) { let last; for (let i = 0; i < 2; i++) { try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(90000) }); if (r.status < 500 || i === 1) return r; last = r; } catch (e) { if (i === 1) throw e; last = e; } await new Promise((ok) => setTimeout(ok, Number(process.env.NP_RETRY_MS || 1500))); } return last; }
const fmt = (q) => `Question: ${q}\nAnswer:`;
async function steer(question, features, { tokens = 56, seed = 16, key = process.env.NEURONPEDIA_API_KEY, chat = false, multiplier } = {}) {
  if (chat) return steerChat(question, features, { tokens, seed, key, multiplier });
  const body = {
    prompt: fmt(question), modelId: MODEL,
    features: normFeatures(features),
    temperature: 0.5, n_tokens: tokens, freq_penalty: 1, seed, strength_multiplier: 4, steer_special_tokens: false,
  };
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  const t0 = Date.now();
  const r = await post(NP + '/api/steer', { method: 'POST', headers, body: JSON.stringify(body) });
  const remaining = r.headers.get('x-limit-remaining');
  if (!r.ok) { const e = new Error('neuronpedia ' + r.status); e.status = r.status; e.remaining = remaining; throw e; }
  const j = await r.json();
  const clean = (s) => String(s || '').replace(/<[^>]{1,20}>/g, '').replace(/\n?Question:[\s\S]*$/, '').trim();
  return { steered: clean(j.STEERED), normal: clean(j.DEFAULT), share: j.shareUrl || null, ms: Date.now() - t0, remaining };
}
// Chat form (Gemma chat template on Neuronpedia's side): used for replies, so the model answers the message as a turn
// in a conversation instead of continuing a "Question/Answer" document.
async function steerChat(userText, features, { tokens = 64, seed = 16, key = process.env.NEURONPEDIA_API_KEY, multiplier = 4 } = {}) {
  const msgs = [{ role: 'user', content: userText }];
  const body = { defaultChatMessages: msgs, steeredChatMessages: msgs, modelId: MODEL,
    features: normFeatures(features),
    temperature: 0.6, n_tokens: tokens, freq_penalty: 1, seed, strength_multiplier: multiplier, steer_special_tokens: false };
  const headers = { 'Content-Type': 'application/json' }; if (key) headers['x-api-key'] = key;
  const t0 = Date.now();
  const r = await post(NP + '/api/steer-chat', { method: 'POST', headers, body: JSON.stringify(body) });
  const remaining = r.headers.get('x-limit-remaining');
  if (!r.ok) { const e = new Error('neuronpedia ' + r.status); e.status = r.status; e.remaining = remaining; throw e; }
  const j = await r.json();
  const last = (x) => { const t = (x && x.chatTemplate) || []; const a = t.filter((m) => m.role === 'assistant').pop(); return String((a && a.content) || '').replace(/<[^>]{1,20}>/g, '').trim(); };
  return { steered: last(j.STEERED), normal: last(j.DEFAULT), share: j.shareUrl || null, ms: Date.now() - t0, remaining };
}
async function searchFeatures(query) {
  const r = await fetch(NP + '/api/explanation/search-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: MODEL, query }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const e = new Error('neuronpedia ' + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  const seen = new Set();
  return (j.results || []).filter((x) => /^(9|20|31)-gemmascope-res-16k$/.test(x.layer)).filter((x) => { const k = x.layer + '/' + x.index; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8).map((x) => ({ layer: x.layer, index: Number(x.index), label: String(x.description || '').trim().slice(0, 80) }));
}
module.exports = { normFeatures, MAX_STRENGTH, steer, steerChat, searchFeatures, MODEL, NP };
