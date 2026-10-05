import { h } from './dom.js';
import { shiftDate, fmtDate } from './state.js';
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
  swap: 'M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7',
  coach: 'M4 5h16v11H10l-4 4v-4H4z M8 10h.01 M12 10h.01 M16 10h.01',
  drop: 'M12 3c3.5 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.5-6.8 6-11z',
  send: 'M5 12h13M12 5l7 7-7 7',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  dots: 'M4 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M17 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  play: 'M9 6.5v11l9-5.5z',
  minus: 'M5 12h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  flame: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5.5.5 1.5 1.5 2.5 2.5 2.5C12 7.5 11.5 5 12 3z',
  compare: 'M12 4v16M4 6h5v12H4zM15 6h5v12h-5z',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M9.5 17h5',
  chart: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  scale: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8.5 10a3.5 3.5 0 0 1 7 0zM12 10l1.5-2',
  cloud: 'M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z',
};

export const icon = (name, size = 24) =>
  h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    h('path', { d: ICONS[name] }));

let toastTimer;
/** Toast with an optional action, e.g. toast('Breakfast logged', '', { label: 'Undo', run }). */
export function toast(msg, kind = '', action = null) {
  const el = document.getElementById('toast');
  el.replaceChildren(h('span', {}, msg));
  if (action) el.append(h('button', { type: 'button', onclick: () => { el.className = 'toast'; action.run(); } }, action.label));
  el.className = `toast show ${kind}`;
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, action ? 5000 : 2600);
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

// A sheet belongs to the screen it was opened on: close it when the route changes (back button,
// tab bar, links inside the sheet).
addEventListener('hashchange', () => document.querySelectorAll('dialog.sheet[open]').forEach((d) => d.close()));

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

/**
 * Food search for the logging sheets and the admin plan editor. onPick(food)
 *   offplan: also eating-out foods (pizza, sweets), shown after the plan's foods. Only for
 *            logging what was eaten; never for swaps or building plans.
 *   recent:  while the box is empty, show this person's recent "other foods"
 *   noMatch: extra element shown when nothing matches (e.g. "Enter it myself")
 * Answers can arrive out of order on a slow network, so only the newest search is ever shown.
 */
export function foodPicker(onPick, { offplan = false, recent = false, noMatch = null } = {}) {
  const list = h('div', { class: 'fp-list', 'aria-live': 'polite' });
  const input = h('input', {
    type: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search foods',
    placeholder: offplan ? 'Eggs, koshari, coffee, juice, pizza, شاورما…' : 'Search foods (rice, chicken, ful…)',
  });
  const r1 = (n) => Math.round(n * 10) / 10;
  // One line per food, in its natural unit when it has one: "1 slice · 285 kcal · P 12 C 36 F 10".
  const line = (f) => {
    const u = f.units?.find((x) => !x.grams);
    const g = u ? u.g : 100;
    const m = (k) => r1((f[k] * g) / 100);
    return `${u ? `1 ${u.name}` : '100 g'} · ${Math.round((f.kcal * g) / 100)} kcal · P ${m('p')} C ${m('c')} F ${m('f')}`;
  };
  const row = (f) => h('button', { class: 'list-row', onclick: () => onPick(f) },
    h('span', { class: 'grow' }, h('span', { class: 'strong' }, f.name), h('span', { class: 'sub' }, line(f))));
  const group = (title, foods) => [h('p', { class: 'fp-head' }, title), ...foods.map(row)];
  const hint = h('p', { class: 'muted pad' }, offplan ? 'Type what you ate or drank: eggs, koshari, coffee, juice, pizza…' : 'Type a food: rice, chicken, ful…');

  let seq = 0; let timer;
  // Three kinds, in this order: diet foods, everyday drinks / sauces / bread (logging only), treats.
  const show = (q, foods, popular = []) => {
    if (!q) {
      const parts = [...(foods.length ? group('Recent', foods) : []), ...(popular.length ? group('Drinks and quick adds', popular) : [])];
      list.replaceChildren(...(parts.length ? parts : [hint]));
      return;
    }
    if (!foods.length) { list.replaceChildren(h('p', { class: 'muted pad' }, `No food matches “${q}”.`), noMatch ?? h('p', { class: 'sub pad' }, 'Ask the admin to add it.')); return; }
    const plan = foods.filter((f) => !f.offplan); const daily = foods.filter((f) => f.offplan && !f.treat); const treats = foods.filter((f) => f.treat);
    list.replaceChildren(...(offplan && (daily.length || treats.length)
      ? [...(plan.length ? group('Food list', plan) : []), ...(daily.length ? group('Drinks, sauces & bread', daily) : []), ...(treats.length ? group('Eating out & treats', treats) : [])]
      : foods.map(row)));
  };
  const run = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    if (!q && !recent) { list.replaceChildren(hint); return; }
    try {
      const params = new URLSearchParams({ q });
      if (offplan) params.set('offplan', '1');
      if (recent) params.set('recent', '1');
      if (!q && offplan) params.set('popular', '1');
      const { foods, popular } = await api('GET', `/api/foods?${params}`);
      if (mine === seq) show(q, foods, popular ?? []); // a newer search started meanwhile: drop this answer
    } catch (e) { if (mine === seq) list.replaceChildren(h('p', { class: 'error' }, e.message)); }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  input.addEventListener('search', () => { clearTimeout(timer); run(); }); // the clear (x) button and Enter
  run();
  return h('div', { class: 'stack fp' }, input, list);
}

/**
 * Seven-day strip: the last 7 days, or a week centred on an older date. Future days disabled.
 * dots: Map(date -> 'hit' | 'miss') for an optional status dot under each day.
 */
export function weekStrip({ date, today, onPick, dots = new Map(), labelFor = () => '' }) {
  const end = shiftDate(date, 3) > today ? today : shiftDate(date, 3);
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(end, i - 6));
  return h('div', { class: 'week', role: 'group', 'aria-label': 'Choose a day' }, days.map((dt) =>
    h('button', {
      class: `day ${dt === today ? 'today' : ''}`, 'aria-pressed': String(dt === date), disabled: dt > today ? true : null,
      'aria-label': `${fmtDate(dt, { weekday: 'long', day: 'numeric', month: 'long' })}${labelFor(dt)}`,
      onclick: () => onPick(dt),
    }, h('span', { class: 'dw' }, fmtDate(dt, { weekday: 'narrow' })), h('span', { class: 'dn' }, Number(dt.slice(8))), h('span', { class: `dot ${dots.get(dt) ?? ''}` }))));
}

/** Per-device memory for small conveniences (dismissed cards, shown celebrations). Never throws. */
export const local = {
  get: (k) => { try { return localStorage.getItem(`fc.${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`fc.${k}`, v); } catch { /* private mode: forget */ } },
};

/**
 * Full-screen reward moment: a burst of colour, a big icon, a headline and one line.
 * Tap anywhere (or wait ~3 s) to close. With reduced motion it is a calm card without the burst.
 * opts: { icon, title, text, stat, kind: 'go' | 'gold' | 'pr' }
 */
export function celebrate({ icon: ic = 'check', title, text = '', stat = null, kind = 'go' }) {
  document.querySelector('.celebrate')?.remove();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colours = ['var(--go)', 'var(--carbs)', 'var(--protein)', 'var(--fat)'];
  // 18 confetti pieces flung outwards at fixed angles with a little randomness.
  const burst = calm ? null : h('div', { class: 'burst', 'aria-hidden': 'true' }, Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
    const d = 110 + Math.random() * 70;
    return h('i', { style: `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--r:${Math.round(Math.random() * 360)}deg;background:${colours[i % 4]};animation-delay:${Math.random() * 80}ms` });
  }));
  const el = h('div', { class: `celebrate k-${kind}`, role: 'status', 'aria-live': 'assertive' },
    h('div', { class: 'cel-card' },
      burst,
      h('div', { class: 'cel-icon' }, icon(ic, 40)),
      h('h2', {}, title),
      stat ? h('div', { class: 'cel-stat' }, stat) : null,
      text ? h('p', {}, text) : null,
      h('span', { class: 'meta' }, 'Tap to close')));
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.addEventListener('click', close);
  document.body.append(el);
  if (navigator.vibrate) navigator.vibrate(calm ? 20 : [18, 40, 28]);
  setTimeout(close, 3200);
  return close;
}

/**
 * Date picker that looks like a chip ("Today ▾", "Thu 2 Oct ▾") instead of a truncated date box.
 * The real <input type="date"> sits invisibly on top, so the phone's own picker opens on tap.
 * The returned element has .value like an input.
 */
export function dateChip(value, { max, label = 'Date' } = {}) {
  const input = h('input', { type: 'date', value, max, 'aria-label': label });
  const text = h('span', {});
  const draw = () => { text.textContent = input.value === localToday() ? 'Today' : input.value === shiftDate(localToday(), -1) ? 'Yesterday' : fmtDate(input.value, { weekday: 'short', day: 'numeric', month: 'short' }); };
  input.addEventListener('change', () => { if (!input.value) input.value = value; draw(); });
  draw();
  const wrap = h('div', { class: 'datechip' }, text, h('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'), input);
  Object.defineProperty(wrap, 'value', { get: () => input.value, set: (v) => { input.value = v; draw(); } });
  return wrap;
}
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- amounts: "3 eggs", "1½ cups", "120 g" ----------
const nice = (n) => { const r = Math.round(n * 2) / 2; return Number.isInteger(r) ? String(r) : r < 1 ? '½' : `${Math.floor(r)}½`; };
/** "3 eggs", "1½ cups", "120 g", "70 g dry". */
export function qtyLabel(u, qty) {
  if (u.grams) return `${Math.round(qty)} ${u.key === 'dry' ? 'g dry' : 'g'}`;
  return `${nice(qty)} ${qty <= 1 ? u.name : u.plural}`;
}

/**
 * Amount picker: log food the way people say it. A unit switch (eggs / g, cups / g dry / g), a big
 * − value + stepper you can also type into, quick portions of the planned amount for weighed foods,
 * and the calories updating live.
 *   units    [{ key, name, plural, g, step, grams? }] from the server (natural units first)
 *   grams    starting amount in grams as eaten (the planned amount, or 0)
 *   planned  planned grams, enables the quick chips ("½", "As planned", "1½")
 *   per100   { kcal, p, c, f } per 100 g for the live preview
 *   onChange({ unit, qty, grams }) after every change
 * Returns { el, value() } where value() is { unit, qty, grams }.
 */
export function amountPicker({ units, grams = 0, planned = null, per100 = null, onChange = () => {} }) {
  const list = units?.length ? units : [{ key: 'g', name: 'g', plural: 'g', g: 1, step: 5, grams: true }];
  // Start in the unit that states the starting amount exactly: 4 eggs, 2 cups... else grams dry
  // (how rice and pasta are planned), else grams.
  const exact = (u) => { const q = grams / u.g; return grams > 0 && !u.grams && Math.abs(q - Math.round(q / u.step) * u.step) <= 0.03 * q; };
  // With nothing planned (adding a food), start in its natural unit: 1 piece, 1 plate, 1 cup.
  let unit = grams > 0 ? (list.find(exact) ?? list.find((u) => u.key === 'dry') ?? list.find((u) => u.key === 'g') ?? list[0]) : list[0];
  const snap = (q, u) => Math.max(0, Math.round(q / u.step) * u.step);
  let qty = grams > 0 ? (unit.grams ? Math.round(grams / unit.g) : snap(grams / unit.g, unit)) : (unit.grams ? 100 : 1);

  // Text, not number, so counts read the way people say them (1½ loaves); typing 1.5 also works.
  const input = h('input', { class: 'amt-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Amount' });
  const unitName = h('span', { class: 'amt-unit' });
  const preview = h('p', { class: 'amt-preview', 'aria-live': 'polite' });
  const unitsRow = list.length > 1 ? h('div', { class: 'amt-units', role: 'radiogroup', 'aria-label': 'Measure in' }) : null;
  const quick = planned ? h('div', { class: 'amt-quick', role: 'group', 'aria-label': 'Quick amounts' }) : null;
  const gramsOf = () => Math.round(qty * unit.g * 10) / 10;

  const draw = (fromTyping = false) => {
    if (!fromTyping) input.value = unit.grams ? String(Math.round(qty)) : nice(qty);
    unitName.textContent = unit.grams ? (unit.key === 'dry' ? 'g dry' : 'g') : (qty <= 1 ? unit.name : unit.plural);
    const g = gramsOf();
    const m = per100 ? (k) => Math.round(((per100[k] ?? 0) * g) / (k === 'kcal' ? 100 : 10)) / (k === 'kcal' ? 1 : 10) : null;
    preview.replaceChildren(
      unit.grams && unit.key === 'g' ? null : h('span', {}, `${Math.round(g)} g`),
      m ? h('span', {}, h('b', {}, m('kcal').toLocaleString('en-US')), ' kcal') : null,
      m ? h('span', {}, `P ${m('p')} · C ${m('c')} · F ${m('f')}`) : null);
    if (unitsRow) unitsRow.replaceChildren(...list.map((u) => h('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(u === unit), 'aria-pressed': String(u === unit),
      onclick: () => { const g0 = gramsOf(); unit = u; qty = u.grams ? Math.round(g0 / u.g) : snap(g0 / u.g, u) || u.step; draw(); },
    }, u.grams ? (u.key === 'dry' ? 'g dry' : 'grams') : u.plural)));
    if (quick) {
      // Portions of the plan in the current unit. With whole units (eggs) several fractions round
      // to the same count: keep one chip per amount, "As planned" winning its own.
      const toQ = (k) => (unit.grams ? Math.round((planned * k) / unit.g) : snap((planned * k) / unit.g, unit));
      const planQ = toQ(1);
      const seen = new Set([planQ]);
      const chips = [[0.5, '½'], [0.75, '¾'], [1, 'As planned'], [1.5, '1½×'], [2, '2×']].filter(([k]) => {
        if (k === 1) return true;
        const q = toQ(k);
        if (q <= 0 || seen.has(q)) return false;
        seen.add(q); return true;
      });
      quick.replaceChildren(...chips.map(([k, label]) => {
        const q = toQ(k);
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(Math.abs(q - qty) < 1e-9), onclick: () => { qty = q; draw(); } }, label);
      }));
    }
    onChange({ unit: unit.key, qty, grams: gramsOf(), label: qtyLabel(unit, qty) });
  };
  const bump = (d) => { qty = Math.max(0, Math.round((qty + d * (unit.grams ? (unit.key === 'g' ? 10 : 5) : unit.step)) * 100) / 100); draw(); };
  // "1½" -> 1.5, "½" -> 0.5, "1,5" -> 1.5
  const parse = (t) => Number(String(t).trim().replace(',', '.').replace(/^(\d*)\s*½$/, (_, w) => `${w || 0}.5`));
  input.addEventListener('input', () => { const v = parse(input.value); if (input.value.trim() && Number.isFinite(v) && v >= 0) { qty = v; draw(true); } });
  input.addEventListener('blur', () => draw());

  const el = h('div', { class: 'amt' },
    unitsRow,
    h('div', { class: 'amt-step' },
      h('button', { type: 'button', class: 'amt-btn', 'aria-label': 'Less', onclick: () => bump(-1) }, icon('minus', 22)),
      h('label', { class: 'amt-val' }, input, unitName),
      h('button', { type: 'button', class: 'amt-btn', 'aria-label': 'More', onclick: () => bump(1) }, icon('plus', 22))),
    quick, preview);
  draw();
  return { el, value: () => ({ unit: unit.key, qty, grams: gramsOf(), label: qtyLabel(unit, qty) }) };
}

// ---------- profile pictures ----------
/**
 * A person's picture, or their initial on the accent gradient when they have none.
 *   who   { name, avatar }   avatar is the versioned /api/avatar/... URL from the server
 *   size  pixels (square)
 */
export function avatarEl(who, size = 36, cls = '') {
  const initial = (who?.name ?? '?').trim()[0]?.toUpperCase() ?? '?';
  const el = h('span', { class: `pic ${cls}`, style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`, 'aria-hidden': 'true' }, initial);
  if (who?.avatar) {
    const img = h('img', { src: who.avatar, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' });
    // A missing or blocked picture falls back to the initial.
    img.addEventListener('error', () => img.remove());
    el.append(img);
  }
  return el;
}

/**
 * Turns a phone photo into a centred square JPEG (default 320 px, under ~60 KB) for the profile
 * picture, so the upload is instant and the database stays small.
 */
export function squareJpeg(file, { size = 320, maxBytes = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let q = 0.86; let out = c.toDataURL('image/jpeg', q);
      while (out.length * 0.75 > maxBytes && q > 0.45) { q -= 0.08; out = c.toDataURL('image/jpeg', q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be opened. Try a JPEG or PNG.')); };
    img.src = url;
  });
}
