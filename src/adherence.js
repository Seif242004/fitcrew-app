// Adherence scoring. A day is scored out of 100:
//   20 calories within +/-10% of target (fades to 0 at +/-30%)
//   20 protein at or above 90% of target (fades to 0 at 60%)
//   20 planned items eaten, adjusted or swapped
//   10 logged on the same day
//   30 training on a planned day: 15 for an approved gym check-in (attendance photo)
//      + 15 x the share of planned sets ticked off. Rest days earn the full 30 when the
//      day is logged. No workout plan: pass workout = null and the rest is rescaled.
// Days with nothing logged score 0, so honest logging is the only way to rank well.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function dayScore({ targets, consumed, itemsTotal, itemsDone, loggedSameDay, workout = null }) {
  const parts = { calories: 0, protein: 0, meals: 0, logging: 0, workout: 0 };
  const anything = consumed.kcal > 0 || itemsDone > 0;
  if (anything) {
    const dev = Math.abs(1 - consumed.kcal / targets.kcal);
    parts.calories = 20 * clamp(1 - Math.max(0, dev - 0.1) / 0.2, 0, 1);
    const under = Math.max(0, 0.9 - consumed.p / targets.proteinG);
    parts.protein = consumed.p > 0 ? 20 * clamp(1 - under / 0.3, 0, 1) : 0;
    parts.meals = itemsTotal > 0 ? 20 * clamp(itemsDone / itemsTotal, 0, 1) : 0;
    parts.logging = loggedSameDay ? 10 : 0;
  }
  let total;
  if (workout === null) {
    total = ((parts.calories + parts.protein + parts.meals + parts.logging) / 70) * 100;
  } else {
    if (!workout.planned) parts.workout = anything ? 30 : 0; // rest day: no free points for an empty day
    else parts.workout = (workout.checkin === 'approved' ? 15 : 0) + 15 * clamp(workout.completion ?? (workout.done ? 1 : 0), 0, 1);
    total = parts.calories + parts.protein + parts.meals + parts.logging + parts.workout;
  }
  return { total: Math.round(total), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])) };
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
