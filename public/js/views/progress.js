import { h } from '../dom.js';
import { api } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt1 } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { sheet, toast, field, numInput, confirmSheet } from '../ui.js';

const MEASURES = [['waistCm', 'Waist'], ['neckCm', 'Neck'], ['hipCm', 'Hips'], ['chestCm', 'Chest'], ['armCm', 'Upper arm'], ['thighCm', 'Thigh'], ['calfCm', 'Calf']];

/** Smoothed weight trend: dots are the weigh-ins, the line is the trend. */
function weightChart(points) {
  const W = 340; const H = 170; const L = 34; const R = 10; const T = 10; const B = 24;
  const ws = points.map((p) => p.weightKg);
  let e = ws[0];
  const ema = ws.map((w, i) => { e = i === 0 ? w : e + 0.3 * (w - e); return e; });
  const lo = Math.floor(Math.min(...ws) - 1); const hi = Math.ceil(Math.max(...ws) + 1);
  const t0 = Date.parse(`${points[0].date}T00:00:00Z`); const t1 = Date.parse(`${points.at(-1).date}T00:00:00Z`);
  const x = (d) => L + ((t1 === t0 ? 0.5 : (Date.parse(`${d}T00:00:00Z`) - t0) / (t1 - t0))) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const mid = (lo + hi) / 2;
  return h('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Weight trend from ${fmt1(ws[0])} to ${fmt1(ws.at(-1))} kilograms` },
    [lo, mid, hi].map((v) => h('g', {}, h('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }), h('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmt1(v)))),
    h('polyline', { class: 'trend', points: points.map((p, i) => `${x(p.date)},${y(ema[i])}`).join(' ') }),
    points.map((p) => h('circle', { class: 'dot', cx: x(p.date), cy: y(p.weightKg), r: 4 })),
    h('text', { x: L, y: H - 6 }, fmtDate(points[0].date, { day: 'numeric', month: 'short' })),
    h('text', { x: W - R, y: H - 6, 'text-anchor': 'end' }, fmtDate(points.at(-1).date, { day: 'numeric', month: 'short' })));
}

/** Daily adherence bars; green when the day scored 70 or more. */
export function scoreBars(scores, today, days = 14) {
  const W = 340; const H = 80; const gap = 4; const bw = (W - gap * (days - 1)) / days;
  const by = new Map(scores.map((s) => [s.date, s.total]));
  return h('svg', { class: 'chart bars', viewBox: `0 0 ${W} ${H + 18}`, role: 'img', 'aria-label': 'Daily scores for the last two weeks' },
    Array.from({ length: days }, (_, i) => {
      const d = shiftDate(today, i - (days - 1));
      const v = by.get(d);
      const bh = v === undefined ? 4 : Math.max(4, (v / 100) * H);
      return h('rect', { class: v === undefined ? 'none' : v >= 70 ? 'hit' : 'miss', x: i * (bw + gap), y: H - bh, width: bw, height: bh, rx: 2 }, h('title', {}, `${fmtDate(d)}: ${v === undefined ? 'no plan' : v}`));
    }),
    h('text', { x: 0, y: H + 14 }, fmtDate(shiftDate(today, -(days - 1)), { day: 'numeric', month: 'short' })),
    h('text', { x: W, y: H + 14, 'text-anchor': 'end' }, 'Today'));
}

export async function progressView() {
  const main = paint('progress', loading());
  const today = localDate();
  const run = () => guard(main, async () => {
    const [{ metrics }, adh, { photos }] = await Promise.all([api('GET', '/api/metrics'), api('GET', `/api/adherence?days=14&today=${today}`), api('GET', '/api/photos')]);
    const weights = metrics.filter((m) => m.weightKg !== null);
    const latest = weights.at(-1);
    const first = weights[0];

    const date = h('input', { type: 'date', value: today, max: today, 'aria-label': 'Weigh-in date' });
    const kg = numInput('', { min: 30, max: 400, placeholder: latest ? fmt1(latest.weightKg) : '0.0', 'aria-label': 'Weight in kilograms' });
    const save = async () => {
      if (!kg.value) { toast('Enter your weight', 'bad'); return; }
      try { await api('POST', '/api/metrics', { date: date.value, weightKg: Number(kg.value) }); toast('Weigh-in saved'); run(); } catch (e) { toast(e.message, 'bad'); }
    };

    const withMeasures = metrics.filter((m) => Object.keys(m.measurements).length).slice(-4).reverse();
    const avg = adh.scores.length ? Math.round(adh.scores.reduce((a, s) => a + s.total, 0) / adh.scores.length) : null;

    main.replaceChildren(
      h('h1', { class: 'title' }, 'Progress'),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Weight')),
        latest ? h('div', { style: 'margin:14px 0' },
          h('span', { class: 'big', style: 'font-size:64px' }, fmt1(latest.weightKg)), h('span', { class: 'sub' }, ' kg'),
          weights.length > 1 ? h('p', { class: 'sub' }, `${latest.weightKg - first.weightKg > 0 ? '+' : ''}${fmt1(latest.weightKg - first.weightKg)} kg since ${fmtDate(first.date)}`) : null) : null,
        weights.length >= 2 ? weightChart(weights) : h('p', { class: 'muted', style: 'margin:12px 0' }, 'Log your weight a few times and the trend line appears here.'),
        h('div', { class: 'row-flex', style: 'margin-top:14px;align-items:flex-end' },
          h('div', { style: 'flex:1' }, field('Date', date)), h('div', { style: 'flex:1' }, field('Weight (kg)', kg)), h('button', { class: 'btn', onclick: save }, 'Save')),
        h('p', { style: 'margin-top:8px' }, h('button', { class: 'link', onclick: () => measureSheet(today, run) }, 'Add body measurements'))),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Last 14 days'), h('span', { class: 'sub' }, avg === null ? '' : `Average ${avg}`)),
        h('div', { style: 'margin-top:12px' }, scoreBars(adh.scores, today)),
        h('p', { class: 'sub', style: 'margin-top:6px' }, adh.streak > 0 ? `${adh.streak}-day streak of days scoring 70 or more.` : 'A day scoring 70 or more starts a streak.')),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Photos'), h('span', { class: 'sub' }, 'Only you and the admin can see these')),
        photos.length ? h('div', { class: 'photo-grid' }, photos.slice(0, 18).map((ph) => h('button', { class: 'photo', 'aria-label': `${ph.pose} photo, ${fmtDate(ph.date)}`, onclick: () => photoSheet(ph, run) },
          h('img', { src: `/api/photos/${ph.id}`, alt: '', loading: 'lazy' }), h('span', {}, `${fmtDate(ph.date, { day: 'numeric', month: 'short' })} · ${ph.pose}`))))
          : h('p', { class: 'muted', style: 'margin:12px 0' }, 'Take a front, side and back photo every few weeks. The admin uses them, with your measurements, to judge your shape and adjust your plan.'),
        h('p', { style: 'margin-top:8px' }, h('button', { class: 'link', onclick: () => addPhotoSheet(today, run) }, 'Add a photo'))),
      withMeasures.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Measurements')),
        withMeasures.map((m) => h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, fmtDate(m.date)), h('span', { class: 'sub' }, MEASURES.filter(([k]) => m.measurements[k]).map(([k, l]) => `${l} ${m.measurements[k]}`).join(' · ')))))) : null);
  }, run);
  await run();
}

function measureSheet(today, done) {
  sheet('Body measurements', (close) => {
    const date = h('input', { type: 'date', value: today, max: today });
    const inputs = Object.fromEntries(MEASURES.map(([k]) => [k, numInput('', { min: 10, max: 250 })]));
    return h('div', { class: 'stack' },
      field('Date', date),
      h('div', { class: 'grid2' }, MEASURES.map(([k, l]) => field(`${l} (cm)`, inputs[k]))),
      h('p', { class: 'sub' }, 'Fill in only what you measured.'),
      h('button', { class: 'btn block', onclick: async () => {
        const measurements = Object.fromEntries(Object.entries(inputs).filter(([, el]) => el.value).map(([k, el]) => [k, Number(el.value)]));
        try { await api('POST', '/api/metrics', { date: date.value, measurements }); close(); toast('Measurements saved'); done(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Save measurements'));
  });
}

/** Shrinks a phone photo to a 900 px JPEG in the browser so uploads stay small and fast. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be opened. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

function addPhotoSheet(today, done) {
  sheet('Add a photo', (close) => {
    const date = h('input', { type: 'date', value: today, max: today, 'aria-label': 'Photo date' });
    const pose = h('select', { 'aria-label': 'Pose' }, [['front', 'Front'], ['side', 'Side'], ['back', 'Back']].map(([v, l]) => h('option', { value: v }, l)));
    const file = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Choose a photo' });
    const go = h('button', { class: 'btn block', onclick: async () => {
      if (!file.files[0]) { toast('Choose a photo first', 'bad'); return; }
      go.disabled = true;
      try {
        const image = await shrink(file.files[0]);
        await api('POST', '/api/photos', { date: date.value, pose: pose.value, image });
        close(); toast('Photo saved'); done();
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
    } }, 'Save photo');
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'Same light, same spot, relaxed stance, arms slightly out. Photos are private to you and the admin.'),
      h('div', { class: 'grid2' }, field('Date', date), field('Pose', pose)), field('Photo', file), go);
  });
}

function photoSheet(ph, done) {
  sheet(`${ph.pose[0].toUpperCase()}${ph.pose.slice(1)}, ${fmtDate(ph.date)}`, (close) => h('div', { class: 'stack' },
    h('img', { src: `/api/photos/${ph.id}`, alt: `${ph.pose} progress photo`, style: 'width:100%;border-radius:12px' }),
    h('button', { class: 'btn danger block', onclick: () => confirmSheet('Delete this photo?', 'It is removed for good.', 'Delete', async () => {
      try { await api('DELETE', `/api/photos/${ph.id}`); close(); toast('Photo deleted'); done(); } catch (e) { toast(e.message, 'bad'); }
    }, true) }, 'Delete photo')));
}
