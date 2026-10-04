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

// ---------------------------------------------------------------- food search (Arabic + English)
const AR_NORMAL = [[/[ً-ْـ]/g, ''], [/[أإآ]/g, 'ا'], [/ة/g, 'ه'], [/ى/g, 'ي'], [/ؤ/g, 'و'], [/ئ/g, 'ي']];
export function norm(s) {
  let t = String(s ?? '').toLowerCase().trim();
  for (const [re, to] of AR_NORMAL) t = t.replace(re, to);
  return t.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ');
}
export function searchFoods(foods, query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored = foods.map((f) => {
    const hay = `${norm(f.name)} ${norm(f.ar)} ${norm(f.id.replace(/-/g, ' '))}`;
    let score = 0;
    if (hay.includes(q)) score += 10;
    for (const w of words) if (w.length > 1 && hay.includes(w)) score += 3;
    if (norm(f.name).startsWith(q) || norm(f.ar).startsWith(q)) score += 4;
    return { f, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ f }) => f);
}

// ---------------------------------------------------------------- tools
const T = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const str = { type: 'string' }; const num = { type: 'number' };
const strs = { type: 'array', items: { type: 'string' } };

export const TOOLS = [
  T('get_day', 'The person\'s plan and log for a date: meals with item refs, what is eaten, calories/macros vs targets, water, workout. Call this before changing anything about a day.', { date: { ...str, description: 'YYYY-MM-DD, default today' } }),
  T('search_foods', 'Find foods in the database by English or Arabic name. Always use this to get a foodId; never invent ids.', { query: str }, ['query']),
  T('mark_plan_items', 'Mark planned items as eaten or skipped (or clear them) by ref from get_day.', { refs: strs, status: { type: 'string', enum: ['eaten', 'skipped', 'clear'] }, date: str }, ['refs', 'status']),
  T('log_food', 'Log something eaten that is not a planned item, from the database. Give grams, or qty + unit key from the food list (u = its own unit like egg/loaf/piece, m0/m1 = household measure like cup/plate, dry = grams weighed dry).', { foodId: str, grams: num, qty: num, unit: str, date: str }, ['foodId']),
  T('ate_amount', 'They ate a planned item but a different amount ("I had 3 eggs, not 2"). qty + unit key (see log_food), or grams.', { ref: str, qty: num, unit: str, grams: num, date: str }, ['ref']),
  T('meal_options', 'Whole-meal alternatives for one meal of the day (same kind, same calories and macros, fits the rest of the day). meal = index from get_day.', { meal: num, date: str }, ['meal']),
  T('swap_meal', 'Replace a whole meal with one from meal_options (key). scope today / always / reset (put the planned meal back).', { meal: num, key: str, scope: { type: 'string', enum: ['today', 'always', 'reset'] }, date: str }, ['meal', 'scope']),
  T('log_custom_food', 'Log something eaten that is not in the database, with your best estimate of its nutrition. Prefer search_foods first.', { name: str, kcal: num, protein: num, carbs: num, fat: num, date: str }, ['name', 'kcal']),
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
  T('get_recap', 'The person\'s weekly recap: points, rank, 70+ days, gym attendance, best lift, PRs, weight change and the one thing to improve.'),
  T('get_feed', 'Recent crew activity: check-ins, PRs, finished sessions, 70+ days, streaks, monthly winners.'),
  T('get_body', 'Body data: weigh-ins, tape measurements, progress photo dates and poses (never the images).'),
  T('log_measurements', 'Record tape measurements in cm.', { waistCm: num, neckCm: num, hipCm: num, chestCm: num, armCm: num, thighCm: num, calfCm: num, date: str }),
  T('ask_admin', 'Send a message to the human admin. Use only for things you cannot do or must not decide (medical issues, injuries, disputes).', { message: str }, ['message']),
];

// Compact day summary so the model sees refs without a wall of JSON.
function summarizeDay(d) {
  if (!d.meals) return { plan: 'none', note: d.hasPending ? 'A plan is waiting for the admin.' : 'No plan yet.' };
  return {
    date: d.date,
    targets: { kcal: d.targets.kcal, protein: d.targets.proteinG, carbs: d.targets.carbsG, fat: d.targets.fatG },
    eaten: d.consumed, score: d.score?.total, water: d.water,
    meals: d.meals.map((m, mi) => ({ meal: mi, name: m.name, title: m.title, items: m.items.map((i) => ({ ref: i.key, food: i.name, foodId: i.foodId, grams: i.grams, label: i.label, kcal: i.kcal, p: i.p, status: i.log?.status ?? 'not logged', swappedFrom: i.swappedFrom })) })),
    otherFood: d.extras.map((e) => ({ name: e.name, kcal: e.kcal })),
  };
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Compact training day for the model: what to do, what is done, what one tap would log.
function summarizeWorkout(w) {
  if (!w.hasPlan && !w.blocks?.length) return { plan: 'none', pending: w.hasPending };
  const checkin = w.checkin ? w.checkin.status : 'not checked in';
  if (w.restDay && !w.blocks.length) return { restDay: true, checkin, week: w.week.map((d) => ({ date: d.date, session: d.name, checkin: d.checkin })) };
  return {
    session: w.dayName, focus: w.focus, checkin,
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
        const all = loadFoods(db);
        const allowed = new Set(filterFoods(all, prefs).map((f) => f.id));
        return searchFoods(all, args.query).map((f) => ({ foodId: f.id, name: f.name, ar: f.ar, per100g: { kcal: f.kcal, p: f.p, c: f.c, f: f.f }, unit: f.unit, excludedForThisPerson: !allowed.has(f.id) }));
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
      case 'log_food': return await call('POST', '/api/log/extra', { date, today, foodId: args.foodId, ...(args.unit ? { unit: args.unit, qty: args.qty } : { grams: args.grams }) });
      case 'ate_amount': return await call('POST', '/api/log', { date, today, ref: args.ref, status: 'adjusted', ...(args.unit ? { unit: args.unit, qty: args.qty } : { grams: args.grams }) });
      case 'meal_options': {
        const r = await call('GET', `/api/plan/meal-options?date=${date}&meal=${Number(args.meal) || 0}`);
        return { now: r.meal, options: r.options.map((o) => ({ key: o.key, title: o.title, kcal: o.kcal, protein: o.p, items: o.items.map((i) => `${i.amount} ${i.name}`) })) };
      }
      case 'swap_meal': return await call('POST', '/api/plan/meal-swap', { date, meal: Number(args.meal) || 0, key: args.key, scope: args.scope });
      case 'log_custom_food': return await call('POST', '/api/log/extra', { date, today, name: args.name, kcal: args.kcal, p: args.protein ?? 0, c: args.carbs ?? 0, f: args.fat ?? 0 });
      case 'list_alternatives': {
        const r = await call('GET', `/api/plan/alternatives?date=${date}&ref=${encodeURIComponent(args.ref)}`);
        return { item: `${r.item.name} ${r.item.amount}`, group: r.groupLabel, options: r.options.slice(0, 15).map((o) => ({ foodId: o.foodId, name: o.name, amount: o.amount, kcalDiff: o.kcalDiff })) };
      }
      case 'swap_item': return await call('POST', '/api/plan/swap', { date, ref: args.ref, foodId: args.foodId, scope: args.scope });
      case 'update_food_preferences': return await call('POST', '/api/profile/prefs', args);
      case 'change_goal': return await call('POST', '/api/profile/goal', args);
      case 'new_plan': return await call('POST', '/api/plan/regenerate', { note: String(args.reason ?? '').slice(0, 280) });
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
- You can act, not just talk. When they tell you they ate something, log it. When they want a different food, swap it. When they dislike something, update their preferences. Do it, then say briefly what you did.
- Today's plan and the food list are in this brief: act on them directly. Call get_day only for other dates or after you changed something and need fresh totals. Never invent ids, numbers or results.
- If they ate something off-plan, log it, then offer (or if they asked, do) rebalance_today so the day still lands on target. Never suggest skipping protein.
- If what they ate matches a planned item, mark that item eaten instead of logging it again. "Ate breakfast" means mark all breakfast items eaten.
- Prefer swaps ("today" unless they say always/every day) over new plans. Use new_plan only when they want a different overall menu.
- Amounts: Egyptians say pieces, not grams ("3 eggs", "a loaf of baladi", "a plate of koshari", "2 cups of rice"). Log them in those units with qty + unit from the food list (ate_amount for a planned item eaten in a different amount, log_food for extras); use grams only when they give grams. Say back what you logged in their words ("3 eggs", not "150 g").
- A whole meal they want different ("I don't want mahshi today", "something else for dinner"): meal_options, then swap_meal with their pick (today unless they say every day). Dinner stays light and lunch is the one cooked meal.
- If a change would be unsafe (below their calorie floor, crash diets, more than 1% bodyweight loss per week), refuse kindly and offer the safe version.

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
- Gym attendance is proven only by a check-in photo in the Train tab (it earns half the training points; ticked sets earn the other half). You cannot check them in or approve check-ins; tell them to tap "Check in" on the Train tab.
- Their training details (days, weekdays, equipment, experience) can be changed with change_training.

SAFETY
- You are not a doctor. For pain, injuries, medical conditions, medication, pregnancy or very low intake, tell them to see a professional and use ask_admin.
- If someone talks about not eating, purging, or hating their body, respond with care, do not push targets, suggest talking to someone they trust or a professional, and use ask_admin.

STYLE
- Reply in the language they write in. If they write Egyptian Arabic (عربي مصري), reply in Egyptian Arabic.
- Short and warm, like a friend who is a good coach. 1-4 sentences, a short list only when it helps. No lectures, no emojis unless they use them.
- Numbers: round grams to what people can measure (slices, eggs, 10 g steps).`;
}

// ---------------------------------------------------------------- the model
async function chatOnce(cfg, model, messages, { tools, fetchImpl }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.min(cfg.timeoutMs ?? 25_000, 25_000)); // a healthy model answers in seconds
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model, temperature: 0.4, max_tokens: 1200, messages, ...(tools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`AI provider answered ${res.status}`), { status: res.status, body: text.slice(0, 400), model });
    }
    const data = await res.json();
    return data.choices?.[0]?.message ?? { content: '' };
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

export async function coachTurn({ db, user, text, today, history = [], env = process.env, fetchImpl }) {
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
  const context = `\n\nTODAY (${today}), already loaded, no need to call get_day for it:\n${JSON.stringify(day)}\n\nTODAY'S TRAINING (already loaded, no need to call get_workout for today):\n${JSON.stringify(workout)}\n\nFOODS THIS PERSON EATS (foodId: name / Arabic [unit]); use these ids directly, search_foods only if nothing fits:\n${foodIndex}`;
  const messages = [
    { role: 'system', content: systemPrompt({ user, profile, targets, today }) + context },
    ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content: text },
  ];
  const actions = [];
  for (let step = 0; step < 8; step++) {
    const msg = await chat(cfg, messages, { fetchImpl, db });
    const calls = msg.tool_calls ?? [];
    if (!calls.length) return { reply: stripThink(msg.content) || 'Done.', actions };
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls });
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* model sent bad JSON: run with no args, the tool reports what is missing */ }
      const result = await runTool(db, user, today, c.function?.name, args);
      actions.push({ tool: c.function?.name, args, result });
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return { reply: 'I made the changes above. Anything else?', actions };
}

/** Short human labels for actions, shown as chips under the coach's reply. */
export function actionLabel(a, foodsById) {
  const r = a.result ?? {};
  if (r.error) return null;
  const name = (id) => foodsById.get(id)?.name ?? id;
  switch (a.tool) {
    case 'mark_plan_items': return a.args.status === 'clear' ? 'Cleared items' : `Marked ${a.args.refs?.length ?? 0} item${a.args.refs?.length === 1 ? '' : 's'} ${a.args.status}`;
    case 'log_food': return `Logged ${name(a.args.foodId)}${foodsById.get(a.args.foodId) ? `, ${describeAmount(foodsById.get(a.args.foodId), a.args.grams)}` : ''}`;
    case 'log_custom_food': return `Logged ${a.args.name} (${Math.round(a.args.kcal)} kcal)`;
    case 'ate_amount': return r.ok ? 'Logged a different amount' : null;
    case 'swap_meal': return r.ok ? (a.args.scope === 'reset' ? 'Put the planned meal back' : `Meal changed to ${r.title} (${a.args.scope === 'always' ? 'every day' : 'today'})`) : null;
    case 'swap_item': return `Swapped to ${name(a.args.foodId)}${r.amount ? `, ${r.amount}` : ''} (${a.args.scope === 'always' ? 'every day' : 'today'})`;
    case 'update_food_preferences': return r.regenerated ? `Preferences saved · new plan ${r.regenerated.status === 'active' ? 'is live' : 'sent to admin'}` : 'Preferences saved';
    case 'change_goal': return `Targets updated: ${r.targets?.kcal ?? '?'} kcal`;
    case 'new_plan': return r.status === 'active' ? 'New plan is live' : 'New plan sent to the admin';
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
