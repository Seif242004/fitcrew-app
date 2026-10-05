// FitCrew AI coach: one conversation per person. It reads the person's day and changes things
// for them through TOOLS. Every tool calls the same API routes the app's buttons use (callAs),
// so the coach is bound by exactly the same validation, exclusions, safety floors and audit log
// as a human tap, and it can never use admin actions.
//
// Provider: any OpenAI-compatible endpoint with tool calling (NVIDIA Build / Kimi by default),
// configured by FITCREW_AI_* (see plan-ai.js). Without a key the coach explains how to enable it.

import { callAs } from './api.js';
import { aiConfig, FALLBACK_MODELS } from './plan-ai.js';
import { loadFoods, getSetting, setSetting } from './db.js';
import { filterFoods } from './plan.js';
import { EXCLUDE_GROUPS } from './foods-seed.js';
import { describeAmount } from './exchange.js';
import { unitsFor } from './measures.js';
import { normalizeToolCalls } from './tool-calls.js';

// Food search (Arabic + English, spellings, word order) lives in search.js, shared with the app.
export { norm, searchFoods } from './search.js';
import { searchFoods } from './search.js';

// ---------------------------------------------------------------- tools
const T = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const str = { type: 'string' }; const num = { type: 'number' };
const strs = { type: 'array', items: { type: 'string' } };

export const TOOLS = [
  T('get_day', 'The person\'s plan and log for a date: meals with item refs, what is eaten, calories/macros vs targets, water, workout. Call this before changing anything about a day.', { date: { ...str, description: 'YYYY-MM-DD, default today' } }),
  T('search_foods', 'Find foods in the database by English or Arabic name. Always use this to get a foodId; never invent ids.', { query: str }, ['query']),
  T('mark_plan_items', 'Mark planned items as eaten or skipped (or clear them) by ref from get_day.', { refs: strs, status: { type: 'string', enum: ['eaten', 'skipped', 'clear'] }, date: str }, ['refs', 'status']),
  T('log_foods', 'THE way to log what they ate or drank. One call per meal with every food and drink of that meal, exactly as they said it. The server matches planned items (marks them eaten, or adjusted / swapped when the amount or food differs), adds the rest to that meal, converts units and ignores repeats, so never log the same report twice and never also call mark_plan_items or log_food for these foods. Each item: foodId from the food list (or name if unsure; or name + kcal/protein/carbs/fat estimates for something not in the database), and qty + unit in the words they used (unit: egg, loaf, slice, piece, sachet, cup, glass, mug, tbsp, tsp, ml, g, "g dry"), or grams when they gave grams. A sandwich or dish they describe by its parts is logged as its parts.', {
    meal: { type: 'string', description: 'Meal name from today\'s plan (breakfast, lunch, dinner, snack, pre-workout, post-workout...) or its index. Use the meal they said; if they did not say, the meal closest to the time they ate.' },
    items: { type: 'array', items: { type: 'object', properties: { foodId: str, name: str, qty: num, unit: str, grams: num, kcal: num, protein: num, carbs: num, fat: num }, required: [] } },
    date: str,
  }, ['items']),
  T('move_food', 'Move a food or drink they added (ref starting with extra:) into another meal, or to "none".', { ref: str, meal: str, date: str }, ['ref', 'meal']),
  T('log_food', 'Older single-item logging. Prefer log_foods.', { foodId: str, grams: num, qty: num, unit: str, meal: str, date: str }, ['foodId']),
  T('ate_amount', 'They ate a planned item but a different amount ("I had 3 eggs, not 2"). qty + unit key (see log_food), or grams.', { ref: str, qty: num, unit: str, grams: num, date: str }, ['ref']),
  T('meal_options', 'Whole-meal alternatives for one meal of the day (same kind, same calories and macros, fits the rest of the day). meal = index from get_day.', { meal: num, date: str }, ['meal']),
  T('swap_meal', 'Replace a whole meal with one from meal_options (key). scope today / always / reset (put the planned meal back).', { meal: num, key: str, scope: { type: 'string', enum: ['today', 'always', 'reset'] }, date: str }, ['meal', 'scope']),
  T('log_custom_food', 'Log something eaten that is not in the database, with your best estimate of its nutrition. Prefer log_foods (it takes estimates too).', { name: str, kcal: num, protein: num, carbs: num, fat: num, meal: str, date: str }, ['name', 'kcal']),
  T('list_alternatives', 'Equivalent swaps for a planned item (same protein/carbs/fat), already filtered by what the person does not eat.', { ref: str, date: str }, ['ref']),
  T('swap_item', 'Replace a planned item with an equivalent food. scope "today" changes only today; "always" changes the plan from now on. The equivalent amount is computed by the server.', { ref: str, foodId: str, scope: { type: 'string', enum: ['today', 'always'] }, date: str }, ['ref', 'foodId', 'scope']),
  T('update_food_preferences', `Change what the person eats. Groups: ${EXCLUDE_GROUPS.map(([k, l]) => `${k} (${l})`).join(', ')}. A new plan is made automatically when needed.`, {
    excludeGroups: strs, includeGroups: strs, dislike: { ...strs, description: 'foodIds' }, undislike: strs, like: strs, unlike: strs,
    mealsPerDay: { type: 'integer', minimum: 3, maximum: 5 }, trainTime: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'none'] }, vegetarian: { type: 'boolean' },
  }),
  T('change_goal', 'Change goal (cut/maintain/bulk), weekly pace in kg, current weight or activity. Targets are recalculated with safety limits and a new plan is made.', { goal: { type: 'string', enum: ['cut', 'maintain', 'bulk'] }, weeklyRateKg: num, weightKg: num, activityLevel: { type: 'string', enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] } }),
  T('new_plan', 'Make a fresh diet plan (different meals, same targets). It is reviewed and goes live at once if it passes the safety rules.', { reason: str }, ['reason']),
  T('rebalance_today', 'Trim the rest of today (only items not yet logged, within realistic portions) so the day lands back on target. Use after they ate something off-plan or big.', { date: str }),
  T('log_weight', 'Record body weight in kg.', { kg: num, date: str }, ['kg']),
  T('add_water', 'Add (or with a negative number remove) water in ml for today.', { ml: num, date: str }, ['ml']),
  T('get_progress', 'Day scores, streak and weight trend for the last N days.', { days: { type: 'integer', minimum: 3, maximum: 60 } }),
  T('get_workout', 'Training for a date: session name, warm-up, each exercise with prescription (sets x reps, RIR, rest, tempo), sets already ticked, the suggested weight x reps, cardio, the gym check-in status and the attendance week.', { date: str }),
  T('set_training_day', 'Make a day a rest day or a training day (today or the next 6 days). type: rest | train | plan (back to the plan). For train on a rest day, weekday (0=Sunday..6=Saturday) picks which planned session to do; default is the next one this week.', { type: { type: 'string', enum: ['rest', 'train', 'plan'] }, date: str, weekday: { type: 'integer', minimum: 0, maximum: 6 } }, ['type']),
  T('get_training_plan', 'The whole weekly training plan: split, weekdays, every session with its exercises and prescriptions, cardio and notes.'),
  T('log_sets', 'Tick off sets of an exercise the person did, with the weight and reps of each set. Use exerciseId from get_workout. Set numbers continue after sets already logged unless setNo is given.', {
    exerciseId: str, date: str, sets: { type: 'array', items: { type: 'object', properties: { weightKg: num, reps: num, setNo: num }, required: ['reps'] } },
  }, ['exerciseId', 'sets']),
  T('complete_exercise', 'Mark an exercise done as planned: logs every remaining planned set at one weight x reps (use the suggested numbers from get_workout when they say "done as planned").', { exerciseId: str, weightKg: num, reps: num, sets: num, date: str }, ['exerciseId', 'reps']),
  T('remove_set', 'Remove one logged set (a mistake).', { exerciseId: str, setNo: num, date: str }, ['exerciseId', 'setNo']),
  T('log_cardio', 'Log cardio (treadmill walk, run, bike...).', { kind: { type: 'string', enum: ['Run', 'Walk', 'Cycle', 'Row', 'Swim', 'Elliptical', 'Stairs', 'Other'] }, minutes: num, distanceKm: num, avgHr: num, date: str }, ['kind', 'minutes']),
  T('exercise_alternatives', 'Like-for-like replacements for an exercise (same movement, fits their equipment).', { exerciseId: str }, ['exerciseId']),
  T('swap_exercise', 'Replace an exercise in their training plan with an alternative from exercise_alternatives. weekday (0=Sunday..6=Saturday) limits it to one session; omit to swap it everywhere.', { exerciseId: str, toId: str, weekday: { type: 'integer', minimum: 0, maximum: 6 } }, ['exerciseId', 'toId']),
  T('change_training', 'Change training details and get a new training plan: intensity (light / moderate / hard: sets, exercises and how close to failure), split (auto = coach picks; arnold = chest&back / shoulders&arms / legs, 3 or 6 days; ppl = push/pull/legs, 3 or 6 days; antpost = anterior/posterior, 2 or 4 days; upperlower, 4 days; fullbody, 2 or 3 days), days per week (2-6), which weekdays (0=Sunday..6=Saturday), experience, equipment, injuries. The plan is reviewed (injuries always go to the admin).', {
    split: { type: 'string', enum: ['auto', 'arnold', 'ppl', 'antpost', 'upperlower', 'fullbody'] },
    intensity: { type: 'string', enum: ['light', 'moderate', 'hard'], description: 'light ~45 min, fewer sets, 2-3 RIR; moderate ~1 h; hard 75-90 min, more sets close to failure' },
    daysPerWeek: { type: 'integer', minimum: 2, maximum: 6 }, trainDays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
    experience: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] }, equipment: { type: 'string', enum: ['gym', 'home', 'mixed'] }, injuries: str,
  }),
  T('new_training_plan', 'Make a fresh training plan from their current details (different exercise picks).', { reason: str }, ['reason']),
  T('get_training_history', 'Recent sessions, personal records (estimated 1RM) and gym attendance for the last 7 and 28 days.'),
  T('get_attendance', 'Gym check-ins (approved / pending / rejected) for the last N days and attendance vs planned sessions.', { days: { type: 'integer', minimum: 7, maximum: 120 } }),
  T('get_profile', 'Everything about the person: body, goal, targets, training details, food preferences, body-fat source.'),
  T('get_plan', 'Their whole diet plan: every meal and item with amounts and how many swaps each has.'),
  T('get_leaderboard', 'The monthly points competition: this month\'s points (most points in the month wins the prize), days left, this week, streaks, gym attendance, past champions.'),
  T('get_weekly_checkin', 'This week\'s adaptive check-in (Friday to Sunday): trend weight, weekly rate vs goal, average calories eaten, estimated maintenance, and the proposed calorie change with its reason, or why there is no change yet. Use when they ask about their weekly check-in, a plateau or whether to change calories.'),
  T('answer_weekly_checkin', 'Answer this week\'s check-in for the person: accept (apply the proposed calorie change; the same plan is re-sized and reviewed), keep (keep the current plan) or dismiss (hide an on-track note). Only when they clearly ask for it.', { answer: { type: 'string', enum: ['accept', 'keep', 'dismiss'] } }, ['answer']),
  T('get_recap', 'The person\'s weekly recap: points, rank, 70+ days, gym attendance, best lift, PRs, weight change and the one thing to improve.'),
  T('get_feed', 'Recent crew activity: check-ins, PRs, finished sessions, 70+ days, streaks, monthly winners.'),
  T('get_body', 'Body data: weigh-ins, tape measurements, progress photo dates and poses (never the images).'),
  T('log_measurements', 'Record tape measurements in cm.', { waistCm: num, neckCm: num, hipCm: num, chestCm: num, armCm: num, thighCm: num, calfCm: num, date: str }),
  T('ask_admin', 'Send a message to the human admin. Use only for things you cannot do or must not decide (medical issues, injuries, disputes).', { message: str }, ['message']),
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));

// Compact day summary so the model sees refs without a wall of JSON.
function summarizeDay(d) {
  if (!d.meals) return { plan: 'none', note: d.hasPending ? 'A plan is waiting for the admin.' : 'No plan yet.' };
  return {
    date: d.date,
    targets: { kcal: d.targets.kcal, protein: d.targets.proteinG, carbs: d.targets.carbsG, fat: d.targets.fatG },
    eaten: d.consumed, score: d.score?.total, water: d.water,
    meals: d.meals.map((m, mi) => ({ meal: mi, name: m.name, title: m.title,
      items: m.items.map((i) => ({ ref: i.key, food: i.name, foodId: i.foodId, amount: i.amount, kcal: i.kcal, p: i.p, status: i.log?.status ?? 'not logged', ...(i.log && i.log.status !== 'eaten' ? { ate: `${i.log.amount ?? ''} ${i.log.name ?? ''}`.trim() } : {}), swappedFrom: i.swappedFrom })),
      added: (m.extras ?? []).map((e) => ({ ref: e.ref, food: e.name, amount: e.amount, kcal: e.kcal })) })),
    notInAMeal: d.extras.map((e) => ({ ref: e.ref, food: e.name, amount: e.amount, kcal: e.kcal })),
  };
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Compact training day for the model: what to do, what is done, what one tap would log.
function summarizeWorkout(w) {
  if (!w.hasPlan && !w.blocks?.length) return { plan: 'none', pending: w.hasPending };
  const checkin = w.checkin ? w.checkin.status : 'not checked in';
  if (w.restDay && !w.blocks.length) return { restDay: true, switchedFrom: w.override === 'rest' ? w.plannedSession : null, restEarnsPoints: w.rest?.counts ?? true, checkin, week: w.week.map((d) => ({ date: d.date, session: d.name, checkin: d.checkin })) };
  return {
    session: w.dayName, switchedFromRestDay: w.override === 'train', focus: w.focus, checkin,
    exercises: w.blocks.map((b) => ({ exerciseId: b.exerciseId, name: b.name, plan: b.plan && { sets: b.plan.sets, reps: `${b.plan.repMin}-${b.plan.repMax}`, rir: b.plan.rir, restSec: b.plan.restSec, tempo: b.plan.tempo }, done: b.sets.map((x) => `${x.weightKg} kg x ${x.reps}`), suggested: b.suggested, lastTime: b.last?.sets.map((x) => `${x.weightKg} x ${x.reps}`) })),
    cardio: { planned: w.cardioPlan, logged: w.cardio },
    completion: w.state?.completion, week: w.week.map((d) => ({ date: d.date, session: d.name, checkin: d.checkin })),
  };
}

/** Run one tool for `user`. Returns a JSON-able result; errors are returned, not thrown. */
export async function runTool(db, user, today, name, args = {}) {
  args = { ...(args && typeof args === 'object' ? args : {}) };
  delete args.userId; // the coach always acts as this person, never on someone else's data
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date ?? '') ? args.date : today;
  const call = (m, p, b) => callAs(db, user, m, p, b);
  try {
    switch (name) {
      case 'get_day': return summarizeDay(await call('GET', `/api/today?date=${date}`));
      case 'search_foods': {
        const prof = db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(user.id);
        const prefs = prof ? JSON.parse(prof.data).prefs : {};
        // Off-plan foods (pizza, burgers, sweets) are searchable so slips can be logged accurately;
        // they are marked offPlan and must never be suggested as swaps or plan foods.
        const all = loadFoods(db, { offplan: true });
        const allowed = new Set(filterFoods(loadFoods(db), prefs).map((f) => f.id));
        return searchFoods(all, args.query).map((f) => ({ foodId: f.id, name: f.name, ar: f.ar, per100g: { kcal: f.kcal, p: f.p, c: f.c, f: f.f }, units: unitsFor(f).filter((u) => !u.grams).map((u) => ({ key: u.key, name: u.name, grams: u.g })), offPlan: f.offplan || undefined, excludedForThisPerson: f.offplan ? undefined : !allowed.has(f.id) }));
      }
      case 'mark_plan_items': {
        const done = [];
        for (const ref of args.refs ?? []) {
          if (args.status === 'clear') await call('POST', '/api/log/remove', { date, ref });
          else await call('POST', '/api/log', { date, today, ref, status: args.status });
          done.push(ref);
        }
        return { ok: true, done };
      }
      case 'log_foods': {
        const items = (Array.isArray(args.items) ? args.items : []).map((i) => ({ foodId: i.foodId, name: i.name, qty: i.qty, unit: i.unit, grams: i.grams, kcal: i.kcal, p: i.protein, c: i.carbs, f: i.fat }));
        const r = await call('POST', '/api/log/foods', { date, today, meal: args.meal ?? null, items });
        return { ok: r.ok, meal: r.mealName ?? 'not placed in a meal', results: r.results.map((x) => ({ food: x.name, amount: x.amount, kcal: x.kcal, how: x.error ? `error: ${x.error}` : x.as === 'planned' ? 'planned item, marked eaten' : x.as === 'adjusted' ? 'planned item, amount changed' : x.as === 'swapped' ? `eaten instead of ${x.instead}` : x.as === 'repeat' ? 'already logged, not added again' : x.offPlan ? 'added, off-plan' : 'added to the meal' })), today: r.day };
      }
      case 'move_food': return await call('POST', '/api/log/meal', { date, ref: args.ref, meal: /^none$/i.test(String(args.meal)) ? null : args.meal });
      case 'log_food': {
        // Older tool: routed through log_foods so it matches planned items and ignores repeats too.
        const r = await call('POST', '/api/log/foods', { date, today, meal: args.meal ?? null, items: [{ foodId: args.foodId, qty: args.qty, unit: args.unit, grams: args.grams }] });
        const x = r.results[0];
        return x.error ? { error: x.error } : { ok: true, food: x.name, amount: x.amount, kcal: x.kcal, how: x.as, meal: r.mealName };
      }
      case 'ate_amount': return await call('POST', '/api/log', { date, today, ref: args.ref, status: 'adjusted', ...(args.unit ? { unit: args.unit, qty: args.qty } : { grams: args.grams }) });
      case 'meal_options': {
        const r = await call('GET', `/api/plan/meal-options?date=${date}&meal=${Number(args.meal) || 0}`);
        return { now: r.meal, options: r.options.map((o) => ({ key: o.key, title: o.title, kcal: o.kcal, protein: o.p, items: o.items.map((i) => `${i.amount} ${i.name}`) })) };
      }
      case 'swap_meal': return await call('POST', '/api/plan/meal-swap', { date, meal: Number(args.meal) || 0, key: args.key, scope: args.scope });
      case 'log_custom_food': return await call('POST', '/api/log/extra', { date, today, name: args.name, kcal: args.kcal, p: args.protein ?? 0, c: args.carbs ?? 0, f: args.fat ?? 0, meal: args.meal });
      case 'list_alternatives': {
        const r = await call('GET', `/api/plan/alternatives?date=${date}&ref=${encodeURIComponent(args.ref)}`);
        return { item: `${r.item.name} ${r.item.amount}`, group: r.groupLabel, options: r.options.slice(0, 15).map((o) => ({ foodId: o.foodId, name: o.name, amount: o.amount, kcalDiff: o.kcalDiff })) };
      }
      case 'swap_item': return await call('POST', '/api/plan/swap', { date, ref: args.ref, foodId: args.foodId, scope: args.scope });
      case 'update_food_preferences': return await call('POST', '/api/profile/prefs', args);
      case 'change_goal': return await call('POST', '/api/profile/goal', args);
      case 'new_plan': return await call('POST', '/api/plan/regenerate', { note: String(args.reason ?? '').slice(0, 280) });
      case 'set_training_day': return await call('POST', '/api/train/day', { date, today, kind: args.type, weekday: args.weekday });
      case 'get_weekly_checkin': {
        const { checkin: c } = await call('GET', `/api/checkin/weekly?today=${today}`);
        if (c.status === 'off') return { status: 'off', why: c.reason === 'override' ? 'The admin set their targets by hand, so check-ins are off.' : 'No active diet plan yet.' };
        if (c.status === 'closed') return { status: 'closed', nextCheckin: c.next, note: 'Check-ins open on Friday (with the weekly recap).' };
        return { status: c.status, kind: c.kind, summary: c.text, trendKg: c.trendKg, ratePerWeek: c.ratePerWeek, goalRate: c.goalRate, avgIntake: c.avgIntake, fullyLoggedDays: c.days, weighIns: c.weighIns, maintenance: c.maintenance, kcal: c.kcal, result: c.result };
      }
      case 'answer_weekly_checkin': {
        const r = await call('POST', '/api/checkin/weekly/answer', { today, answer: args.answer });
        return { ok: true, status: r.checkin.status, result: r.checkin.result };
      }
      case 'rebalance_today': return await call('POST', '/api/today/rebalance', { date });
      case 'log_weight': return await call('POST', '/api/metrics', { date, weightKg: args.kg });
      case 'add_water': return await call('POST', '/api/water', { date, add: args.ml });
      case 'get_progress': {
        const days = Math.min(60, Math.max(3, Number(args.days) || 14));
        const [adh, met] = await Promise.all([call('GET', `/api/adherence?days=${days}&today=${today}`), call('GET', '/api/metrics')]);
        return { scores: adh.scores.map((s) => ({ date: s.date, score: s.total, kcal: Math.round(s.consumed.kcal) })), streak: adh.streak, weights: (met.metrics ?? []).slice(-12).map((m) => ({ date: m.date, kg: m.weightKg })) };
      }
      case 'get_workout': return summarizeWorkout(await call('GET', `/api/train?date=${date}`));
      case 'get_training_plan': {
        const { plan, hasPending } = await call('GET', '/api/workout-plan');
        if (!plan) return { plan: 'none', pending: hasPending };
        return { split: plan.split, whyThisSplit: plan.splitChoice?.reason, intensity: plan.intensity, startDate: plan.startDate, cardio: plan.cardio, notes: plan.notes, days: plan.days.map((d) => ({ weekday: WEEKDAY[d.weekday], weekdayNumber: d.weekday, name: d.name, exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, name: e.name, sets: e.sets, reps: `${e.repMin}-${e.repMax}`, rir: e.rir, restSec: e.restSec, tempo: e.tempo })) })) };
      }
      case 'log_sets': {
        const w = await call('GET', `/api/train?date=${date}`);
        const have = w.blocks.find((b) => b.exerciseId === args.exerciseId)?.sets.map((x) => x.setNo) ?? [];
        let next = have.length ? Math.max(...have) + 1 : 1;
        const out = [];
        for (const st of (args.sets ?? []).slice(0, 12)) {
          const setNo = st.setNo ?? next++;
          const r = await call('POST', '/api/train/set', { date, today, exerciseId: args.exerciseId, setNo, weightKg: st.weightKg ?? 0, reps: st.reps });
          out.push({ setNo, pr: r.pr });
        }
        return { ok: true, logged: out, personalRecord: out.some((x) => x.pr) };
      }
      case 'complete_exercise': return await call('POST', '/api/train/exercise/complete', { date, today, exerciseId: args.exerciseId, weightKg: args.weightKg ?? 0, reps: args.reps, sets: args.sets });
      case 'remove_set': return await call('POST', '/api/train/set/remove', { date, exerciseId: args.exerciseId, setNo: args.setNo });
      case 'log_cardio': return await call('POST', '/api/train/cardio', { date, today, kind: args.kind, minutes: args.minutes, distanceKm: args.distanceKm, avgHr: args.avgHr });
      case 'exercise_alternatives': {
        const r = await call('GET', `/api/exercises/${encodeURIComponent(args.exerciseId)}/alternatives`);
        return { for: r.exercise.name, options: r.options.map((o) => ({ id: o.id, name: o.name, equipment: o.equip })) };
      }
      case 'swap_exercise': return await call('POST', '/api/workout-plan/swap', { exerciseId: args.exerciseId, toId: args.toId, weekday: args.weekday });
      case 'change_training': return await call('POST', '/api/profile/training', args);
      case 'new_training_plan': return await call('POST', '/api/workout-plan/regenerate', { note: String(args.reason ?? '').slice(0, 280) });
      case 'get_training_history': {
        const h = await call('GET', `/api/train/history?today=${today}`);
        return { attendance: h.attendance, records: h.records.slice(0, 15), sessions: h.sessions.slice(0, 12), cardio: h.cardio.slice(0, 8) };
      }
      case 'get_attendance': return await call('GET', `/api/checkins?days=${Math.min(120, Math.max(7, Number(args.days) || 28))}&today=${today}`);
      case 'get_profile': {
        const me = await call('GET', `/api/me?today=${today}`);
        return { name: user.name, profile: me.profile, targets: me.targets, hasDietPlan: me.hasActivePlan, dietPlanWaiting: me.hasPendingPlan };
      }
      case 'get_plan': {
        const { plan } = await call('GET', '/api/plan');
        if (!plan) return { plan: 'none' };
        return { summary: plan.summary, days: plan.days.map((d) => ({ meals: d.meals.map((m) => ({ name: m.name, items: m.items.map((i) => ({ ref: i.ref, food: i.name, amount: i.amount, kcal: i.kcal, p: i.p, swaps: i.alts })) })) })) };
      }
      case 'get_leaderboard': {
        const g = await call('GET', `/api/group?today=${today}`);
        return { month: g.month.label, daysLeft: g.month.daysLeft, prize: g.prize, champions: g.champions, board: g.board.filter((b) => !b.private).map((b, i) => ({ rank: i + 1, name: b.name, pointsThisMonth: b.points, pointsThisWeek: b.week, averagePerDay: b.avg, daysAt70Plus: b.days70, streak: b.streak, today: b.today, gymThisMonth: b.gym ? `${b.gym.attended}/${b.gym.planned}` : 'no training plan', trophies: b.trophies, isMe: b.isMe })),
          ...(g.private ? { you: { privateMember: true, note: 'You are a private member: you are not on the board and not competing; only the admin sees your scores.', pointsThisMonth: g.private.points } } : {}) };
      }
      case 'get_recap': return (await call('GET', `/api/recap?today=${today}`)).recap ?? { recap: 'not enough logged yet' };
      case 'get_feed': return (await call('GET', `/api/feed?today=${today}`)).items.slice(0, 15).map((i) => ({ who: i.isMe ? 'you' : i.name, what: i.text, at: i.at }));
      case 'get_body': {
        const [met, ph] = await Promise.all([call('GET', '/api/metrics'), call('GET', '/api/photos')]);
        return { metrics: met.metrics.slice(-15), photos: ph.photos.slice(0, 30).map((p) => ({ date: p.date, pose: p.pose })) };
      }
      case 'log_measurements': {
        const { date: _d, ...measurements } = args;
        return await call('POST', '/api/metrics', { date, measurements });
      }
      case 'ask_admin': {
        await call('POST', '/api/plan/request-change', { note: `[via coach] ${String(args.message ?? '').slice(0, 560)}` });
        return { ok: true, sentToAdmin: true };
      }
      default: return { error: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e.message ?? String(e) };
  }
}

// ---------------------------------------------------------------- the coach's brief
export function systemPrompt({ user, profile, targets, today }) {
  const p = profile ?? {};
  const pr = p.prefs ?? {};
  const excluded = EXCLUDE_GROUPS.filter(([k]) => (pr.allergies ?? []).includes(k)).map(([, l]) => l);
  return `You are the FitCrew coach for ${user.name}, a member of a small private group of friends in Egypt who train and diet together. You are their nutrition coach, accountability partner and the app's assistant. Today is ${today}.

WHO THEY ARE
- ${p.sex ?? '?'}, ${p.age ?? '?'} years, ${p.heightCm ?? '?'} cm, ${p.weightKg ?? '?'} kg. Goal: ${p.goal ?? '?'}${p.weeklyRateKg ? ` at ${p.weeklyRateKg} kg/week` : ''}. Trains ${pr.trainTime ?? 'evening'}s, ${p.daysPerWeek ?? '?'} days/week.
- Daily targets: ${targets?.kcal ?? '?'} kcal, protein ${targets?.proteinG ?? '?'} g, carbs ${targets?.carbsG ?? '?'} g, fat ${targets?.fatG ?? '?'} g.
- Never eats: ${excluded.length ? excluded.join(', ') : 'nothing excluded'}${pr.vegetarian ? '; vegetarian' : ''}.${p.injuries ? ` Injuries: ${p.injuries}.` : ''}

HOW YOU WORK
- You can act, not just talk. When they tell you what they ate or drank, LOG IT in the same turn with log_foods; never answer "done" or "logged" unless a tool call in this turn did it. When they want a different food, swap it. When they dislike something, update their preferences. Then say briefly what you did.
- Today's plan, what is logged and the food list are in this brief: act on them directly. Call get_day only for other dates or after you changed something and need fresh totals. Never invent ids, numbers or results.

LOGGING FOOD (most messages are this; get it right)
- One log_foods call per meal, with EVERY food and drink they named for that meal, in their own amounts: "2 eggs" = qty 2 unit egg; "1 balady bread" = qty 1 unit loaf; "100gm bread" = grams 100; "3 tbsp sugar" = qty 3 unit tbsp; "100ml milk" = qty 100 unit ml; "a Nescafé 3-in-1" = qty 1 unit sachet. Never multiply or convert amounts yourself; the server does it.
- Always give the meal: the one they said ("for breakfast", "على الغدا"); if they did not say, the meal that fits the time they ate (local time is in the brief). Drinks go in the meal they had them with.
- A sandwich or dish described by its parts ("egg sandwich: 100 g bread, 2 eggs, 10 g cheddar") is logged as those parts. A known dish with no parts given (koshari, a shawarma sandwich, a slice of pizza) is one item.
- The server matches the plan for you: a food that is on the plan for that meal is marked eaten (or the amount / food changed), everything else is added to the meal. So do not call mark_plan_items for foods you pass to log_foods, and never log the same report twice. If they ask "did you log it?", look at the day in this brief (each meal shows its items and what was added) and answer from it; log only what is missing.
- Use foodIds from the food list in this brief or from search_foods. The list covers diet foods and many everyday foods and drinks (coffee, tea, juices, sauces, breads, sweets, fast food). For something truly not in the database, give its name with your best kcal / protein / carbs / fat estimate in the same log_foods call.
- "Ate my breakfast / the whole lunch" means everything planned for that meal: mark_plan_items eaten.
- After logging, reply with one short line of what was logged and where it stands ("Logged breakfast: 2 scrambled eggs, 100 g bread, 10 g cheddar and a Nescafé with milk and sugar. 1,240 kcal left today."). Read the numbers from the tool result.
- Off-plan food (offPlan: true in search results: pizza, burgers, sweets, coffee-shop drinks): log it the same way, kindly and without guilt. Ask whether it replaced a meal (if yes, mark that meal's planned items skipped with mark_plan_items) and, if the day is now over target, offer rebalance_today. Never suggest off-plan foods as swaps or plan foods.
- Something logged in the wrong meal: move_food. Logged by mistake: mark_plan_items clear for a planned item.
- Prefer swaps ("today" unless they say always/every day) over new plans. Use new_plan only when they want a different overall menu.
- A whole meal they want different ("I don't want mahshi today", "something else for dinner"): meal_options, then swap_meal with their pick (today unless they say every day). Dinner stays light and lunch is the one cooked meal.
- If a change would be unsafe (below their calorie floor, crash diets, more than 1% bodyweight loss per week), refuse kindly and offer the safe version.

POINTS (the monthly competition; explain them like this)
- Up to 100 a day: calories 20 and protein 20 from DIET food, meals matched 20, logging on the day 10, training 30.
- Meals matched: each meal's diet food (planned items, swaps, and diet foods logged into that meal) is compared with that meal's plan on calories, protein, carbs and fat; within 10% is full marks, then 1% lost per 1% off, bigger meals weigh more. So logging food INTO THE RIGHT MEAL matters.
- Off-plan / logging-only food (pizza, sweets, coffee drinks, sauces) and custom entries never earn points, even when the day stays under target.
- ${p.goal === 'bulk' ? 'They are bulking, so going over calories costs no points.' : `They are ${p.goal === 'maintain' ? 'maintaining: going more than 10%' : 'cutting: going more than 5%'} over the day's calories (everything eaten counts) costs 1 point per % over, up to 30.`}
- A gym check-in on a planned rest day is an extra session: +10 bonus (not when a training day was switched to rest that week).

COACHING RULES (from Egyptian coaches)
- Carbs (rice, pasta, oats...) are weighed dry/raw; protein is weighed cooked. The app shows both.
- Vegetables and salad are free; eat as much as you like. Hungry at night: a big salad and water.
- Missed a meal: eat its protein later, skip its carbs.
- Water: aim for the daily target (about 40 ml per kg). Tea, coffee and nescafe are fine with up to 100 ml skimmed milk; diet sugar is fine.
- One cheat meal is fine after about two weeks of following the plan 80% or more. Not a cheat day.
- Cravings: plan sweet fruit (strawberries, watermelon, cantaloupe), water, and do not keep sweets in sight. Never shame.
- Consistency beats perfection. A missed day is not a failed week.

TRAINING (you can see and change everything about their training)
- The training plan is coach-style: sets x rep range, RIR (reps left in the tank), rest and tempo for every exercise, a short warm-up and post-workout cardio.
- When they report a lift ("leg press 120 for 10, 10, 9" / "عملت بنش 60 في 10") log it with log_sets. "Did it as planned" means complete_exercise with the suggested numbers. Never invent numbers they did not give.
- Progression is double progression: when every set hits the top of the range, add weight next time (the app suggests it).
- A machine is taken or missing, or an exercise feels wrong: offer exercise_alternatives, then swap_exercise. Pain is different: do not program around pain; tell them to stop that movement and use ask_admin.
- Training points (30 a day) come only from the gym check-in photo in the Train tab: any training counts (gym, CrossFit, a class, football). Training on a planned rest day adds a 10-point bonus. Logging sets is optional, for records and PRs, and earns no points. You cannot check them in or approve check-ins; tell them to tap "Check in" on the Train tab.
- Rest or train today? Use set_training_day: a planned session day can become a rest day, a rest day can become a training day (doing the next session of the week, or the one they name). Rest days earn the 30 when the day is logged, but only as many per week as their plan has rest days; an extra rest day earns 0 unless they train on another rest day instead.
- Their training details (days, weekdays, equipment, experience) can be changed with change_training.

SAFETY
- You are not a doctor. For pain, injuries, medical conditions, medication, pregnancy or very low intake, tell them to see a professional and use ask_admin.
- If someone talks about not eating, purging, or hating their body, respond with care, do not push targets, suggest talking to someone they trust or a professional, and use ask_admin.

STYLE
- Reply in the language of their LAST message (stated at the end of this brief). English message: English reply, even if earlier messages or food names were Arabic. Arabic message: Egyptian Arabic.
- Short and warm, like a friend who is a good coach. 1-4 sentences, a short list only when it helps. No lectures, no emojis unless they use them.
- Numbers: round grams to what people can measure (slices, eggs, 10 g steps). Use the amounts they used ("3 eggs", not "150 g").`;
}

// ---------------------------------------------------------------- the model
async function chatOnce(cfg, model, messages, { tools, fetchImpl }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.min(cfg.timeoutMs ?? 25_000, 25_000)); // a healthy model answers in seconds
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      // Room for thinking models (Kimi, DeepSeek, Nemotron) to reason AND then call the tool:
      // at 1,200 tokens they often ran out mid-thought and the call never came.
      body: JSON.stringify({ model, temperature: 0.4, max_tokens: 4096, messages, ...(tools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`AI provider answered ${res.status}`), { status: res.status, body: text.slice(0, 400), model });
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? { content: '' };
    // Some models write the tool call as text in their own format: turn it into a real call.
    return tools ? normalizeToolCalls(msg, TOOL_NAMES) : msg;
  } finally { clearTimeout(timer); }
}

// "Model not found / not available" style errors: try the next model instead of failing.
const modelMissing = (e) => e.status === 404 || ((e.status === 400 || e.status === 422) && /model|not (found|available|supported)|unknown/i.test(e.body ?? ''));

/**
 * Chat with automatic model fallback. The model that last worked is remembered in settings
 * (aiModelWorking) and tried first; the last failure is kept in aiLastError for the admin panel.
 */
export async function chat(cfg, messages, { tools = true, fetchImpl = fetch, db = null } = {}) {
  const chosen = db ? getSetting(db, 'aiModelPreferred', null) : null; // picked by the admin from the benchmark
  const remembered = db ? getSetting(db, 'aiModelWorking', null) : null;
  const order = [...new Set([chosen, remembered, cfg.model, ...FALLBACK_MODELS].filter(Boolean))];
  let last; let timeouts = 0;
  for (const model of order) {
    try {
      const msg = await chatOnce(cfg, model, messages, { tools, fetchImpl });
      if (db && remembered !== model) setSetting(db, 'aiModelWorking', model);
      if (db && getSetting(db, 'aiLastError', null)) setSetting(db, 'aiLastError', null); // healthy again
      return msg;
    } catch (e) {
      last = e;
      const timedOut = e.name === 'AbortError';
      if (db) setSetting(db, 'aiLastError', { at: new Date().toISOString(), model, status: e.status ?? null, message: timedOut ? 'Timed out' : e.message, body: e.body ?? null });
      // A missing model -> try the next. A slow (overloaded) model -> one more try on the next
      // model, then give up so nobody waits minutes. Auth / rate limits -> stop right away.
      if (timedOut && ++timeouts <= 1) continue;
      if (!modelMissing(e)) throw e;
    }
  }
  throw last;
}

const stripThink = (t) => String(t ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/**
 * One turn: the person's message in, the coach's reply out, with any tool actions applied.
 * Returns { reply, actions: [{ tool, args, result }] }.
 */
// ---------- quick commands (no AI needed) ----------
// The everyday messages are handled directly, so they work instantly and keep working when the
// AI provider is slow or down: "I ate my breakfast", "log lunch", "I drank 2 glasses", "اكلت الفطار".
const MEAL_WORDS = [
  [/breakfast|فطار|فطور/i, /breakfast/i], [/lunch|غدا|غداء/i, /lunch/i], [/dinner|عشا|عشاء/i, /dinner/i],
  [/pre[- ]?workout|before (the )?(gym|workout|training)|قبل التمرين/i, /pre-workout/i],
  [/post[- ]?workout|after (the )?(gym|workout|training)|بعد التمرين/i, /post-workout/i],
  [/night snack/i, /night snack/i], [/snack|سناك/i, /snack/i],
];
export async function quickIntent(db, user, today, text) {
  const t = String(text).trim();
  // Water: "drank 500 ml", "2 glasses of water", "1.5 l", "شربت 2 كوباية"
  const water = /(\d+(?:\.\d+)?)\s*(ml|l\b|litre|liter|لتر|glass|glasses|cup|cups|كوب|كوباية)/i.exec(t);
  if (water && /water|drank|drink|مياه|مية|شربت/i.test(t)) {
    const n = Number(water[1]); const u = water[2].toLowerCase();
    const ml = Math.round(/ml/.test(u) ? n : /^l|lit|لتر/.test(u) ? n * 1000 : n * 250);
    if (ml > 0 && ml <= 5000) {
      const r = await runTool(db, user, today, 'add_water', { ml });
      if (!r.error) return { reply: `Added ${ml} ml. You are at ${(r.water.ml / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} of ${(r.water.target / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} L today.`, actions: [{ tool: 'add_water', args: { ml }, result: r }] };
    }
  }
  // Whole meal eaten: "I ate my breakfast", "log lunch", "had my post workout meal", "اكلت الغدا".
  // The meal word must follow the verb directly, so "I had koshari for lunch" goes to the AI.
  const verb = /(?:^|\s)(?:i\s+)?(?:ate|had|finished|log|logged|done with|اكلت|أكلت|خلصت)\s+(?:all\s+(?:of\s+)?)?(?:my\s+|the\s+|ال)?/i;
  const v = verb.exec(t);
  if (v && t.length <= 60 && !/\b(not|didn'?t|instead|half)\b|بدل|نص|مش/i.test(t)) {
    const rest = t.slice(v.index + v[0].length);
    const hit = MEAL_WORDS.find(([re]) => new RegExp(`^(?:${re.source})`, 'i').test(rest));
    const day = hit ? await runTool(db, user, today, 'get_day', {}) : null;
    const meal = day?.meals?.find((m) => hit[1].test(m.name));
    if (meal) {
      const refs = meal.items.filter((i) => i.status === 'not logged').map((i) => i.ref);
      if (!refs.length) return { reply: `${meal.name} is already logged.`, actions: [] };
      const r = await runTool(db, user, today, 'mark_plan_items', { refs, status: 'eaten' });
      const after = await runTool(db, user, today, 'get_day', {});
      const left = Math.round(after.targets.kcal - after.eaten.kcal);
      return { reply: `Logged ${meal.name.toLowerCase()}. ${left >= 0 ? `${left.toLocaleString('en-US')} kcal left today` : `${(-left).toLocaleString('en-US')} kcal over today`}, protein ${Math.round(after.eaten.p)} of ${after.targets.protein} g.`, actions: [{ tool: 'mark_plan_items', args: { refs, status: 'eaten' }, result: r }] };
    }
  }
  return null;
}

// A message that reports eating or drinking (English, Egyptian Arabic, or Franco-Arabic).
const FOOD_REPORT = /\b(ate|eaten|eat|had|having|drank|drink|drunk|log(ged)?|breakfast|lunch|dinner|snack|for (breakfast|lunch|dinner))\b|اكلت|أكلت|كلت|شربت|فطرت|اتغديت|اتعشيت|فطار|غدا|عشا/i;
const QUESTION = /\?|^(how|what|why|when|which|can|could|should|is|are|do|does|will|would)\b|^(ازاي|ايه|ليه|امتى|هل|ممكن)/i;
/** The language to answer in: the script of their last message (Arabic letters vs Latin letters). */
export function replyLanguage(text) {
  const ar = (String(text).match(/[\u0600-\u06FF]/g) ?? []).length;
  const la = (String(text).match(/[A-Za-z]/g) ?? []).length;
  return ar > la ? 'Egyptian Arabic' : 'English';
}

export async function coachTurn({ db, user, text, today, clock = null, history = [], env = process.env, fetchImpl }) {
  const quick = await quickIntent(db, user, today, text).catch(() => null);
  if (quick) return quick;
  const cfg = aiConfig(env);
  if (!cfg) {
    return { reply: 'The AI coach is not switched on yet, so I can only do quick things: "I ate my breakfast", "log lunch", "I drank 2 glasses of water". Everything else in the app works as normal.', actions: [] };
  }
  const prof = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
  const profile = prof ? JSON.parse(prof.data) : null;
  const targets = prof ? { ...JSON.parse(prof.targets), ...(prof.targets_override ? JSON.parse(prof.targets_override) : {}) } : null;
  // Pre-load what nearly every turn needs, so the model can act in ONE call instead of first
  // calling get_day and search_foods (each round trip costs seconds on a large model).
  const day = await runTool(db, user, today, 'get_day', {});
  const workout = await runTool(db, user, today, 'get_workout', {});
  const allowed = filterFoods(loadFoods(db), profile?.prefs ?? {});
  // Each food with the units it can be logged in: [u: 1 egg = 50 g; m0: 1 cup = 160 g; dry: 1 g dry = 2.8 g].
  const foodIndex = allowed.map((f) => {
    const us = unitsFor(f).filter((u) => u.key !== 'g').map((u) => (u.key === 'dry' ? `dry: 1 g dry = ${u.g} g` : `${u.key}: 1 ${u.name} = ${u.g} g`));
    return `${f.id}: ${f.name}${f.ar ? ` / ${f.ar}` : ''}${us.length ? ` [${us.join('; ')}]` : ''}`;
  }).join('\n');
  // Everyday drinks, sauces and breads people log all the time (logging only, never plan food).
  const extrasIndex = loadFoods(db, { offplan: true }).filter((f) => f.offplan && ['drinks', 'basics', 'bakery'].includes(f.cat))
    .map((f) => `${f.id}: ${f.name}${f.unit ? ` [${f.unit.name} = ${f.unit.g} g]` : ''}`).join('\n');
  const lang = replyLanguage(text);
  const context = `\n\nLOCAL TIME NOW: ${clock ?? 'unknown'} on ${today}.\n\nTODAY (${today}), already loaded, no need to call get_day for it:\n${JSON.stringify(day)}\n\nTODAY'S TRAINING (already loaded, no need to call get_workout for today):\n${JSON.stringify(workout)}\n\nFOODS THIS PERSON EATS (foodId: name / Arabic [unit]); use these ids directly, search_foods for anything else (sweets, fast food, dishes):\n${foodIndex}\n\nEVERYDAY DRINKS, SAUCES AND BREADS (logging only; ml works for any drink):\n${extrasIndex}\n\nREPLY LANGUAGE for this message: ${lang}.`;
  const messages = [
    { role: 'system', content: systemPrompt({ user, profile, targets, today }) + context },
    ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content: text },
  ];
  const actions = [];
  let nudged = false;
  for (let step = 0; step < 8; step++) {
    const msg = await chat(cfg, messages, { fetchImpl, db });
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      // Models sometimes answer "Done." to a food report without logging anything. Once per turn,
      // remind it to act; a real question ("how much rice can I eat?") is left alone.
      if (!nudged && !actions.length && FOOD_REPORT.test(text) && !QUESTION.test(text.trim())) {
        nudged = true;
        messages.push({ role: 'assistant', content: msg.content ?? '' });
        messages.push({ role: 'user', content: '[app] Nothing was logged: no tool was called. If my last message says what I ate or drank, call log_foods now (one call per meal, every item, my amounts, the meal). If it does not, just answer it.' });
        continue;
      }
      return { reply: stripThink(msg.content) || fallbackReply(db, actions), actions };
    }
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls });
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* model sent bad JSON: run with no args, the tool reports what is missing */ }
      const result = await runTool(db, user, today, c.function?.name, args);
      actions.push({ tool: c.function?.name, args, result });
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return { reply: fallbackReply(db, actions), actions };
}

/** When the model gives no text: say what was actually done, never a bare "Done.". */
function fallbackReply(db, actions) {
  const foodsById = new Map(loadFoods(db, { includeInactive: true }).map((f) => [f.id, f]));
  const did = actions.map((a) => actionLabel(a, foodsById)).filter(Boolean);
  const failed = actions.filter((a) => a.result?.error).map((a) => a.result.error);
  if (did.length) return `${did.join('. ')}.${failed.length ? ` One thing did not work: ${failed[0]}` : ''}`;
  if (failed.length) return `That did not work: ${failed[0]}`;
  return 'Sorry, I did not catch that. Tell me what you ate and for which meal (for example "2 eggs and a loaf of baladi for breakfast"), or ask me anything about your plan.';
}

/** Short human labels for actions, shown as chips under the coach's reply. */
// "Baladi bread" from "Baladi bread", "Eggs" from "Eggs, boiled": the chip stays one short line.
const shortName = (n) => String(n ?? '').split(/[,(]/)[0].trim().toLowerCase();
/** "2 eggs", "1 loaf baladi bread", "100 ml milk": amount and food without saying the unit twice. */
export function foodChip(amount, food) {
  const s = shortName(food);
  amount = amount ? String(amount).replace(/\s*\(about [^)]*\)/, '') : amount; // "100 g (about 1 loaf)" -> "100 g"

  const m = /^([\d.½]+)\s+(.+)$/.exec(String(amount ?? ''));
  if (!m) return amount ? `${amount} ${s}` : s;
  const unit = m[2].toLowerCase();
  if (/^(g|ml|g dry)\b|\(/.test(unit)) return `${amount} ${s}`;
  const sing = unit.replace(/(es|s)$/, '');
  if (s.startsWith(sing)) return amount;
  if (s.includes(sing)) return `${m[1]} ${s}`;
  return `${amount} ${s}`;
}

export function actionLabel(a, foodsById) {
  const r = a.result ?? {};
  if (r.error) return null;
  const name = (id) => foodsById.get(id)?.name ?? id;
  switch (a.tool) {
    case 'mark_plan_items': return a.args.status === 'clear' ? 'Cleared items' : `Marked ${a.args.refs?.length ?? 0} item${a.args.refs?.length === 1 ? '' : 's'} ${a.args.status}`;
    case 'log_foods': {
      const done = (r.results ?? []).filter((x) => !x.how?.startsWith('error') && x.how !== 'already logged, not added again');
      if (!done.length) return (r.results ?? []).some((x) => x.how === 'already logged, not added again') ? 'Already logged' : null;
      const what = done.map((x) => foodChip(x.amount, x.food)).join(', ');
      return `${r.meal && r.meal !== 'not placed in a meal' ? `${r.meal}: ` : 'Logged '}${what}`;
    }
    case 'move_food': return r.ok ? 'Moved to another meal' : null;
    case 'log_food': return r.ok ? `Logged ${foodChip(r.amount, r.food ?? name(a.args.foodId))}` : null;
    case 'log_custom_food': return `Logged ${a.args.name} (${Math.round(a.args.kcal)} kcal)`;
    case 'ate_amount': return r.ok ? 'Logged a different amount' : null;
    case 'swap_meal': return r.ok ? (a.args.scope === 'reset' ? 'Put the planned meal back' : `Meal changed to ${r.title} (${a.args.scope === 'always' ? 'every day' : 'today'})`) : null;
    case 'swap_item': return `Swapped to ${name(a.args.foodId)}${r.amount ? `, ${r.amount}` : ''} (${a.args.scope === 'always' ? 'every day' : 'today'})`;
    case 'update_food_preferences': return r.regenerated ? `Preferences saved · new plan ${r.regenerated.status === 'active' ? 'is live' : 'sent to admin'}` : 'Preferences saved';
    case 'change_goal': return `Targets updated: ${r.targets?.kcal ?? '?'} kcal`;
    case 'new_plan': return r.status === 'active' ? 'New plan is live' : 'New plan sent to the admin';
    case 'set_training_day': return r.ok ? (r.restDay ? 'Made it a rest day' : `Training day: ${r.dayName}`) : null;
    case 'answer_weekly_checkin': return r.status === 'accepted' && r.result ? `Check-in applied: ${r.result.kcal.to.toLocaleString('en-US')} kcal a day${r.result.planStatus === 'active' ? ', plan updated' : ''}` : r.status === 'kept' ? 'Kept your current plan' : null;
    case 'rebalance_today': return r.changed ? `Rest of today trimmed to ${r.after} kcal` : null;
    case 'log_weight': return `Weight logged: ${a.args.kg} kg`;
    case 'add_water': return `${a.args.ml > 0 ? 'Added' : 'Removed'} ${Math.abs(a.args.ml)} ml water`;
    case 'ask_admin': return 'Message sent to the admin';
    case 'log_sets': return `Logged ${r.logged?.length ?? 0} set${r.logged?.length === 1 ? '' : 's'}${r.personalRecord ? ' · new record' : ''}`;
    case 'complete_exercise': return r.added ? `Ticked ${r.added} set${r.added === 1 ? '' : 's'}${r.pr ? ' · new record' : ''}` : null;
    case 'remove_set': return 'Removed a set';
    case 'log_cardio': return `Cardio logged: ${a.args.minutes} min`;
    case 'swap_exercise': return 'Exercise swapped in your plan';
    case 'change_training': return r.status === 'active' ? 'New training plan is live' : 'New training plan sent to the admin';
    case 'new_training_plan': return r.status === 'active' ? 'New training plan is live' : 'New training plan sent to the admin';
    case 'log_measurements': return 'Measurements saved';
    default: return null;
  }
}
