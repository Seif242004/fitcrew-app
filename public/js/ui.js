import { h } from './dom.js';
import { api } from './api.js';

const ICONS = {
  today: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l3 3 5-6',
  plan: 'M5 5h14v15H5zM5 10h14M9 3v4M15 3v4',
  progress: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  group: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 3-5 6-5s6 2 6 5M16 6a3 3 0 0 1 0 5M18 14c2 .5 3 2 3 5',
  train: 'M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  chevL: 'M15 5l-7 7 7 7',
  chevR: 'M9 5l7 7-7 7',
  check: 'M5 12l5 5 9-10',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
};

export const icon = (name, size = 24) =>
  h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    h('path', { d: ICONS[name] }));

let toastTimer;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

/** Bottom sheet. build(close) returns the content; returns close(). */
export function sheet(title, build) {
  const dlg = h('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.append(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close', 22))),
    build(close)));
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

export function confirmSheet(title, message, confirmLabel, onConfirm, danger = false) {
  return sheet(title, (close) => h('div', { class: 'stack' },
    h('p', {}, message),
    h('div', { class: 'row-flex' },
      h('button', { class: `btn ${danger ? 'danger' : ''}`, onclick: async () => { close(); await onConfirm(); } }, confirmLabel),
      h('button', { class: 'btn ghost', onclick: close }, 'Cancel'))));
}

/** One macro plate: a ring showing eaten against target. */
export function plate({ label, value, target, kind }) {
  const r = 30;
  const C = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  return h('div', { class: 'plate' },
    h('svg', { viewBox: '0 0 80 80', width: 84, height: 84, role: 'img', 'aria-label': `${label}: ${Math.round(value)} of ${Math.round(target)} grams` },
      h('circle', { class: `ring track ${kind}`, cx: 40, cy: 40, r }),
      h('circle', { class: `ring ${kind}`, cx: 40, cy: 40, r, 'stroke-dasharray': `${C * pct} ${C}`, transform: 'rotate(-90 40 40)' }),
      h('text', { class: 'plate-num', x: 40, y: 48, 'text-anchor': 'middle' }, Math.round(value))),
    h('div', { class: 'plate-label' }, label),
    h('div', { class: 'plate-sub' }, `of ${Math.round(target)} g`));
}

export function seg(options, value, onChange, label) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const draw = (v) => {
    wrap.replaceChildren(...options.map(([val, text]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(val === v), onclick: () => { onChange(val); draw(val); } }, text)));
  };
  draw(value);
  return wrap;
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

export const numInput = (value, attrs = {}) =>
  h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: value ?? '', ...attrs });

export function emptyState(title, text, action) {
  return h('section', { class: 'empty' }, h('h2', { class: 'h2' }, title), h('p', {}, text), action);
}

export function errorBlock(e, retry) {
  return h('section', { class: 'empty' },
    h('h2', { class: 'h2' }, e.offline ? "You're offline" : 'That did not load'),
    h('p', {}, e.message),
    retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null);
}

/** Exercise search for the add and swap sheets. onPick(exercise) */
export function exercisePicker(onPick) {
  const list = h('div', {});
  const input = h('input', { type: 'text', placeholder: 'Search exercises (squat, row, chest…)', 'aria-label': 'Search exercises', autocomplete: 'off' });
  let t;
  const run = async () => {
    try {
      const { exercises } = await api('GET', `/api/exercises?q=${encodeURIComponent(input.value.trim())}`);
      list.replaceChildren(...(exercises.length
        ? exercises.map((e) => h('button', { class: 'list-row', onclick: () => onPick(e) },
            h('span', { class: 'grow' }, h('span', { class: 'strong' }, e.name), h('span', { class: 'sub' }, `${e.muscle} · ${e.equip}`))))
        : [h('p', { class: 'muted pad' }, 'No match. Ask the admin to add this exercise.')]));
    } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 180); });
  run();
  return h('div', { class: 'stack' }, input, list);
}

/** Food search used by the swap and add-food sheets. onPick(food) */
export function foodPicker(onPick) {
  const list = h('div', {});
  const input = h('input', { type: 'text', placeholder: 'Search foods (rice, chicken, ful…)', 'aria-label': 'Search foods', autocomplete: 'off' });
  let t;
  const run = async () => {
    try {
      const { foods } = await api('GET', `/api/foods?q=${encodeURIComponent(input.value.trim())}`);
      list.replaceChildren(...(foods.length
        ? foods.slice(0, 40).map((f) => h('button', { class: 'list-row', onclick: () => onPick(f) },
            h('span', { class: 'grow' }, h('span', { class: 'strong' }, f.name), h('span', { class: 'sub' }, `${Math.round(f.kcal)} kcal · P ${f.p} · C ${f.c} · F ${f.f} per 100 g`))))
        : [h('p', { class: 'muted pad' }, 'No match. Ask the admin to add this food.')]));
    } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 180); });
  run();
  return h('div', { class: 'stack' }, input, list);
}
