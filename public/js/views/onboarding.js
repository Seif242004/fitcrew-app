import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { plain } from '../shell.js';
import { navigate } from '../router.js';
import { field, numInput, seg, plate, toast } from '../ui.js';
import { loadMe } from '../session.js';
import { computeTargets, navyBodyFat } from '/shared/calc.js';

const ALLERGENS = [['egg', 'Eggs'], ['dairy', 'Dairy'], ['nuts', 'Tree nuts'], ['peanut', 'Peanuts'], ['gluten', 'Gluten'], ['fish', 'Fish'], ['sesame', 'Sesame'], ['soy', 'Soy']];
const CATS = [['protein', 'Protein'], ['dairy', 'Dairy'], ['carb', 'Carbs'], ['fruit', 'Fruit'], ['veg', 'Vegetables'], ['fat', 'Fats']];
const ACTIVITY = [
  ['sedentary', 'Mostly sitting', 'Desk or study day, little walking'],
  ['light', 'Lightly active', 'On your feet some of the day, or 1 to 3 workouts a week'],
  ['moderate', 'Moderately active', '3 to 5 workouts a week'],
  ['active', 'Very active', '6 to 7 hard workouts a week, or a physical job'],
  ['very_active', 'Extremely active', 'Training twice a day or heavy manual work'],
];
const STEPS = ['About you', 'Body', 'Goal', 'Food', 'Training'];

const blank = () => ({
  sex: 'male', age: '', heightCm: '', weightKg: '', measurements: {}, bodyFatPct: '',
  goal: 'cut', weeklyRateKg: 0.5, activityLevel: 'moderate',
  experience: 'beginner', daysPerWeek: 4, equipment: 'gym', injuries: '', hideFromLeaderboard: false,
  prefs: { mealsPerDay: 3, likedIds: [], dislikedIds: [], allergies: [], vegetarian: false, note: '' },
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

function payload(p) {
  const out = { ...p, age: n(p.age), heightCm: n(p.heightCm), weightKg: n(p.weightKg), weeklyRateKg: p.goal === 'maintain' ? 0 : Number(p.weeklyRateKg) };
  const bf = n(p.bodyFatPct);
  if (bf === undefined) delete out.bodyFatPct; else out.bodyFatPct = bf;
  out.measurements = Object.fromEntries(Object.entries(p.measurements).filter(([, v]) => n(v) !== undefined).map(([k, v]) => [k, Number(v)]));
  return out;
}

export async function onboardingView(edit) {
  const existing = state.me?.profile;
  const p = existing ? structuredClone({ ...blank(), ...existing, bodyFatPct: existing.bodyFatPct ?? '', measurements: existing.measurements ?? {} }) : blank();
  // A body fat stored from an estimate should not be treated as a typed value on re-edit.
  if (existing && state.me?.targets?.bodyFatEstimated) p.bodyFatPct = '';
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

  function stepBody() {
    const m = p.measurements;
    const mi = (key, label, hint) => field(label, bind(key, numInput(m[key], { min: 10, max: 250 }), (v) => v, m), hint);
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'Measure with a soft tape, relaxed, in the morning. Neck and waist (plus hips for women) let the app estimate your body fat. Skip any you do not have.'),
      h('div', { class: 'grid2' }, mi('neckCm', 'Neck (cm)', 'Just below the larynx'), mi('waistCm', 'Waist (cm)', 'At the navel')),
      p.sex === 'female' ? mi('hipCm', 'Hips (cm)', 'Widest point') : null,
      h('div', { class: 'grid2' }, mi('chestCm', 'Chest (cm)'), mi('armCm', 'Upper arm (cm)')),
      h('div', { class: 'grid2' }, mi('thighCm', 'Thigh (cm)'), mi('calfCm', 'Calf (cm)')),
      field('Body fat % (only if you know it)', bind('bodyFatPct', numInput(p.bodyFatPct, { min: 3, max: 60 })), 'From a scan or a smart scale. Otherwise leave it blank.'));
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
        h('div', { class: 'plates' },
          plate({ label: 'Protein', value: t.proteinG, target: t.proteinG, kind: 'p' }),
          plate({ label: 'Carbs', value: t.carbsG, target: t.carbsG, kind: 'c' }),
          plate({ label: 'Fat', value: t.fatG, target: t.fatG, kind: 'f' })),
        ...t.warnings.map((w) => h('p', { class: 'notice' }, w)),
        h('p', { class: 'sub' }, 'The admin reviews your plan before it goes live and can adjust these numbers.'));
    };
    const goal = seg([['cut', 'Lose fat'], ['maintain', 'Maintain'], ['bulk', 'Build']], p.goal, (v) => { p.goal = v; if (v === 'bulk' && p.weeklyRateKg > 0.4) p.weeklyRateKg = 0.25; if (v === 'cut' && p.weeklyRateKg < 0.25) p.weeklyRateKg = 0.5; draw(); }, 'Goal');
    const act = h('select', { 'aria-label': 'Activity level' }, ACTIVITY.map(([v, l]) => h('option', { value: v, selected: p.activityLevel === v ? true : null }, l)));
    const actHint = h('small', {}, ACTIVITY.find((a) => a[0] === p.activityLevel)[2]);
    act.addEventListener('change', () => { p.activityLevel = act.value; actHint.textContent = ACTIVITY.find((a) => a[0] === act.value)[2]; draw(); });
    draw();
    return h('div', { class: 'stack' }, h('div', { class: 'field' }, h('span', {}, 'Your goal'), goal), rate, field('Daily activity', act, null), actHint, prev);
  }

  function stepFood() {
    const pr = p.prefs;
    const meals = seg([[3, '3 meals'], [4, '4 meals'], [5, '5 meals']], pr.mealsPerDay, (v) => { pr.mealsPerDay = v; }, 'Meals per day');
    const veg = h('input', { type: 'checkbox', checked: pr.vegetarian, style: 'width:24px;height:24px' });
    veg.addEventListener('change', () => { pr.vegetarian = veg.checked; });
    const allergens = h('div', { class: 'chips' }, ALLERGENS.map(([id, label]) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pr.allergies.includes(id)) }, label);
      b.addEventListener('click', () => {
        pr.allergies = pr.allergies.includes(id) ? pr.allergies.filter((x) => x !== id) : [...pr.allergies, id];
        b.setAttribute('aria-pressed', String(pr.allergies.includes(id)));
      });
      return b;
    }));
    const chip = (f) => {
      const b = h('button', { type: 'button', class: 'chip' });
      const draw = () => {
        const s = pr.likedIds.includes(f.id) ? 'like' : pr.dislikedIds.includes(f.id) ? 'dislike' : 'none';
        b.dataset.state = s;
        b.setAttribute('aria-label', `${f.name}, ${s === 'like' ? 'liked' : s === 'dislike' ? 'excluded' : 'no preference'}`);
        b.replaceChildren(s === 'like' ? '✓ ' : s === 'dislike' ? '✕ ' : '', f.name);
      };
      b.addEventListener('click', () => {
        const s = b.dataset.state;
        pr.likedIds = pr.likedIds.filter((x) => x !== f.id);
        pr.dislikedIds = pr.dislikedIds.filter((x) => x !== f.id);
        if (s === 'none') pr.likedIds.push(f.id);
        else if (s === 'like') pr.dislikedIds.push(f.id);
        draw();
      });
      draw();
      return b;
    };
    const note = h('textarea', { 'aria-label': 'Anything else about food', placeholder: 'Anything else the admin should know about how you eat?' }, pr.note);
    note.addEventListener('input', () => { pr.note = note.value; });
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'field' }, h('span', {}, 'Meals per day'), meals),
      h('label', { class: 'row-flex' }, veg, h('span', {}, 'I do not eat meat or fish')),
      h('div', {}, h('p', { class: 'h2', style: 'margin-bottom:8px' }, 'Allergies and intolerances'), allergens),
      h('div', { class: 'stack' },
        h('p', { class: 'h2' }, 'Foods you like and foods you will not eat'),
        h('p', { class: 'sub' }, 'Tap once to like (the plan uses these more), twice to exclude, three times to clear.'),
        foods.length ? CATS.map(([cat, label]) => {
          const list = foods.filter((f) => f.cat === cat);
          return list.length ? h('div', {}, h('p', { style: 'font-weight:700;margin:8px 0' }, label), h('div', { class: 'chips' }, list.map(chip))) : null;
        }) : h('p', { class: 'error' }, 'The food list did not load. Go back and return to this step.')),
      field('Anything else', note));
  }

  function stepTrain() {
    const exp = seg([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']], p.experience, (v) => { p.experience = v; }, 'Training experience');
    const eq = seg([['gym', 'Full gym'], ['home', 'Home'], ['mixed', 'Both']], p.equipment, (v) => { p.equipment = v; }, 'Equipment');
    const days = seg([2, 3, 4, 5, 6].map((d) => [d, String(d)]), Number(p.daysPerWeek), (v) => { p.daysPerWeek = v; }, 'Days per week');
    const inj = h('textarea', { 'aria-label': 'Injuries or limits', placeholder: 'Bad knee, shoulder pain, anything to work around' }, p.injuries);
    inj.addEventListener('input', () => { p.injuries = inj.value; });
    const hide = h('input', { type: 'checkbox', checked: p.hideFromLeaderboard, style: 'width:24px;height:24px' });
    hide.addEventListener('change', () => { p.hideFromLeaderboard = hide.checked; });
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'field' }, h('span', {}, 'Training experience'), exp),
      h('div', { class: 'field' }, h('span', {}, 'Days a week you can train'), days),
      h('div', { class: 'field' }, h('span', {}, 'Where you train'), eq),
      field('Injuries or limits', inj),
      h('label', { class: 'row-flex' }, hide, h('span', {}, 'Hide me from the group leaderboard')));
  }

  const builders = [stepAbout, stepBody, stepGoal, stepFood, stepTrain];

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
    try {
      const res = await api('PUT', '/api/profile', { profile: payload(p) });
      await loadMe();
      if (edit) { toast('Saved. Your current plan stays until the admin approves a new one.'); navigate('/profile'); return; }
      done(res);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  }

  function done() {
    plain(
      h('h1', { class: 'title' }, 'Plan sent'),
      h('p', { style: 'margin:12px 0 24px;max-width:34ch' }, 'Your numbers are saved and a first plan has been drafted. The admin will check it and approve it, then it appears on your Today screen.'),
      h('button', { class: 'btn', onclick: () => navigate('/today') }, 'Continue'));
  }

  function draw() {
    bar.replaceChildren(...STEPS.map((_, i) => h('i', { class: i <= step ? 'on' : '' })));
    heading.replaceChildren(h('p', { class: 'sub' }, `Step ${step + 1} of ${STEPS.length}`), h('h1', { class: 'title' }, STEPS[step]));
    body.replaceChildren(builders[step]());
    msg.textContent = '';
    const last = step === STEPS.length - 1;
    const next = h('button', { class: 'btn', type: 'button' }, last ? (edit ? 'Save changes' : 'Send for approval') : 'Next');
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
