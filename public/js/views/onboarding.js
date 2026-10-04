import { h } from '../dom.js';
import { api } from '../api.js';
import { state, localDate } from '../state.js';
import { plain } from '../shell.js';
import { navigate } from '../router.js';
import { field, numInput, seg, toast, icon } from '../ui.js';
import { enablePush } from '../notify.js';
import { loadMe } from '../session.js';
import { computeTargets, navyBodyFat } from '/shared/calc.js';
import { shrink } from './progress.js';

// Mirrors EXCLUDE_GROUPS on the server (src/foods-seed.js).
const GROUPS = [['meat', 'Red meat'], ['poultry', 'Chicken & turkey'], ['fish', 'Fish'], ['seafood', 'Shrimp & seafood'], ['organ', 'Liver & organ meat'], ['egg', 'Eggs'], ['dairy', 'Milk & dairy'], ['gluten', 'Wheat / gluten'], ['nuts', 'Tree nuts'], ['peanut', 'Peanuts'], ['sesame', 'Sesame & tahini'], ['soy', 'Soy']];
const AR = (s) => String(s ?? '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
const ACTIVITY = [
  ['sedentary', 'Mostly sitting', 'Desk or study day, little walking'],
  ['light', 'Lightly active', 'On your feet some of the day, or 1 to 3 workouts a week'],
  ['moderate', 'Moderately active', '3 to 5 workouts a week'],
  ['active', 'Very active', '6 to 7 hard workouts a week, or a physical job'],
  ['very_active', 'Extremely active', 'Training twice a day or heavy manual work'],
];
const STEPS = ['About you', 'Goal', 'Training', 'Food', 'Photos'];

const blank = () => ({
  sex: 'male', age: '', heightCm: '', weightKg: '', measurements: {}, bodyFatPct: '',
  goal: 'cut', weeklyRateKg: 0.5, activityLevel: 'moderate',
  experience: 'beginner', daysPerWeek: 4, equipment: 'gym', split: 'auto', intensity: 'moderate', injuries: '', hideFromLeaderboard: false,
  prefs: { mealsPerDay: 4, trainTime: 'evening', likedIds: [], dislikedIds: [], allergies: [], vegetarian: false, hasWhey: false, budget: 'normal', note: '' },
});

const n = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

function previewTargets(p) {
  const base = { sex: p.sex, age: n(p.age), heightCm: n(p.heightCm), weightKg: n(p.weightKg), activityLevel: p.activityLevel, goal: p.goal, weeklyRateKg: p.goal === 'maintain' ? 0 : Number(p.weeklyRateKg) };
  if (!base.age || !base.heightCm || !base.weightKg) return null;
  let bf = n(p.bodyFatPct);
  if (bf === undefined) {
    const m = p.measurements;
    if (n(m.neckCm) && n(m.waistCm) && (p.sex === 'male' || n(m.hipCm))) {
      bf = navyBodyFat({ sex: p.sex, heightCm: base.heightCm, neckCm: n(m.neckCm), waistCm: n(m.waistCm), hipCm: n(m.hipCm) }) ?? undefined;
    }
  }
  try { return { ...computeTargets({ ...base, bodyFatPct: bf }), bf }; } catch { return null; }
}

// Default training weekdays per number of sessions (mirrors DEFAULT_DAYS in src/workout.js).
const DEFAULT_DAYS = { 2: [0, 3], 3: [6, 1, 3], 4: [6, 0, 2, 3], 5: [6, 0, 1, 3, 4], 6: [6, 0, 1, 2, 3, 4] };
// Mirrors SPLITS in src/workout.js: which split, and on how many days a week it runs.
export const SPLIT_CHOICES = [
  ['auto', 'Coach picks', 'The AI picks the best split for you and says why', [2, 3, 4, 5, 6]],
  ['arnold', 'Arnold split', 'Chest & back · shoulders & arms · legs', [3, 6]],
  ['ppl', 'Push / pull / legs', 'Push muscles · pull muscles · legs', [3, 6]],
  ['antpost', 'Anterior / posterior', 'Front of the body · back of the body', [2, 4]],
  ['upperlower', 'Upper / lower', 'Upper body · lower body', [4]],
  ['fullbody', 'Full body', 'Everything, every session', [2, 3]],
  ['ulppl', 'Upper / lower / push / pull / legs', 'Two halves, then push, pull and legs', [5]],
];
// Mirrors INTENSITY in src/workout.js.
export const INTENSITY_CHOICES = [
  ['light', 'Light', 'About 45 min. Fewer exercises, 2–3 sets, 2–3 reps left in the tank.'],
  ['moderate', 'Moderate', 'About an hour. 3 sets, 1–2 reps left in the tank.'],
  ['hard', 'Hard', '75–90 min. More exercises, 3–4 sets taken close to failure.'],
];
const WEEK = [[6, 'Sat'], [0, 'Sun'], [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri']];

function payload(p) {
  const out = { ...p, age: n(p.age), heightCm: n(p.heightCm), weightKg: n(p.weightKg), weeklyRateKg: p.goal === 'maintain' ? 0 : Number(p.weeklyRateKg) };
  delete out.photoBf; delete out.aiPhotos; delete out.bodyFatSource;
  const bf = n(p.bodyFatPct);
  // Only a typed body fat is sent; otherwise the server estimates from the tape measurements.
  if (bf !== undefined) out.bodyFatPct = bf;
  else delete out.bodyFatPct;
  if (!Array.isArray(p.trainDays) || p.trainDays.length !== Number(p.daysPerWeek)) delete out.trainDays;
  out.measurements = Object.fromEntries(Object.entries(p.measurements).filter(([, v]) => n(v) !== undefined).map(([k, v]) => [k, Number(v)]));
  return out;
}

export async function onboardingView(edit) {
  const existing = state.me?.profile;
  const p = existing ? structuredClone({ ...blank(), ...existing, bodyFatPct: existing.bodyFatPct ?? '', measurements: existing.measurements ?? {} }) : blank();
  // A body fat stored from an estimate should not be treated as a typed value on re-edit.
  if (existing && state.me?.targets?.bodyFatEstimated) p.bodyFatPct = '';
  if (existing?.bodyFatSource === 'photos') p.bodyFatPct = ''; // old photo estimate: not a typed value
  let step = 0;
  let foods = [];
  try { foods = (await api('GET', '/api/foods')).foods; } catch { /* food step shows its own message */ }

  const bind = (key, input, parse = (v) => v, target = p) => { input.addEventListener('input', () => { target[key] = parse(input.value); }); return input; };
  const msg = h('p', { class: 'error', role: 'alert' });
  const body = h('div', { class: 'stack-lg' });
  const nav = h('div', { class: 'row-flex', style: 'margin-top:28px' });
  const bar = h('div', { class: 'progress-steps', 'aria-hidden': 'true' });
  const heading = h('div', {});

  function stepAbout() {
    return h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('span', {}, 'Sex'), seg([['male', 'Male'], ['female', 'Female']], p.sex, (v) => { p.sex = v; }, 'Sex'), h('small', {}, 'Used for the calorie formula.')),
      h('div', { class: 'grid3' },
        field('Age', bind('age', numInput(p.age, { min: 18, max: 90, inputmode: 'numeric' })), null),
        field('Height (cm)', bind('heightCm', numInput(p.heightCm, { min: 120, max: 230 }))),
        field('Weight (kg)', bind('weightKg', numInput(p.weightKg, { min: 35, max: 300 })))),
      h('p', { class: 'sub' }, 'FitCrew is for adults, 18 and over.'));
  }

  // Photos replace the long tape-measure form: front/side/back, all optional, uploaded on submit.
  // Only the measurements the body-fat estimate needs are offered, folded away.
  const shots = {}; // pose -> JPEG data URL (in memory until the profile is saved)
  function stepBody() {
    const m = p.measurements;
    const mi = (key, label, hint) => field(label, bind(key, numInput(m[key], { min: 10, max: 250 }), (v) => v, m), hint);
    // No `capture` attribute: phones then offer both "Take photo" and the photo library.
    const tile = (pose, label) => {
      const img = h('img', { alt: '', class: 'shot-img', src: shots[pose] ?? '', hidden: shots[pose] ? null : true });
      const ph = h('span', { class: 'shot-ph', hidden: shots[pose] ? true : null }, icon('camera', 26), h('small', {}, 'Add'));
      const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', 'aria-label': `${label} photo: take one or choose from your photos` });
      const clear = h('button', { type: 'button', class: 'shot-x', 'aria-label': `Remove ${label.toLowerCase()} photo`, hidden: shots[pose] ? null : true, onclick: (e) => { e.preventDefault(); delete shots[pose]; img.hidden = true; img.removeAttribute('src'); ph.hidden = false; clear.hidden = true; input.value = ''; } }, icon('close', 16));
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { shots[pose] = await shrink(input.files[0]); img.src = shots[pose]; img.hidden = false; ph.hidden = true; clear.hidden = false; }
        catch (e) { toast(e.message, 'bad'); }
      });
      return h('div', { class: 'shot-wrap' }, h('label', { class: 'shot' }, input, img, ph, h('span', { class: 'shot-label' }, label)), clear);
    };
    const more = h('details', { class: 'more-details', open: Object.keys(m).length || p.bodyFatPct ? true : null },
      h('summary', {}, 'Add measurements (optional)'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        h('p', { class: 'sub' }, 'Neck and waist' + (p.sex === 'female' ? ' and hips' : '') + ' let the app estimate your body fat, which makes the calorie target a bit more accurate.'),
        h('div', { class: 'grid2' }, mi('neckCm', 'Neck (cm)', 'Below the Adam\'s apple'), mi('waistCm', 'Waist (cm)', 'At the belly button')),
        p.sex === 'female' ? mi('hipCm', 'Hips (cm)', 'Widest point') : null,
        field('Body fat % (if you know it)', bind('bodyFatPct', numInput(p.bodyFatPct, { min: 3, max: 60 })), 'From a scan or a smart scale. It always wins over estimates.')));
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'Optional: your starting photos for comparing later in Progress. Take them now or pick them from your photos. Same spot, good light, relaxed, arms slightly out. Only you and the admin can see them.'),
      h('div', { class: 'shots' }, tile('front', 'Front'), tile('side', 'Side'), tile('back', 'Back')),
      more);
  }

  async function uploadShots() {
    const date = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
    let failed = 0;
    for (const [pose, image] of Object.entries(shots)) {
      try { await api('POST', '/api/photos', { date, pose, image }); delete shots[pose]; } catch { failed++; }
    }
    if (failed) toast(`${failed} photo${failed > 1 ? 's' : ''} did not upload. Add ${failed > 1 ? 'them' : 'it'} from Progress.`, 'bad');
  }

  function stepGoal() {
    const prev = h('div', { class: 'preview', 'aria-live': 'polite' });
    const rate = h('div', { class: 'field' });
    const draw = () => {
      rate.replaceChildren(...(p.goal === 'maintain' ? [] : [
        h('span', {}, p.goal === 'cut' ? 'How fast to lose' : 'How fast to gain'),
        seg(p.goal === 'cut' ? [[0.25, '0.25 kg'], [0.5, '0.5 kg'], [0.75, '0.75 kg'], [1, '1 kg']] : [[0.1, '0.1 kg'], [0.25, '0.25 kg'], [0.4, '0.4 kg']], Number(p.weeklyRateKg), (v) => { p.weeklyRateKg = v; draw(); }, 'Weekly rate'),
        h('small', {}, 'Per week. Slower keeps more muscle and is easier to stick to.')]));
      const t = previewTargets(p);
      if (!t) { prev.replaceChildren(h('p', { class: 'muted' }, 'Fill in your basics to see your numbers.')); return; }
      prev.replaceChildren(
        h('h3', { class: 'h2' }, `${t.kcal.toLocaleString('en-US')} kcal a day`),
        h('p', { class: 'sub' }, `Resting burn ${t.bmr.toLocaleString('en-US')} · with activity ${t.tdee.toLocaleString('en-US')}${t.bf !== undefined ? ` · body fat ${t.bf}%` : ''}`),
        h('div', { class: 'macro-row' },
          ...[['p', 'Protein', t.proteinG], ['c', 'Carbs', t.carbsG], ['f', 'Fat', t.fatG]].map(([k, label, g]) =>
            h('div', { class: `macro-stat m-${k}` }, h('span', { class: 'macro-g' }, `${g} g`), h('span', { class: 'macro-l' }, label)))),
        ...t.warnings.filter((w) => !/Admin review/.test(w)).map((w) => h('p', { class: 'notice' }, w)),
        h('p', { class: 'sub' }, 'Your plan is built from these numbers and checked automatically, so it is ready the moment you finish.'));
    };
    const goal = seg([['cut', 'Lose fat'], ['maintain', 'Maintain'], ['bulk', 'Build']], p.goal, (v) => { p.goal = v; if (v === 'bulk' && p.weeklyRateKg > 0.4) p.weeklyRateKg = 0.25; if (v === 'cut' && p.weeklyRateKg < 0.25) p.weeklyRateKg = 0.5; draw(); }, 'Goal');
    const act = h('select', { 'aria-label': 'Activity level' }, ACTIVITY.map(([v, l]) => h('option', { value: v, selected: p.activityLevel === v ? true : null }, l)));
    const actHint = h('small', {}, ACTIVITY.find((a) => a[0] === p.activityLevel)[2]);
    act.addEventListener('change', () => { p.activityLevel = act.value; actHint.textContent = ACTIVITY.find((a) => a[0] === act.value)[2]; draw(); });
    draw();
    return h('div', { class: 'stack' }, h('div', { class: 'field' }, h('span', {}, 'Your goal'), goal), rate, field('Daily activity', act, null), actHint, prev);
  }

  // Food: ask only what they NEVER eat. Everything else is fair game, and any item can be
  // swapped later, so a short "no" list beats a long "yes" questionnaire.
  function stepFood() {
    const pr = p.prefs;
    const meals = seg([[3, '3'], [4, '4'], [5, '5']], pr.mealsPerDay, (v) => { pr.mealsPerDay = v; }, 'Meals per day');
    const toggle = (pressed, label, onToggle) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed) }, label);
      b.addEventListener('click', () => { const now = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(now)); onToggle(now); });
      return b;
    };
    const groups = h('div', { class: 'chips' },
      toggle(pr.vegetarian, 'Vegetarian', (on) => { pr.vegetarian = on; }),
      ...GROUPS.map(([id, label]) => toggle(pr.allergies.includes(id), label, (on) => { pr.allergies = on ? [...new Set([...pr.allergies, id])] : pr.allergies.filter((x) => x !== id); })));

    // Specific foods: search, tap to rule out; ruled-out foods show as removable chips.
    const picked = h('div', { class: 'chips' });
    const results = h('div', { class: 'food-results' });
    const q = h('input', { type: 'search', placeholder: 'Search, e.g. liver, كبدة, mushrooms', 'aria-label': 'Search foods you do not eat', autocomplete: 'off' });
    const drawPicked = () => picked.replaceChildren(...pr.dislikedIds.map((id) => foods.find((f) => f.id === id)).filter(Boolean).map((f) =>
      h('button', { type: 'button', class: 'chip', 'data-state': 'dislike', 'aria-label': `Allow ${f.name} again`, onclick: () => { pr.dislikedIds = pr.dislikedIds.filter((x) => x !== f.id); drawPicked(); drawResults(); } }, f.name.split(/[,(]/)[0], ' ×')));
    const drawResults = () => {
      const t = AR(q.value.trim());
      if (!t) { results.replaceChildren(); return; }
      const hits = foods.filter((f) => AR(f.name).includes(t) || AR(f.ar).includes(t)).slice(0, 8);
      results.replaceChildren(...(hits.length ? hits.map((f) => {
        const out = pr.dislikedIds.includes(f.id);
        return h('button', { type: 'button', class: 'list-row', onclick: () => { pr.dislikedIds = out ? pr.dislikedIds.filter((x) => x !== f.id) : [...pr.dislikedIds, f.id]; drawPicked(); drawResults(); } },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, f.name), h('span', { class: 'sub', dir: 'rtl', style: 'text-align:left' }, f.ar ?? '')),
          h('span', { class: out ? 'status bad' : 'status idle' }, out ? 'Ruled out' : 'Rule out'));
      }) : [h('p', { class: 'sub', style: 'padding:8px 0' }, 'Not in the list. You can tell the coach about it later.')]));
    };
    q.addEventListener('input', drawResults);
    drawPicked();
    const budget = seg([['low', 'Tight'], ['normal', 'Normal'], ['high', 'Flexible']], pr.budget ?? 'normal', (v) => { pr.budget = v; }, 'Food budget');
    const whey = seg([[true, 'I have it'], [false, 'No']], Boolean(pr.hasWhey), (v) => { pr.hasWhey = v; }, 'Whey protein');
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'field' }, h('span', {}, 'Meals a day'), meals),
      h('div', { class: 'field' }, h('span', {}, 'Food budget'), budget, h('small', {}, 'Tight leaves out salmon, shrimp, steak, avocado and nuts.')),
      h('div', { class: 'field' }, h('span', {}, 'Whey protein'), whey, h('small', {}, 'Only planned if you already have it. You never need to buy supplements.')),
      h('div', {}, h('p', { class: 'h3', style: 'margin-bottom:4px' }, 'Anything you never eat?'),
        h('p', { class: 'sub', style: 'margin-bottom:12px' }, 'Allergies, religion, or just "no thanks". Everything else is fair game, and you can swap any item in your plan later.'),
        groups),
      foods.length ? h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'Specific foods'), q, results, picked) : null);
  }

  // How hard: sets the volume, how close to failure, and the split "Coach picks" chooses.
  function intensityField() {
    const hint = h('small', {});
    const show = () => { hint.textContent = INTENSITY_CHOICES.find((x) => x[0] === (p.intensity ?? 'moderate'))[2]; };
    show();
    return h('div', { class: 'field' }, h('span', {}, 'How hard do you want to train?'),
      seg(INTENSITY_CHOICES.map(([v, l]) => [v, l]), p.intensity ?? 'moderate', (v) => { p.intensity = v; show(); }, 'Training intensity'), hint);
  }

  function stepTrain() {
    const exp = seg([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']], p.experience, (v) => { p.experience = v; }, 'Training experience');
    const eq = seg([['gym', 'Full gym'], ['home', 'Home'], ['mixed', 'Both']], p.equipment, (v) => { p.equipment = v; }, 'Equipment');
    if (!Array.isArray(p.trainDays) || p.trainDays.length !== Number(p.daysPerWeek)) p.trainDays = [...(DEFAULT_DAYS[p.daysPerWeek] ?? DEFAULT_DAYS[4])];
    const chips = h('div', { class: 'chips' });
    const dayHint = h('small', {});
    const drawDays = () => {
      chips.replaceChildren(...WEEK.map(([wd, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(p.trainDays.includes(wd)), onclick: () => { p.trainDays = p.trainDays.includes(wd) ? p.trainDays.filter((x) => x !== wd) : [...p.trainDays, wd]; drawDays(); } }, label)));
      const k = p.trainDays.length; const want = Number(p.daysPerWeek);
      dayHint.textContent = k === want ? 'Your sessions land on these days. Change them any time.' : `Pick ${want} days (${k} picked). Otherwise the suggested days are used.`;
      dayHint.style.color = k === want ? '' : 'var(--warn)';
    };
    drawDays();
    const allowed = (SPLIT_CHOICES.find((x) => x[0] === (p.split ?? 'auto')) ?? SPLIT_CHOICES[0])[3];
    const days = seg(allowed.map((d) => [d, String(d)]), Number(p.daysPerWeek), (v) => { p.daysPerWeek = v; p.trainDays = [...DEFAULT_DAYS[v]]; drawDays(); }, 'Days per week');
    // Picking a split re-draws the step so the day choices match it.
    const splits = h('div', { class: 'split-list', role: 'radiogroup', 'aria-label': 'Training split' }, SPLIT_CHOICES.map(([id, name, about, d]) => h('button', {
      type: 'button', class: 'split-opt', role: 'radio', 'aria-checked': String((p.split ?? 'auto') === id),
      onclick: () => { p.split = id; if (!d.includes(Number(p.daysPerWeek))) { p.daysPerWeek = d.reduce((a, b) => (Math.abs(b - p.daysPerWeek) < Math.abs(a - p.daysPerWeek) ? b : a)); p.trainDays = [...DEFAULT_DAYS[p.daysPerWeek]]; } draw(); },
    }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, name), h('span', { class: 'sub' }, about)), h('span', { class: 'meta' }, `${d.join(' or ')} days`.replace('2 or 3 or 4 or 5 or 6 days', '2–6 days')))));
    const when = seg([['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening'], ['none', 'Varies']], p.prefs.trainTime ?? 'evening', (v) => { p.prefs.trainTime = v; }, 'When you train');
    const inj = h('textarea', { 'aria-label': 'Injuries or limits', placeholder: 'Bad knee, shoulder pain, anything to work around' }, p.injuries);
    inj.addEventListener('input', () => { p.injuries = inj.value; });
    const hide = h('input', { type: 'checkbox', checked: p.hideFromLeaderboard, style: 'width:24px;height:24px' });
    hide.addEventListener('change', () => { p.hideFromLeaderboard = hide.checked; });
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'field' }, h('span', {}, 'Training experience'), exp),
      intensityField(),
      h('div', { class: 'field' }, h('span', {}, 'Training split'), splits),
      h('div', { class: 'field' }, h('span', {}, 'Days a week you can train'), days),
      h('div', { class: 'field' }, h('span', {}, 'Which days'), chips, dayHint),
      h('div', { class: 'field' }, h('span', {}, 'When you usually train'), when, h('small', {}, 'Meals are timed around it: pre-workout and post-workout.')),
      h('div', { class: 'field' }, h('span', {}, 'Where you train'), eq),
      field('Injuries or limits', inj),
      h('label', { class: 'row-flex' }, hide, h('span', {}, 'Hide me from the group leaderboard')));
  }

  const builders = [stepAbout, stepGoal, stepTrain, stepFood, stepBody];

  function validate() {
    if (step === 0) {
      const age = n(p.age); const hgt = n(p.heightCm); const wt = n(p.weightKg);
      if (!age || age < 18) return 'Enter your age. FitCrew is for adults, 18 and over.';
      if (!hgt || hgt < 120 || hgt > 230) return 'Enter your height in centimetres, between 120 and 230.';
      if (!wt || wt < 35 || wt > 300) return 'Enter your weight in kilograms, between 35 and 300.';
    }
    return '';
  }

  async function submit(btn) {
    btn.disabled = true;
    msg.textContent = '';
    const label = btn.textContent;
    try {
      btn.textContent = 'Saving…';
      const res = await api('PUT', '/api/profile', { profile: payload(p), today: localDate() });
      await uploadShots();
      await loadMe();
      if (edit) { toast('Saved. Your current plan stays until the admin approves a new one.'); navigate('/profile'); return; }
      done(res);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function done() {
    const ready = state.me?.hasActivePlan;
    const preview = h('div', { style: 'margin-bottom:20px' });
    const t = state.me?.targets;
    const remind = h('button', { class: 'btn ghost block', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await enablePush(); b.textContent = 'Reminders are on'; toast('Your coach will check in morning and evening'); }
      catch (err) { toast(err.message, 'bad'); b.disabled = false; }
    } }, icon('bell', 20), 'Turn on daily reminders');
    plain(
      h('div', { class: 'coach-avatar', style: 'margin-bottom:16px' }, icon(ready ? 'check' : 'coach', 28)),
      h('h1', { class: 'title' }, ready ? 'Your plan is ready' : 'Almost there'),
      h('p', { class: 'sub', style: 'margin:8px 0 20px;max-width:36ch' }, ready
        ? `${t ? `${t.kcal.toLocaleString('en-US')} kcal a day with ${t.proteinG} g protein, ` : ''}${p.prefs.mealsPerDay} meals timed around your training. Swap anything you like from the Plan tab, or just tell the coach.`
        : 'Your plan needs a quick check from the admin (for example because of an injury). It shows up on Today as soon as it is approved.'),
      preview,
      h('div', { class: 'stack' },
        h('button', { class: 'btn block', onclick: () => navigate('/today') }, ready ? 'Start today' : 'Go to Today'),
        remind));
    if (ready) {
      try {
        const { plan } = await api('GET', '/api/plan');
        const day = plan?.days?.[0];
        if (day) preview.replaceChildren(h('div', { class: 'section plan-preview' },
          ...day.meals.map((m) => h('div', { class: 'pp-row' },
            h('div', { style: 'flex:1;min-width:0' }, h('p', { class: 'pp-name' }, m.name), h('p', { class: 'sub' }, m.title ?? m.items.map((i) => i.name.split(/[,(]/)[0]).join(', '))),
            h('span', { class: 'pp-kcal' }, `${m.totals.kcal}`)))));
      } catch { /* preview is a nice-to-have */ }
    }
  }

  function draw() {
    bar.replaceChildren(...STEPS.map((_, i) => h('i', { class: i <= step ? 'on' : '' })));
    heading.replaceChildren(h('p', { class: 'sub' }, `Step ${step + 1} of ${STEPS.length}`), h('h1', { class: 'title' }, STEPS[step]),
      // First screen of a first setup: say what is coming so nobody wonders how long this takes.
      step === 0 && !edit ? h('p', { class: 'sub', style: 'margin:-8px 0 16px' }, `Hi ${(state.me?.user?.name ?? '').split(' ')[0]}. Five short steps, about 3 minutes, then your diet and training plans are made for you. You can change everything later.`) : null);
    body.replaceChildren(builders[step]());
    msg.textContent = '';
    const last = step === STEPS.length - 1;
    const next = h('button', { class: 'btn', type: 'button' }, last ? (edit ? 'Save changes' : 'Make my plan') : 'Next');
    next.addEventListener('click', () => {
      const bad = validate();
      if (bad) { msg.textContent = bad; return; }
      if (last) submit(next); else { step++; draw(); window.scrollTo(0, 0); }
    });
    nav.replaceChildren(
      step > 0 ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { step--; draw(); window.scrollTo(0, 0); } }, 'Back') : null,
      next);
  }

  plain(bar, heading, h('div', { style: 'margin-top:18px' }, body), msg, nav,
    !edit && state.me?.user.role === 'admin' ? h('p', { style: 'margin-top:20px' }, h('button', { class: 'link', onclick: () => { state.skipOnboarding = true; navigate('/admin'); } }, 'Skip for now and open Admin')) : null,
    edit ? h('p', { style: 'margin-top:20px' }, h('button', { class: 'link', onclick: () => navigate('/profile') }, 'Cancel')) : null);
  draw();
}
