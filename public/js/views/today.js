import { h } from '../dom.js';
import { api } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { icon, plate, sheet, toast, emptyState, field, numInput, foodPicker, seg } from '../ui.js';

export async function todayView() {
  const main = paint('today', loading());
  const today = localDate();
  const date = state.date ?? today;
  const run = () => guard(main, async () => {
    const d = await api('GET', `/api/today?date=${date}`);
    main.replaceChildren(...build(d, date, today, reload));
  }, run);
  const reload = async () => { const y = window.scrollY; await run(); window.scrollTo(0, y); };
  await run();
}

function build(d, date, today, reload) {
  const nav = h('div', { class: 'date-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { state.date = shiftDate(date, -1); todayView(); } }, icon('chevL', 22)),
    h('span', { class: 'label' }, date === today ? 'Today' : fmtDate(date)),
    h('button', { class: 'icon-btn', 'aria-label': 'Next day', disabled: date >= today ? true : null, onclick: () => { state.date = shiftDate(date, 1) === today ? null : shiftDate(date, 1); todayView(); }, style: date >= today ? 'opacity:.3' : null }, icon('chevR', 22)));

  if (d.plan === null) {
    const isAdmin = state.me?.user.role === 'admin';
    return [nav, d.hasPending
      ? emptyState('Your plan is being checked', 'A plan has been drafted for you and is waiting for the admin to approve it. It will show up here as soon as it is approved.',
          isAdmin && !state.as ? h('button', { class: 'btn', onclick: () => navigate('/admin') }, 'Review plans') : null)
      : emptyState('No plan yet', 'Fill in your details so a plan can be drafted for you.', h('button', { class: 'btn', onclick: () => navigate('/onboarding') }, 'Set up my plan'))];
  }

  const t = d.targets;
  const left = t.kcal - d.consumed.kcal;
  const logged = d.consumed.kcal > 0;
  const hero = h('section', {},
    nav,
    h('div', { class: `big ${left < 0 ? 'over' : ''}`, 'aria-label': `${Math.abs(left)} calories ${left < 0 ? 'over' : 'left'}` }, fmt(Math.abs(left))),
    h('p', { class: 'sub', style: 'margin-top:6px' }, `kcal ${left < 0 ? 'over' : 'left'} of ${fmt(t.kcal)}`),
    h('div', { class: 'plates' },
      plate({ label: 'Protein', value: d.consumed.p, target: t.proteinG, kind: 'p' }),
      plate({ label: 'Carbs', value: d.consumed.c, target: t.carbsG, kind: 'c' }),
      plate({ label: 'Fat', value: d.consumed.f, target: t.fatG, kind: 'f' })),
    logged ? h('p', { class: 'score-line' }, 'Day score', h('b', {}, d.score.total), 'out of 100') : null);

  const meals = d.meals.map((m) => {
    const planned = m.items.reduce((a, i) => a + i.kcal, 0);
    return h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, m.name), h('span', { class: 'sub' }, `${fmt(planned)} kcal planned`)),
      m.items.map((it) => itemRow(it, date, today, reload)));
  });

  const extras = h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Other food'), h('span', { class: 'sub' }, d.extras.length ? `${fmt(d.extras.reduce((a, e) => a + e.kcal, 0))} kcal` : '')),
    d.extras.map((e) => h('div', { class: 'item', 'data-state': 'eaten' },
      h('span', { class: 'item-main', style: 'padding-left:2px' }, h('span', { class: 'item-name' }, e.name), h('span', { class: 'item-amt' }, e.grams ? `${e.grams} g` : 'Custom entry')),
      h('span', { class: 'item-kcal' }, fmt(e.kcal)),
      h('button', { class: 'icon-btn', 'aria-label': `Remove ${e.name}`, onclick: async () => { try { await api('POST', '/api/log/remove', { date, ref: e.ref }); await reload(); } catch (err) { toast(err.message, 'bad'); } } }, icon('trash', 20)))),
    h('button', { class: 'add-row', onclick: () => addSheet(date, today, reload) }, icon('plus', 22), 'Add something you ate'));

  return [hero, ...meals, extras];
}

function itemRow(it, date, today, reload) {
  const st = it.log?.status ?? 'none';
  const planned = it.label ? `${it.label} · ${it.grams} g` : `${it.grams} g`;
  const amt = st === 'adjusted' ? `Ate ${it.log.grams} g (planned ${it.grams} g)`
    : st === 'swapped' ? `Swapped for ${it.log.name}, ${it.log.grams} g`
    : st === 'skipped' ? 'Skipped' : planned;
  const kcal = st === 'adjusted' || st === 'swapped' ? it.log.kcal : st === 'skipped' ? 0 : it.kcal;
  const toggle = async () => {
    try {
      if (st === 'none') await api('POST', '/api/log', { date, today, ref: it.key, status: 'eaten' });
      else await api('POST', '/api/log/remove', { date, ref: it.key });
      await reload();
    } catch (e) { toast(e.message, 'bad'); }
  };
  return h('div', { class: 'item', 'data-state': st },
    h('button', { class: 'check', role: 'checkbox', 'aria-checked': String(st !== 'none' && st !== 'skipped'), 'aria-label': `${it.name}, ${planned}`, onclick: toggle }, h('span', {}, icon('check', 18))),
    h('button', { class: 'item-main', onclick: () => itemSheet(it, date, today, reload), 'aria-label': `Options for ${it.name}` },
      h('span', { class: 'item-name' }, it.name), h('span', { class: 'item-amt' }, amt)),
    h('span', { class: 'item-kcal' }, fmt(kcal)));
}

function itemSheet(it, date, today, reload) {
  sheet(it.name, (close) => {
    const save = async (body, msg = 'Saved') => {
      try { await api('POST', '/api/log', { date, today, ref: it.key, ...body }); close(); toast(msg); await reload(); } catch (e) { toast(e.message, 'bad'); }
    };
    const clearLog = async () => { try { await api('POST', '/api/log/remove', { date, ref: it.key }); close(); await reload(); } catch (e) { toast(e.message, 'bad'); } };
    const grams = numInput(it.log?.status === 'adjusted' ? it.log.grams : it.grams, { min: 0, max: 2000, 'aria-label': 'Grams eaten' });
    const swap = h('div', {});
    const pickSwap = () => swap.replaceChildren(foodPicker((f) => {
      const g = numInput(it.grams, { min: 1, max: 2000, 'aria-label': 'Grams of the swapped food' });
      swap.replaceChildren(h('div', { class: 'stack' },
        h('p', { class: 'item-name' }, f.name),
        field('Grams eaten', g),
        h('div', { class: 'row-flex' }, h('button', { class: 'btn', onclick: () => save({ status: 'swapped', foodId: f.id, grams: Number(g.value) }, 'Swap saved') }, 'Save swap'), h('button', { class: 'btn ghost', onclick: pickSwap }, 'Pick another'))));
    }));
    return h('div', { class: 'stack-lg' },
      h('p', { class: 'sub' }, `Planned: ${it.label ? `${it.label}, ` : ''}${it.grams} g · ${fmt(it.kcal)} kcal · P ${it.p} · C ${it.c} · F ${it.f}`),
      h('div', { class: 'row-flex', style: 'flex-wrap:wrap' },
        h('button', { class: 'btn', onclick: () => save({ status: 'eaten' }) }, 'Ate it as planned'),
        h('button', { class: 'btn ghost', onclick: () => save({ status: 'skipped' }, 'Marked skipped') }, 'Skipped it'),
        it.log ? h('button', { class: 'btn ghost', onclick: clearLog }, 'Clear') : null),
      h('div', { class: 'stack' }, h('p', { class: 'h2' }, 'Ate a different amount'),
        h('div', { class: 'row-flex' }, h('div', { style: 'flex:1' }, grams), h('button', { class: 'btn', onclick: () => save({ status: 'adjusted', grams: Number(grams.value) }) }, 'Save amount'))),
      h('div', { class: 'stack' }, h('p', { class: 'h2' }, 'Ate something else instead'),
        swap, h('button', { class: 'btn ghost', id: 'swap-open', onclick: (e) => { e.currentTarget.remove(); pickSwap(); } }, 'Find a food')));
  });
}

function addSheet(date, today, reload) {
  sheet('Add food', (close) => {
    const area = h('div', {});
    const add = async (body) => {
      try { await api('POST', '/api/log/extra', { date, today, ...body }); close(); toast('Added'); await reload(); } catch (e) { toast(e.message, 'bad'); }
    };
    const showSearch = () => area.replaceChildren(foodPicker((f) => {
      const g = numInput(100, { min: 1, max: 3000, 'aria-label': 'Grams' });
      area.replaceChildren(h('div', { class: 'stack' }, h('p', { class: 'item-name' }, f.name), field('Grams', g),
        h('div', { class: 'row-flex' }, h('button', { class: 'btn', onclick: () => add({ foodId: f.id, grams: Number(g.value) }) }, 'Add'), h('button', { class: 'btn ghost', onclick: showSearch }, 'Pick another'))));
    }));
    const showCustom = () => {
      const f = { name: h('input', { type: 'text', 'aria-label': 'Name' }), kcal: numInput('', { min: 0 }), p: numInput('', { min: 0 }), c: numInput('', { min: 0 }), f: numInput('', { min: 0 }) };
      area.replaceChildren(h('div', { class: 'stack' },
        field('What did you eat?', f.name),
        h('div', { class: 'grid2' }, field('Calories', f.kcal), field('Protein (g)', f.p)),
        h('div', { class: 'grid2' }, field('Carbs (g)', f.c), field('Fat (g)', f.f)),
        h('button', { class: 'btn', onclick: () => add({ name: f.name.value, kcal: Number(f.kcal.value), p: Number(f.p.value || 0), c: Number(f.c.value || 0), f: Number(f.f.value || 0) }) }, 'Add')));
    };
    const tabs = seg([['search', 'From the food list'], ['custom', 'Enter it myself']], 'search', (v) => (v === 'search' ? showSearch() : showCustom()), 'How to add');
    showSearch();
    return h('div', { class: 'stack' }, tabs, area);
  });
}
