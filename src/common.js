import { mountBrain, regionFor } from './brain.js';
export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'request failed'); return j;
}
export const pad = (n) => String(n).padStart(2, '0');
export const clock = (ms) => { ms = Math.max(0, ms); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return (h ? h + ':' : '') + pad(m) + ':' + pad(s); };
export const fmt = (n) => Number(n || 0).toLocaleString('en-US');
export const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };
export const mixHTML = (mix) => (mix || []).map((f) => `<div class="feat"><span class="l">${esc(f.label || 'feature ' + f.index)}</span><span class="s">+${esc(f.strength)}</span><span class="m">${esc(f.layer)} #${esc(f.index)}</span></div>`).join('');

// ---- background brain ----
export let brain = null;
export function startBrain(handle) {
  const canvas = $('#brain'); if (!canvas) return null;
  try { brain = mountBrain({ canvas, handle: handle || document.createElement('div') }); } catch (e) { console.warn('webgl off', e); canvas.remove(); }
  return brain;
}
export const fireFor = (id, k = 1) => brain && brain.light(regionFor(id), k);

// ---- reveal on scroll ----
export function reveals() {
  fetch('/api/round').then((r) => r.json()).then((r) => { const el = document.getElementById('mh-round'); if (el) el.textContent = String(r.round); }).catch(() => {});
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  const p = document.body.className; document.querySelectorAll('.mh-index a').forEach((a) => { if (a.dataset.p && p.includes(a.dataset.p)) a.classList.add('on'); });
}

// ---- wallet (Phantom, Solflare, Backpack): connect + signMessage only, never a transaction ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(bytes) {
  let n = 0n; for (const b of bytes) n = (n << 8n) + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; } return s;
}
const provider = () => window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana || null;
export const wallet = {
  address: localStorage.getItem('nc.wallet') || null,
  async connect() {
    const p = provider(); if (!p) throw new Error('No Solana wallet found. Install Phantom or Solflare.');
    const r = await p.connect(); const pk = (r && r.publicKey) || p.publicKey; this.address = pk.toString();
    localStorage.setItem('nc.wallet', this.address); return this.address;
  },
  async sign(message) {
    const p = provider(); if (!p) throw new Error('No Solana wallet found.');
    if (!p.isConnected && !p.publicKey) await this.connect();
    const r = await p.signMessage(new TextEncoder().encode(message), 'utf8');
    return b58(r.signature || r);
  },
  short: (a) => (a ? a.slice(0, 4) + '...' + a.slice(-4) : ''),
};
