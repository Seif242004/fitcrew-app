// Workout engine: exercise library, coach-style plan generator and progression rules.
// Pure functions, no dependencies. Weights are in kg.
//
// Plans follow how the crew's coaches write them (Diet & Cheat / Fitness Savior programmes):
//   - a fixed split (Push / Pull / Legs, Upper / Lower, ...) on fixed weekdays,
//   - every exercise with sets, a rep range, RIR (reps in reserve), rest and tempo,
//   - mostly stable machines, cables and dumbbells (hypertrophy-focused, joint friendly),
//   - a short pre-activation warm-up and post-workout cardio,
//   - a demo video for every exercise.
// Progression is double progression: reach the top of the rep range on every set, then add weight.

const yt = (id, t) => `https://www.youtube.com/watch?v=${id}${t ? `&t=${t}s` : ''}`;

/**
 * id, name, muscle, equip, pattern, inc (kg step), options: timed, video, notes (technique cues).
 * Patterns group exercises that can replace each other (used for swaps and the admin library).
 */
const E = (id, name, muscle, equip, pattern, inc, o = {}) => ({
  id, name, muscle, equip, pattern, inc, timed: Boolean(o.timed), video: o.video ?? '', notes: o.notes ?? '',
});

export const EXERCISES = [
  // ---------------------------------------------------------------- chest
  E('incline-smith-press', '30° incline Smith machine press', 'chest', 'machine', 'hpush', 2.5, { video: yt('Huwq0SH5p8Y'), notes: 'Bench at 30°. Lower the bar to the upper chest with elbows about 45° from the body, press up and slightly back.' }),
  E('incline-db-press', 'Incline dumbbell press (15–30°)', 'chest', 'dumbbell', 'hpush', 2, { video: yt('XL9aTB1SHqs'), notes: 'Shoulder blades pinched and down. Lower until you feel a stretch in the chest, press the dumbbells up and slightly together.' }),
  E('incline-press-machine', 'Incline press machine', 'chest', 'machine', 'hpush', 2.5, { notes: 'Seat so the handles start at upper-chest height. Control the way back, do not let the stack touch between reps.' }),
  E('machine-chest-press', 'Chest press machine', 'chest', 'machine', 'hpush', 2.5, { video: yt('NwzUje3z0qY'), notes: 'Handles at mid-chest, back flat on the pad. Press without locking the elbows hard, slow on the way back.' }),
  E('flat-smith-press', 'Flat Smith machine press', 'chest', 'machine', 'hpush', 2.5, { notes: 'Bar touches the lower chest, feet planted, shoulder blades pinched. Press in a straight line.' }),
  E('db-bench', 'Flat dumbbell press', 'chest', 'dumbbell', 'hpush', 2, { video: yt('SfFfLXlpiQQ'), notes: 'Neutral or slightly turned grip. Lower to the sides of the chest with a deep stretch, press up without clanking the dumbbells.' }),
  E('bench-press', 'Barbell bench press', 'chest', 'barbell', 'hpush', 2.5, { notes: 'Shoulder blades pinched, feet planted, touch the chest and press.' }),
  E('weighted-dip', 'Weighted dips (chest lean)', 'chest', 'bodyweight', 'hpush', 2.5, { notes: 'Lean the torso forward, elbows slightly out. Lower until the shoulders are just below the elbows, press up. Add weight with a belt once 12 clean reps are easy.' }),
  E('push-up', 'Push-up', 'chest', 'bodyweight', 'hpush', 0, { notes: 'Body in one straight line, hands just wider than the shoulders, chest to a fist above the floor.' }),
  E('pec-deck', 'Pec deck fly machine', 'chest', 'machine', 'fly', 2.5, { video: yt('XjD5ee9sOhM'), notes: 'Handles at chest height, slight bend in the elbows. Squeeze the arms together, open slowly to a big stretch.' }),
  E('cable-fly', 'Cable fly (low to high)', 'chest', 'cable', 'fly', 2.5, { notes: 'Pulleys low, step forward. Sweep the hands up and together to chin height, keep the elbows soft.' }),
  E('db-fly', 'Flat dumbbell fly', 'chest', 'dumbbell', 'fly', 1, { notes: 'Elbows slightly bent and fixed. Open until a deep chest stretch, hug the dumbbells back together.' }),
  // ---------------------------------------------------------------- shoulders
  E('machine-shoulder-press', 'Neutral-grip shoulder press machine', 'shoulders', 'machine', 'vpush', 2.5, { video: yt('LEhz8ZXNWaY'), notes: 'Back against the pad, handles start at ear height. Press up without shrugging, lower under control.' }),
  E('db-shoulder-press', 'Seated dumbbell shoulder press', 'shoulders', 'dumbbell', 'vpush', 2, { notes: 'Bench nearly upright. Dumbbells start at ear height, press up and slightly in.' }),
  E('overhead-press', 'Barbell overhead press', 'shoulders', 'barbell', 'vpush', 2.5),
  E('pike-push-up', 'Pike push-up', 'shoulders', 'bodyweight', 'vpush', 0, { notes: 'Hips high, head moves forward of the hands as you lower.' }),
  E('cs-db-lateral', 'Chest-supported dumbbell lateral raise', 'shoulders', 'dumbbell', 'sidedelt', 1, { video: yt('aUDh4_V1-eY'), notes: 'Chest on an incline bench. Raise the dumbbells out to the sides to shoulder height, lead with the elbows, no swinging.' }),
  E('sa-cable-lateral', 'Single-arm cable lateral raise (wrist height)', 'shoulders', 'cable', 'sidedelt', 1.25, { video: yt('VOA6_pa2Cso'), notes: 'Cuff at wrist height, cable crossing in front of the body. Raise out to the side to shoulder height, slow on the way down.' }),
  E('lateral-raise', 'Dumbbell lateral raise', 'shoulders', 'dumbbell', 'sidedelt', 1, { notes: 'Slight forward lean, raise to shoulder height leading with the elbows, no momentum.' }),
  E('machine-rear-delt', 'Machine rear delt fly', 'shoulders', 'machine', 'reardelt', 2.5, { notes: 'Face the pad, handles at shoulder height. Push the arms back and out, do not squeeze the shoulder blades together.' }),
  E('cross-cable-rear-delt', 'Cross-cable rear delt fly', 'shoulders', 'cable', 'reardelt', 1.25, { video: yt('ywMSCem375A'), notes: 'Cables crossed at shoulder height. Pull the hands apart in a wide arc, arms almost straight.' }),
  E('sa-cable-rear-delt', 'Single-arm cable rear delt fly', 'shoulders', 'cable', 'reardelt', 1.25, { notes: 'Cable at shoulder height, pull across the body with a long arm until the hand is behind the shoulder. One side at a time, no torso twist.' }),
  E('rear-delt-fly', 'Prone dumbbell rear delt fly', 'shoulders', 'dumbbell', 'reardelt', 1, { notes: 'Chest on an incline bench, light dumbbells. Sweep the arms out wide, thumbs slightly down.' }),
  E('face-pull', 'Face pull', 'shoulders', 'cable', 'reardelt', 2.5, { notes: 'Rope at face height, pull to the forehead with elbows high and wide.' }),
  E('cable-shrug', 'Cable shrugs', 'traps', 'cable', 'shrug', 2.5, { video: yt('YykmcX2b-LY'), notes: 'Stand tall, shrug straight up toward the ears, pause one second, lower fully.' }),
  // ---------------------------------------------------------------- back
  E('ng-lat-pulldown', 'Neutral-grip lat pulldown', 'back', 'machine', 'vpull', 2.5, { video: yt('kVB6SlEyjQM', 284), notes: 'Thighs locked under the pad. Pull the handle to the upper chest by driving the elbows down to the hips, slow stretch at the top.' }),
  E('sa-iliac-pulldown', 'Single-arm cable iliac pulldown', 'back', 'cable', 'vpull', 1.25, { video: yt('Qed5O9toqT8'), notes: 'Seated, one arm. Pull the elbow down and back toward the hip bone, let the lat stretch fully overhead.' }),
  E('upper-back-pulldown', 'Wide-grip upper-back pulldown', 'back', 'machine', 'vpull', 2.5, { notes: 'Wide grip, slight lean back. Pull the bar to the collarbones with elbows flared out to the sides.' }),
  E('lat-pulldown', 'Lat pulldown', 'back', 'machine', 'vpull', 2.5, { notes: 'Pull to the upper chest, elbows down and back.' }),
  E('pull-up', 'Pull-up', 'back', 'bodyweight', 'vpull', 0, { notes: 'Full hang at the bottom, chest to the bar.' }),
  E('db-pullover', 'Dumbbell pullover', 'back', 'dumbbell', 'vpull', 2, { notes: 'Lying across a bench, arms slightly bent. Lower the dumbbell behind the head to a lat stretch, pull back over the chest.' }),
  E('cs-db-row', 'Chest-supported dumbbell row', 'back', 'dumbbell', 'hpull', 2, { video: yt('_FrrYQxA6kc'), notes: 'Chest on a 30–45° bench. Row the dumbbells to the lower ribs, squeeze, lower to a full stretch.' }),
  E('wide-cable-row', 'Wide-grip cable row (upper back)', 'back', 'cable', 'hpull', 2.5, { video: yt('g6wTsj0sj5s'), notes: 'Wide bar, sit tall. Pull to the lower chest with elbows flared, squeeze the upper back.' }),
  E('tbar-row', 'T-bar row machine', 'back', 'machine', 'hpull', 2.5, { notes: 'Chest on the pad. Pull the handles to the stomach, pause, lower until the arms are straight.' }),
  E('upper-back-row-machine', 'Upper-back row machine', 'back', 'machine', 'hpull', 2.5, { notes: 'Wide handles, elbows out. Pull back until the elbows pass the torso, control the return.' }),
  E('sa-lat-row-machine', 'Single-arm iso lat row machine', 'back', 'machine', 'hpull', 2.5, { video: yt('GdL4VJ25xY4'), notes: 'One arm. Pull the elbow back and down toward the hip, keep the torso still.' }),
  E('sa-cable-lumbar-row', 'Single-arm cable row (lat focus)', 'back', 'cable', 'hpull', 1.25, { video: yt('0pGi67ADMRg'), notes: 'Cable low, pull the elbow toward the back pocket in an arc, long stretch forward.' }),
  E('db-row', 'One-arm supported dumbbell row', 'back', 'dumbbell', 'hpull', 2, { video: yt('DMo3HJoawrU'), notes: 'Hand and knee on a bench, back flat. Row the dumbbell to the hip, lower all the way.' }),
  E('chest-supported-row', 'Chest-supported row machine', 'back', 'machine', 'hpull', 2.5, { notes: 'Chest on the pad, pull to the stomach, squeeze the shoulder blades.' }),
  E('seated-cable-row', 'Seated cable row', 'back', 'cable', 'hpull', 2.5, { notes: 'Sit tall, pull to the stomach, do not rock.' }),
  E('barbell-row', 'Barbell row', 'back', 'barbell', 'hpull', 2.5),
  E('inverted-row', 'Inverted row', 'back', 'bodyweight', 'hpull', 0),
  E('back-extension', '45° back extension (glute focus)', 'glutes', 'bodyweight', 'hinge', 2.5, { video: yt('bs7S3RFyIYs'), notes: 'Pad just below the hips, slight round in the upper back. Lower slowly, drive the hips into the pad to come up. Hold a plate when it gets easy.' }),
  // ---------------------------------------------------------------- arms
  E('face-away-curl', 'Face-away cable curl', 'biceps', 'cable', 'bicep', 1.25, { video: yt('fV9BpknCjGM'), notes: 'Face away from a low cable, arm slightly behind the body. Curl without moving the elbow forward.' }),
  E('sa-db-preacher', 'Single-arm dumbbell preacher curl', 'biceps', 'dumbbell', 'bicep', 1, { video: yt('fuK3nFvwgXk'), notes: 'Back of the arm flat on the pad. Lower until almost straight, curl up without lifting the elbow.' }),
  E('hammer-curl', 'Dumbbell hammer curl', 'biceps', 'dumbbell', 'bicep', 1, { video: yt('nvcqKLIJ_ds'), notes: 'Palms facing each other, elbows pinned to the sides. Curl up, lower slowly.' }),
  E('reverse-cable-curl', 'Reverse-grip cable curl', 'biceps', 'cable', 'bicep', 1.25, { video: yt('23-WiuDnsZ0'), notes: 'Overhand grip on a straight bar. Curl up keeping the wrists straight.' }),
  E('seated-db-curl', 'Seated incline dumbbell curl', 'biceps', 'dumbbell', 'bicep', 1, { notes: 'Bench at 45–60°, arms hanging behind the body. Curl without the elbows drifting forward; slow on the way down.' }),
  E('db-curl', 'Dumbbell curl', 'biceps', 'dumbbell', 'bicep', 1, { notes: 'Elbows still, turn the palms up as you curl.' }),
  E('cable-curl', 'Cable curl', 'biceps', 'cable', 'bicep', 2.5),
  E('rope-oh-ext', 'Dual-rope overhead triceps extension', 'triceps', 'cable', 'tricep', 1.25, { notes: 'Face away from the cable, elbows by the ears. Extend fully, then let the hands go deep behind the head.' }),
  E('cross-cable-oh-ext', 'Cross-cable overhead triceps extension', 'triceps', 'cable', 'tricep', 1.25, { video: yt('jtLTcED38Dg', 97), notes: 'One cable in each hand crossing behind the head. Extend up and out, slow stretch back.' }),
  E('dual-rope-pushdown', 'Dual-rope triceps extension', 'triceps', 'cable', 'tricep', 1.25, { video: yt('89UkdRV2Xco'), notes: 'Two ropes, elbows at the sides. Push down and apart until the arms are straight, pause.' }),
  E('sa-triceps-pushdown', 'Single-arm cable triceps pushdown', 'triceps', 'cable', 'tricep', 1.25, { notes: 'One handle, elbow pinned to the side. Push down to full lockout, control back up. Do all reps, then switch arms.' }),
  E('triceps-pushdown', 'V-grip triceps pushdown', 'triceps', 'cable', 'tricep', 2.5, { video: yt('6Fzep104f0s'), notes: 'Elbows pinned to the sides, push down to full lockout, control back to 90°.' }),
  E('overhead-triceps-ext', 'Dumbbell overhead triceps extension', 'triceps', 'dumbbell', 'tricep', 2, { notes: 'One dumbbell in both hands, elbows pointing up. Lower behind the head, extend fully.' }),
  E('bench-dip', 'Bench dip', 'triceps', 'bodyweight', 'tricep', 0),
  E('cable-wrist-curl', 'Cable wrist curl', 'forearms', 'cable', 'forearm', 1.25, { video: yt('WVAaKJvToe0'), notes: 'Forearms resting on the thighs, palms up. Let the bar roll to the fingertips, curl the wrist up.' }),
  // ---------------------------------------------------------------- legs
  E('leg-press', 'Leg press machine (quads)', 'quads', 'machine', 'squat', 5, { video: yt('yZmx_Ac3880'), notes: 'Feet shoulder width, low on the platform. Lower until the knees are deeply bent without the lower back lifting off the pad.' }),
  E('hack-squat', 'Hack squat machine (quads)', 'quads', 'machine', 'squat', 5, { video: yt('rYgNArpwE7E'), notes: 'Feet mid platform. Sit down deep between the heels, drive up through the whole foot.' }),
  E('smith-squat', 'Smith machine squat', 'quads', 'machine', 'squat', 5, { notes: 'Feet slightly in front of the bar, shoulder width. Sit down between the heels until the thighs are at least parallel, drive up through the whole foot.' }),
  E('back-squat', 'Barbell back squat', 'quads', 'barbell', 'squat', 5, { notes: 'Brace, knees track over toes, hips back and down.' }),
  E('goblet-squat', 'Goblet squat', 'quads', 'dumbbell', 'squat', 2, { notes: 'Hold one dumbbell at the chest, elbows inside the knees.' }),
  E('bodyweight-squat', 'Bodyweight squat', 'quads', 'bodyweight', 'squat', 0, { video: yt('NvHjGILrH0E'), notes: 'Arms forward, sit down between the heels, chest up.' }),
  E('leg-extension', 'Leg extension machine (quads)', 'quads', 'machine', 'quad', 2.5, { video: yt('m0FOpMEgero'), notes: 'Knee lined up with the machine pivot. Kick up to straight, pause, lower slowly.' }),
  E('bulgarian-split-squat', 'Dumbbell Bulgarian split squat (quads)', 'quads', 'dumbbell', 'lunge', 2, { video: yt('vLuhN_glFZ8'), notes: 'Back foot on a bench, front foot far enough that the knee can travel over the toes. Lower straight down.' }),
  E('walking-lunge', 'Walking lunge', 'quads', 'dumbbell', 'lunge', 2),
  E('split-squat', 'Split squat', 'quads', 'dumbbell', 'lunge', 2),
  E('bodyweight-lunge', 'Bodyweight lunge', 'quads', 'bodyweight', 'lunge', 0),
  E('seated-leg-curl', 'Seated leg curl', 'hamstrings', 'machine', 'ham', 2.5, { video: yt('Orxowest56U'), notes: 'Lean the torso forward for a bigger stretch. Curl all the way down, slow back up.' }),
  E('leg-curl', 'Lying leg curl', 'hamstrings', 'machine', 'ham', 2.5, { video: yt('SbSNUXPRkc8'), notes: 'Hips pressed into the pad. Curl the heels to the glutes, lower under control.' }),
  E('nordic-curl', 'Nordic hamstring curl', 'hamstrings', 'bodyweight', 'ham', 0),
  E('db-rdl', 'Dumbbell Romanian deadlift', 'hamstrings', 'dumbbell', 'hinge', 2, { video: yt('hQgFixeXdZo'), notes: 'Soft knees, push the hips back with the dumbbells close to the legs. Stop at a strong hamstring stretch, back flat.' }),
  E('romanian-deadlift', 'Barbell Romanian deadlift', 'hamstrings', 'barbell', 'hinge', 5, { notes: 'Soft knees, push the hips back, bar stays close to the legs.' }),
  E('deadlift', 'Deadlift', 'hamstrings', 'barbell', 'hinge', 5),
  E('hip-adduction', 'Seated hip adduction machine', 'adductors', 'machine', 'adduct', 2.5, { video: yt('CjAVezAggkI'), notes: 'Lean slightly forward. Squeeze the knees together, open slowly to a stretch.' }),
  E('hip-abduction', 'Seated hip abduction machine', 'glutes', 'machine', 'glute', 2.5, { notes: 'Lean slightly forward, push the knees out, pause, return slowly.' }),
  E('smith-glute-bridge', 'Smith machine glute bridge', 'glutes', 'machine', 'glute', 5, { video: yt('ADgWjz9i42Y'), notes: 'Bar padded over the hips, feet flat. Drive the hips up, squeeze the glutes, ribs down.' }),
  E('hip-thrust', 'Barbell hip thrust', 'glutes', 'barbell', 'glute', 5),
  E('glute-bridge', 'Glute bridge', 'glutes', 'bodyweight', 'glute', 0, { notes: 'Heels close to the hips, squeeze the glutes at the top for a second.' }),
  E('horizontal-calf', 'Horizontal calf raise (leg press)', 'calves', 'machine', 'calf', 5, { video: yt('dhRz1Ns60Zg'), notes: 'Balls of the feet on the platform edge. Deep stretch at the bottom, pause, push all the way up.' }),
  E('seated-calf', 'Seated calf raise machine', 'calves', 'machine', 'calf', 2.5, { video: yt('HSGjUouQZCQ'), notes: 'Pause 2 seconds in the stretch at the bottom, rise fully onto the toes.' }),
  E('standing-calf-raise', 'Standing calf raise', 'calves', 'machine', 'calf', 5),
  E('bodyweight-calf-raise', 'Single-leg calf raise', 'calves', 'bodyweight', 'calf', 0, { notes: 'On a step, one leg at a time, full stretch at the bottom.' }),
  // ---------------------------------------------------------------- core
  E('cable-crunch', 'Cable rope crunch', 'core', 'cable', 'core', 2.5, { video: yt('ToJeyhydUxU'), notes: 'Kneel, rope by the head. Curl the ribs toward the hips; the hips stay still.' }),
  E('plank', 'Plank (seconds)', 'core', 'bodyweight', 'core', 0, { timed: true, video: yt('pSHjTRCQxIw'), notes: 'Elbows under the shoulders, squeeze the glutes, ribs down, breathe.' }),
  E('side-plank', 'Side plank (seconds)', 'core', 'bodyweight', 'core', 0, { timed: true, video: yt('_R389Jk0tIo'), notes: 'Elbow under the shoulder, body in one line, hips high. Do both sides.' }),
  E('dead-bug', 'Dead bug', 'core', 'bodyweight', 'core', 0, { video: yt('rbemelnkHag'), notes: 'Lower back pressed into the floor. Extend the opposite arm and leg slowly.' }),
  E('pallof-press', 'Pallof press', 'core', 'cable', 'core', 1.25, { video: yt('XZkN5MljJY4'), notes: 'Side-on to the cable, press the handle straight out and resist the twist.' }),
  E('cable-russian-twist', 'Cable Russian twist', 'core', 'cable', 'core', 1.25, { notes: 'Arms long, rotate from the ribs, not the arms. Control both directions.' }),
  E('hanging-knee-raise', 'Hanging knee raise', 'core', 'bodyweight', 'core', 0),
  // ---------------------------------------------------------------- warm-up (pre-activation)
  E('wall-slide', 'Forward wall slide', 'shoulders', 'bodyweight', 'warmup', 0, { video: yt('Tp43JMh_gaM'), notes: 'Forearms on the wall, slide up while pushing gently into the wall.' }),
  E('push-plus', 'Push-up plus', 'chest', 'bodyweight', 'warmup', 0, { video: yt('I2MM3UBAlU4'), notes: 'At the top of a push-up, push the floor away to spread the shoulder blades.' }),
  E('incline-y-raise', 'Incline dumbbell Y raise', 'shoulders', 'dumbbell', 'warmup', 0, { video: yt('lXp16YozXgk'), notes: 'Chest on an incline bench, very light dumbbells. Raise the arms in a Y, thumbs up.' }),
  E('bird-dog', 'Bird dog', 'core', 'bodyweight', 'warmup', 0, { video: yt('vzU5xrs1gMQ'), notes: 'On all fours, extend the opposite arm and leg, hold one second, switch.' }),
];

export const MUSCLES = ['chest', 'back', 'shoulders', 'traps', 'quads', 'hamstrings', 'glutes', 'adductors', 'biceps', 'triceps', 'forearms', 'calves', 'core'];
export const PATTERNS = ['squat', 'hinge', 'lunge', 'glute', 'adduct', 'hpush', 'vpush', 'hpull', 'vpull', 'quad', 'ham', 'calf', 'bicep', 'tricep', 'forearm', 'sidedelt', 'reardelt', 'shrug', 'fly', 'core', 'warmup'];
/** Body-assessment focus areas (what the AI may suggest bringing up). */
export const FOCUS_AREAS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core'];

/** A demo link for any exercise: the coach's video when we have one, otherwise a YouTube search. */
// ---------------------------------------------------------------- training cycles
// Like the coaches' programmes: 6 building weeks, then a lighter deload week, then the plan
// refreshes itself with the next exercise variations (same split, days and intensity).
export const CYCLE_WEEKS = 7;
/** Week number of the plan (1 = the week it started). */
export const planWeek = (startDate, date) => Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 604800000) + 1;
export const isDeloadWeek = (startDate, date) => Boolean(startDate) && planWeek(startDate, date) === CYCLE_WEEKS;
/** Deload prescription: about half the sets, two more reps in reserve, ~10% lighter. */
export const deloadSets = (sets) => Math.max(1, Math.ceil(sets / 2));
export const deloadRir = (rir) => Math.min(4, (rir ?? 1) + 2);
export const deloadWeight = (kg, inc = 2.5) => (kg > 0 ? Math.max(inc, Math.round((kg * 0.9) / inc) * inc) : kg);

export const videoFor = (ex) => ex?.video || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex?.name ?? ''} exercise form`)}`;

// ---------------------------------------------------------------- slots
// Each slot lists real options in the order coaches pick them. Repeated days (Push A / Push B)
// rotate through the options so the two sessions differ, like the coaches' programmes.
// kind: compound | iso | core.
const SLOTS = {
  inclinePress: { kind: 'compound', gym: ['incline-smith-press', 'incline-db-press', 'incline-press-machine'], home: ['incline-db-press', 'push-up'] },
  flatPress: { kind: 'compound', gym: ['machine-chest-press', 'flat-smith-press', 'db-bench'], home: ['db-bench', 'push-up'] },
  shoulderPress: { kind: 'compound', gym: ['machine-shoulder-press', 'db-shoulder-press'], home: ['db-shoulder-press', 'pike-push-up'] },
  sideDelt: { kind: 'iso', gym: ['cs-db-lateral', 'sa-cable-lateral'], home: ['lateral-raise'] },
  fly: { kind: 'iso', gym: ['pec-deck', 'cable-fly'], home: ['db-fly'] },
  triOverhead: { kind: 'iso', gym: ['rope-oh-ext', 'cross-cable-oh-ext'], home: ['overhead-triceps-ext'] },
  triPushdown: { kind: 'iso', gym: ['dual-rope-pushdown', 'triceps-pushdown'], home: ['bench-dip'] },
  vPull: { kind: 'compound', gym: ['ng-lat-pulldown', 'sa-iliac-pulldown', 'upper-back-pulldown'], home: ['db-pullover'] },
  row: { kind: 'compound', gym: ['cs-db-row', 'wide-cable-row', 'tbar-row', 'upper-back-row-machine'], home: ['db-row'] },
  latRow: { kind: 'compound', gym: ['sa-lat-row-machine', 'sa-cable-lumbar-row', 'db-row'], home: ['db-row'] },
  rearDelt: { kind: 'iso', gym: ['machine-rear-delt', 'cross-cable-rear-delt', 'rear-delt-fly'], home: ['rear-delt-fly'] },
  biceps: { kind: 'iso', gym: ['face-away-curl', 'sa-db-preacher'], home: ['db-curl'] },
  biceps2: { kind: 'iso', gym: ['hammer-curl', 'reverse-cable-curl'], home: ['hammer-curl'] },
  quadCompound: { kind: 'compound', gym: ['leg-press', 'hack-squat'], home: ['goblet-squat'] },
  hinge: { kind: 'compound', gym: ['db-rdl', 'back-extension'], home: ['db-rdl'] },
  quadIso: { kind: 'iso', gym: ['leg-extension'], home: ['bulgarian-split-squat'] },
  lunge: { kind: 'compound', gym: ['bulgarian-split-squat'], home: ['bulgarian-split-squat'] },
  ham: { kind: 'iso', gym: ['seated-leg-curl', 'leg-curl'], home: ['glute-bridge'] },
  adductor: { kind: 'iso', gym: ['hip-adduction'], home: [] },
  glute: { kind: 'iso', gym: ['smith-glute-bridge', 'hip-abduction'], home: ['glute-bridge'] },
  calf: { kind: 'iso', gym: ['horizontal-calf', 'seated-calf'], home: ['bodyweight-calf-raise'] },
  abs: { kind: 'core', gym: ['cable-crunch', 'plank', 'side-plank', 'pallof-press', 'dead-bug', 'cable-russian-twist'], home: ['plank', 'dead-bug', 'side-plank'] },
  traps: { kind: 'iso', gym: ['cable-shrug'], home: [] },
  // named splits (Arnold, PPL, anterior / posterior): exercise order as the crew wrote it
  chestPress: { kind: 'compound', gym: ['machine-chest-press', 'flat-smith-press', 'db-bench'], home: ['db-bench', 'push-up'] },
  inclineMachine: { kind: 'compound', gym: ['incline-press-machine', 'incline-smith-press', 'incline-db-press'], home: ['incline-db-press', 'push-up'] },
  butterfly: { kind: 'iso', gym: ['pec-deck', 'weighted-dip'], home: ['db-fly'] },
  latPulldown: { kind: 'compound', gym: ['lat-pulldown', 'ng-lat-pulldown'], home: ['db-pullover'] },
  tbar: { kind: 'compound', gym: ['tbar-row', 'cs-db-row'], home: ['db-row'] },
  singleRow: { kind: 'compound', gym: ['sa-lat-row-machine', 'sa-cable-lumbar-row'], home: ['db-row'] },
  hyper: { kind: 'iso', gym: ['back-extension'], home: ['glute-bridge'] },
  rearDeltUni: { kind: 'iso', gym: ['sa-cable-rear-delt', 'cross-cable-rear-delt'], home: ['rear-delt-fly'] },
  hammer: { kind: 'iso', gym: ['hammer-curl'], home: ['hammer-curl'] },
  preacher: { kind: 'iso', gym: ['sa-db-preacher', 'seated-db-curl'], home: ['seated-db-curl'] },
  pushdownSingle: { kind: 'iso', gym: ['sa-triceps-pushdown', 'triceps-pushdown'], home: ['bench-dip'] },
  overheadExt: { kind: 'iso', gym: ['rope-oh-ext', 'cross-cable-oh-ext'], home: ['overhead-triceps-ext'] },
  reverseCurl: { kind: 'iso', gym: ['reverse-cable-curl'], home: ['hammer-curl'] },
  rdl: { kind: 'compound', gym: ['db-rdl'], home: ['db-rdl'] },
  squat: { kind: 'compound', gym: ['smith-squat', 'hack-squat'], home: ['goblet-squat'] },
  legCurl: { kind: 'iso', gym: ['seated-leg-curl', 'leg-curl'], home: ['glute-bridge'] },
  legExt: { kind: 'iso', gym: ['leg-extension'], home: ['bulgarian-split-squat'] },
  forearm: { kind: 'iso', gym: ['cable-wrist-curl'], home: [] },
};

// [slot, optional?]. Order = order in the gym: big lifts first, small ones last.
const DAYS = {
  push: { name: 'Push', focus: 'Chest, shoulders, triceps', warm: 'upper', slots: [['inclinePress'], ['flatPress'], ['sideDelt'], ['fly'], ['triOverhead'], ['triPushdown'], ['abs', true]] },
  pull: { name: 'Pull', focus: 'Back, rear delts, biceps', warm: 'upper', slots: [['vPull'], ['row'], ['latRow'], ['rearDelt'], ['biceps'], ['biceps2'], ['traps', true]] },
  legs: { name: 'Legs', focus: 'Quads, hamstrings, glutes, calves', warm: 'lower', slots: [['quadCompound'], ['hinge'], ['quadIso'], ['ham'], ['adductor', true], ['calf'], ['abs', true]] },
  upper: { name: 'Upper', focus: 'Chest, back, shoulders, arms', warm: 'upper', slots: [['inclinePress'], ['vPull'], ['sideDelt'], ['row'], ['fly'], ['biceps'], ['triOverhead'], ['forearm', true]] },
  lower: { name: 'Lower', focus: 'Legs, glutes, core', warm: 'lower', slots: [['ham'], ['quadCompound'], ['quadIso'], ['calf'], ['hinge'], ['adductor', true], ['abs']] },
  fullA: { name: 'Full body A', focus: 'Whole body', warm: 'upper', slots: [['quadCompound'], ['flatPress'], ['vPull'], ['sideDelt'], ['ham'], ['abs', true]] },
  fullB: { name: 'Full body B', focus: 'Whole body', warm: 'lower', slots: [['hinge'], ['inclinePress'], ['row'], ['lunge'], ['biceps'], ['triPushdown', true]] },
  fullC: { name: 'Full body C', focus: 'Whole body', warm: 'upper', slots: [['quadCompound'], ['shoulderPress'], ['latRow'], ['glute'], ['triOverhead'], ['abs', true]] },
  // Arnold split
  chestBack: { name: 'Chest & back', focus: 'Chest, back', warm: 'upper', slots: [['chestPress'], ['inclineMachine'], ['butterfly'], ['latPulldown'], ['tbar'], ['singleRow'], ['hyper', true]] },
  shouldersArms: { name: 'Shoulders & arms', focus: 'Shoulders, biceps, triceps', warm: 'upper', slots: [['shoulderPress'], ['sideDelt'], ['rearDeltUni'], ['hammer'], ['preacher'], ['pushdownSingle'], ['overheadExt'], ['reverseCurl', true]] },
  arnoldLegs: { name: 'Legs', focus: 'Hamstrings, quads, calves', warm: 'lower', slots: [['rdl'], ['squat'], ['legCurl', false, 'Leg extension'], ['legExt', false, 'Leg curl'], ['calf']] },
  // Push / pull / legs (the crew's version)
  pushX: { name: 'Push', focus: 'Chest, shoulders, triceps', warm: 'upper', slots: [['chestPress'], ['inclineMachine'], ['butterfly'], ['shoulderPress'], ['sideDelt'], ['pushdownSingle'], ['overheadExt']] },
  pullX: { name: 'Pull', focus: 'Back, biceps, rear delts', warm: 'upper', slots: [['latPulldown'], ['tbar'], ['singleRow'], ['hyper', true], ['hammer'], ['preacher'], ['rearDeltUni'], ['reverseCurl', true], ['traps', true]] },
  // Anterior / posterior (front of the body / back of the body)
  anterior: { name: 'Anterior', focus: 'Chest, front delts, biceps, quads', warm: 'upper', slots: [['chestPress'], ['inclineMachine'], ['butterfly'], ['shoulderPress'], ['sideDelt'], ['hammer'], ['preacher'], ['legExt'], ['squat'], ['reverseCurl', true]] },
  posterior: { name: 'Posterior', focus: 'Back, rear delts, hamstrings, triceps', warm: 'lower', slots: [['latPulldown'], ['tbar'], ['singleRow'], ['hyper'], ['rearDeltUni'], ['legCurl'], ['calf'], ['pushdownSingle'], ['overheadExt'], ['traps', true]] },
};

/**
 * Splits a member can pick. `auto` is the coach-style default chosen from days and experience.
 * The named splits follow the crew's notes; each runs on fixed day counts.
 */
export const SPLITS = {
  auto: { name: 'Coach picks', about: 'Chosen from your days and experience, like the coaches\' programmes.', days: [2, 3, 4, 5, 6] },
  arnold: { name: 'Arnold split', about: 'Chest & back, shoulders & arms, legs.', days: [3, 6], seq: ['chestBack', 'shouldersArms', 'arnoldLegs'] },
  ppl: { name: 'Push / pull / legs', about: 'Push muscles, pull muscles, legs.', days: [3, 6], seq: ['pushX', 'pullX', 'arnoldLegs'] },
  antpost: { name: 'Anterior / posterior', about: 'Front of the body, back of the body.', days: [2, 4], seq: ['anterior', 'posterior'] },
  upperlower: { name: 'Upper / lower', about: 'Upper body, lower body.', days: [4], seq: ['upper', 'lower'] },
  fullbody: { name: 'Full body', about: 'Everything, every session.', days: [2, 3], seq: ['fullA', 'fullB', 'fullC'] },
  ulppl: { name: 'Upper / lower / push / pull / legs', about: 'Two halves, then push, pull and legs.', days: [5], seq: ['upper', 'lower', 'push', 'pull', 'legs'] },
};

/** Splits that run on `days` sessions a week (everything except "coach picks"). */
export const splitsFor = (days) => Object.entries(SPLITS).filter(([id, x]) => id !== 'auto' && x.days.includes(days)).map(([id]) => id);

/**
 * Coach picks: the split that suits this person best, from every split that fits their days.
 * Rules a coach would use: new lifters and light weeks hit everything more often; arm and shoulder
 * focus suits the Arnold split; hard 4-day weeks for experienced lifters suit anterior / posterior;
 * a leg or glute focus keeps a dedicated lower day. Returns { split, reason }.
 */
export function chooseSplit(profile) {
  const days = Math.min(6, Math.max(2, Math.round(profile.daysPerWeek ?? 3)));
  const exp = profile.experience ?? 'beginner';
  const level = INTENSITY[profile.intensity] ? profile.intensity : 'moderate';
  const focus = new Set(profile.focus ?? []);
  const upperFocus = focus.has('arms') || focus.has('shoulders');
  const lowerFocus = focus.has('legs') || focus.has('glutes');
  const easy = exp === 'beginner' || level === 'light';
  if (days === 2) return easy
    ? { split: 'fullbody', reason: 'Two sessions a week: full body hits every muscle twice, which matters most when time is short.' }
    : { split: 'antpost', reason: 'Two harder sessions: front of the body, then back of the body, so each session can go deep.' };
  if (days === 3) {
    if ((exp === 'beginner' && level !== 'hard') || level === 'light') return { split: 'fullbody', reason: 'Three sessions: full body trains every muscle three times a week, the fastest way to learn the lifts and build a base.' };
    if (upperFocus) return { split: 'arnold', reason: 'Your arms and shoulders need the most work: the Arnold split gives them a whole day of their own.' };
    return { split: 'ppl', reason: 'Three sessions: push, pull and legs gives each muscle group a full session with room for enough sets.' };
  }
  if (days === 4) {
    if (!easy && level === 'hard' && !lowerFocus) return { split: 'antpost', reason: 'Four hard sessions: anterior / posterior trains everything twice a week with a lot of volume per muscle.' };
    return { split: 'upperlower', reason: lowerFocus ? 'Four sessions with a leg focus: two full lower-body days a week.' : 'Four sessions: upper / lower trains every muscle twice a week, the best balance of frequency and recovery.' };
  }
  if (days === 5) return { split: 'ulppl', reason: 'Five sessions: upper and lower early in the week, then push, pull and legs, so everything is trained about twice.' };
  if (exp === 'advanced' && upperFocus) return { split: 'arnold', reason: 'Six sessions with an arm and shoulder focus: the Arnold split twice gives those muscles two dedicated days.' };
  return { split: 'ppl', reason: 'Six sessions: push, pull, legs twice trains every muscle twice a week with full-length sessions.' };
}
/** Error text when a split does not run on that many days, else ''. */
export const splitDaysError = (split, days) => {
  const s = SPLITS[split ?? 'auto'];
  if (!s) return 'Unknown split';
  if (!s.seq) return ''; // coach picks: any day count (clamped to 2-6 when the plan is made)
  return s.days.includes(days) ? '' : `${s.name} runs ${s.days.join(' or ')} days a week`;
};

// Weekdays (0 = Sunday ... 6 = Saturday). The Egyptian week starts on Saturday; Friday is rest.
export const DEFAULT_DAYS = { 2: [0, 3], 3: [6, 1, 3], 4: [6, 0, 2, 3], 5: [6, 0, 1, 3, 4], 6: [6, 0, 1, 2, 3, 4] };
const WEEK_ORDER = (wd) => (wd + 1) % 7; // Saturday first

function splitFor(days, experience, choice = 'auto', intensity = 'moderate') {
  const named = SPLITS[choice];
  if (named?.seq && named.days.includes(days)) return { split: named.name, seq: Array.from({ length: days }, (_, i) => named.seq[i % named.seq.length]) };
  if (days === 2) return { split: 'Full body', seq: ['fullA', 'fullB'] };
  // 3 days: light or new lifters train everything each time; hard sessions split the body up.
  if (days === 3) return intensity === 'light' || (experience === 'beginner' && intensity !== 'hard') ? { split: 'Full body', seq: ['fullA', 'fullB', 'fullC'] } : { split: 'Push / Pull / Legs', seq: ['push', 'pull', 'legs'] };
  if (days === 4) return { split: 'Upper / Lower', seq: ['upper', 'lower', 'upper', 'lower'] };
  if (days === 5) return { split: 'Upper / Lower / Push / Pull / Legs', seq: ['upper', 'lower', 'push', 'pull', 'legs'] };
  return { split: 'Push / Pull / Legs ×2', seq: ['push', 'pull', 'legs', 'push', 'pull', 'legs'] };
}

// Sets × reps, RIR and rest by slot kind and experience. Based on the coaches' sheets:
// compounds 3–4 × 6–10/8–10, isolations 3–4 × 10–12/12–15, RPE 9 (≈ RIR 1), 1–3 min rest.
function prescription(experience, kind, ex, lead) {
  const tempo = '2-0-1-0';
  if (kind === 'core') return ex.timed ? { sets: 2, repMin: 30, repMax: 45, rir: 1, restSec: 60, tempo: '' } : { sets: 2, repMin: 12, repMax: 15, rir: 1, restSec: 60, tempo };
  if (kind === 'compound') {
    if (experience === 'beginner') return { sets: 3, repMin: 8, repMax: 12, rir: 2, restSec: 120, tempo };
    if (experience === 'intermediate') return { sets: lead ? 4 : 3, repMin: 8, repMax: 10, rir: 1, restSec: 150, tempo };
    return { sets: lead ? 4 : 3, repMin: 6, repMax: 10, rir: 0, restSec: 180, tempo };
  }
  if (experience === 'beginner') return { sets: 2, repMin: 12, repMax: 15, rir: 2, restSec: 75, tempo };
  if (experience === 'intermediate') return { sets: 3, repMin: 10, repMax: 12, rir: 1, restSec: 90, tempo };
  return { sets: 3, repMin: 10, repMax: 15, rir: 0, restSec: 90, tempo };
}

const WARMUPS = {
  upper: [['wall-slide', 8, 10], ['push-plus', 8, 10], ['incline-y-raise', 8, 10]],
  lower: [['bird-dog', 8, 10], ['plank', 20, 30], ['bodyweight-squat', 10, 12]],
};

// Post-workout cardio, by goal. Coaches: treadmill after training, heart rate kept moderate.
export function cardioFor(goal) {
  const minutes = goal === 'cut' ? 25 : goal === 'bulk' ? 10 : 15;
  return { kind: 'Walk', label: 'Incline treadmill walk', minutes, when: 'After training', note: 'Brisk walk on an incline. You should still be able to talk (heart rate about 100–130).' };
}

/**
 * How hard and how long the member wants to train. It sets the volume (exercises per session and
 * sets per exercise), how close to failure (RIR) and, for "coach picks", the split.
 */
export const INTENSITY = {
  light: { name: 'Light', about: 'About 45 min. Fewer exercises, 2–3 sets, 2–3 reps left in the tank.', sets: -1, cap: -1, rir: 1, maxSets: 16 },
  moderate: { name: 'Moderate', about: 'About an hour. 3 sets, 1–2 reps left in the tank.', sets: 0, cap: 0, rir: 0, maxSets: 24 },
  hard: { name: 'Hard', about: '75–90 min. More exercises, 3–4 sets taken close to failure.', sets: 1, cap: 1, rir: -1, maxSets: 28 },
};

/** Estimated minutes of lifting: work sets (~45 s each) plus rest, and the warm-up. Cardio is extra. */
export function sessionMinutes(day) {
  const lifting = day.exercises.reduce((a, e) => a + e.sets * (45 + (e.restSec ?? 90)), 0) / 60;
  return Math.round((lifting + (day.warmup?.length ? 6 : 0)) / 5) * 5;
}

const CAP = { beginner: 6, intermediate: 7, advanced: 8 };
// The named splits list more exercises per session (8–10), so they get a higher cap.
const CAP_NAMED = { beginner: 7, intermediate: 9, advanced: 10 };

/**
 * profile: { experience, daysPerWeek, trainDays?, equipment, goal, injuries, focus? }
 * exercises: library (defaults to EXERCISES; the database copy includes admin-made ones).
 * Returns a draft plan for review.
 */
export function generateWorkoutPlan({ profile, exercises = EXERCISES, rotation = 0 }) {
  const n = Math.min(6, Math.max(2, Math.round(profile.daysPerWeek ?? 3)));
  const experience = profile.experience ?? 'beginner';
  const home = profile.equipment === 'home';
  const byId = new Map(exercises.map((e) => [e.id, e]));
  // A named split the member chose; for "coach picks", the split the AI (or the rules) picked.
  const valid = (id) => Boolean(SPLITS[id]?.seq && SPLITS[id].days.includes(n));
  const choice = valid(profile.split) ? profile.split
    : valid(profile.chosenSplit) ? profile.chosenSplit
      : valid(chooseSplit({ ...profile, daysPerWeek: n }).split) ? chooseSplit({ ...profile, daysPerWeek: n }).split : 'auto';
  const level = INTENSITY[profile.intensity] ? profile.intensity : 'moderate';
  const int = INTENSITY[level];
  const { split, seq } = splitFor(n, experience, choice, level);
  const chosen = Array.isArray(profile.trainDays) && new Set(profile.trainDays).size === n ? [...new Set(profile.trainDays)] : DEFAULT_DAYS[n];
  const weekdays = [...chosen].sort((a, b) => WEEK_ORDER(a) - WEEK_ORDER(b));
  const focus = (profile.focus ?? []).filter((f) => FOCUS_AREAS.includes(f)).slice(0, 2);
  const warnings = [];
  const seen = new Map(); // slot -> times used, to rotate options across the week
  const counts = new Map(); // template -> times used, for A / B names

  const days = seq.map((tpl, i) => {
    const t = DAYS[tpl];
    const k = (counts.get(tpl) ?? 0) + 1; counts.set(tpl, k);
    const repeats = seq.filter((x) => x === tpl).length > 1;
    const picked = new Set();
    const list = [];
    for (const [slot, optional, superset] of t.slots) {
      const s = SLOTS[slot];
      const options = (home ? s.home : s.gym).map((id) => byId.get(id)).filter((e) => e && !picked.has(e.id));
      if (!options.length) continue; // e.g. no adductor machine at home
      const used = seen.get(slot) ?? 0; seen.set(slot, used + 1);
      const ex = options[(used + rotation) % options.length]; // rotation: next cycle's variations
      picked.add(ex.id);
      list.push({ ex, kind: s.kind, optional: Boolean(optional), superset });
    }
    // Beginners get shorter sessions: optional slots go first, then from the end.
    const cap = Math.min(10, Math.max(4, ((valid(profile.split) ? CAP_NAMED : CAP)[experience] ?? 7) + int.cap)); // the crew's own splits list more exercises
    while (list.length > cap) { const j = list.findLastIndex((x) => x.optional); list.splice(j >= 0 ? j : list.length - 1, 1); }
    let lead = true;
    const exercisesOut = list.map(({ ex, kind, superset }, j) => {
      const p = prescription(experience, kind, ex, lead && kind === 'compound');
      if (kind === 'compound') lead = false;
      // Intensity: volume and proximity to failure (core work keeps its own numbers).
      if (kind !== 'core') {
        p.sets = Math.min(kind === 'compound' ? 5 : 4, Math.max(2, p.sets + int.sets));
        p.rir = Math.min(3, Math.max(0, p.rir + int.rir));
      }
      const out = { exerciseId: ex.id, name: ex.name, muscle: ex.muscle, ...p };
      // Superset (e.g. leg curl + leg extension): no rest after the first, rest after the pair.
      if (superset && list[j + 1]?.superset) { out.restSec = 15; out.note = `Superset: go straight to the ${superset.toLowerCase()}, then rest.`; }
      else if (superset) out.note = `Superset with the ${superset.toLowerCase()}: rest after both.`;
      return out;
    });
    // Keep the session inside the intensity's set budget: trim isolation sets from the end first.
    // Then compounds down to 2 sets, then drop exercises from the end (optional ones first).
    let total = exercisesOut.reduce((a, e) => a + e.sets, 0);
    for (const allow of [(k) => k !== 'compound', () => true]) {
      for (let pass = 0; pass < 3 && total > int.maxSets; pass++) {
        for (let j = exercisesOut.length - 1; j >= 0 && total > int.maxSets; j--) {
          const e = exercisesOut[j];
          if (e.sets > 2 && allow(list[j].kind)) { e.sets--; total--; }
        }
      }
    }
    while (total > int.maxSets && exercisesOut.length > 4) {
      const j = list.findLastIndex((x) => x.optional);
      const k = j >= 0 ? j : list.length - 1;
      total -= exercisesOut[k].sets; exercisesOut.splice(k, 1); list.splice(k, 1);
    }
    // Body-assessment focus areas get one extra set on their first exercise of the day.
    const hits = { arms: ['biceps', 'triceps'], legs: ['quads', 'hamstrings'] };
    for (const area of focus) {
      const e = exercisesOut.find((x) => (hits[area] ?? [area]).includes(x.muscle));
      if (e && e.sets < 5) e.sets += 1;
    }
    const warmup = WARMUPS[t.warm].filter(([id]) => byId.has(id)).map(([id, a, b]) => {
      const ex = byId.get(id);
      return { exerciseId: ex.id, name: ex.name, sets: 1, repMin: a, repMax: b, timed: ex.timed };
    });
    return { weekday: weekdays[i], name: repeats ? `${t.name} ${'ABC'[k - 1]}` : t.name, focus: t.focus, warmup, exercises: exercisesOut };
  });
  const cardio = cardioFor(profile.goal);
  for (const d of days) d.minutes = sessionMinutes(d);

  if (profile.injuries && profile.injuries.trim()) warnings.push(`Injuries or limits reported: "${profile.injuries.trim().slice(0, 200)}". Check the exercise choices.`);
  return {
    format: 2, split, daysPerWeek: n, experience, intensity: level, equipment: profile.equipment ?? 'gym',
    days, cardio, warnings,
    notes: [
      'Warm up with the pre-activation moves, then do 1–2 lighter ramp-up sets before your first exercise.',
      'RIR = reps in reserve: stop when you could still do that many good reps. RIR 1 means one rep left in the tank.',
      'Tempo 2-0-1-0: 2 seconds down, no pause, 1 second up, no pause at the top.',
      'Hit the top of the rep range on every set with good form, then add weight next time.',
    ],
  };
}

/** Exercises that can stand in for `ex` (same movement pattern), for swaps. */
export function swapOptions(ex, library, equipment = 'gym') {
  const allowed = equipment === 'home' ? new Set(['bodyweight', 'dumbbell']) : null;
  return library.filter((e) => e.id !== ex.id && e.pattern === ex.pattern && e.pattern !== 'warmup' && (!allowed || allowed.has(e.equip)));
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
