// Briques d'interface : bottom sheet glissant, toasts, dialogue, icônes de manœuvre.
export const $ = (sel) => document.querySelector(sel);
export const setText = (el, v) => el.textContent !== v && (el.textContent = v);

export function showView(name) {
  for (const v of document.querySelectorAll('#sheet .view')) v.hidden = v.dataset.view !== name;
}

/** Feuille glissante : on la tire vers le bas pour ne garder que l'en-tête, vers le haut pour tout voir. */
export function initSheet(el) {
  let y = 0, start = null;
  const set = (v) => el.style.setProperty('--sheet-y', `${(y = v)}px`);
  const peek = () => {
    const head = el.querySelector('.view:not([hidden]) .sheet-head');
    return Math.max(0, el.offsetHeight - (head ? head.offsetTop + head.offsetHeight + 14 : 90));
  };
  el.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.handle, .sheet-head') || e.target.closest('button')) return;
    start = { y: e.clientY, base: y, t: e.timeStamp, max: peek() };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => start && set(Math.min(start.max, Math.max(0, start.base + e.clientY - start.y))));
  const end = (e) => {
    if (!start) return;
    const dy = e.clientY - start.y, v = dy / Math.max(1, e.timeStamp - start.t);
    el.classList.remove('dragging');
    const collapse = Math.abs(dy) < 6 ? start.base === 0 : v > 0.4 || (v > -0.4 && y > start.max / 2);
    set(collapse ? start.max : 0);
    start = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return { expand: () => set(0), height: () => el.offsetHeight - y };
}

let toastTimer = 0;
export function toast(text, { action = '', onAction, duration = 4000 } = {}) {
  const el = $('#toast'), btn = el.querySelector('button');
  el.querySelector('span').textContent = text;
  btn.textContent = action;
  btn.onclick = () => (hideToast(), onAction?.());
  // Au-dessus du panneau visible le plus haut (feuille ou barre de navigation).
  const tops = ['#sheet', '.nav-bottom'].map((s) => $(s).getBoundingClientRect()).filter((r) => r.height > 0 && r.top < innerHeight);
  el.style.setProperty('--toast-bottom', `${innerHeight - Math.min(innerHeight, ...tops.map((r) => r.top)) + 12}px`);
  el.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(hideToast, duration);
}
export const hideToast = () => ($('#toast').hidden = true);

let closeCurrent = null;
/** Dialogue modal → Promise<boolean>. cancel vide = un seul bouton. */
export function ask({ title, text, ok = 'OK', cancel = '', icon = 'i-locate' }) {
  closeCurrent?.(false);
  const d = $('#dialog'), okBtn = $('#dialog-ok'), cancelBtn = $('#dialog-cancel');
  $('#dialog-title').textContent = title;
  $('#dialog-text').textContent = text;
  d.querySelector('.dialog-icon use').setAttribute('href', `#${icon}`);
  okBtn.textContent = ok;
  cancelBtn.textContent = cancel;
  cancelBtn.hidden = !cancel;
  d.hidden = false;
  okBtn.focus();
  return new Promise((resolve) => {
    closeCurrent = (v) => {
      d.hidden = true;
      closeCurrent = null;
      resolve(v);
    };
    okBtn.onclick = () => closeCurrent(true);
    cancelBtn.onclick = () => closeCurrent(false);
  });
}
export const closeDialog = () => !!closeCurrent && (closeCurrent(false), true);

// Types de manœuvre Valhalla → icône (flip = miroir pour la gauche).
const STRAIGHT = ['m-straight'], SLIGHT_R = ['m-slight'], SLIGHT_L = ['m-slight', true];
const MANEUVERS = {
  1: STRAIGHT, 2: ['m-turn'], 3: ['m-turn', true], 4: ['m-dest'], 5: ['m-dest'], 6: ['m-dest'],
  7: STRAIGHT, 8: STRAIGHT, 17: STRAIGHT, 22: STRAIGHT,
  9: SLIGHT_R, 18: SLIGHT_R, 20: SLIGHT_R, 23: SLIGHT_R, 37: SLIGHT_R,
  16: SLIGHT_L, 19: SLIGHT_L, 21: SLIGHT_L, 24: SLIGHT_L, 38: SLIGHT_L,
  10: ['m-turn'], 15: ['m-turn', true], 11: ['m-sharp'], 14: ['m-sharp', true],
  12: ['m-uturn', true], 13: ['m-uturn'], 25: ['m-merge'], 26: ['m-roundabout'], 27: ['m-roundabout'],
  28: ['m-ferry'], 29: ['m-ferry'],
};
export function maneuverIcon(type) {
  const [id, flip = false] = MANEUVERS[type] || STRAIGHT;
  return { id, flip };
}
