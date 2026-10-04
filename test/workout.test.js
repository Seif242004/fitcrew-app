import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, generateWorkoutPlan, nextTarget, e1rm, videoFor, swapOptions } from '../src/workout.js';

const byId = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

test('library has unique ids and every plan pattern has exercises', () => {
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
  for (const p of ['squat', 'hinge', 'hpush', 'vpush', 'hpull', 'vpull', 'lunge', 'glute', 'quad', 'ham', 'calf', 'bicep', 'tricep', 'sidedelt', 'reardelt', 'fly', 'core']) {
    assert.ok(EXERCISES.some((e) => e.pattern === p), `no exercise for ${p}`);
    assert.ok(EXERCISES.some((e) => e.pattern === p && e.equip === 'bodyweight' || e.equip === 'dumbbell' && e.pattern === p) || ['quad', 'fly', 'reardelt', 'vpull'].includes(p), `home has nothing for ${p}`);
  }
});

test('plans have the requested number of training days on distinct weekdays', () => {
  for (const d of [2, 3, 4, 5, 6]) {
    const plan = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: d, equipment: 'gym' } });
    assert.equal(plan.days.length, d);
    assert.equal(new Set(plan.days.map((x) => x.weekday)).size, d);
    assert.ok(plan.days.every((x) => x.exercises.length >= 5));
  }
});

test('no exercise is repeated within a day', () => {
  for (const d of [3, 4, 5, 6]) {
    const plan = generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: d, equipment: 'gym' } });
    for (const day of plan.days) assert.equal(new Set(day.exercises.map((e) => e.exerciseId)).size, day.exercises.length, `${day.name} repeats an exercise`);
  }
});

test('home plans only use bodyweight and dumbbell exercises', () => {
  const plan = generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: 4, equipment: 'home' } });
  for (const day of plan.days) for (const e of day.exercises) assert.ok(['bodyweight', 'dumbbell'].includes(byId[e.exerciseId].equip), `${e.exerciseId} needs a gym`);
});

test('coach-style prescriptions: every exercise has sets, reps, RIR, rest and tempo', () => {
  for (const exp of ['beginner', 'intermediate', 'advanced']) {
    const plan = generateWorkoutPlan({ profile: { experience: exp, daysPerWeek: 4, equipment: 'gym', goal: 'cut' } });
    assert.equal(plan.format, 2);
    for (const d of plan.days) {
      assert.ok(d.warmup.length >= 2, `${d.name} has a warm-up`);
      for (const e of d.exercises) {
        assert.ok(e.sets >= 2 && e.sets <= 5, `${e.name} sets`);
        assert.ok(e.repMin < e.repMax, `${e.name} has a rep range`);
        assert.ok(Number.isInteger(e.rir) && e.rir >= 0 && e.rir <= 3, `${e.name} has RIR`);
        assert.ok(e.restSec >= 60, `${e.name} has rest`);
      }
    }
    assert.equal(plan.cardio.minutes, 25, 'cutting gets 25 min of cardio');
  }
});

test('beginners train with more reps in reserve and fewer sets than advanced lifters', () => {
  const b = generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: 4, equipment: 'gym' } }).days[0];
  const a = generateWorkoutPlan({ profile: { experience: 'advanced', daysPerWeek: 4, equipment: 'gym' } }).days[0];
  assert.ok(b.exercises[0].rir > a.exercises[0].rir);
  assert.ok(b.exercises.length <= 6 && a.exercises.length >= b.exercises.length);
  assert.ok(a.exercises.reduce((n, e) => n + e.sets, 0) > b.exercises.reduce((n, e) => n + e.sets, 0));
});

test('gym plans lead with stable machines and dumbbells, like the coaches write them', () => {
  const plan = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 6, equipment: 'gym' } });
  for (const d of plan.days) for (const e of d.exercises) assert.notEqual(byId[e.exerciseId].equip, 'barbell', `${e.name} should not be a barbell lift`);
});

test('repeated sessions rotate exercises (Push A differs from Push B)', () => {
  const plan = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 6, equipment: 'gym' } });
  const a = plan.days.find((d) => d.name === 'Push A'); const b = plan.days.find((d) => d.name === 'Push B');
  assert.ok(a && b);
  assert.notDeepEqual(a.exercises.map((e) => e.exerciseId), b.exercises.map((e) => e.exerciseId));
});

test('default weekdays start on Saturday and keep Friday free; chosen days are respected', () => {
  for (const n of [3, 4, 5, 6]) {
    const plan = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: n, equipment: 'gym' } });
    assert.ok(!plan.days.some((d) => d.weekday === 5), 'Friday is a rest day');
    assert.equal(plan.days[0].weekday, 6, 'the week starts on Saturday');
  }
  const mine = generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: 3, trainDays: [0, 2, 4], equipment: 'gym' } });
  assert.deepEqual(mine.days.map((d) => d.weekday), [0, 2, 4]);
});

test('body-assessment focus areas get an extra set', () => {
  const base = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 4, equipment: 'gym' } });
  const focus = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 4, equipment: 'gym', focus: ['shoulders'] } });
  const sets = (p) => p.days.flatMap((d) => d.exercises).filter((e) => e.muscle === 'shoulders').reduce((n, e) => n + e.sets, 0);
  assert.ok(sets(focus) > sets(base));
});

test('every exercise in the library has technique cues and most have a coach demo video', () => {
  const main = EXERCISES.filter((e) => !['barbell'].includes(e.equip));
  assert.ok(main.filter((e) => e.video).length >= 40);
  for (const e of EXERCISES) if (e.video) assert.match(e.video, /^https:\/\/www\.youtube\.com\/watch\?v=/);
  assert.match(videoFor({ name: 'Svend press' }), /results\?search_query=Svend%20press/);
});

test('swap options keep the movement and respect home equipment', () => {
  const opts = swapOptions(byId['pec-deck'], EXERCISES, 'gym');
  assert.ok(opts.length >= 2 && opts.every((e) => e.pattern === 'fly'));
  assert.ok(swapOptions(byId['leg-press'], EXERCISES, 'home').every((e) => ['bodyweight', 'dumbbell'].includes(e.equip)));
});

test('timed core work uses seconds', () => {
  const plan = generateWorkoutPlan({ profile: { experience: 'advanced', daysPerWeek: 6, equipment: 'gym' } });
  const timed = plan.days.flatMap((d) => d.exercises).filter((e) => byId[e.exerciseId].timed);
  for (const t of timed) assert.ok(t.repMin >= 20 && t.repMax <= 60);
});

test('injuries produce a warning for the admin', () => {
  const plan = generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: 3, equipment: 'gym', injuries: 'left knee pain' } });
  assert.ok(plan.warnings.some((w) => w.includes('left knee pain')));
});

test('progression: top of the range on every set adds weight', () => {
  const t = nextTarget({ lastSets: [{ weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }], repMin: 6, repMax: 10, inc: 2.5 });
  assert.deepEqual(t, { weightKg: 62.5, reps: 6, change: 'add weight' });
});

test('progression: below the top keeps the weight and aims for one more rep', () => {
  const t = nextTarget({ lastSets: [{ weightKg: 60, reps: 9 }, { weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }], repMin: 6, repMax: 10, inc: 2.5 });
  assert.deepEqual(t, { weightKg: 60, reps: 9, change: 'add reps' });
});

test('progression ignores light warm-up sets', () => {
  const t = nextTarget({ lastSets: [{ weightKg: 20, reps: 12 }, { weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }], repMin: 6, repMax: 10, inc: 2.5 });
  assert.equal(t.weightKg, 62.5);
});

test('progression: bodyweight exercises keep adding reps', () => {
  const t = nextTarget({ lastSets: [{ weightKg: 0, reps: 12 }, { weightKg: 0, reps: 11 }], repMin: 8, repMax: 12, inc: 0 });
  assert.deepEqual(t, { weightKg: 0, reps: 12, change: 'add reps' });
});

test('progression: no history means no target', () => {
  assert.equal(nextTarget({ lastSets: [], repMin: 6, repMax: 10, inc: 2.5 }), null);
});

test('e1rm: single is the weight, 10 reps adds a third, reps are capped at 12', () => {
  assert.ok(Math.abs(e1rm(100, 1) - 103.33) < 0.1);
  assert.ok(Math.abs(e1rm(100, 10) - 133.33) < 0.1);
  assert.equal(e1rm(100, 20), e1rm(100, 12));
  assert.equal(e1rm(0, 10), 0);
});

// ---------------------------------------------------------------- named splits (the crew's notes)
import { SPLITS, splitDaysError } from '../src/workout.js';

test('named splits: Arnold, push/pull/legs and anterior/posterior follow the crew notes', () => {
  const arnold = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 3, split: 'arnold' } });
  assert.equal(arnold.split, 'Arnold split');
  assert.deepEqual(arnold.days.map((d) => d.name), ['Chest & back', 'Shoulders & arms', 'Legs']);
  assert.deepEqual(arnold.days[0].exercises.slice(0, 5).map((e) => e.exerciseId), ['machine-chest-press', 'incline-press-machine', 'pec-deck', 'lat-pulldown', 'tbar-row']);
  const legs = arnold.days[2].exercises;
  assert.deepEqual(legs.map((e) => e.exerciseId).slice(0, 4), ['db-rdl', 'smith-squat', 'seated-leg-curl', 'leg-extension']);
  assert.match(legs[2].note, /Superset/);
  assert.equal(legs[2].restSec, 15, 'no rest inside the superset');

  const six = generateWorkoutPlan({ profile: { experience: 'advanced', daysPerWeek: 6, split: 'ppl' } });
  assert.deepEqual(six.days.map((d) => d.name), ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B']);
  const curls = six.days.filter((d) => d.name.startsWith('Pull')).map((d) => d.exercises.find((e) => ['sa-db-preacher', 'seated-db-curl'].includes(e.exerciseId))?.exerciseId);
  assert.deepEqual(curls, ['sa-db-preacher', 'seated-db-curl'], 'biceps twice a week: preacher, then seated curls');

  const ap = generateWorkoutPlan({ profile: { experience: 'advanced', daysPerWeek: 4, split: 'antpost' } });
  assert.deepEqual(ap.days.map((d) => d.name), ['Anterior A', 'Posterior A', 'Anterior B', 'Posterior B']);
  assert.ok(ap.days.every((d) => d.exercises.length <= 10));
});

test('a split only runs on its day counts; the coach default takes any', () => {
  assert.equal(splitDaysError('arnold', 4), 'Arnold split runs 3 or 6 days a week');
  assert.equal(splitDaysError('antpost', 4), '');
  assert.equal(splitDaysError('auto', 7), '');
  // a stale combination falls back to the coach default instead of breaking
  const p = generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 4, split: 'arnold' } });
  assert.equal(p.split, 'Upper / lower');
  for (const [k, s] of Object.entries(SPLITS)) for (const d of s.days) {
    const plan = generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: d, split: k, equipment: 'home' } });
    assert.equal(plan.days.length, d, `${k} ${d}`);
    for (const day of plan.days) for (const e of day.exercises) assert.ok(['bodyweight', 'dumbbell'].includes(byId[e.exerciseId].equip), `${k}: ${e.exerciseId} at home`);
  }
});

// ---------------------------------------------------------------- intensity
import { INTENSITY } from '../src/workout.js';

test('intensity sets the volume, how close to failure and the session length', () => {
  const plan = (intensity) => generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 4, intensity, goal: 'cut' } });
  const [l, m, hd] = ['light', 'moderate', 'hard'].map(plan);
  const sets = (p) => p.days[0].exercises.reduce((a, e) => a + e.sets, 0);
  assert.ok(sets(l) < sets(m) && sets(m) < sets(hd), 'light < moderate < hard sets');
  assert.ok(l.days[0].exercises.length <= m.days[0].exercises.length && m.days[0].exercises.length <= hd.days[0].exercises.length);
  assert.ok(l.days[0].exercises[0].rir > m.days[0].exercises[0].rir && m.days[0].exercises[0].rir > hd.days[0].exercises[0].rir);
  for (const [p, k] of [[l, 'light'], [m, 'moderate'], [hd, 'hard']]) {
    assert.equal(p.intensity, k);
    for (const d of p.days) {
      assert.ok(d.exercises.reduce((a, e) => a + e.sets, 0) <= INTENSITY[k].maxSets, `${k} stays within its set budget`);
      assert.ok(Number.isInteger(d.minutes) && d.minutes > 0);
    }
  }
  assert.ok(l.days[0].minutes < hd.days[0].minutes);
  assert.ok(l.days[0].minutes <= 50 && hd.days[0].minutes <= 95, 'durations match the labels');
});

test('coach picks: light 3-day weeks are full body, hard ones push / pull / legs', () => {
  assert.equal(generateWorkoutPlan({ profile: { experience: 'intermediate', daysPerWeek: 3, intensity: 'light' } }).split, 'Full body');
  assert.equal(generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: 3, intensity: 'hard' } }).split, 'Push / pull / legs');
  assert.equal(generateWorkoutPlan({ profile: { experience: 'beginner', daysPerWeek: 3 } }).split, 'Full body');
});
