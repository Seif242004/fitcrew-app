// AI admin: reviews every new diet / workout plan and approves it automatically when it passes
// hard safety and quality rules. Anything that fails goes to the human admin with the reasons.
//
// The rules are deterministic on purpose: they are what makes auto-approval safe. (An LLM may
// write the menu, but it never decides whether a plan is safe to follow.)

import { getSetting } from './db.js';
import { loadFoods } from './db.js';
import { filterFoods, portionOf, dayLogicIssues } from './plan.js';
import { SPLITS, INTENSITY } from './workout.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export const autoApproveOn = (db) => getSetting(db, 'aiAutoApprove', true);

/** Activates a plan (diet: table 'plans'; training: 'workout_plans'). approverId null = the AI. */
export function activatePlan(db, table, planId, approverId = null, start = todayUtc()) {
  const p = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(planId);
  if (!p) throw new Error('plan not found');
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE ${table} SET status = 'archived', end_date = ? WHERE user_id = ? AND status = 'active'`).run(addDays(start, -1), p.user_id);
    db.prepare(`UPDATE ${table} SET status = 'active', start_date = ?, end_date = NULL, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(start, approverId, planId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Hard rules for a diet plan. Returns a list of human-readable problems (empty = safe). */
export function dietPlanIssues(db, plan, profile, targets) {
  const issues = [];
  const prefs = profile?.prefs ?? {};
  const allFoods = loadFoods(db, { includeInactive: true });
  const all = new Map(allFoods.map((f) => [f.id, f]));
  const pool = new Map(filterFoods(allFoods, prefs).map((f) => [f.id, f]));
  const floor = profile?.sex === 'female' ? 1200 : 1500;
  if (!plan.days?.length) issues.push('The plan has no days.');
  for (const [di, d] of (plan.days ?? []).entries()) {
    const label = plan.days.length > 1 ? `Day ${di + 1}: ` : '';
    if (d.meals.length < 2 || d.meals.length > 6) issues.push(`${label}${d.meals.length} meals is outside 2-6.`);
    const t = d.totals ?? { kcal: 0, p: 0 };
    if (t.kcal < floor) issues.push(`${label}${t.kcal} kcal is below the ${floor} kcal safety floor.`);
    if (Math.abs(t.kcal - targets.kcal) > targets.kcal * 0.07) issues.push(`${label}${t.kcal} kcal is more than 7% away from the ${targets.kcal} kcal target.`);
    if (t.p < targets.proteinG * 0.9) issues.push(`${label}protein ${t.p} g is under 90% of the ${targets.proteinG} g target.`);
    // Would a normal person eat this day? (one cooked dish, light dinner, breakfast foods at breakfast...)
    for (const x of dayLogicIssues(d, all)) issues.push(`${label}${x}`);
    for (const m of d.meals) {
      if (!m.items.length || m.items.length > 7) issues.push(`${label}${m.name} has ${m.items.length} items.`);
      for (const it of m.items) {
        const f = pool.get(it.foodId);
        if (!f) { issues.push(`${label}${it.name} is excluded for this person or no longer exists.`); continue; }
        const { max } = portionOf(f);
        if (!(it.grams > 0) || it.grams > max * 1.6) issues.push(`${label}${it.name} ${it.grams} g is not a realistic portion.`);
      }
    }
  }
  for (const w of plan.warnings ?? []) issues.push(w);
  return issues;
}

/**
 * Hard rules for a training plan. Injuries always go to a human. Also checks the split the AI
 * picked fits the person's days, sessions stay inside the intensity's volume, and no muscle gets an
 * unrecoverable number of weekly sets.
 */
export function workoutPlanIssues(plan, profile) {
  const issues = [];
  if (!plan.days?.length) issues.push('The training plan has no days.');
  const wanted = Math.min(6, Math.max(2, Math.round(profile?.daysPerWeek ?? plan.days?.length ?? 3)));
  if (plan.days?.length && plan.days.length !== wanted) issues.push(`The plan has ${plan.days.length} sessions but ${wanted} were asked for.`);
  const pick = plan.splitChoice?.id;
  if (pick && pick !== 'auto' && SPLITS[pick] && !SPLITS[pick].days.includes(plan.days?.length)) issues.push(`${SPLITS[pick].name} does not run on ${plan.days.length} days a week.`);
  const budget = (INTENSITY[plan.intensity] ?? INTENSITY.moderate).maxSets + 4; // focus areas may add a set or two
  const weekly = new Map();
  for (const d of plan.days ?? []) {
    const total = d.exercises.reduce((a, e) => a + e.sets, 0);
    if (total > budget) issues.push(`${d.name}: ${total} sets is too much for a ${plan.intensity ?? 'moderate'} session.`);
    for (const e of d.exercises) weekly.set(e.muscle, (weekly.get(e.muscle) ?? 0) + e.sets);
  }
  for (const [m, n] of weekly) if (n > 30) issues.push(`${n} hard sets a week for ${m} is more than anyone can recover from.`);
  if (profile?.injuries?.trim()) issues.push(`Injury noted ("${profile.injuries.trim().slice(0, 80)}"): a person should check the exercise choices.`);
  for (const d of plan.days ?? []) {
    if (d.exercises.length < 2 || d.exercises.length > 10) issues.push(`${d.name}: ${d.exercises.length} exercises is outside 2-10.`);
    for (const e of d.exercises) if (e.sets < 1 || e.sets > 6) issues.push(`${d.name}: ${e.name} has ${e.sets} sets.`);
  }
  return issues;
}

/**
 * Review a freshly saved pending plan. Approves it (as the AI) when it passes and auto-approval
 * is on; otherwise leaves it pending with the reasons stored for the admin.
 * Returns { status: 'active' | 'pending', issues }.
 */
export function autoReview(db, table, planId) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(planId);
  if (!row || row.status !== 'pending') return { status: row?.status ?? 'missing', issues: [] };
  const prof = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(row.user_id);
  const profile = prof ? JSON.parse(prof.data) : null;
  const data = JSON.parse(row.data);
  const targets = prof ? { ...JSON.parse(prof.targets), ...(prof.targets_override ? JSON.parse(prof.targets_override) : {}) } : null;
  const issues = table === 'plans' ? dietPlanIssues(db, data, profile, targets ?? data.targets) : workoutPlanIssues(data, profile);
  data.review = { by: 'ai', at: new Date().toISOString(), issues };
  db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(data), planId);
  const action = table === 'plans' ? 'plan' : 'workout_plan';
  if (!issues.length && autoApproveOn(db)) {
    activatePlan(db, table, planId, null);
    db.prepare('INSERT INTO audit (actor_id, action, target_user_id, detail) VALUES (NULL, ?, ?, ?)').run(`${action}.auto_approved`, row.user_id, JSON.stringify({ planId }));
    return { status: 'active', issues };
  }
  db.prepare('INSERT INTO audit (actor_id, action, target_user_id, detail) VALUES (NULL, ?, ?, ?)').run(`${action}.sent_to_admin`, row.user_id, JSON.stringify({ planId, issues }));
  return { status: 'pending', issues };
}
