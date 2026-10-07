// Small DOM helpers and in-app dialogs (never the browser's alert/confirm).
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// dialog(title, bodyHtml, [{label, value, primary, danger}]) -> clicked value,
// or null if dismissed. `read(box)` runs before closing to collect inputs.
export function dialog(title, body, buttons = [{ label: 'OK', value: true, primary: true }], read) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2><div class="dialog-body">${body}</div>
      <div class="dialog-actions">${buttons.map((b, i) =>
        `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const done = v => { wrap.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') done(null); };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) return done(null);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const btn = buttons[+b.dataset.i];
      done(read && btn.value !== null && btn.value !== false ? read(wrap) ?? btn.value : btn.value);
    });
    wrap.addEventListener('submit', e => e.preventDefault());
    document.addEventListener('keydown', key);
    document.body.append(wrap);
    $('input,select,textarea', wrap)?.focus();
  });
}

export const confirmDialog = (title, text, yes = 'Yes', danger = false) =>
  dialog(title, `<p>${esc(text)}</p>`, [{ label: 'Cancel', value: false }, { label: yes, value: true, primary: !danger, danger }]);

export const alertDialog = (title, text) => dialog(title, `<p>${esc(text)}</p>`);

export function ago(ms) {
  if (!ms) return '';
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}
