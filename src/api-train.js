// Training endpoints: workout plans, one-tap set logging, gym check-ins (attendance), cardio,
// history and records, plus the admin side (plan editor, check-in review, plan clean-up).
import crypto from 'node:crypto';
import { autoReview } from './review.js';
import { loadExercises, getSetting } from './db.js';
import { generateWorkoutPlan, nextTarget, e1rm, videoFor, planWeek, isDeloadWeek, deloadSets, deloadRir, deloadWeight, CYCLE_WEEKS, swapOptions, MUSCLES, PATTERNS, cardioFor, SPLITS, splitDaysError, INTENSITY } from './workout.js';
import { pushToUser } from './push.js';
import { pickSplit } from './split-ai.js';
import { addActivity, removeActivity } from './social.js';

const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const planRow = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);

export const activeWorkoutPlan = (db, uid) =>
  planRow(db.prepare("SELECT * FROM workout_plans WHERE user_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(uid));
export const workoutPlanForDate = (db, uid, date) =>
  planRow(db.prepare("SELECT * FROM workout_plans WHERE user_id = ? AND status IN ('active','archived') AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY version DESC LIMIT 1").get(uid, date, date));

const checkinOn = (db, uid, date) => db.prepare('SELECT id, status, verdict FROM checkins WHERE user_id = ? AND date = ?').get(uid, date) ?? null;

/**
 * Used by the day score. null when the person has no workout plan for that date.
 *   planned:    a session is scheduled on this weekday
 *   completion: logged sets / planned sets (0..1)
 *   checkin:    'approved' | 'pending' | 'rejected' | null (gym attendance photo)
 *   done:       at least half the planned sets are logged
 */
export function workoutState(db, uid, date) {
  const plan = workoutPlanForDate(db, uid, date);
  if (!plan) return null;
  const checkin = checkinOn(db, uid, date)?.status ?? null;
  const day = plan.data.days.find((d) => d.weekday === weekdayOf(date));
  if (!day) return { planned: false, done: false, completion: 0, checkin };
  const deload = isDeloadWeek(plan.start_date, date);
  const plannedSets = day.exercises.reduce((a, e) => a + (deload ? deloadSets(e.sets) : e.sets), 0);
  const logged = db.prepare('SELECT COUNT(*) n FROM set_logs WHERE user_id = ? AND date = ?').get(uid, date).n;
  const completion = plannedSets > 0 ? Math.min(1, logged / plannedSets) : 0;
  return { planned: true, done: plannedSets > 0 && logged >= Math.ceil(plannedSets / 2), completion: Math.round(completion * 100) / 100, checkin };
}

const lastSession = (db, uid, exId, date) => {
  const rows = db.prepare('SELECT date, set_no, weight_kg, reps FROM set_logs WHERE user_id = ? AND exercise_id = ? AND date < ? ORDER BY date DESC, set_no LIMIT 40').all(uid, exId, date);
  if (!rows.length) return null;
  const d = rows[0].date;
  return { date: d, sets: rows.filter((r) => r.date === d).map((r) => ({ setNo: r.set_no, weightKg: r.weight_kg, reps: r.reps })) };
};

const WEEK_ORDER = (wd) => (wd + 1) % 7; // Saturday first
const addDaysStr = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Saturday of the week that contains `date` (the Egyptian week runs Saturday to Friday). */
export const weekStart = (date) => addDaysStr(date, -WEEK_ORDER(weekdayOf(date)));

/** 64-bit average hashes as 16 hex chars: how many bits differ. */
export function hamming(a, b) {
  if (!/^[0-9a-f]{16}$/.test(a ?? '') || !/^[0-9a-f]{16}$/.test(b ?? '')) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`); let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/**
 * Attendance between two dates for the leaderboard: planned sessions and approved check-ins.
 */
export function attendance(db, uid, from, to) {
  let planned = 0; let attended = 0;
  const approved = new Set(db.prepare("SELECT date FROM checkins WHERE user_id = ? AND status = 'approved' AND date BETWEEN ? AND ?").all(uid, from, to).map((r) => r.date));
  for (let d = from; d <= to; d = addDaysStr(d, 1)) {
    const plan = workoutPlanForDate(db, uid, d);
    const isPlanned = Boolean(plan?.data.days.some((x) => x.weekday === weekdayOf(d)));
    if (isPlanned) planned++;
    if (approved.has(d)) attended++;
  }
  return { planned, attended };
}

export function registerTrain(c) {
  const { route, bad, notFound, num, optNum, oneOf, str, needDate, isDate, subjectId, audit, addDays, todayUtc } = c;
  const dayChanged = (db, uid, date) => { try { c.dayChanged?.(db, uid, date); } catch (e) { console.warn('[feed]', e.message); } };

  /** Feed: a check-in that counts (approved) is posted; a revoked one is taken down. */
  const checkinFeed = (db, uid, date, status) => {
    if (status === 'approved') addActivity(db, uid, 'checkin', `checkin:${date}`, 'checked in at the gym');
    else removeActivity(db, uid, `checkin:${date}`);
    dayChanged(db, uid, date);
  };

  /** After sets are logged: post a finished session once every planned set is in. */
  function sessionFeed(db, uid, date) {
    const plan = workoutPlanForDate(db, uid, date);
    const day = plan?.data.days.find((d) => d.weekday === weekdayOf(date));
    if (!day) return;
    const planned = day.exercises.reduce((a, e) => a + e.sets, 0);
    const logged = db.prepare('SELECT COUNT(*) n FROM set_logs WHERE user_id = ? AND date = ?').get(uid, date).n;
    if (planned > 0 && logged >= planned) addActivity(db, uid, 'session', `session:${date}`, `finished ${day.name} · ${logged} sets`, { sets: logged });
  }

  // ------------------------------------------------ plan validation (admin editor and user swaps)
  function normalizeWorkout(body, base, exById) {
    const days = body.days;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7) throw bad('A workout plan needs 1 to 7 sessions');
    const seen = new Set();
    const cleanEx = (e, warm = false) => {
      const ex = exById.get(e.exerciseId);
      if (!ex) throw bad('Unknown exercise');
      const repMin = Math.round(num(e.repMin, 1, 200, 'min reps'));
      const repMax = Math.round(num(e.repMax, 1, 300, 'max reps'));
      if (repMax < repMin) throw bad('Max reps must be at least min reps');
      const out = { exerciseId: ex.id, name: ex.name, muscle: ex.muscle, sets: Math.round(num(e.sets, 1, 10, 'sets')), repMin, repMax };
      if (warm) return { ...out, timed: ex.timed };
      out.restSec = Math.round(num(e.restSec ?? 90, 15, 600, 'rest seconds'));
      const rir = optNum(e.rir, 0, 5, 'RIR'); if (rir !== undefined) out.rir = Math.round(rir);
      const tempo = str(e.tempo, 12, 'tempo'); if (tempo) { if (!/^[0-9X]-?[0-9X]-?[0-9X]-?[0-9X]$/i.test(tempo)) throw bad('Tempo looks like 2-0-1-0'); out.tempo = tempo.length === 4 ? tempo.split('').join('-') : tempo; }
      const note = str(e.note, 200, 'note'); if (note) out.note = note;
      return out;
    };
    const out = days.map((d) => {
      const weekday = Math.round(num(d.weekday, 0, 6, 'weekday'));
      if (seen.has(weekday)) throw bad('Two sessions fall on the same weekday');
      seen.add(weekday);
      if (!Array.isArray(d.exercises) || d.exercises.length > 14) throw bad('A session can have up to 14 exercises');
      if (d.warmup !== undefined && (!Array.isArray(d.warmup) || d.warmup.length > 6)) throw bad('A warm-up can have up to 6 moves');
      return {
        weekday,
        name: str(d.name, 40, 'session name', true),
        ...(d.focus ? { focus: str(d.focus, 80, 'focus') } : {}),
        warmup: (d.warmup ?? []).map((e) => cleanEx(e, true)),
        exercises: d.exercises.map((e) => cleanEx(e)),
      };
    }).sort((a, b) => WEEK_ORDER(a.weekday) - WEEK_ORDER(b.weekday));
    let cardio = base.cardio ?? null;
    if (body.cardio !== undefined) {
      cardio = body.cardio === null ? null : {
        kind: oneOf(body.cardio.kind ?? 'Walk', ['Run', 'Walk', 'Cycle', 'Row', 'Swim', 'Elliptical', 'Stairs', 'Other'], 'cardio type'),
        label: str(body.cardio.label, 60, 'cardio name') || 'Cardio',
        minutes: Math.round(num(body.cardio.minutes, 1, 120, 'cardio minutes')),
        when: str(body.cardio.when, 40, 'cardio timing') || 'After training',
        note: str(body.cardio.note, 200, 'cardio note'),
      };
    }
    return { ...base, format: 2, days: out, daysPerWeek: out.length, cardio };
  }

  function profileOf(db, uid) {
    const prof = db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(uid);
    if (!prof) throw bad('This user has not completed their profile yet');
    return JSON.parse(prof.data);
  }

  // Focus areas used to come from the AI body assessment (removed). Kept as a hook: none for now.
  const latestFocus = () => [];

  /**
   * Drafts a training plan and sends it through the AI admin's review. With "coach picks" the AI
   * chooses the split for this person (falls back to the rules); the reason is kept on the plan.
   */
  async function makePendingWorkoutPlan(db, uid, note = null) {
    const profile = { ...profileOf(db, uid), focus: latestFocus(db, uid) };
    let splitChoice = null;
    if ((profile.split ?? 'auto') === 'auto') splitChoice = await pickSplit({ profile, db });
    const plan = generateWorkoutPlan({ profile: { ...profile, chosenSplit: splitChoice?.split }, exercises: loadExercises(db) });
    plan.splitChoice = splitChoice
      ? { id: splitChoice.split, by: splitChoice.by, reason: splitChoice.reason, ...(splitChoice.model ? { model: splitChoice.model } : {}) }
      : { id: profile.split, by: 'member', reason: 'You picked this split.' };
    db.prepare("DELETE FROM workout_plans WHERE user_id = ? AND status = 'pending'").run(uid); // superseded draft
    const version = (db.prepare('SELECT MAX(version) v FROM workout_plans WHERE user_id = ?').get(uid).v ?? 0) + 1;
    const r = db.prepare("INSERT INTO workout_plans (user_id, version, status, data, note) VALUES (?, ?, 'pending', ?, ?)").run(uid, version, JSON.stringify(plan), note);
    const id = Number(r.lastInsertRowid);
    autoReview(db, 'workout_plans', id); // the AI admin approves it now if it passes the safety rules
    return id;
  }

  /**
   * End of a cycle (6 weeks + deload): draft the next plan with the next exercise variations,
   * keeping the split, days and intensity. Goes through the same review as any new plan. Asked
   * once per plan (data.rotationRequested), so a rejected draft is not recreated on every visit.
   */
  function rotateIfDue(db, uid, plan, date) {
    if (!plan || plan.status !== 'active' || plan.data.rotationRequested || plan.data.format !== 2) return false;
    if (planWeek(plan.start_date, date) <= CYCLE_WEEKS) return false;
    if (db.prepare("SELECT 1 FROM workout_plans WHERE user_id = ? AND status = 'pending'").get(uid)) return false;
    let profile;
    try { profile = { ...profileOf(db, uid), focus: latestFocus(db, uid) }; } catch { return false; }
    const rotation = (plan.data.rotation ?? 0) + 1;
    const next = generateWorkoutPlan({ profile: { ...profile, chosenSplit: plan.data.split }, exercises: loadExercises(db), rotation });
    next.rotation = rotation;
    next.splitChoice = plan.data.splitChoice ?? null;
    db.prepare('UPDATE workout_plans SET data = ? WHERE id = ?').run(JSON.stringify({ ...plan.data, rotationRequested: true }), plan.id);
    const version = (db.prepare('SELECT MAX(version) v FROM workout_plans WHERE user_id = ?').get(uid).v ?? 0) + 1;
    const r = db.prepare("INSERT INTO workout_plans (user_id, version, status, data, note) VALUES (?, ?, 'pending', ?, ?)")
      .run(uid, version, JSON.stringify(next), `New cycle ${rotation + 1}: same split, fresh exercise variations after the deload week.`);
    autoReview(db, 'workout_plans', Number(r.lastInsertRowid));
    return true;
  }

  const planStatus = (db, id) => {
    const row = db.prepare('SELECT status, data FROM workout_plans WHERE id = ?').get(id);
    return { planId: id, status: row.status, issues: JSON.parse(row.data).review?.issues ?? [] };
  };

  // ------------------------------------------------ library
  route('GET', '/api/exercises', 'user', (ctx) => {
    const q = (ctx.query.get('q') ?? '').toLowerCase();
    return { exercises: loadExercises(ctx.db).filter((e) => !q || e.name.toLowerCase().includes(q) || e.muscle.includes(q)).slice(0, 200).map((e) => ({ ...e, video: videoFor(e) })) };
  });

  route('GET', '/api/splits', 'user', () => ({ splits: Object.entries(SPLITS).map(([id, x]) => ({ id, name: x.name, about: x.about, days: x.days })) }));

  route('GET', '/api/exercises/:id/alternatives', 'user', (ctx) => {
    const lib = loadExercises(ctx.db);
    const ex = lib.find((e) => e.id === ctx.params.id);
    if (!ex) throw notFound('Exercise not found');
    let equipment = 'gym';
    try { equipment = profileOf(ctx.db, subjectId(ctx)).equipment ?? 'gym'; } catch { /* no profile: gym */ }
    return { exercise: { ...ex, video: videoFor(ex) }, options: swapOptions(ex, lib, equipment).map((e) => ({ id: e.id, name: e.name, equip: e.equip, muscle: e.muscle, video: videoFor(e) })) };
  });

  // ------------------------------------------------ plan
  const publicPlan = (plan, exById) => plan && ({
    id: plan.id, version: plan.version, startDate: plan.start_date, ...plan.data,
    days: plan.data.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e, video: videoFor(exById.get(e.exerciseId) ?? e) })) })),
  });

  route('GET', '/api/workout-plan', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const plan = activeWorkoutPlan(ctx.db, uid);
    const pending = ctx.db.prepare("SELECT id FROM workout_plans WHERE user_id = ? AND status = 'pending'").get(uid);
    const exById = new Map(loadExercises(ctx.db, { includeInactive: true }).map((e) => [e.id, e]));
    return { plan: publicPlan(plan, exById), hasPending: Boolean(pending) };
  });

  // A fresh plan from the person's current training details. Reviewed like any other plan.
  route('POST', '/api/workout-plan/regenerate', 'user', async (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const id = await makePendingWorkoutPlan(ctx.db, uid, str(ctx.body.note, 300, 'note') || 'New training plan requested');
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'workout_plan.regenerated_by_admin', uid, { planId: id });
    return { ok: true, ...planStatus(ctx.db, id) };
  });

  // Change training details (days, which weekdays, experience, equipment, injuries) and get a new plan.
  route('POST', '/api/profile/training', 'user', async (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const row = ctx.db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(uid);
    if (!row) throw bad('Finish setting up your profile first');
    const data = JSON.parse(row.data);
    const b = ctx.body;
    if (b.daysPerWeek !== undefined) data.daysPerWeek = Math.round(num(b.daysPerWeek, 2, 6, 'days per week'));
    if (b.experience !== undefined) data.experience = oneOf(b.experience, ['beginner', 'intermediate', 'advanced'], 'experience');
    if (b.equipment !== undefined) data.equipment = oneOf(b.equipment, ['gym', 'home', 'mixed'], 'equipment');
    if (b.injuries !== undefined) data.injuries = str(b.injuries, 500, 'injuries');
    if (b.split !== undefined) data.split = oneOf(b.split, Object.keys(SPLITS), 'split');
    if (b.intensity !== undefined) data.intensity = oneOf(b.intensity, Object.keys(INTENSITY), 'intensity');
    if (b.trainDays !== undefined) {
      if (!Array.isArray(b.trainDays)) throw bad('trainDays must be a list of weekdays');
      const days = [...new Set(b.trainDays.map((d) => Math.round(num(d, 0, 6, 'weekday'))))];
      data.trainDays = days;
      if (b.daysPerWeek === undefined) data.daysPerWeek = days.length;
    }
    if (Array.isArray(data.trainDays) && data.trainDays.length !== data.daysPerWeek) delete data.trainDays; // stale choice
    const splitErr = splitDaysError(data.split ?? 'auto', data.daysPerWeek);
    if (splitErr) throw bad(splitErr);
    ctx.db.prepare('UPDATE profiles SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(JSON.stringify(data), uid);
    const id = await makePendingWorkoutPlan(ctx.db, uid, 'Training details changed');
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'training.edited_by_admin', uid, b);
    return { ok: true, profile: { daysPerWeek: data.daysPerWeek, trainDays: data.trainDays ?? null, split: data.split ?? 'auto', intensity: data.intensity ?? 'moderate', experience: data.experience, equipment: data.equipment, injuries: data.injuries }, ...planStatus(ctx.db, id) };
  });

  // Swap one exercise in the live plan for another with the same movement (machine taken, no
  // cable at this gym, it hurts...). Sets, reps and rest stay as they were.
  route('POST', '/api/workout-plan/swap', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const plan = activeWorkoutPlan(ctx.db, uid);
    if (!plan) throw bad('No active training plan');
    const lib = loadExercises(ctx.db);
    const from = lib.find((e) => e.id === ctx.body.exerciseId) ?? loadExercises(ctx.db, { includeInactive: true }).find((e) => e.id === ctx.body.exerciseId);
    const to = lib.find((e) => e.id === ctx.body.toId);
    if (!from || !to) throw bad('Unknown exercise');
    if (from.pattern !== to.pattern) throw bad(`${to.name} is not a like-for-like swap for ${from.name}`);
    const weekday = ctx.body.weekday === undefined ? null : Math.round(num(ctx.body.weekday, 0, 6, 'weekday'));
    let n = 0;
    for (const d of plan.data.days) {
      if (weekday !== null && d.weekday !== weekday) continue;
      if (d.exercises.some((e) => e.exerciseId === to.id)) continue; // never twice in one session
      for (const e of d.exercises) if (e.exerciseId === from.id) { Object.assign(e, { exerciseId: to.id, name: to.name, muscle: to.muscle }); n++; }
    }
    if (!n) throw bad('That exercise is not in the plan on that day');
    ctx.db.prepare('UPDATE workout_plans SET data = ? WHERE id = ?').run(JSON.stringify(plan.data), plan.id);
    audit(ctx.db, ctx.user.id, 'workout_plan.exercise_swapped', uid, { planId: plan.id, from: from.id, to: to.id, weekday });
    return { ok: true, swapped: n };
  });

  // ------------------------------------------------ the day
  route('GET', '/api/train', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const date = needDate(ctx.query.get('date'));
    let plan = workoutPlanForDate(ctx.db, uid, date);
    if (date >= addDays(todayUtc(), -1) && rotateIfDue(ctx.db, uid, plan, date)) plan = workoutPlanForDate(ctx.db, uid, date);
    const deload = Boolean(plan) && isDeloadWeek(plan.start_date, date);
    const pending = Boolean(ctx.db.prepare("SELECT id FROM workout_plans WHERE user_id = ? AND status = 'pending'").get(uid));
    const day = plan ? plan.data.days.find((d) => d.weekday === weekdayOf(date)) ?? null : null;
    const exById = new Map(loadExercises(ctx.db, { includeInactive: true }).map((e) => [e.id, e]));
    const logged = ctx.db.prepare('SELECT * FROM set_logs WHERE user_id = ? AND date = ? ORDER BY exercise_id, set_no').all(uid, date);
    const byEx = new Map();
    for (const r of logged) {
      if (!byEx.has(r.exercise_id)) byEx.set(r.exercise_id, []);
      byEx.get(r.exercise_id).push({ setNo: r.set_no, weightKg: r.weight_kg, reps: r.reps, rpe: r.rpe });
    }
    const planned = day ? day.exercises : [];
    const ids = [...planned.map((p) => p.exerciseId), ...[...byEx.keys()].filter((k) => !planned.some((p) => p.exerciseId === k))];
    const blocks = ids.map((id) => {
      const ex = exById.get(id);
      const p = planned.find((x) => x.exerciseId === id) ?? null;
      const last = lastSession(ctx.db, uid, id, date);
      const repMin = p?.repMin ?? 8; const repMax = p?.repMax ?? 12;
      // No progression in a deload week: lighter on purpose.
      const target = last && !deload ? nextTarget({ lastSets: last.sets, repMin, repMax, inc: ex?.inc ?? 2.5 }) : null;
      const lastTop = last ? Math.max(...last.sets.map((s) => s.weightKg)) : null;
      return {
        exerciseId: id, name: ex?.name ?? p?.name ?? id, muscle: ex?.muscle ?? '', notes: ex?.notes ?? '', video: videoFor(ex ?? { name: id }), timed: ex?.timed ?? false,
        equip: ex?.equip ?? '', inc: ex?.inc ?? 2.5,
        plan: p && (deload
          ? { sets: deloadSets(p.sets), repMin: p.repMin, repMax: p.repMax, restSec: p.restSec, rir: deloadRir(p.rir), tempo: p.tempo ?? '', note: p.note ?? '', deload: true }
          : { sets: p.sets, repMin: p.repMin, repMax: p.repMax, restSec: p.restSec, rir: p.rir ?? null, tempo: p.tempo ?? '', note: p.note ?? '' }),
        sets: byEx.get(id) ?? [], last, target,
        // What one tap logs: the progression target, or last time, or the bottom of the range.
        suggested: target ? { weightKg: target.weightKg, reps: target.reps }
          : last ? { weightKg: deload ? deloadWeight(lastTop, ex?.inc ?? 2.5) : lastTop, reps: repMin } : { weightKg: null, reps: repMin },
      };
    });
    const warmup = (day?.warmup ?? []).map((w) => { const ex = exById.get(w.exerciseId); return { ...w, video: videoFor(ex ?? w), notes: ex?.notes ?? '' }; });
    const cardio = ctx.db.prepare('SELECT id, kind, minutes, distance_km distanceKm, avg_hr avgHr, notes FROM cardio_logs WHERE user_id = ? AND date = ? ORDER BY id').all(uid, date);
    const ci = checkinOn(ctx.db, uid, date);
    // The attendance week (Saturday to Friday) around this date.
    const ws = weekStart(date);
    const approvedDates = new Map(ctx.db.prepare('SELECT date, status FROM checkins WHERE user_id = ? AND date BETWEEN ? AND ?').all(uid, ws, addDays(ws, 6)).map((r) => [r.date, r.status]));
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws, i);
      const p = workoutPlanForDate(ctx.db, uid, d); // days before the first plan are not planned
      const s = p?.data.days.find((x) => x.weekday === weekdayOf(d));
      return { date: d, planned: Boolean(s), name: s?.name ?? null, checkin: approvedDates.get(d) ?? null };
    });
    return {
      date, hasPlan: Boolean(plan), hasPending: pending, dayName: day?.name ?? null, focus: day?.focus ?? null, minutes: day?.minutes ?? null, restDay: Boolean(plan) && !day,
      split: plan?.data.split ?? null, notes: plan?.data.notes ?? [], cardioPlan: day ? plan.data.cardio ?? null : null,
      warmup, blocks, cardio, week,
      cycle: plan && plan.data.format === 2 ? { week: Math.max(1, planWeek(plan.start_date, date)), of: CYCLE_WEEKS, deload, rotation: plan.data.rotation ?? 0 } : null,
      checkin: ci && { id: ci.id, status: ci.status, reason: ci.verdict ? JSON.parse(ci.verdict).reason ?? '' : '' },
      state: workoutState(ctx.db, uid, date),
    };
  });

  function logSet(ctx, uid, { date, loggedOn, exId, setNo, weightKg, reps, rpe }) {
    const prev = ctx.db.prepare('SELECT weight_kg, reps FROM set_logs WHERE user_id = ? AND exercise_id = ? AND NOT (date = ? AND set_no = ?)').all(uid, exId, date, setNo);
    const prevBest = Math.max(0, ...prev.map((r) => e1rm(r.weight_kg, r.reps)));
    const now = e1rm(weightKg, reps);
    ctx.db.prepare(`INSERT INTO set_logs (user_id, date, exercise_id, set_no, weight_kg, reps, rpe, logged_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, date, exercise_id, set_no) DO UPDATE SET weight_kg = excluded.weight_kg, reps = excluded.reps, rpe = excluded.rpe, logged_on = excluded.logged_on`)
      .run(uid, date, exId, setNo, weightKg, reps, rpe ?? null, loggedOn);
    const pr = prevBest > 0 && now > prevBest + 1e-9;
    if (pr) {
      const name = ctx.db.prepare('SELECT name FROM exercises WHERE id = ?').get(exId)?.name ?? exId;
      addActivity(ctx.db, uid, 'pr', `pr:${exId}:${date}`, `set a new PR on ${name}: ${weightKg > 0 ? `${weightKg} kg × ${reps}` : `${reps} reps`}`, { exerciseId: exId, weightKg, reps });
    }
    return { pr, e1rm: Math.round(now * 10) / 10 };
  }

  const knownExercise = (ctx, id) => {
    const exId = str(id, 60, 'exercise', true);
    if (!ctx.db.prepare('SELECT 1 FROM exercises WHERE id = ?').get(exId)) throw bad('Unknown exercise');
    return exId;
  };

  route('POST', '/api/train/set', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const date = needDate(ctx.body.date);
    const r = logSet(ctx, uid, {
      date, loggedOn: isDate(ctx.body.today) ? ctx.body.today : date, exId: knownExercise(ctx, ctx.body.exerciseId),
      setNo: Math.round(num(ctx.body.setNo, 1, 20, 'set number')), weightKg: num(ctx.body.weightKg ?? 0, 0, 600, 'weight'),
      reps: Math.round(num(ctx.body.reps, 1, 500, 'reps')), rpe: optNum(ctx.body.rpe, 1, 10, 'rpe'),
    });
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'set.edited_by_admin', uid, { date, exId: ctx.body.exerciseId, setNo: ctx.body.setNo });
    sessionFeed(ctx.db, uid, date); dayChanged(ctx.db, uid, date);
    return { ok: true, ...r };
  });

  // "Done as planned": log every remaining planned set of an exercise at one weight × reps.
  route('POST', '/api/train/exercise/complete', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const date = needDate(ctx.body.date);
    const exId = knownExercise(ctx, ctx.body.exerciseId);
    const plan = workoutPlanForDate(ctx.db, uid, date);
    const p = plan?.data.days.find((d) => d.weekday === weekdayOf(date))?.exercises.find((e) => e.exerciseId === exId);
    const sets = Math.round(num(ctx.body.sets ?? p?.sets ?? 3, 1, 20, 'sets'));
    const weightKg = num(ctx.body.weightKg ?? 0, 0, 600, 'weight');
    const reps = Math.round(num(ctx.body.reps ?? p?.repMin, 1, 500, 'reps'));
    const have = new Set(ctx.db.prepare('SELECT set_no FROM set_logs WHERE user_id = ? AND date = ? AND exercise_id = ?').all(uid, date, exId).map((r) => r.set_no));
    let pr = false; let added = 0;
    for (let s = 1; s <= sets; s++) {
      if (have.has(s)) continue;
      pr = logSet(ctx, uid, { date, loggedOn: isDate(ctx.body.today) ? ctx.body.today : date, exId, setNo: s, weightKg, reps }).pr || pr;
      added++;
    }
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'set.edited_by_admin', uid, { date, exId, bulk: added });
    sessionFeed(ctx.db, uid, date); dayChanged(ctx.db, uid, date);
    return { ok: true, added, pr };
  });

  route('POST', '/api/train/set/remove', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    ctx.db.prepare('DELETE FROM set_logs WHERE user_id = ? AND date = ? AND exercise_id = ? AND set_no = ?')
      .run(uid, needDate(ctx.body.date), str(ctx.body.exerciseId, 60, 'exercise', true), Math.round(num(ctx.body.setNo, 1, 20, 'set number')));
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'set.removed_by_admin', uid, { date: ctx.body.date, exId: ctx.body.exerciseId });
    return { ok: true };
  });

  route('POST', '/api/train/exercise/clear', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    ctx.db.prepare('DELETE FROM set_logs WHERE user_id = ? AND date = ? AND exercise_id = ?').run(uid, needDate(ctx.body.date), str(ctx.body.exerciseId, 60, 'exercise', true));
    return { ok: true };
  });

  route('POST', '/api/train/cardio', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const date = needDate(ctx.body.date);
    const kind = oneOf(ctx.body.kind, ['Run', 'Walk', 'Cycle', 'Row', 'Swim', 'Elliptical', 'Stairs', 'Other'], 'kind');
    const r = ctx.db.prepare('INSERT INTO cardio_logs (user_id, date, kind, minutes, distance_km, avg_hr, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, date, kind, num(ctx.body.minutes, 1, 600, 'minutes'), optNum(ctx.body.distanceKm, 0, 500, 'distance') ?? null, optNum(ctx.body.avgHr, 40, 230, 'average heart rate') ?? null, str(ctx.body.notes, 200, 'notes'));
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'cardio.added_by_admin', uid, { date, kind });
    return { ok: true, id: Number(r.lastInsertRowid) };
  });

  route('POST', '/api/train/cardio/remove', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    ctx.db.prepare('DELETE FROM cardio_logs WHERE id = ? AND user_id = ?').run(Number(ctx.body.id), uid);
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'cardio.removed_by_admin', uid, { id: ctx.body.id });
    return { ok: true };
  });

  route('GET', '/api/train/history', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const exById = new Map(loadExercises(ctx.db, { includeInactive: true }).map((e) => [e.id, e]));
    const rows = ctx.db.prepare('SELECT date, exercise_id, weight_kg, reps FROM set_logs WHERE user_id = ? ORDER BY date DESC').all(uid);
    const sessions = new Map();
    const best = new Map();
    for (const r of rows) {
      if (!sessions.has(r.date)) sessions.set(r.date, { date: r.date, sets: 0, volume: 0, ex: new Set() });
      const s = sessions.get(r.date);
      s.sets++; s.volume += r.weight_kg * r.reps; s.ex.add(r.exercise_id);
      const score = r.weight_kg > 0 ? e1rm(r.weight_kg, r.reps) : r.reps / 1000;
      const cur = best.get(r.exercise_id);
      if (!cur || score > cur.score) best.set(r.exercise_id, { exerciseId: r.exercise_id, name: exById.get(r.exercise_id)?.name ?? r.exercise_id, timed: Boolean(exById.get(r.exercise_id)?.timed), weightKg: r.weight_kg, reps: r.reps, e1rm: Math.round(e1rm(r.weight_kg, r.reps) * 10) / 10, date: r.date, score });
    }
    const checkins = new Map(ctx.db.prepare("SELECT date, status FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 60").all(uid).map((r) => [r.date, r.status]));
    const cardio = ctx.db.prepare('SELECT id, date, kind, minutes, distance_km distanceKm, avg_hr avgHr FROM cardio_logs WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 20').all(uid);
    const today = isDate(ctx.query.get('today')) ? ctx.query.get('today') : todayUtc();
    return {
      sessions: [...sessions.values()].slice(0, 30).map((s) => ({ date: s.date, sets: s.sets, exercises: s.ex.size, volume: Math.round(s.volume), checkin: checkins.get(s.date) ?? null })),
      records: [...best.values()].map(({ score, ...r }) => r).sort((a, b) => b.e1rm - a.e1rm || b.reps - a.reps),
      attendance: { last7: attendance(ctx.db, uid, addDays(today, -6), today), last28: attendance(ctx.db, uid, addDays(today, -27), today) },
      cardio,
      ...weekCompare(rows, exById, today),
    };
  });

  /**
   * This training week (Saturday to Friday, so far) against last week: sets, volume, sessions,
   * and hard sets per muscle. Weekly sets per muscle is what coaches use to judge volume.
   */
  function weekCompare(rows, exById, today) {
    const ws = weekStart(today);
    const lastFrom = addDays(ws, -7);
    const blank = () => ({ sets: 0, volume: 0, sessions: new Set() });
    const tw = blank(); const lw = blank();
    const muscles = new Map();
    for (const r of rows) {
      // Last week only up to the same weekday, so a Sunday is not compared with a whole week.
      const bucket = r.date >= ws && r.date <= today ? tw : r.date >= lastFrom && r.date <= addDays(today, -7) ? lw : null;
      if (!bucket) continue;
      bucket.sets++; bucket.volume += r.weight_kg * r.reps; bucket.sessions.add(r.date);
      const m = exById.get(r.exercise_id)?.muscle ?? 'other';
      if (!muscles.has(m)) muscles.set(m, { muscle: m, this: 0, last: 0 });
      muscles.get(m)[bucket === tw ? 'this' : 'last']++;
    }
    const out = (b) => ({ sets: b.sets, volume: Math.round(b.volume), sessions: b.sessions.size });
    return {
      week: { from: ws, this: out(tw), last: out(lw) },
      muscles: [...muscles.values()].sort((a, b) => b.this - a.this || b.last - a.last),
    };
  }

  // One exercise over time: per session the best set, estimated max and volume (oldest first, for a chart).
  route('GET', '/api/train/exercise/:id/history', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const ex = loadExercises(ctx.db, { includeInactive: true }).find((e) => e.id === ctx.params.id);
    if (!ex) throw notFound('No such exercise');
    const rows = ctx.db.prepare('SELECT date, set_no setNo, weight_kg weightKg, reps FROM set_logs WHERE user_id = ? AND exercise_id = ? ORDER BY date, set_no').all(uid, ex.id);
    const byDate = new Map();
    for (const r of rows) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r);
    }
    const sessions = [...byDate].map(([date, sets]) => {
      const top = sets.reduce((b, x) => ((x.weightKg > 0 ? e1rm(x.weightKg, x.reps) : x.reps / 1000) > (b.weightKg > 0 ? e1rm(b.weightKg, b.reps) : b.reps / 1000) ? x : b));
      return {
        date, sets: sets.map(({ weightKg, reps }) => ({ weightKg, reps })),
        best: { weightKg: top.weightKg, reps: top.reps }, e1rm: top.weightKg > 0 ? Math.round(e1rm(top.weightKg, top.reps) * 10) / 10 : null,
        volume: Math.round(sets.reduce((a, x) => a + x.weightKg * x.reps, 0)),
      };
    });
    return { exercise: { id: ex.id, name: ex.name, muscle: ex.muscle, equip: ex.equip, video: videoFor(ex), timed: Boolean(ex.timed) }, sessions: sessions.slice(-40) };
  });

  // ------------------------------------------------ gym check-ins (attendance)
  // A photo taken at the gym proves attendance and earns the check-in half of the day's training
  // points. It is approved straight away; admins can revoke a fake one (Admin > Gym check-ins), and
  // a photo that matches an earlier one is flagged to them.
  const notifyAdmins = (db, body) => {
    for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all()) {
      pushToUser(db, a.id, { title: 'FitCrew check-in', body, url: '/#/admin/checkins', tag: 'checkin' }).catch(() => {});
    }
  };

  route('POST', '/api/checkins', 'user', async (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const date = needDate(ctx.body.date);
    // Check-ins are for today only, in the crew's time zone (Admin > settings, Cairo by default).
    // A 3-hour margin either side covers phones set to a nearby time zone around midnight.
    const tz = getSetting(ctx.db, 'timezone', 'Africa/Cairo');
    const localDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
    const now = Date.now();
    const today = localDay(now);
    if (![today, localDay(now - 3 * 3600_000), localDay(now + 3 * 3600_000)].includes(date)) throw bad('You can only check in for today');
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.image ?? ''));
    if (!m) throw bad('Send the photo as a JPEG');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw bad('That file is not a valid JPEG');
    if (buf.length > 400_000) throw bad('That photo is too large');
    const prev = checkinOn(ctx.db, uid, date);
    if (prev?.status === 'approved') throw bad('You already checked in today');
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const ahash = /^[0-9a-f]{16}$/.test(ctx.body.ahash ?? '') ? ctx.body.ahash : null;
    const older = ctx.db.prepare('SELECT date, hash, ahash FROM checkins WHERE user_id = ? AND date <> ? ORDER BY date DESC LIMIT 90').all(uid, date);
    const repeat = older.find((o) => o.hash === hash || (ahash && o.ahash && hamming(ahash, o.ahash) <= 5));

    // Every check-in is approved at once (no image AI). A photo that matches an earlier one is
    // still approved but flagged, and the admins get a notification so they can revoke it.
    const status = 'approved';
    const verdict = repeat ? { by: 'rules', flag: true, reason: `Looks the same as the check-in on ${repeat.date}` } : { by: 'auto', reason: '' };
    ctx.db.prepare(`INSERT INTO checkins (user_id, date, status, image, hash, ahash, verdict, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status, image = excluded.image, hash = excluded.hash, ahash = excluded.ahash,
        verdict = excluded.verdict, reviewed_by = NULL, reviewed_at = excluded.reviewed_at, created_at = CURRENT_TIMESTAMP`)
      .run(uid, date, status, buf, hash, ahash, JSON.stringify(verdict), new Date().toISOString());
    // Keep the database small: check-in photos older than 60 days are dropped (the record stays).
    ctx.db.prepare('UPDATE checkins SET image = NULL WHERE user_id = ? AND date < ? AND image IS NOT NULL').run(uid, addDays(today, -60));
    const id = checkinOn(ctx.db, uid, date).id;
    audit(ctx.db, ctx.user.id, `checkin.${status}`, uid, { date, by: verdict.by, reason: verdict.reason });
    if (verdict.flag) {
      const who = ctx.db.prepare('SELECT name FROM users WHERE id = ?').get(uid)?.name ?? 'Someone';
      notifyAdmins(ctx.db, `${who}'s gym photo looks like an earlier one (${repeat.date}). Tap to check it.`);
    }
    checkinFeed(ctx.db, uid, date, status);
    return { ok: true, id, status, reason: verdict.reason ?? '' };
  });

  route('GET', '/api/checkins', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const days = Math.min(120, Math.max(1, Number(ctx.query.get('days') ?? 30)));
    const today = isDate(ctx.query.get('today')) ? ctx.query.get('today') : todayUtc();
    const rows = ctx.db.prepare('SELECT id, date, status, verdict, image IS NOT NULL hasPhoto FROM checkins WHERE user_id = ? AND date >= ? ORDER BY date DESC').all(uid, addDays(today, -(days - 1)));
    return { checkins: rows.map((r) => ({ id: r.id, date: r.date, status: r.status, hasPhoto: Boolean(r.hasPhoto), reason: r.verdict ? JSON.parse(r.verdict).reason ?? '' : '' })), attendance: attendance(ctx.db, uid, addDays(today, -(days - 1)), today) };
  });

  route('GET', '/api/checkins/:id/photo', 'user', (ctx) => {
    const row = ctx.db.prepare('SELECT id, user_id, image FROM checkins WHERE id = ?').get(Number(ctx.params.id));
    if (!row || !row.image || (row.user_id !== ctx.user.id && ctx.user.role !== 'admin')) throw notFound('Photo not found');
    return { __raw: Buffer.from(row.image), headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } };
  });

  route('GET', '/api/admin/checkins', 'admin', (ctx) => {
    const today = isDate(ctx.query.get('today')) ? ctx.query.get('today') : todayUtc();
    const map = (r) => ({ id: r.id, userId: r.user_id, name: r.name, date: r.date, status: r.status, hasPhoto: Boolean(r.hasPhoto), verdict: r.verdict ? JSON.parse(r.verdict) : null, reviewedAt: r.reviewed_at });
    const q = (where, ...args) => ctx.db.prepare(`SELECT c.id, c.user_id, u.name, c.date, c.status, c.verdict, c.reviewed_at, c.image IS NOT NULL hasPhoto FROM checkins c JOIN users u ON u.id = c.user_id WHERE ${where} ORDER BY c.date DESC, c.id DESC LIMIT 60`).all(...args).map(map);
    return { pending: q("c.status = 'pending'"), recent: q("c.status <> 'pending' AND c.date >= ?", addDays(today, -14)) };
  });

  route('POST', '/api/admin/checkins/:id/review', 'admin', (ctx) => {
    const row = ctx.db.prepare('SELECT * FROM checkins WHERE id = ?').get(Number(ctx.params.id));
    if (!row) throw notFound('Check-in not found');
    const status = oneOf(ctx.body.status, ['approved', 'rejected'], 'status');
    const v = row.verdict ? JSON.parse(row.verdict) : {};
    const reason = str(ctx.body.reason, 120, 'reason');
    ctx.db.prepare('UPDATE checkins SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, verdict = ? WHERE id = ?')
      .run(status, ctx.user.id, JSON.stringify({ ...v, admin: { status, reason, at: new Date().toISOString() }, reason: reason || v.reason || '' }), row.id);
    audit(ctx.db, ctx.user.id, `checkin.${status}_by_admin`, row.user_id, { date: row.date });
    checkinFeed(ctx.db, row.user_id, row.date, status);
    // Only tell the member when something changed for them (an admin "it is fine" is silent).
    if (status !== row.status) pushToUser(ctx.db, row.user_id, { title: 'FitCrew', body: status === 'approved' ? `Gym check-in for ${row.date} counts again. Points added back.` : `Gym check-in for ${row.date} was revoked by the admin${reason ? `: ${reason}` : ''}. The 15 points were removed.`, url: '/#/train', tag: 'checkin' }).catch(() => {});
    return { ok: true };
  });

  // Mark someone as attended without a photo (forgot the phone, camera broke...).
  route('POST', '/api/admin/users/:id/checkins', 'admin', (ctx) => {
    const uid = Number(ctx.params.id);
    if (!ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) throw notFound('User not found');
    const date = needDate(ctx.body.date);
    const status = oneOf(ctx.body.status ?? 'approved', ['approved', 'rejected'], 'status');
    ctx.db.prepare(`INSERT INTO checkins (user_id, date, status, verdict, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`)
      .run(uid, date, status, JSON.stringify({ by: 'admin', reason: 'Marked by the admin' }), ctx.user.id);
    audit(ctx.db, ctx.user.id, `checkin.marked_${status}`, uid, { date });
    checkinFeed(ctx.db, uid, date, status);
    return { ok: true };
  });

  // ------------------------------------------------ admin: plans
  const loadPlan = (ctx) => {
    const p = planRow(ctx.db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(Number(ctx.params.id)));
    if (!p) throw notFound('Workout plan not found');
    return p;
  };

  route('POST', '/api/admin/users/:id/workout-plans/generate', 'admin', async (ctx) => {
    const id = Number(ctx.params.id);
    const planId = await makePendingWorkoutPlan(ctx.db, id, str(ctx.body.note, 300, 'note') || 'Generated by admin');
    audit(ctx.db, ctx.user.id, 'workout_plan.generated', id, { planId });
    return { ok: true, planId };
  });

  route('GET', '/api/admin/workout-plans/:id', 'admin', (ctx) => {
    const p = loadPlan(ctx);
    const exById = new Map(loadExercises(ctx.db, { includeInactive: true }).map((e) => [e.id, e]));
    const pp = publicPlan(p, exById);
    return { plan: { ...pp, id: p.id, userId: p.user_id, version: p.version, status: p.status, startDate: p.start_date, note: p.note, cardio: p.data.cardio ?? null } };
  });

  route('PUT', '/api/admin/workout-plans/:id', 'admin', (ctx) => {
    const p = loadPlan(ctx);
    const exById = new Map(loadExercises(ctx.db, { includeInactive: true }).map((e) => [e.id, e]));
    const data = normalizeWorkout(ctx.body, p.data, exById);
    ctx.db.prepare('UPDATE workout_plans SET data = ? WHERE id = ?').run(JSON.stringify(data), p.id);
    audit(ctx.db, ctx.user.id, 'workout_plan.edited', p.user_id, { planId: p.id });
    return { ok: true };
  });

  route('POST', '/api/admin/workout-plans/:id/approve', 'admin', (ctx) => {
    const p = loadPlan(ctx);
    if (!['pending', 'archived'].includes(p.status)) throw bad(`A ${p.status} plan cannot be approved`);
    const start = ctx.body.startDate ? needDate(ctx.body.startDate, 'startDate') : todayUtc();
    ctx.db.exec('BEGIN');
    try {
      ctx.db.prepare("UPDATE workout_plans SET status = 'archived', end_date = ? WHERE user_id = ? AND status = 'active'").run(addDays(start, -1), p.user_id);
      ctx.db.prepare("UPDATE workout_plans SET status = 'active', start_date = ?, end_date = NULL, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?").run(start, ctx.user.id, p.id);
      ctx.db.exec('COMMIT');
    } catch (e) { ctx.db.exec('ROLLBACK'); throw e; }
    audit(ctx.db, ctx.user.id, 'workout_plan.approved', p.user_id, { planId: p.id, start });
    return { ok: true };
  });

  route('POST', '/api/admin/workout-plans/:id/reject', 'admin', (ctx) => {
    const p = loadPlan(ctx);
    if (p.status !== 'pending') throw bad('Only pending plans can be rejected');
    ctx.db.prepare("UPDATE workout_plans SET status = 'rejected' WHERE id = ?").run(p.id);
    audit(ctx.db, ctx.user.id, 'workout_plan.rejected', p.user_id, { planId: p.id });
    return { ok: true };
  });

  // Old plans can be deleted for good. The live plan cannot (publish another one first).
  route('DELETE', '/api/admin/workout-plans/:id', 'admin', (ctx) => {
    const p = loadPlan(ctx);
    if (p.status === 'active') throw bad('This plan is live. Publish another plan first, then delete this one.');
    ctx.db.prepare('DELETE FROM workout_plans WHERE id = ?').run(p.id);
    audit(ctx.db, ctx.user.id, 'workout_plan.deleted', p.user_id, { planId: p.id, version: p.version, status: p.status });
    return { ok: true };
  });

  // ------------------------------------------------ admin: exercise library
  const cleanExercise = (b, id) => ({
    id: id ?? `${str(b.name, 60, 'name', true).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Math.random().toString(16).slice(2, 6)}`,
    name: str(b.name, 80, 'name', true),
    muscle: oneOf(b.muscle, MUSCLES, 'muscle'),
    equip: oneOf(b.equip, ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'], 'equipment'),
    pattern: oneOf(b.pattern, PATTERNS, 'pattern'),
    inc: num(b.inc ?? 2.5, 0, 20, 'weight step'),
    timed: Boolean(b.timed),
    notes: str(b.notes, 300, 'notes'),
    video: (() => { const v = str(b.video, 300, 'video link'); if (v && !/^https:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com|vimeo\.com|drive\.google\.com)\//.test(v)) throw bad('Video must be a YouTube, Vimeo or Google Drive link'); return v; })(),
  });

  route('POST', '/api/admin/exercises', 'admin', (ctx) => {
    const e = cleanExercise(ctx.body);
    ctx.db.prepare('INSERT INTO exercises (id,name,muscle,equip,pattern,inc,timed,notes,video,custom) VALUES (?,?,?,?,?,?,?,?,?,1)').run(e.id, e.name, e.muscle, e.equip, e.pattern, e.inc, e.timed ? 1 : 0, e.notes, e.video);
    audit(ctx.db, ctx.user.id, 'exercise.created', null, { id: e.id });
    return { ok: true, id: e.id };
  });

  route('PUT', '/api/admin/exercises/:id', 'admin', (ctx) => {
    if (!ctx.db.prepare('SELECT 1 FROM exercises WHERE id = ?').get(ctx.params.id)) throw notFound('Exercise not found');
    const e = cleanExercise(ctx.body, ctx.params.id);
    ctx.db.prepare('UPDATE exercises SET name=?, muscle=?, equip=?, pattern=?, inc=?, timed=?, notes=?, video=?, edited=1 WHERE id = ?').run(e.name, e.muscle, e.equip, e.pattern, e.inc, e.timed ? 1 : 0, e.notes, e.video, e.id);
    audit(ctx.db, ctx.user.id, 'exercise.updated', null, { id: e.id });
    return { ok: true };
  });

  route('DELETE', '/api/admin/exercises/:id', 'admin', (ctx) => {
    ctx.db.prepare('UPDATE exercises SET active = 0 WHERE id = ?').run(ctx.params.id);
    audit(ctx.db, ctx.user.id, 'exercise.deactivated', null, { id: ctx.params.id });
    return { ok: true };
  });

  return { makePendingWorkoutPlan, cardioFor };
}
