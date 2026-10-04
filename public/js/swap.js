// Swap sheet: replace a plan item with an equivalent food (same protein / carbs / fat), like
// an Egyptian coach's "بدائل" table. Options are already filtered by what the person never eats.
import { h } from './dom.js';
import { api } from './api.js';
import { sheet, toast, icon } from './ui.js';
import { fmt } from './state.js';

const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');

/**
 * Open the swap sheet for plan item `ref` on `date`.
 * onDone({ scope }) runs after a swap is saved.
 */
export function swapSheet({ ref, date, name, onDone }) {
  sheet(`Swap ${name.split(/[,(]/)[0].trim().toLowerCase()}`, (close) => {
    const body = h('div', { class: 'swap' }, h('div', { class: 'skel', style: 'height:72px;border-radius:12px' }), h('div', { class: 'skel', style: 'height:240px;border-radius:12px;margin-top:12px' }));
    (async () => {
      let data;
      try { data = await api('GET', `/api/plan/alternatives?date=${date}&ref=${encodeURIComponent(ref)}`); }
      catch (e) { body.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      const { item, options, groupLabel } = data;
      let chosen = null;
      const confirm = h('div', { class: 'swap-confirm', hidden: true });
      const list = h('div', { class: 'swap-list', role: 'listbox', 'aria-label': `Equivalent ${groupLabel.toLowerCase()}` });
      const q = h('input', { type: 'search', placeholder: `Search ${options.length} options`, 'aria-label': 'Search options', autocomplete: 'off' });

      const save = async (scope, btn) => {
        btn.disabled = true;
        try {
          const r = await api('POST', '/api/plan/swap', { date, ref, foodId: chosen.foodId, scope });
          close();
          toast(scope === 'today' ? `Today: ${chosen.name.split(/[,(]/)[0]} instead` : `Your plan now uses ${chosen.name.split(/[,(]/)[0].toLowerCase()}`);
          onDone?.({ scope, amount: r.amount });
        } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
      };

      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const shown = options.filter((o) => !term || o.name.toLowerCase().includes(term) || (o.ar ?? '').includes(term));
        list.replaceChildren(...shown.map((o) => h('button', {
          class: 'swap-opt', role: 'option', 'aria-selected': String(chosen?.foodId === o.foodId),
          onclick: () => {
            chosen = o; draw();
            confirm.hidden = false;
            confirm.replaceChildren(
              h('p', { class: 'sub' }, h('b', { style: 'color:var(--ink)' }, `${o.amount} ${o.name.split(/[,(]/)[0].toLowerCase()}`), ` · ${fmt(o.kcal)} kcal · P ${o.p} · C ${o.c} · F ${o.f}`),
              h('div', { class: 'grid2', style: 'margin-top:12px' },
                h('button', { class: 'btn ghost', onclick: (e) => save('today', e.currentTarget) }, 'Just today'),
                h('button', { class: 'btn', onclick: (e) => save('always', e.currentTarget) }, 'Every day')));
          },
        },
          h('span', { class: 'swap-name' }, h('span', {}, o.name), o.ar ? h('span', { class: 'swap-ar', lang: 'ar', dir: 'rtl' }, o.ar) : null),
          h('span', { class: 'swap-amt' }, o.amount),
          h('span', { class: `swap-diff ${Math.abs(o.kcalDiff) <= 25 ? 'even' : ''}` }, `${sign(o.kcalDiff)} kcal`))));
        if (!shown.length) list.append(h('p', { class: 'sub', style: 'padding:16px 0' }, 'No match. Ask the coach for something that is not on the list.'));
      };
      q.addEventListener('input', draw);
      draw();
      body.replaceChildren(
        h('div', { class: 'swap-current' },
          h('span', { class: 'meta' }, `Now · ${groupLabel}`),
          h('span', { class: 'h3' }, `${item.amount} ${item.name.split(/[,(]/)[0].toLowerCase()}`),
          h('span', { class: 'sub' }, `${fmt(item.kcal)} kcal · P ${item.p} · C ${item.c} · F ${item.f}`)),
        h('p', { class: 'sub', style: 'margin:12px 0 8px' }, `${options.length} equivalent options, already without anything you don't eat. Amounts keep the same ${groupLabel === 'Healthy fats' ? 'fat' : groupLabel === 'Carbs' || groupLabel === 'Fruit' ? 'carbs' : groupLabel === 'Protein' ? 'protein' : 'calories'}.`),
        options.length > 8 ? q : null,
        list, confirm,
        // A dish like mahshi is rice and vegetables: swapping it really changes the whole meal.
        h('button', { class: 'act-row', style: 'margin-top:16px', onclick: () => { close(); mealSheet({ date, meal: Number(String(ref).split('-')[1]), onDone }); } },
          h('span', { class: 'ico' }, icon('plan', 20)),
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Change the whole meal instead'), h('span', { class: 'sub' }, 'Another complete meal with the same calories')),
          icon('chevR', 18)));
    })();
    return body;
  });
}

/** Inline "Swap · 9 options" control used under plan items. */
export function swapLink({ ref, date, name, count, onDone }) {
  if (!count) return null;
  return h('button', { class: 'swap-link', onclick: (e) => { e.stopPropagation(); swapSheet({ ref, date, name, onDone }); } },
    icon('swap', 16), `Swap · ${count} option${count === 1 ? '' : 's'}`);
}

/**
 * "Change this meal": other complete meals of the same kind, already sized to the same calories
 * and macros, that fit the rest of the day (one cooked dish a day, dinner from lunch's protein).
 * Pick one, then "Just today" or "Every day". A meal changed for today can be put back.
 */
export function mealSheet({ date, meal, onDone }) {
  sheet('Change this meal', (close) => {
    const body = h('div', { class: 'swap' }, h('div', { class: 'skel', style: 'height:72px;border-radius:12px' }), h('div', { class: 'skel', style: 'height:300px;border-radius:12px;margin-top:12px' }));
    (async () => {
      let data;
      try { data = await api('GET', `/api/plan/meal-options?date=${date}&meal=${meal}`); }
      catch (e) { body.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      const { meal: cur, options, logged } = data;
      let chosen = null;
      const confirm = h('div', { class: 'swap-confirm', hidden: true });
      const save = async (scope, btn) => {
        btn.disabled = true;
        try {
          const r = await api('POST', '/api/plan/meal-swap', { date, meal, key: chosen?.key, scope });
          close();
          toast(scope === 'reset' ? `${cur.name} is back to your plan` : scope === 'today' ? `Today's ${cur.name.toLowerCase()}: ${r.title}` : `${cur.name} is now ${r.title.toLowerCase()} every day`);
          onDone?.({ scope });
        } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
      };
      const list = h('div', { class: 'meal-opts', role: 'listbox', 'aria-label': 'Other meals' });
      const draw = () => list.replaceChildren(...options.map((o) => {
        const diff = o.kcal - cur.totals.kcal;
        return h('button', {
          class: 'meal-opt', role: 'option', 'aria-selected': String(chosen?.key === o.key),
          onclick: () => {
            chosen = o; draw();
            confirm.hidden = false;
            confirm.replaceChildren(
              logged ? h('p', { class: 'sub' }, `This clears the ${logged} item${logged === 1 ? '' : 's'} you ticked in this meal.`) : null,
              h('div', { class: 'grid2', style: 'margin-top:8px' },
                h('button', { class: 'btn ghost', onclick: (e) => save('today', e.currentTarget) }, 'Just today'),
                h('button', { class: 'btn', onclick: (e) => save('always', e.currentTarget) }, 'Every day')));
            confirm.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          },
        },
          h('span', { class: 'meal-opt-head' },
            h('span', { class: 'strong' }, o.title),
            h('span', { class: `swap-diff ${Math.abs(diff) <= 25 ? 'even' : ''}` }, `${fmt(o.kcal)} kcal`)),
          h('span', { class: 'meal-opt-items' }, o.items.map((i) => h('span', {}, h('b', {}, i.amount), ' ', i.name.split(/[,(]/)[0].trim().toLowerCase()))),
          h('span', { class: 'meal-opt-macros' }, `P ${o.p} · C ${o.c} · F ${o.f}`));
      }));
      draw();
      body.replaceChildren(
        h('div', { class: 'swap-current' },
          h('span', { class: 'meta' }, cur.swappedFrom ? `Now · changed today (was ${cur.swappedFrom})` : `Now · ${cur.name}`),
          h('span', { class: 'h3' }, cur.title ?? cur.name),
          h('span', { class: 'sub' }, `${fmt(cur.totals.kcal)} kcal · P ${cur.totals.p} · C ${cur.totals.c} · F ${cur.totals.f}`),
          cur.swappedFrom ? h('button', { class: 'textbtn', style: 'align-self:flex-start;margin-top:4px', onclick: (e) => save('reset', e.currentTarget) }, 'Put the planned meal back') : null),
        h('p', { class: 'sub', style: 'margin:12px 0 8px' }, options.length
          ? `${options.length} complete meals with about the same calories and protein, so your day stays on target.`
          : 'Nothing else fits this meal with what you eat. Ask the coach for ideas.'),
        list, confirm);
    })();
    return body;
  });
}
