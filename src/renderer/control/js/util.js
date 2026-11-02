// Petits outils partagés par l'interface de régie.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 75.4 → « 1:15 » ; avec tenths : « 1:15.4 »
export function fmtTime(sec, tenths = false) {
  if (!isFinite(sec) || sec == null) return tenths ? '-:--.-' : '-:--';
  const neg = sec < 0;
  let s = Math.abs(sec);
  if (tenths) s = Math.floor(s * 10) / 10;
  else s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ss = tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return (neg ? '-' : '') + body;
}

// Champ de saisie d'un temps : « 1:15.4 », « 75.4 » ou « 1:02:03 ». Retourne null si vide.
export function parseTime(text) {
  const t = String(text).trim().replace(',', '.');
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !isFinite(p) || p < 0)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function fmtInputTime(sec) {
  if (sec == null || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function toast(message, kind = '', ms = 4500) {
  const node = el('div', { class: `toast ${kind}`, text: message });
  document.getElementById('toasts').append(node);
  setTimeout(() => node.remove(), ms);
}

export function uid() {
  return crypto.randomUUID();
}
