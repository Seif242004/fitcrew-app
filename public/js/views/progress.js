import { h } from '../dom.js';
import { screenTip } from '../tour.js';
import { api } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt1 } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { sheet, toast, field, numInput, confirmSheet, icon, seg, dateChip } from '../ui.js';
import { loadMe } from '../session.js';

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

    const date = dateChip(today, { max: today, label: 'Weigh-in date' });
    const kg = numInput('', { min: 30, max: 400, placeholder: latest ? fmt1(latest.weightKg) : '0.0', 'aria-label': 'Weight in kilograms' });
    const save = async () => {
      if (!kg.value) { toast('Enter your weight', 'bad'); return; }
      try { await api('POST', '/api/metrics', { date: date.value, weightKg: Number(kg.value) }); toast('Weigh-in saved'); run(); } catch (e) { toast(e.message, 'bad'); }
    };

    const withMeasures = metrics.filter((m) => Object.keys(m.measurements).length).slice(-4).reverse();
    const avg = adh.scores.length ? Math.round(adh.scores.reduce((a, s) => a + s.total, 0) / adh.scores.length) : null;

    main.replaceChildren(
      h('h1', { class: 'title' }, 'Progress'),
      screenTip('progress', 'Track the trend, not the day', 'Weigh in once a week, same time, same scale. Add front, side and back photos every 2–4 weeks; only you and the admin can see them.'),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Weight')),
        latest ? h('div', { style: 'margin:14px 0' },
          h('span', { class: 'big', style: 'font-size:64px' }, fmt1(latest.weightKg)), h('span', { class: 'sub' }, ' kg'),
          weights.length > 1 ? h('p', { class: 'sub' }, `${latest.weightKg - first.weightKg > 0 ? '+' : ''}${fmt1(latest.weightKg - first.weightKg)} kg since ${fmtDate(first.date)}`) : null) : null,
        weights.length >= 2 ? weightChart(weights) : h('p', { class: 'muted', style: 'margin:12px 0' }, 'Log your weight a few times and the trend line appears here.'),
        h('div', { class: 'weigh', style: 'margin-top:14px' }, field('Date', date), field('Weight (kg)', kg), h('button', { class: 'btn', onclick: save }, 'Save')),
        h('p', { style: 'margin-top:8px' }, h('button', { class: 'link', onclick: () => measureSheet(today, run) }, 'Add body measurements'))),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Last 14 days'), h('span', { class: 'sub' }, avg === null ? '' : `Average ${avg}`)),
        h('div', { style: 'margin-top:12px' }, scoreBars(adh.scores, today)),
        h('p', { class: 'sub', style: 'margin-top:6px' }, adh.streak > 0 ? `${adh.streak}-day streak of days scoring 70 or more.` : 'A day scoring 70 or more starts a streak.')),
      photosSection(photos, today, run),
      withMeasures.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Measurements')),
        withMeasures.map((m) => h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, fmtDate(m.date)), h('span', { class: 'sub' }, MEASURES.filter(([k]) => m.measurements[k]).map(([k, l]) => `${l} ${m.measurements[k]}`).join(' · ')))))) : null);
  }, run);
  await run();
}

function measureSheet(today, done) {
  sheet('Body measurements', (close) => {
    const date = dateChip(today, { max: today, label: 'Measurement date' });
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

/**
 * Shrinks a phone photo to a small JPEG in the browser so uploads stay fast and the database small.
 * Large photos are re-encoded until they fit `maxBytes`.
 */
export function shrink(file, { max = 800, quality = 0.72, maxBytes = 170_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = quality; let out = c.toDataURL('image/jpeg', q);
      while (out.length * 0.75 > maxBytes && q > 0.4) { q -= 0.08; out = c.toDataURL('image/jpeg', q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be opened. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

// ---------------------------------------------------------------- photos: sessions + compare
const POSES = [['front', 'Front'], ['side', 'Side'], ['back', 'Back']];
/** Photos grouped by date, newest first: [{ date, front, side, back }]. */
const sessionsOf = (photos) => {
  const by = new Map();
  for (const ph of photos) { if (!by.has(ph.date)) by.set(ph.date, { date: ph.date }); const s = by.get(ph.date); if (!s[ph.pose]) s[ph.pose] = ph; }
  return [...by.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
};

function photosSection(photos, today, run) {
  const sessions = sessionsOf(photos);
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Photos'), sessions.length >= 2 ? h('button', { class: 'btn small ghost', onclick: () => compareSheet(sessions) }, icon('compare', 18), 'Compare') : null),
    sessions.length ? h('div', {}, sessions.slice(0, 6).map((s) => h('div', { class: 'psession' },
      h('p', { class: 'meta' }, fmtDate(s.date, { day: 'numeric', month: 'long', year: 'numeric' })),
      h('div', { class: 'photo-grid' }, POSES.map(([k, l]) => s[k]
        ? h('button', { class: 'photo', 'aria-label': `${l} photo, ${fmtDate(s.date)}`, onclick: () => photoSheet(s[k], run) }, h('img', { src: `/api/photos/${s[k].id}`, alt: '', loading: 'lazy' }), h('span', {}, l))
        : h('div', { class: 'photo empty-photo' }, h('span', {}, l)))))),
      sessions.length > 6 ? h('p', { class: 'meta', style: 'padding:6px 0' }, `${sessions.length - 6} older sets kept for comparing.`) : null)
      : h('p', { class: 'muted', style: 'margin:12px 0' }, 'Take a front, side and back photo every 2–4 weeks in the same spot and light. Compare them side by side here.'),
    h('button', { class: 'add-row', onclick: () => addPhotosSheet(today, run) }, icon('camera', 22), 'Add progress photos'));
}

function compareSheet(sessions) {
  sheet('Compare photos', () => {
    let pose = 'front';
    let a = sessions[sessions.length - 1].date; let b = sessions[0].date; // first vs latest
    const view = h('div', { class: 'compare' });
    const pick = (cur, onChange, label) => {
      const sel = h('select', { 'aria-label': label }, sessions.map((s) => h('option', { value: s.date, selected: s.date === cur ? true : null }, fmtDate(s.date, { day: 'numeric', month: 'short', year: 'numeric' }))));
      sel.addEventListener('change', () => { onChange(sel.value); draw(); });
      return sel;
    };
    const side = (date, label, onChange) => {
      const s = sessions.find((x) => x.date === date);
      const ph = s?.[pose];
      return h('figure', {}, ph ? h('img', { src: `/api/photos/${ph.id}`, alt: `${pose} photo, ${fmtDate(date)}` }) : h('div', { class: 'photo empty-photo', style: 'aspect-ratio:3/4' }, h('span', {}, `No ${pose} photo`)),
        pick(date, onChange, label));
    };
    const days = () => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    const note = h('p', { class: 'sub', style: 'margin-top:8px' });
    const draw = () => {
      view.replaceChildren(side(a, 'Before', (v) => { a = v; }), side(b, 'After', (v) => { b = v; }));
      note.textContent = days() ? `${Math.abs(days())} days apart.` : '';
    };
    draw();
    return h('div', {}, seg(POSES, pose, (v) => { pose = v; draw(); }, 'Pose'), view, note);
  });
}

/** Front, side and back in one go: take them or pick them from the phone's photos. */
function addPhotosSheet(today, done) {
  sheet('Add progress photos', (close) => {
    const shots = {};
    const date = dateChip(today, { max: today, label: 'Photo date' });
    const tile = (pose, label) => {
      const img = h('img', { alt: '', class: 'shot-img', hidden: true });
      const ph = h('span', { class: 'shot-ph' }, icon('camera', 26), h('small', {}, 'Add'));
      const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', 'aria-label': `${label} photo` });
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { shots[pose] = await shrink(input.files[0]); img.src = shots[pose]; img.hidden = false; ph.hidden = true; } catch (e) { toast(e.message, 'bad'); }
      });
      return h('label', { class: 'shot' }, input, img, ph, h('span', { class: 'shot-label' }, label));
    };
    const go = h('button', { class: 'btn block', onclick: async () => {
      const poses = Object.keys(shots);
      if (!poses.length) { toast('Add at least one photo', 'bad'); return; }
      go.disabled = true; go.textContent = 'Saving…';
      try {
        for (const pose of poses) await api('POST', '/api/photos', { date: date.value, pose, image: shots[pose] });
        toast('Photos saved');
        close(); done();
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; go.textContent = 'Save photos'; }
    } }, 'Save photos');
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'Same spot, same light, relaxed stance, arms slightly out. Private to you and the admin.'),
      h('div', { class: 'shots' }, POSES.map(([k, l]) => tile(k, l))),
      field('Date', date),
      go);
  });
}

function photoSheet(ph, done) {
  sheet(`${ph.pose[0].toUpperCase()}${ph.pose.slice(1)}, ${fmtDate(ph.date)}`, (close) => h('div', { class: 'stack' },
    h('img', { src: `/api/photos/${ph.id}`, alt: `${ph.pose} progress photo`, style: 'width:100%;border-radius:12px' }),
    h('button', { class: 'btn danger block', onclick: () => confirmSheet('Delete this photo?', 'It is removed for good.', 'Delete', async () => {
      try { await api('DELETE', `/api/photos/${ph.id}`); close(); toast('Photo deleted'); done(); } catch (e) { toast(e.message, 'bad'); }
    }, true) }, 'Delete photo')));
}

/** 64-bit average hash (8x8 greyscale) of an image data URL, as 16 hex chars. Flags re-used photos. */
export function averageHash(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
      const px = g.getImageData(0, 0, 8, 8).data;
      const lum = []; for (let i = 0; i < 64; i++) lum.push(px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114);
      const avg = lum.reduce((a, b) => a + b, 0) / 64;
      let hex = ''; for (let i = 0; i < 64; i += 4) hex += ((lum[i] > avg) << 3 | (lum[i + 1] > avg) << 2 | (lum[i + 2] > avg) << 1 | (lum[i + 3] > avg)).toString(16);
      resolve(hex);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
