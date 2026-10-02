// Workout engine: exercise library, plan generator and progression rules.
// Pure functions, no dependencies. Weights are in kg.

const E = (id, name, muscle, equip, pattern, inc, o = {}) => ({ id, name, muscle, equip, pattern, inc, timed: Boolean(o.timed), notes: o.notes ?? '' });

export const EXERCISES = [
  // squat
  E('back-squat', 'Back squat', 'quads', 'barbell', 'squat', 5, { notes: 'Brace, knees track over toes, hips back and down.' }),
  E('leg-press', 'Leg press', 'quads', 'machine', 'squat', 5, { notes: 'Full range without letting the lower back lift off the pad.' }),
  E('hack-squat', 'Hack squat', 'quads', 'machine', 'squat', 5),
  E('goblet-squat', 'Goblet squat', 'quads', 'dumbbell', 'squat', 2, { notes: 'Hold one dumbbell at the chest, elbows inside the knees.' }),
  E('bodyweight-squat', 'Bodyweight squat', 'quads', 'bodyweight', 'squat', 0),
  // hinge
  E('romanian-deadlift', 'Romanian deadlift', 'hamstrings', 'barbell', 'hinge', 5, { notes: 'Soft knees, push the hips back, bar stays close to the legs.' }),
  E('deadlift', 'Deadlift', 'hamstrings', 'barbell', 'hinge', 5),
  E('db-rdl', 'Dumbbell Romanian deadlift', 'hamstrings', 'dumbbell', 'hinge', 2),
  E('hip-thrust', 'Hip thrust', 'glutes', 'barbell', 'glute', 5),
  E('glute-bridge', 'Glute bridge', 'glutes', 'bodyweight', 'glute', 0),
  // lunge
  E('walking-lunge', 'Walking lunge', 'quads', 'dumbbell', 'lunge', 2),
  E('split-squat', 'Split squat', 'quads', 'dumbbell', 'lunge', 2),
  E('bodyweight-lunge', 'Bodyweight lunge', 'quads', 'bodyweight', 'lunge', 0),
  // horizontal push
  E('bench-press', 'Bench press', 'chest', 'barbell', 'hpush', 2.5, { notes: 'Shoulder blades pinched, feet planted, touch the chest and press.' }),
  E('machine-chest-press', 'Machine chest press', 'chest', 'machine', 'hpush', 2.5),
  E('db-bench', 'Dumbbell bench press', 'chest', 'dumbbell', 'hpush', 2),
  E('incline-db-press', 'Incline dumbbell press', 'chest', 'dumbbell', 'hpush', 2),
  E('push-up', 'Push-up', 'chest', 'bodyweight', 'hpush', 0),
  // vertical push
  E('overhead-press', 'Overhead press', 'shoulders', 'barbell', 'vpush', 2.5),
  E('machine-shoulder-press', 'Machine shoulder press', 'shoulders', 'machine', 'vpush', 2.5),
  E('db-shoulder-press', 'Dumbbell shoulder press', 'shoulders', 'dumbbell', 'vpush', 2),
  E('pike-push-up', 'Pike push-up', 'shoulders', 'bodyweight', 'vpush', 0),
  // horizontal pull
  E('chest-supported-row', 'Chest-supported row', 'back', 'machine', 'hpull', 2.5),
  E('seated-cable-row', 'Seated cable row', 'back', 'cable', 'hpull', 2.5),
  E('barbell-row', 'Barbell row', 'back', 'barbell', 'hpull', 2.5),
  E('db-row', 'One-arm dumbbell row', 'back', 'dumbbell', 'hpull', 2),
  E('inverted-row', 'Inverted row', 'back', 'bodyweight', 'hpull', 0),
  // vertical pull
  E('lat-pulldown', 'Lat pulldown', 'back', 'machine', 'vpull', 2.5),
  E('pull-up', 'Pull-up', 'back', 'bodyweight', 'vpull', 0),
  // quads / hamstrings isolation
  E('leg-extension', 'Leg extension', 'quads', 'machine', 'quad', 2.5),
  E('leg-curl', 'Lying leg curl', 'hamstrings', 'machine', 'ham', 2.5),
  E('nordic-curl', 'Nordic hamstring curl', 'hamstrings', 'bodyweight', 'ham', 0),
  // calves
  E('standing-calf-raise', 'Standing calf raise', 'calves', 'machine', 'calf', 5),
  E('bodyweight-calf-raise', 'Bodyweight calf raise', 'calves', 'bodyweight', 'calf', 0),
  // arms
  E('db-curl', 'Dumbbell curl', 'biceps', 'dumbbell', 'bicep', 2),
  E('cable-curl', 'Cable curl', 'biceps', 'cable', 'bicep', 2.5),
  E('hammer-curl', 'Hammer curl', 'biceps', 'dumbbell', 'bicep', 2),
  E('triceps-pushdown', 'Triceps pushdown', 'triceps', 'cable', 'tricep', 2.5),
  E('overhead-triceps-ext', 'Overhead triceps extension', 'triceps', 'dumbbell', 'tricep', 2),
  E('bench-dip', 'Bench dip', 'triceps', 'bodyweight', 'tricep', 0),
  // delts and chest isolation
  E('lateral-raise', 'Lateral raise', 'shoulders', 'dumbbell', 'sidedelt', 1),
  E('face-pull', 'Face pull', 'shoulders', 'cable', 'reardelt', 2.5),
  E('rear-delt-fly', 'Rear delt fly', 'shoulders', 'dumbbell', 'reardelt', 1),
  E('cable-fly', 'Cable fly', 'chest', 'cable', 'fly', 2.5),
  E('pec-deck', 'Pec deck', 'chest', 'machine', 'fly', 2.5),
  // core
  E('plank', 'Plank (seconds)', 'core', 'bodyweight', 'core', 0, { timed: true }),
  E('hanging-knee-raise', 'Hanging knee raise', 'core', 'bodyweight', 'core', 0),
  E('cable-crunch', 'Cable crunch', 'core', 'cable', 'core', 2.5),
  E('dead-bug', 'Dead bug', 'core', 'bodyweight', 'core', 0),
];

const COMPOUND = new Set(['squat', 'hinge', 'hpush', 'vpush', 'hpull', 'vpull', 'lunge', 'glute']);

// Preference order: beginners start on machines and dumbbells, others lead with barbells.
const PREF_BEGINNER = ['machine', 'dumbbell', 'cable', 'barbell', 'bodyweight'];
const PREF_LIFTER = ['barbell', 'machine', 'dumbbell', 'cable', 'bodyweight'];

const DAY_TEMPLATES = {
  fullA: ['squat', 'hpush', 'hpull', 'vpush', 'core'],
  fullB: ['hinge', 'vpull', 'hpush', 'lunge', 'tricep', 'bicep'],
  fullC: ['squat', 'hpull', 'vpush', 'glute', 'sidedelt', 'core'],
  upper: ['hpush', 'hpull', 'vpush', 'vpull', 'sidedelt', 'bicep', 'tricep'],
  lower: ['squat', 'hinge', 'lunge', 'ham', 'calf', 'core'],
  push: ['hpush', 'vpush', 'fly', 'sidedelt', 'tricep', 'tricep'],
  pull: ['vpull', 'hpull', 'reardelt', 'hpull', 'bicep', 'bicep'],
  legs: ['squat', 'hinge', 'quad', 'ham', 'calf', 'core'],
};

// weekday numbers: 0 = Sunday ... 6 = Saturday
const SCHEDULES = {
  2: { split: 'Full body', days: [['Full body A', 'fullA', 1], ['Full body B', 'fullB', 4]] },
  3: { split: 'Full body', days: [['Full body A', 'fullA', 1], ['Full body B', 'fullB', 3], ['Full body C', 'fullC', 5]] },
  4: { split: 'Upper / lower', days: [['Upper A', 'upper', 1], ['Lower A', 'lower', 2], ['Upper B', 'upper', 4], ['Lower B', 'lower', 5]] },
  5: { split: 'Push / pull / legs + upper / lower', days: [['Push', 'push', 1], ['Pull', 'pull', 2], ['Legs', 'legs', 3], ['Upper', 'upper', 5], ['Lower', 'lower', 6]] },
  6: { split: 'Push / pull / legs twice', days: [['Push A', 'push', 1], ['Pull A', 'pull', 2], ['Legs A', 'legs', 3], ['Push B', 'push', 4], ['Pull B', 'pull', 5], ['Legs B', 'legs', 6]] },
};

function prescription(experience, pattern, exercise) {
  if (pattern === 'core') return exercise.timed ? { sets: 3, repMin: 30, repMax: 60, restSec: 60 } : { sets: 3, repMin: 10, repMax: 15, restSec: 60 };
  if (COMPOUND.has(pattern)) {
    if (experience === 'beginner') return { sets: 3, repMin: 8, repMax: 12, restSec: 120 };
    if (experience === 'intermediate') return { sets: 4, repMin: 6, repMax: 10, restSec: 120 };
    return { sets: 4, repMin: 5, repMax: 8, restSec: 150 };
  }
  return { sets: experience === 'beginner' ? 2 : 3, repMin: 10, repMax: 15, restSec: 75 };
}

/**
 * profile: { experience, daysPerWeek, equipment, injuries }
 * exercises: library (defaults to EXERCISES). Returns a draft plan for the admin to review.
 */
export function generateWorkoutPlan({ profile, exercises = EXERCISES }) {
  const days = Math.min(6, Math.max(2, Math.round(profile.daysPerWeek ?? 3)));
  const schedule = SCHEDULES[days];
  const experience = profile.experience ?? 'beginner';
  const allowed = profile.equipment === 'home' ? new Set(['bodyweight', 'dumbbell']) : new Set(['bodyweight', 'dumbbell', 'machine', 'cable', 'barbell']);
  const pool = exercises.filter((e) => allowed.has(e.equip));
  const pref = experience === 'beginner' ? PREF_BEGINNER : PREF_LIFTER;
  const warnings = [];
  const used = new Map(); // pattern -> how many times already placed, to vary across days

  const out = schedule.days.map(([name, tpl, weekday]) => {
    const picked = new Set();
    const list = [];
    for (const pattern of DAY_TEMPLATES[tpl]) {
      let cands = pool.filter((e) => e.pattern === pattern && !picked.has(e.id));
      if (profile.equipment === 'home') cands = cands.sort((a, b) => (a.equip === 'dumbbell' ? -1 : 0) - (b.equip === 'dumbbell' ? -1 : 0));
      else cands = cands.sort((a, b) => pref.indexOf(a.equip) - pref.indexOf(b.equip));
      if (!cands.length) {
        const w = `No exercise available for "${pattern}" with this equipment; that slot was skipped.`;
        if (!warnings.includes(w)) warnings.push(w);
        continue;
      }
      const n = used.get(pattern) ?? 0;
      used.set(pattern, n + 1);
      const ex = cands[n % cands.length];
      picked.add(ex.id);
      list.push({ exerciseId: ex.id, name: ex.name, muscle: ex.muscle, ...prescription(experience, pattern, ex) });
    }
    return { weekday, name, exercises: list };
  });

  if (profile.injuries && profile.injuries.trim()) warnings.push(`Injuries or limits reported: "${profile.injuries.trim().slice(0, 200)}". Check the exercise choices.`);
  return { split: schedule.split, daysPerWeek: days, experience, equipment: profile.equipment ?? 'gym', days: out, warnings };
}

/** Epley estimate of a one-rep max. Reps above 12 are capped because the estimate gets unreliable. */
export function e1rm(weightKg, reps) {
  if (!weightKg || !reps || weightKg <= 0 || reps <= 0) return 0;
  return weightKg * (1 + Math.min(reps, 12) / 30);
}

/**
 * Double progression. lastSets: [{weightKg, reps}] from the last session of this exercise.
 * Hit the top of the rep range on every working set, then add weight and start at the bottom again.
 */
export function nextTarget({ lastSets, repMin, repMax, inc }) {
  if (!lastSets || !lastSets.length) return null;
  const top = Math.max(...lastSets.map((s) => s.weightKg));
  const work = lastSets.filter((s) => s.weightKg >= top * 0.95 - 1e-9);
  const minReps = Math.min(...work.map((s) => s.reps));
  if (inc > 0 && top > 0) {
    if (minReps >= repMax) return { weightKg: Math.round((top + inc) * 100) / 100, reps: repMin, change: 'add weight' };
    return { weightKg: top, reps: Math.min(repMax, minReps + 1), change: minReps + 1 > repMax ? 'repeat' : 'add reps' };
  }
  // bodyweight or no load step: keep adding reps
  return { weightKg: top, reps: minReps + 1, change: 'add reps' };
}
