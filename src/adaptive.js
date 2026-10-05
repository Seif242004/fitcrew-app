// Adaptive weekly check-in: tunes a person's calorie target from what actually happened.
//
// The idea (the same one MacroFactor and coaches use): over a few weeks,
//   real maintenance  =  average calories eaten  -  weight change per day x 7,700 kcal/kg
// Someone eating 2,200 a day and losing 0.5 kg a week burns about 2,200 + 550 = 2,750.
// The formula (Mifflin x activity) is only a first guess; this replaces it with the person's
// real number, slowly and safely:
//   - move halfway from the current estimate toward the measured one each week (noise damping)
//   - change the calorie target by at most 150 kcal a week, and only if it is 50+ off
//   - never below the safety floors, and the learned value stays within 25% of the formula
//   - no change without enough data (10 fully logged days, 3 weigh-ins over 2 weeks, a
//     weigh-in this week), and none when the person did not eat close to the plan: then the
//     weight says nothing about the target, so the advice is "eat your plan first"
// Pure functions, no database. The routes that store and apply check-ins live in api-checkin.js.

import { calorieTarget, KCAL_PER_KG, CALORIE_FLOOR } from './calc.js';

export const RULES = {
  window: 21,        // days of food logs used (the three weeks before the check-in)
  minDays: 10,       // fully logged days needed in that window
  fullDay: 0.5,      // a day counts as fully logged when it reaches 50% of the calorie target
  weightWindow: 28,  // days of weigh-ins used for the trend
  minWeighIns: 3,    // ...at least this many
  minSpan: 14,       // ...spread over at least two weeks
  freshWeight: 2,    // the latest weigh-in may be at most 2 days before the check-in Friday
  band: 0.15,        // adjust only when average intake was within 15% of the target
  blend: 0.5,        // move halfway toward the measured maintenance each week
  maxStep: 150,      // largest change to the daily target in one week (kcal)
  deadband: 50,      // smaller differences are noise: no change
  maxAdjust: 0.25,   // learned maintenance stays within 25% of the formula's
  ema: 0.3,          // weight trend smoothing, the same as the Progress chart
};

const DAY = 86400000;
const dayNo = (date) => Date.parse(`${date}T00:00:00Z`) / DAY;
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const round10 = (n) => Math.round(n / 10) * 10;

/** The check-in week a date belongs to: the latest Friday on or before it (YYYY-MM-DD). */
export function checkinWeek(date) {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun ... 5 Fri
  return addDays(date, -((wd + 2) % 7));
}

/** Check-ins open Friday to Sunday (with the weekly recap); a proposal stays open all week. */
export const checkinOpenOn = (date) => [5, 6, 0].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/**
 * Weight trend from weigh-ins [{ date, kg }] (any order) up to `asOf`.
 * trendKg: the smoothed current weight (EMA, as drawn in Progress).
 * ratePerWeek: kg per week from a least-squares line through the weigh-ins of the last 4 weeks
 * (a line is far steadier than "last minus first" with weekly weigh-ins).
 */
export function weightTrend(weighIns, asOf) {
  const from = addDays(asOf, -RULES.weightWindow);
  const pts = weighIns.filter((w) => w.kg > 0 && w.date <= asOf).sort((a, b) => (a.date < b.date ? -1 : 1));
  const recent = pts.filter((w) => w.date > from);
  let e = null;
  for (const w of pts) e = e === null ? w.kg : e + RULES.ema * (w.kg - e);
  const out = { trendKg: e === null ? null : r1(e), ratePerWeek: null, count: recent.length, spanDays: 0, last: pts.at(-1) ?? null };
  if (recent.length < 2) return out;
  const xs = recent.map((w) => dayNo(w.date)); const ys = recent.map((w) => w.kg);
  out.spanDays = xs.at(-1) - xs[0];
  if (out.spanDays <= 0) return out;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0; let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  out.ratePerWeek = r2((num / den) * 7);
  return out;
}

/** The weekly rate the goal asks for, with the same caps as the calculator (kg/week, signed). */
export function goalRate(profile) {
  const rate = Math.abs(profile.weeklyRateKg ?? 0);
  if (profile.goal === 'cut') return -r2(Math.min(rate, profile.weightKg * 0.01));
  if (profile.goal === 'bulk') return r2(Math.min(rate, profile.weightKg * 0.005));
  return 0;
}

/**
 * The check-in for one week.
 *   week      the check-in Friday (YYYY-MM-DD); food logs are read up to the day before
 *   targets   the person's computed targets: { kcal, tdee, tdeeFormula, tdeeAdjust }
 *   profile   { goal, weeklyRateKg, weightKg, sex }
 *   intake    [{ date, kcal }] one row per day with anything logged
 *   weighIns  [{ date, kg }]
 *   since     first day that counts (plan start or a fresh start); earlier logs are ignored
 *   asOf      the day the check-in is looked at (Friday to Sunday); weigh-ins up to it count
 * Returns { kind, ...numbers, text } where kind is:
 *   'needs_weight'  no weigh-in around this Friday yet
 *   'learning'      not enough data yet (days / weighIns / need say how far along)
 *   'hold'          the target stays; `hold` says why (under, over, floor, unclear)
 *   'on_track'      the target is right
 *   'proposed'      change the daily target from kcal.from to kcal.to
 */
export function weeklyCheckin({ week, targets, profile, intake, weighIns, since = null, asOf = week }) {
  const to = addDays(week, -1);
  const from = addDays(week, -RULES.window);
  const start = since && since > from ? since : from;
  const full = intake.filter((d) => d.date >= start && d.date <= to && d.kcal >= targets.kcal * RULES.fullDay);
  const trend = weightTrend(weighIns, asOf > week ? asOf : week);
  const goal = goalRate(profile);
  const base = {
    week, days: full.length, needDays: RULES.minDays, weighIns: trend.count, needWeighIns: RULES.minWeighIns,
    trendKg: trend.trendKg, ratePerWeek: trend.ratePerWeek, goalRate: goal, goal: profile.goal,
    avgIntake: full.length ? Math.round(full.reduce((a, d) => a + d.kcal, 0) / full.length) : null,
    kcal: { from: targets.kcal, to: targets.kcal },
  };
  const fresh = trend.last && trend.last.date >= addDays(week, -RULES.freshWeight);
  if (!fresh) return finish({ ...base, kind: 'needs_weight' });
  if (full.length < RULES.minDays || trend.count < RULES.minWeighIns || trend.spanDays < RULES.minSpan || trend.ratePerWeek === null) {
    return finish({ ...base, kind: 'learning' });
  }

  // Did they eat close to the plan? If not, the weight change reflects the eating, not the target.
  const T0 = targets.kcal;
  if (base.avgIntake < T0 * (1 - RULES.band)) return finish({ ...base, kind: 'hold', hold: 'under' });
  if (base.avgIntake > T0 * (1 + RULES.band)) return finish({ ...base, kind: 'hold', hold: 'over' });

  // Measured maintenance, then move halfway there from the current estimate.
  const M0 = targets.tdee;
  const measured = base.avgIntake - (trend.ratePerWeek / 7) * KCAL_PER_KG;
  if (measured < M0 * 0.6 || measured > M0 * 1.5) return finish({ ...base, kind: 'hold', hold: 'unclear', maintenance: { current: M0, measured: Math.round(measured) } });
  const formula = targets.tdeeFormula ?? M0;
  const lo = formula * (1 - RULES.maxAdjust); const hi = formula * (1 + RULES.maxAdjust);
  const M1 = Math.min(hi, Math.max(lo, M0 + RULES.blend * (measured - M0)));
  const weightKg = trend.trendKg ?? profile.weightKg;
  const T1 = calorieTarget({ tdeeValue: M1, goal: profile.goal, weeklyRateKg: profile.weeklyRateKg, weightKg, sex: profile.sex }).kcal;
  const maintenance = { current: Math.round(M0), measured: Math.round(measured), next: Math.round(M1) };

  const floor = CALORIE_FLOOR[profile.sex] ?? 1500;
  // Already at the safety floor and the real burn is lower than thought: the target would go
  // down, but it cannot go below the floor. Say so instead of calling it "on track".
  if (T0 <= floor + 10 && M1 < M0 - RULES.deadband) return finish({ ...base, kind: 'hold', hold: 'floor', maintenance });
  const diff = T1 - T0;
  if (Math.abs(diff) < RULES.deadband) return finish({ ...base, kind: 'on_track', maintenance });
  const step = Math.sign(diff) * Math.min(RULES.maxStep, round10(Math.abs(diff)));
  const next = Math.max(floor, T0 + step);
  if (Math.abs(next - T0) < RULES.deadband) return finish({ ...base, kind: diff < 0 ? 'hold' : 'on_track', hold: diff < 0 ? 'floor' : undefined, maintenance });
  return finish({ ...base, kind: 'proposed', kcal: { from: T0, to: next }, maintenance });
}

// ---------------------------------------------------------------- words
const kg = (n) => `${r1(Math.abs(n))} kg`;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** "losing 0.3 kg a week" / "gaining 0.2 kg a week" / "holding steady". */
export function rateWords(rate) {
  if (rate === null || rate === undefined) return 'not clear yet';
  if (Math.abs(rate) < 0.05) return 'holding steady';
  return `${rate < 0 ? 'losing' : 'gaining'} ${kg(rate)} a week`;
}
const goalWords = (goal, rate) => (goal === 'maintain' ? 'to hold your weight' : `${goal === 'cut' ? 'losing' : 'gaining'} ${kg(rate)} a week`);

/** Adds `text`: one or two plain sentences for the card, the coach and the push. */
function finish(r) {
  const you = `You're ${rateWords(r.ratePerWeek)}`;
  const goal = `your goal is ${goalWords(r.goal, r.goalRate)}`;
  const change = r.kcal.to - r.kcal.from;
  switch (r.kind) {
    case 'needs_weight':
      r.text = 'Weigh in to see this week\'s check-in. Same scale, after the toilet, before food or water.'; break;
    case 'learning': {
      const need = [];
      if (r.days < r.needDays) need.push(`${r.needDays - r.days} more fully logged day${r.needDays - r.days === 1 ? '' : 's'}`);
      if (r.weighIns < r.needWeighIns) need.push(`${r.needWeighIns - r.weighIns} more weekly weigh-in${r.needWeighIns - r.weighIns === 1 ? '' : 's'}`);
      r.text = need.length
        ? `Your check-in tunes your calories from your real results. It needs ${need.join(' and ')} first.`
        : 'Your check-in needs weigh-ins spread over at least two weeks. Keep weighing in on Fridays.';
      break;
    }
    case 'on_track':
      r.text = `${you}, and ${goal}. That's on track, so your plan stays the same.`; break;
    case 'proposed': {
      const more = change > 0;
      const why = r.goal === 'cut'
        ? (more ? `${you}, faster than your goal of ${kg(r.goalRate)}. Eating ${fmt(change)} kcal more a day protects your muscle and energy.`
          : r.ratePerWeek > 0.05 ? `Your weight went up ${kg(r.ratePerWeek)} a week, and ${goal}. Eating ${fmt(-change)} kcal less a day gets it moving down.`
            : `${you}, and ${goal}. Eating ${fmt(-change)} kcal less a day gets you back on pace.`)
        : r.goal === 'bulk'
          ? (more ? `${you}, and ${goal}. Eating ${fmt(change)} kcal more a day helps you build.`
            : `${you}, faster than your goal of ${kg(r.goalRate)}, which adds more fat than muscle. Eating ${fmt(-change)} kcal less a day keeps the gain lean.`)
          : `Your weight is ${r.ratePerWeek < 0 ? 'drifting down' : 'drifting up'} ${kg(r.ratePerWeek)} a week. Eating ${fmt(Math.abs(change))} kcal ${more ? 'more' : 'less'} a day keeps it steady.`;
      r.text = why; break;
    }
    case 'hold':
      r.text = r.hold === 'under'
        ? `You ate about ${fmt(r.avgIntake)} kcal a day, under your ${fmt(r.kcal.from)} target, so your weight can't show yet whether the target is right. Eat your full plan this week and log everything, including oil, drinks and snacks.`
        : r.hold === 'over'
          ? `You ate about ${fmt(r.avgIntake)} kcal a day, over your ${fmt(r.kcal.from)} target. Stay close to your plan this week and next Friday's check-in can tune it.`
          : r.hold === 'floor'
            ? `${you}, and ${goal}, but your calories are already at the safe minimum, so the plan won't go lower. Add daily steps or cardio, and Seif can review your plan.`
            : 'Your logs and weight don\'t add up yet, which usually means some food or drinks weren\'t logged. Log everything this week and the check-in will try again next Friday.';
      break;
    default: r.text = '';
  }
  return r;
}
