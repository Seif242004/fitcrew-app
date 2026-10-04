// FitCrew calculator: BMR, body fat, TDEE, calorie target and macros.
// Pure functions, no dependencies. Metric units only (kg, cm, g).

export const ACTIVITY = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const KCAL_PER_KG = 7700;

/** Mifflin-St Jeor resting energy expenditure (kcal/day). */
export function bmrMifflin({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** Katch-McArdle resting energy expenditure from body fat % (kcal/day). */
export function bmrKatch({ weightKg, bodyFatPct }) {
  const leanKg = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * leanKg;
}

/** US Navy body fat estimate (%). Needs neck/waist (and hip for women) in cm. */
export function navyBodyFat({ sex, heightCm, neckCm, waistCm, hipCm }) {
  let pct;
  if (sex === 'male') {
    if (waistCm <= neckCm) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  } else {
    if (!hipCm || waistCm + hipCm <= neckCm) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
  }
  if (!Number.isFinite(pct) || pct < 2 || pct > 60) return null;
  return Math.round(pct * 10) / 10;
}

/** Resting energy: Katch-McArdle when body fat is known, otherwise Mifflin-St Jeor. */
export function bmr(profile) {
  if (profile.bodyFatPct != null) {
    return { value: bmrKatch(profile), formula: 'katch-mcardle' };
  }
  return { value: bmrMifflin(profile), formula: 'mifflin-st-jeor' };
}

export function tdee(bmrValue, activityLevel) {
  const factor = ACTIVITY[activityLevel];
  if (!factor) throw new Error(`Unknown activity level: ${activityLevel}`);
  return bmrValue * factor;
}

const CALORIE_FLOOR = { male: 1500, female: 1200 };

/**
 * Daily calorie target for a goal.
 * goal: 'cut' | 'maintain' | 'bulk'
 * weeklyRateKg: positive number, kg of body weight per week to lose (cut) or gain (bulk).
 */
export function calorieTarget({ tdeeValue, goal, weeklyRateKg = 0, weightKg, sex }) {
  const warnings = [];
  let rate = goal === 'maintain' ? 0 : Math.abs(weeklyRateKg);

  if (goal === 'cut') {
    const maxRate = weightKg * 0.01; // 1% of body weight per week
    if (rate > maxRate) {
      rate = maxRate;
      warnings.push(`Weekly loss rate capped at ${maxRate.toFixed(2)} kg (1% of body weight).`);
    }
  }
  if (goal === 'bulk') {
    const maxRate = weightKg * 0.005; // 0.5% per week keeps fat gain low
    if (rate > maxRate) {
      rate = maxRate;
      warnings.push(`Weekly gain rate capped at ${maxRate.toFixed(2)} kg (0.5% of body weight).`);
    }
  }

  let dailyDelta = (rate * KCAL_PER_KG) / 7;
  if (goal === 'cut' && dailyDelta > 0.25 * tdeeValue) {
    dailyDelta = 0.25 * tdeeValue; // bigger deficits are rarely kept up and cost muscle
    warnings.push(`Deficit capped at 25% of maintenance (${Math.round(dailyDelta)} kcal a day).`);
  }
  let target = goal === 'cut' ? tdeeValue - dailyDelta : goal === 'bulk' ? tdeeValue + dailyDelta : tdeeValue;

  const floor = CALORIE_FLOOR[sex] ?? 1500;
  if (target < floor) {
    target = floor;
    warnings.push(`Target raised to the safety floor of ${floor} kcal. Admin review recommended.`);
  }
  return { kcal: Math.round(target), warnings };
}

const PROTEIN_G_PER_KG = { cut: 2.0, maintain: 1.8, bulk: 1.8 };

/**
 * Body weight that protein is dosed on. Muscle, not fat, drives protein needs, so heavier people
 * are dosed on the weight they would have at a BMI of 25 (or on lean mass when body fat is known).
 * Dosing on total weight gave a 110 kg beginner 242 g protein and zero carbs.
 */
export function referenceWeight({ weightKg, heightCm, sex, bodyFatPct }) {
  if (bodyFatPct != null) {
    const lean = weightKg * (1 - bodyFatPct / 100);
    return Math.min(weightKg, lean / (sex === 'female' ? 0.75 : 0.85));
  }
  if (!heightCm) return weightKg;
  return Math.min(weightKg, 25 * (heightCm / 100) ** 2);
}

/**
 * Macro split in grams: protein on reference weight (at most 35% of calories), fat 25% of calories
 * (never under 0.6 g/kg or 20%), carbs the rest but never under 25% of calories. Real Egyptian
 * plans are bread and rice based; a split with almost no carbs cannot be eaten from this food list.
 */
export function macros({ kcal, weightKg, heightCm, sex, bodyFatPct, goal }) {
  const ref = referenceWeight({ weightKg, heightCm, sex, bodyFatPct });
  let proteinG = Math.min((PROTEIN_G_PER_KG[goal] ?? 1.8) * ref, (0.35 * kcal) / 4);
  const fatMinG = Math.max(0.6 * ref, (0.2 * kcal) / 9);
  let fatG = Math.max(fatMinG, (0.25 * kcal) / 9);
  const carbMinG = (0.25 * kcal) / 4;
  let carbsG = (kcal - proteinG * 4 - fatG * 9) / 4;
  if (carbsG < carbMinG) { // trim fat to its floor first, then protein
    const fromFat = Math.min(fatG - fatMinG, ((carbMinG - carbsG) * 4) / 9);
    fatG -= fromFat; carbsG += (fromFat * 9) / 4;
    if (carbsG < carbMinG) { proteinG -= carbMinG - carbsG; carbsG = carbMinG; }
  }
  return { proteinG: Math.round(proteinG), fatG: Math.round(fatG), carbsG: Math.round(carbsG) };
}

/** Full pipeline from an onboarding profile to targets. */
export function computeTargets(profile) {
  const rest = bmr(profile);
  const maintenance = tdee(rest.value, profile.activityLevel);
  const { kcal, warnings } = calorieTarget({
    tdeeValue: maintenance,
    goal: profile.goal,
    weeklyRateKg: profile.weeklyRateKg,
    weightKg: profile.weightKg,
    sex: profile.sex,
  });
  return {
    bmr: Math.round(rest.value),
    bmrFormula: rest.formula,
    tdee: Math.round(maintenance),
    kcal,
    ...macros({ kcal, weightKg: profile.weightKg, heightCm: profile.heightCm, sex: profile.sex, bodyFatPct: profile.bodyFatPct, goal: profile.goal }),
    warnings,
  };
}
