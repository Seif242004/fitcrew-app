// Adherence scoring. A day is scored out of 100 (110 with the extra-session bonus):
//   20 calories within +/-10% of target (fades to 0 at +/-30%)       } from PLAN food only: planned
//   20 protein at or above 90% of target (fades to 0 at 60%)          } items eaten, adjusted or
//   20 meals matched: each meal's diet food vs that meal's plan       } swapped for another diet food,
//      (kcal, protein, carbs, fat), weighted by the meal's size       } plus diet foods added to a meal
//   10 logged on the same day
//   30 training: a gym check-in (attendance photo) earns all 30, on any day. Any training
//      counts (gym, CrossFit, a class, football), so logging sets or cardio is optional: it is
//      for records and PRs and earns nothing. A training day without a check-in earns 0.
//      Rest days earn the full 30 when the day is logged, for as many rest days a week as the
//      plan has (workout.restCounts = false on an extra rest day: 0). No workout plan: pass
//      workout = null and the rest is rescaled.
//  +10 extra session: a gym check-in on a planned rest day (workout.extraSession).
//  -   over target: when cutting or maintaining, eating more than the day's calories (ALL food,
//      extras and off-plan included) costs 1 point per % over, past a small margin (cut 5%,
//      maintain 10%), up to 30. Bulking has no penalty. The total never goes below 0.
// "Diet food" = planned items (eaten, adjusted, swapped for a diet food) and diet foods added to a
// meal (2 scrambled eggs, a slice of cheddar). Logging-only food (pizza, a latte, sweets, sauces)
// and custom entries never EARN points: someone who fills the day with other food lands near the
// calorie target without following the plan. They still count toward the over-target penalty.
// Days with no plan food logged score 0, so honest logging of the plan is the only way to rank well.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Allowed calories over target before points are lost, by goal. null = no penalty (bulk). */
export const OVER_MARGIN = { cut: 0.05, maintain: 0.10 };
export const OVER_MAX = 30;
export const EXTRA_SESSION_BONUS = 10;

/** Points lost for eating over target: 1 per % past the margin, capped. */
export function overPenalty(goal, kcal, target) {
  const margin = OVER_MARGIN[goal];
  if (margin === undefined || !target || kcal <= 0) return 0;
  const over = kcal / target - 1 - margin;
  return over > 0 ? Math.min(OVER_MAX, Math.round(over * 100)) : 0;
}

/** Weights of each macro in a meal match: protein matters most, then calories. */
export const MATCH_WEIGHTS = { p: 0.4, kcal: 0.3, c: 0.15, f: 0.15 };

/**
 * How well one meal matched its plan, 0..1. For each of kcal, protein, carbs and fat: full marks
 * within 10% of the planned amount, then 1% lost per 1% further off, in either direction (eating
 * half the planned protein scores 0.6 on protein; twice the planned carbs scores 0). A macro the
 * meal barely has (under 3 g, e.g. fat in a fruit snack) is left out so it cannot swing the score.
 */
export function mealMatch(planned, eaten) {
  if (!planned || !(planned.kcal > 0)) return null;
  if (!(eaten?.kcal > 0)) return 0; // nothing from the diet eaten in this meal
  let sum = 0; let weight = 0;
  for (const [k, w] of Object.entries(MATCH_WEIGHTS)) {
    const want = planned[k] ?? 0;
    if (k !== 'kcal' && want < 3) continue;
    const dev = Math.abs((eaten[k] ?? 0) / want - 1);
    sum += w * Math.min(1, Math.max(0, 1.1 - dev));
    weight += w;
  }
  return weight ? sum / weight : null;
}

/**
 * dayScore inputs: consumed = everything eaten; planConsumed = diet food only; meals (optional) =
 * [{ planned: {kcal,p,c,f}, eaten: {kcal,p,c,f} }] for the meal-match points (without it, the
 * share of planned items logged is used).
 */
export function dayScore({ targets, consumed, planConsumed = consumed, itemsTotal, itemsDone, meals = null, loggedSameDay, workout = null }) {
  const parts = { calories: 0, protein: 0, meals: 0, logging: 0, workout: 0, bonus: 0, over: 0 };
  // Earning starts with plan food: a day of only extras (a coffee, a pizza) earns nothing, not even
  // the rest-day or logging points. The over-target penalty looks at everything eaten.
  const anything = planConsumed.kcal > 0 || itemsDone > 0;
  if (consumed.kcal > 0) parts.over = -overPenalty(targets.goal, consumed.kcal, targets.kcal);
  if (anything) {
    const dev = Math.abs(1 - planConsumed.kcal / targets.kcal);
    parts.calories = planConsumed.kcal > 0 ? 20 * clamp(1 - Math.max(0, dev - 0.1) / 0.2, 0, 1) : 0;
    const under = Math.max(0, 0.9 - planConsumed.p / targets.proteinG);
    parts.protein = planConsumed.p > 0 ? 20 * clamp(1 - under / 0.3, 0, 1) : 0;
    if (meals?.length) {
      // Bigger meals count for more: lunch matters more than an apple at 4 pm.
      const total = meals.reduce((a, m) => a + (m.planned.kcal > 0 ? m.planned.kcal : 0), 0);
      parts.meals = total > 0 ? 20 * meals.reduce((a, m) => a + (mealMatch(m.planned, m.eaten) ?? 0) * Math.max(0, m.planned.kcal), 0) / total : 0;
    } else parts.meals = itemsTotal > 0 ? 20 * clamp(itemsDone / itemsTotal, 0, 1) : 0;
    parts.logging = loggedSameDay ? 10 : 0;
  }
  let total;
  if (workout === null) {
    total = ((parts.calories + parts.protein + parts.meals + parts.logging) / 70) * 100 + parts.over;
  } else {
    if (workout.checkin === 'approved') parts.workout = 30; // trained (and proved it): full marks, any day
    else if (!workout.planned) parts.workout = anything && workout.restCounts !== false ? 30 : 0; // rest day: no free points for an empty day
    else parts.workout = 0; // a training day without a check-in
    if (workout.checkin === 'approved' && workout.extraSession) parts.bonus = EXTRA_SESSION_BONUS;
    total = parts.calories + parts.protein + parts.meals + parts.logging + parts.workout + parts.bonus + parts.over;
  }
  return { total: Math.max(0, Math.round(total)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])) };
}

/** Consecutive days with a score >= threshold. scores: array of {date, total}, any order. */
export function streak(scores, todayStr, threshold = 70) {
  const byDate = new Map(scores.map((s) => [s.date, s.total]));
  const step = (str, n) => {
    const d = new Date(`${str}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let cursor = (byDate.get(todayStr) ?? 0) >= threshold ? todayStr : step(todayStr, -1);
  let n = 0;
  while ((byDate.get(cursor) ?? 0) >= threshold) {
    n++;
    cursor = step(cursor, -1);
  }
  return n;
}
