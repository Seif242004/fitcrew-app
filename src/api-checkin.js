// Adaptive weekly check-in routes. The maths lives in adaptive.js; this file reads a person's
// food logs and weigh-ins, stores one check-in per week (diet_checkins) and applies a change the
// person accepted:
//   1. new targets: maintenance moves by the accepted step (kept as an offset to the formula,
//      tdeeAdjust) and the profile weight becomes the trend weight
//   2. the SAME plan is re-sized to the new targets (same foods, portions nudged by the solver,
//      like a dietitian changing "rice 80 g" to "rice 70 g"); only if that cannot hit the
//      targets is a new menu drafted
//   3. the plan goes through the usual review (auto-approved when it passes the safety rules)
// Seif's manual targets (targets_override) always win: check-ins are off for that person.

import { weeklyCheckin, checkinWeek, checkinOpenOn, RULES } from './adaptive.js';
import { rebalanceDay, itemFor, totalsOf } from './plan.js';
import { describeAmount } from './exchange.js';
import { loadFoods } from './db.js';

const STORED = new Set(['proposed', 'on_track', 'hold']); // outcomes worth keeping for the week

export function registerCheckin(c) {
  const { route, bad, needDate, isDate, subjectId, audit, todayUtc, addDays, activePlan, savePendingPlan, makePendingPlan, targetsFor, effectiveTargets } = c;

  const profileOf = (db, uid) => db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const rowView = (r) => ({ ...JSON.parse(r.data), status: r.status, result: r.result ? JSON.parse(r.result) : null, decidedAt: r.decided_at });

  /** Everything adaptive.js needs for one person and check-in week (weigh-ins up to `asOf`). */
  function inputs(db, uid, prof, week, asOf) {
    const from = addDays(week, -RULES.window);
    const intake = db.prepare(`SELECT date, SUM(kcal) kcal FROM logs WHERE user_id = ? AND status != 'skipped' AND date >= ? AND date < ? GROUP BY date`).all(uid, from, week);
    const weighIns = db.prepare('SELECT date, weight_kg kg FROM body_metrics WHERE user_id = ? AND weight_kg IS NOT NULL AND date >= ? AND date <= ? ORDER BY date').all(uid, addDays(asOf, -180), asOf); // 180 days: the trend only needs recent weigh-ins (old ones fade out of the EMA)
    const since = db.prepare("SELECT MIN(start_date) d FROM plans WHERE user_id = ? AND status IN ('active','archived')").get(uid)?.d ?? null;
    return { week, targets: JSON.parse(prof.targets), profile: JSON.parse(prof.data), intake, weighIns, since, asOf };
  }

  /**
   * This week's check-in for a person, computed on first look (Friday to Sunday) and stored if
   * it has an outcome. status: open | accepted | kept | dismissed (stored), live (needs a
   * weigh-in or more data, recomputed each time), off (no plan, or Seif's manual targets),
   * closed (Monday to Thursday with nothing open).
   */
  function checkinFor(db, uid, today) {
    const week = checkinWeek(today);
    const prof = profileOf(db, uid);
    if (!prof || !activePlan(db, uid)) return { status: 'off', reason: 'plan', week };
    if (prof.targets_override) return { status: 'off', reason: 'override', week };
    let row = db.prepare('SELECT * FROM diet_checkins WHERE user_id = ? AND week = ?').get(uid, week);
    // A proposal made for other targets (goal or profile changed since Friday) is retired, never
    // applied on top of the new ones; next Friday's check-in starts from the new targets.
    if (row && row.status === 'open' && JSON.parse(row.data).kcal.from !== JSON.parse(prof.targets).kcal) {
      db.prepare("UPDATE diet_checkins SET status = 'kept', decided_at = CURRENT_TIMESTAMP WHERE user_id = ? AND week = ?").run(uid, week);
      row = db.prepare('SELECT * FROM diet_checkins WHERE user_id = ? AND week = ?').get(uid, week);
    }
    if (row) return rowView(row);
    if (!checkinOpenOn(today)) return { status: 'closed', week, next: addDays(week, 7) };
    // Weigh-ins up to today count (the Friday weigh-in is usually done that morning).
    const r = weeklyCheckin(inputs(db, uid, prof, week, today));
    if (!STORED.has(r.kind)) return { ...r, status: 'live' };
    db.prepare("INSERT OR IGNORE INTO diet_checkins (user_id, week, status, data) VALUES (?, ?, 'open', ?)").run(uid, week, JSON.stringify(r));
    return rowView(db.prepare('SELECT * FROM diet_checkins WHERE user_id = ? AND week = ?').get(uid, week));
  }

  /**
   * Re-size every day of a plan to new targets, keeping the foods. Returns the new plan data and
   * the portion changes of the first day, or null when the old foods cannot reach the targets.
   * oldTargets: the targets before the change (protein foods stay put if protein did not move).
   */
  function resizePlan(db, plan, targets, oldTargets) {
    const foodsById = new Map(loadFoods(db, { includeInactive: true }).map((f) => [f.id, f]));
    // Dietitian logic: a calorie change comes out of (or goes into) rice, bread, pasta, oil,
    // fruit and extras. Vegetables never move, and protein foods stay put while the protein
    // target is unchanged. If that cannot reach the targets, only vegetables stay locked.
    const proteinSame = Math.abs(targets.proteinG - (oldTargets.proteinG ?? targets.proteinG)) < 10;
    const lockCats = proteinSame ? new Set(['veg', 'protein', 'dairy', 'legume']) : new Set(['veg']);
    const direction = Math.sign(targets.kcal - (oldTargets.kcal ?? targets.kcal)); // less food: only shrink portions
    return resizeWith(plan, targets, foodsById, lockCats, direction) ?? (proteinSame ? resizeWith(plan, targets, foodsById, new Set(['veg']), direction) : null);
  }

  function resizeWith(plan, targets, foodsById, lockCats, direction) {
    const changes = [];
    const days = plan.data.days.map((d, di) => {
      const fixed = new Set();
      d.meals.forEach((m, mi) => m.items.forEach((it, ii) => { if (lockCats.has(foodsById.get(it.foodId)?.cat)) fixed.add(`${mi}-${ii}`); }));
      const { grams } = rebalanceDay({ meals: d.meals, foodsById, targets, fixed, direction });
      const meals = d.meals.map((m, mi) => {
        const items = m.items.map((it, ii) => {
          const f = foodsById.get(it.foodId);
          // Items are never dropped (logs point at items by position); a portion only changes size.
          const solved = grams.get(`${mi}-${ii}`);
          const g = solved > 0 ? solved : it.grams;
          if (!f) return it;
          if (di === 0 && g !== it.grams) changes.push({ name: it.name, from: describeAmount(f, it.grams), to: describeAmount(f, g) });
          return itemFor(f, g);
        });
        return { ...m, items, totals: totalsOf(items) };
      });
      return { ...d, meals, totals: totalsOf(meals.flatMap((m) => m.items)) };
    });
    // Same bar as the plan generator: within 5% of the calories and at least 90% of the protein.
    const fits = days.every((d) => Math.abs(d.totals.kcal - targets.kcal) <= targets.kcal * 0.05 && d.totals.p >= targets.proteinG * 0.9);
    if (!fits) return null;
    const avg = (k) => Math.round(days.reduce((a, d) => a + d.totals[k], 0) / days.length);
    const { review, ...rest } = plan.data; // the new version gets its own review
    return { data: { ...rest, targets, days, summary: { kcal: avg('kcal'), p: avg('p'), c: avg('c'), f: avg('f') }, warnings: [] }, changes };
  }

  /** Apply an accepted proposal: new targets, re-sized plan, review. Returns what changed. */
  function applyCheckin(db, uid, data) {
    const prof = profileOf(db, uid);
    const pdata = JSON.parse(prof.data);
    const old = JSON.parse(prof.targets);
    const next = { ...pdata, weightKg: data.trendKg ?? pdata.weightKg };
    // New maintenance = old maintenance + accepted step, stored as an offset to the formula for
    // the (possibly new) weight, so a later profile edit still moves it the right way.
    const formulaNow = targetsFor(next, 0).tdeeFormula;
    const lim = formulaNow * RULES.maxAdjust;
    const step = data.kcal.to - data.kcal.from;
    const adj = Math.max(-lim, Math.min(lim, (old.tdeeFormula ?? old.tdee) + (old.tdeeAdjust ?? 0) + step - formulaNow));
    const targets = targetsFor(next, adj);
    db.prepare('UPDATE profiles SET data = ?, targets = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(JSON.stringify(next), JSON.stringify(targets), uid);

    const t = effectiveTargets(profileOf(db, uid));
    const plan = activePlan(db, uid);
    const note = `Weekly check-in: ${data.kcal.from.toLocaleString('en-US')} → ${t.kcal.toLocaleString('en-US')} kcal`;
    let planId = null; let changes = []; let newMenu = false;
    if (plan) {
      const resized = resizePlan(db, plan, { kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG }, old);
      if (resized) { planId = savePendingPlan(db, uid, resized.data, note); changes = resized.changes; }
      else { planId = makePendingPlan(db, uid, note); newMenu = true; }
    }
    const planStatus = planId ? db.prepare('SELECT status FROM plans WHERE id = ?').get(planId)?.status ?? null : null;
    return { kcal: { from: data.kcal.from, to: t.kcal }, macros: { p: t.proteinG, c: t.carbsG, f: t.fatG }, maintenance: t.tdee, planId, planStatus, changes, newMenu };
  }

  route('GET', '/api/checkin/weekly', 'user', (ctx) => {
    const uid = subjectId(ctx);
    const today = needDate(ctx.query.get('today') ?? todayUtc(), 'today');
    return { checkin: checkinFor(ctx.db, uid, today) };
  });

  // answer: accept (apply the proposed change) | keep (keep the current plan) | dismiss (hide an
  // on-track or hold note). Only this week's open check-in can be answered.
  route('POST', '/api/checkin/weekly/answer', 'user', (ctx) => {
    const uid = subjectId(ctx, ctx.body);
    const today = isDate(ctx.body.today) ? ctx.body.today : todayUtc();
    const answer = ctx.body.answer;
    if (!['accept', 'keep', 'dismiss'].includes(answer)) throw bad('answer must be accept, keep or dismiss');
    const cur = checkinFor(ctx.db, uid, today);
    if (cur.status === 'off' && cur.reason === 'override') throw bad('Seif set your targets by hand, so weekly check-ins are off for you.');
    if (cur.status !== 'open') throw bad(cur.status === 'accepted' || cur.status === 'kept' ? 'This week\'s check-in is already answered.' : 'There is no check-in to answer right now.');
    if (answer === 'accept' && cur.kind !== 'proposed') throw bad('This check-in has no change to apply.');
    let result = null;
    let status = answer === 'accept' ? 'accepted' : answer === 'keep' ? 'kept' : 'dismissed';
    if (answer === 'accept') result = applyCheckin(ctx.db, uid, cur);
    if (answer === 'dismiss' && cur.kind === 'proposed') status = 'kept';
    ctx.db.prepare('UPDATE diet_checkins SET status = ?, result = ?, decided_at = CURRENT_TIMESTAMP WHERE user_id = ? AND week = ?').run(status, result ? JSON.stringify(result) : null, uid, cur.week);
    audit(ctx.db, ctx.user.id, `checkin.${status}`, uid, { week: cur.week, kcal: result?.kcal ?? cur.kcal });
    return { ok: true, checkin: checkinFor(ctx.db, uid, today) };
  });

  return { checkinFor };
}
