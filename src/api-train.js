// Training endpoints: workout plans, set and cardio logging, history and records.
import { loadExercises } from './db.js';
import { generateWorkoutPlan, nextTarget, e1rm } from './workout.js';

const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const planRow = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);

export const activeWorkoutPlan = (db, uid) =>
  planRow(db.prepare("SELECT * FROM workout_plans WHERE user_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(uid));
export const workoutPlanForDate = (db, uid, date) =>
  planRow(db.prepare("SELECT * FROM workout_plans WHERE user_id = ? AND status IN ('active','archived') AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY version DESC LIMIT 1").get(uid, date, date));

/**
 * Used by the adherence score. null when the person has no workout plan for that date.
 * A planned session counts as done once at least half of its planned sets are logged.
 */
export function workoutState(db, uid, date) {
  const plan = workoutPlanForDate(db, uid, date);
  if (!plan) return null;
  const day = plan.data.days.find((d) => d.weekday === weekdayOf(date));
  if (!day) return { planned: false, done: false };
  const plannedSets = day.exercises.reduce((a, e) => a + e.sets, 0);
  const logged = db.prepare('SELECT COUNT(*) n FROM set_logs WHERE user_id = ? AND date = ?').get(uid, date).n;
  return { planned: true, done: plannedSets > 0 && logged >= Math.ceil(plannedSets / 2) };
}

const lastSession = (db, uid, exId, date) => {
  const rows = db.prepare('SELECT date, set_no, weight_kg, reps FROM set_logs WHERE user_id = ? AND exercise_id = ? AND date < ? ORDER BY date DESC, set_no LIMIT 40').all(uid, exId, date);
  if (!rows.length) return null;
  const d = rows[0].date;
  return { date: d, sets: rows.filter((r) => r.date === d).map((r) => ({ setNo: r.set_no, weightKg: r.weight_kg, reps: r.reps })) };
};

const WEEK_ORDER = (wd) => (wd + 1) % 7; // Saturday first

export function registerTrain(c) {
  const { route, bad, notFound, num, optNum, oneOf, str, needDate, isDate, subjectId, audit, addDays, todayUtc } = c;

  function normalizeWorkout(body, base, exById) {
    const days = body.days;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7) throw bad('A workout plan needs 1 to 7 sessions');
    const seen = new Set();
    const out = days.map((d) => {
      const weekday = Math.round(num(d.weekday, 0, 6, 'weekday'));
      if (seen.has(weekday)) throw bad('Two sessions fall on the same weekday');
      seen.add(weekday);
      if (!Array.isArray(d.exercises) || d.exercises.length > 14) throw bad('A session can have up to 14 exercises');
      return {
        weekday,
        name: str(d.name, 40, 'session name', true),
        exercises: d.exercises.map((e) => {
          const ex = exById.get(e.exerciseId);
          if (!ex) throw bad('Unknown exercise');
          const repMin = Math.round(num(e.repMin, 1, 200, 'min reps'));
          const repMax = Math.round(num(e.repMax, 1, 300, 'max reps'));
          if (repMax < repMin) throw bad('Max reps must be at least min reps');
          return { exerciseId: ex.id, name: ex.name, muscle: ex.muscle, sets: Math.round(num(e.sets, 1, 10, 'sets')), repMin, repMax, restSec: Math.round(num(e.restSec ?? 90, 15, 600, 'rest seconds')) };
        }),
      };
    }).sort((a, b) => WEEK_ORDER(a.weekday) - WEEK_ORDER(b.weekday));
    return { ...base, days: out, daysPerWeek: out.length };
  }

  function makePendingWorkoutPlan(db, uid, note = null) {
    const prof = db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(uid);
    if (!prof) throw bad('This user has not completed their profile yet');
    const plan = generateWorkoutPlan({ profile: JSON.parse(prof.data), exercises: loadExercises(db) });
    db.prepare("UPDATE workout_plans SET status = 'rejected' WHERE user_id = ? AND status = 'pending'").run(uid);
    const version = (db.prepare('SELECT MAX(version) v FROM workout_plans WHERE user_id = ?').get(uid).v ?? 0) + 1;
    const r = db.prepare("INSERT INTO workout_plans (user_id, version, status, data, note) VALUES (?, ?, 'pending', ?, ?)").run(uid, version, JSON.stringify(plan), note);
    return Number(r.lastInsertRowid);
  }

  route('GET', '/api/exercises', 'user', (ctx) => {
    const q = (ctx.query.get('q') ?? '').toLowerCase();
    return { exercises: loadExercises(ctx.db).filter((e) => !q || e.name.toLowerCase().includes(q) || e.muscle.includes(q)).slice(0, 120) };
  });

  route('GET', '/api/workout-plan', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const plan = activeWorkoutPlan(ctx.db, uid);
    const pending = ctx.db.prepare("SELECT id FROM workout_plans WHERE user_id = ? AND status = 'pending'").get(uid);
    return { plan: plan ? { id: plan.id, version: plan.version, startDate: plan.start_date, ...plan.data } : null, hasPending: Boolean(pending) };
  });

  route('GET', '/api/train', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const date = needDate(ctx.query.get('date'));
    const plan = workoutPlanForDate(ctx.db, uid, date);
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
      const target = last ? nextTarget({ lastSets: last.sets, repMin: p?.repMin ?? 6, repMax: p?.repMax ?? 12, inc: ex?.inc ?? 2.5 }) : null;
      return { exerciseId: id, name: ex?.name ?? id, muscle: ex?.muscle ?? '', notes: ex?.notes ?? '', timed: ex?.timed ?? false, plan: p && { sets: p.sets, repMin: p.repMin, repMax: p.repMax, restSec: p.restSec }, sets: byEx.get(id) ?? [], last, target };
    });
    const cardio = ctx.db.prepare('SELECT id, kind, minutes, distance_km distanceKm, avg_hr avgHr, notes FROM cardio_logs WHERE user_id = ? AND date = ? ORDER BY id').all(uid, date);
    return { date, hasPlan: Boolean(plan), hasPending: pending, dayName: day?.name ?? null, restDay: Boolean(plan) && !day, blocks, cardio, state: workoutState(ctx.db, uid, date) };
  });

  route('POST', '/api/train/set', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const date = needDate(ctx.body.date);
    const loggedOn = isDate(ctx.body.today) ? ctx.body.today : date;
    const exId = str(ctx.body.exerciseId, 60, 'exercise', true);
    if (!ctx.db.prepare('SELECT 1 FROM exercises WHERE id = ?').get(exId)) throw bad('Unknown exercise');
    const setNo = Math.round(num(ctx.body.setNo, 1, 20, 'set number'));
    const weightKg = num(ctx.body.weightKg ?? 0, 0, 600, 'weight');
    const reps = Math.round(num(ctx.body.reps, 1, 500, 'reps'));
    const rpe = optNum(ctx.body.rpe, 1, 10, 'rpe');
    const prev = ctx.db.prepare('SELECT weight_kg, reps FROM set_logs WHERE user_id = ? AND exercise_id = ? AND NOT (date = ? AND set_no = ?)').all(uid, exId, date, setNo);
    const prevBest = Math.max(0, ...prev.map((r) => e1rm(r.weight_kg, r.reps)));
    const now = e1rm(weightKg, reps);
    ctx.db.prepare(`INSERT INTO set_logs (user_id, date, exercise_id, set_no, weight_kg, reps, rpe, logged_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, date, exercise_id, set_no) DO UPDATE SET weight_kg = excluded.weight_kg, reps = excluded.reps, rpe = excluded.rpe, logged_on = excluded.logged_on`)
      .run(uid, date, exId, setNo, weightKg, reps, rpe ?? null, loggedOn);
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'set.edited_by_admin', uid, { date, exId, setNo });
    return { ok: true, pr: prevBest > 0 && now > prevBest + 1e-9, e1rm: Math.round(now * 10) / 10 };
  });

  route('POST', '/api/train/set/remove', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    ctx.db.prepare('DELETE FROM set_logs WHERE user_id = ? AND date = ? AND exercise_id = ? AND set_no = ?')
      .run(uid, needDate(ctx.body.date), str(ctx.body.exerciseId, 60, 'exercise', true), Math.round(num(ctx.body.setNo, 1, 20, 'set number')));
    if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'set.removed_by_admin', uid, { date: ctx.body.date, exId: ctx.body.exerciseId });
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
      if (!cur || score > cur.score) best.set(r.exercise_id, { exerciseId: r.exercise_id, name: exById.get(r.exercise_id)?.name ?? r.exercise_id, weightKg: r.weight_kg, reps: r.reps, e1rm: Math.round(e1rm(r.weight_kg, r.reps) * 10) / 10, date: r.date, score });
    }
    const cardio = ctx.db.prepare('SELECT id, date, kind, minutes, distance_km distanceKm, avg_hr avgHr FROM cardio_logs WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 20').all(uid);
    return {
      sessions: [...sessions.values()].slice(0, 30).map((s) => ({ date: s.date, sets: s.sets, exercises: s.ex.size, volume: Math.round(s.volume) })),
      records: [...best.values()].map(({ score, ...r }) => r).sort((a, b) => b.e1rm - a.e1rm || b.reps - a.reps),
      cardio,
    };
  });

  // ------------------------------------------------ admin
  const loadPlan = (ctx) => {
    const p = planRow(ctx.db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(Number(ctx.params.id)));
    if (!p) throw notFound('Workout plan not found');
    return p;
  };

  route('POST', '/api/admin/users/:id/workout-plans/generate', 'admin', (ctx) => {
    const id = Number(ctx.params.id);
    const planId = makePendingWorkoutPlan(ctx.db, id, str(ctx.body.note, 300, 'note') || 'Generated by admin');
    audit(ctx.db, ctx.user.id, 'workout_plan.generated', id, { planId });
    return { ok: true, planId };
  });

  route('GET', '/api/admin/workout-plans/:id', 'admin', (ctx) => {
    const p = loadPlan(ctx);
    return { plan: { id: p.id, userId: p.user_id, version: p.version, status: p.status, startDate: p.start_date, note: p.note, ...p.data } };
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

  const cleanExercise = (b, id) => ({
    id: id ?? `${str(b.name, 60, 'name', true).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Math.random().toString(16).slice(2, 6)}`,
    name: str(b.name, 80, 'name', true),
    muscle: oneOf(b.muscle, ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps', 'calves', 'core'], 'muscle'),
    equip: oneOf(b.equip, ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'], 'equipment'),
    pattern: oneOf(b.pattern, ['squat', 'hinge', 'lunge', 'glute', 'hpush', 'vpush', 'hpull', 'vpull', 'quad', 'ham', 'calf', 'bicep', 'tricep', 'sidedelt', 'reardelt', 'fly', 'core'], 'pattern'),
    inc: num(b.inc ?? 2.5, 0, 20, 'weight step'),
    timed: Boolean(b.timed),
    notes: str(b.notes, 300, 'notes'),
  });

  route('POST', '/api/admin/exercises', 'admin', (ctx) => {
    const e = cleanExercise(ctx.body);
    ctx.db.prepare('INSERT INTO exercises (id,name,muscle,equip,pattern,inc,timed,notes,custom) VALUES (?,?,?,?,?,?,?,?,1)').run(e.id, e.name, e.muscle, e.equip, e.pattern, e.inc, e.timed ? 1 : 0, e.notes);
    audit(ctx.db, ctx.user.id, 'exercise.created', null, { id: e.id });
    return { ok: true, id: e.id };
  });

  route('PUT', '/api/admin/exercises/:id', 'admin', (ctx) => {
    if (!ctx.db.prepare('SELECT 1 FROM exercises WHERE id = ?').get(ctx.params.id)) throw notFound('Exercise not found');
    const e = cleanExercise(ctx.body, ctx.params.id);
    ctx.db.prepare('UPDATE exercises SET name=?, muscle=?, equip=?, pattern=?, inc=?, timed=?, notes=? WHERE id = ?').run(e.name, e.muscle, e.equip, e.pattern, e.inc, e.timed ? 1 : 0, e.notes, e.id);
    audit(ctx.db, ctx.user.id, 'exercise.updated', null, { id: e.id });
    return { ok: true };
  });

  route('DELETE', '/api/admin/exercises/:id', 'admin', (ctx) => {
    ctx.db.prepare('UPDATE exercises SET active = 0 WHERE id = ?').run(ctx.params.id);
    audit(ctx.db, ctx.user.id, 'exercise.deactivated', null, { id: ctx.params.id });
    return { ok: true };
  });

  return { makePendingWorkoutPlan };
}
