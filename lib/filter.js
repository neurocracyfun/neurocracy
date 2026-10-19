// Light content filter for anything the steered model writes in public (X posts, replies, Hall).
// Rejects instead of editing: the only automatic changes are whitespace/markdown cleanup and a cut
// at a sentence boundary to fit 280 chars.
const SLURS = ['nigger', 'nigga', 'faggot', 'fag', 'retard', 'tranny', 'kike', 'spic', 'chink', 'gook', 'wetback', 'coon', 'dyke', 'cunt'];
const RULES = [
  ['slur', (t) => new RegExp('\\b(' + SLURS.join('|') + ')s?\\b', 'i').test(t)],
  ['group-target', (t) => /\b(black|white|jewish|jews|muslim|asian|gay|trans|mexican)\s+(people|men|women|folks)\b/i.test(t)],
  ['financial-advice', (t) => /\b(buy|sell|ape|invest(ing)? in|price target|to the moon|100x|1000x|guaranteed|not financial advice|nfa|pump(ing)?|dump(ing)?|moon(ing)?|presale|airdrop|giveaway|returns?)\b/i.test(t)],
  ['ticker-or-ca', (t) => /\$[A-Za-z]{2,10}\b/.test(t) || /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(t) || /\b0x[0-9a-fA-F]{40}\b/.test(t) || /\bCA\b/.test(t)],
  ['url', (t) => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|fun|xyz|io|ai|net|org)\b)/i.test(t)],
  ['impersonation', (t) => /\b(hoot|sauers_?|iamhoot_?)\b/i.test(t) || /@/.test(t)],
  ['symbols', (t) => /[^\p{L}\p{N}\s.,!?'"():;\-]/u.test(t)],
  ['too-long', (t) => t.length > 280],
  ['too-short', (t) => t.length < 30],
  ['garbled', (t) => garbled(t)],
];
function garbled(t) {
  const w = t.toLowerCase().match(/[a-z']+/g) || [];
  if (w.length < 6) return true;
  const uniq = new Set(w).size / w.length;
  if (uniq < 0.45) return true;
  for (let n = 3; n <= 6; n++) { const seen = new Set(); for (let i = 0; i + n <= w.length; i++) { const k = w.slice(i, i + n).join(' '); if (seen.has(k)) return true; seen.add(k); } }
  return false;
}
function clean(raw, prompt = '') {
  let t = String(raw || '').replace(/<[^>]{1,20}>/g, ' ');
  if (prompt) { const i = t.indexOf(prompt); if (i >= 0 && i < 40) t = t.slice(i + prompt.length); }
  t = t.replace(/^\s*(Answer|Question|Post|A|Q)\s*:\s*/i, '').replace(/\n?(Question|Answer)\s*:[\s\S]*$/i, '');
  t = t.replace(/[*_#`>~|]+/g, ' ').replace(/^\s*[-•]\s+/gm, '').replace(/\[[^\]]{0,40}\]/g, ' ');
  t = t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, ', ').replace(/\u2026/g, '...');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 280) {
    const cut = t.slice(0, 280); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = end > 60 ? cut.slice(0, end + 1) : cut;
  } else if (!/[.!?"]$/.test(t)) {
    const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
    if (end > 60) t = t.slice(0, end + 1);
  }
  return t.trim();
}
function check(t) { const why = RULES.filter(([, f]) => f(t)).map(([n]) => n); return { ok: why.length === 0, why }; }
function score(t) { return -Math.abs(t.length - 190) + (/[.!?]$/.test(t) ? 25 : 0); }
module.exports = { clean, check, score, garbled };
