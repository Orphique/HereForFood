'use strict';

/**
 * Calorie & BMI engine (from the updated requirements: "Based on the gender of
 * the user, age, bmi, weight" + "Activeness of the user").
 *
 * Computes a personalised daily calorie target from the user's body metrics and
 * activity level using the Mifflin–St Jeor equation (BMR), scaled to TDEE by an
 * activity factor, then adjusted for the user's goal. Falls back to null when
 * the metrics aren't provided, so the app can use a flat default instead.
 */

// Activity multipliers ("how many times they exercise in a week").
const ACTIVITY = {
  sedentary: 1.2,    // little / no exercise
  light: 1.375,      // 1-3 days/week
  moderate: 1.55,    // 3-5 days/week
  active: 1.725,     // 6-7 days/week
  very_active: 1.9,  // hard exercise / physical job
};

// kcal added/removed from maintenance (TDEE) per goal.
const GOAL_DELTA = {
  lose_weight: -400,
  gain_weight: 400,
  build_muscle: 250,
  maintain: 0,
  eat_healthier: 0,
  manage_diet: 0,
  track_food: 0,
  doctor_recommendation: 0, // clinician sets specifics; keep at maintenance
  elderly_energy: 0,        // maintain weight, fuel activity
};

const CALORIE_FLOOR = 1200; // don't recommend below this for safety

function bmr({ gender, weightKg, heightCm, age }) {
  const w = Number(weightKg), h = Number(heightCm), a = Number(age);
  if (!(w > 0 && h > 0 && a > 0)) return null;
  const base = 10 * w + 6.25 * h - 5 * a;
  const g = String(gender || '').toLowerCase();
  // Mifflin–St Jeor sex constant; average it when gender isn't male/female.
  const constant = g === 'male' ? 5 : g === 'female' ? -161 : -78;
  return base + constant;
}

function tdee(profile) {
  const b = bmr(profile);
  if (b == null) return null;
  const factor = ACTIVITY[profile.activityLevel] || ACTIVITY.sedentary;
  return b * factor;
}

/** Personalised daily calorie target, or null if body metrics are incomplete. */
function recommendedCalories(profile) {
  const maintenance = tdee(profile);
  if (maintenance == null) return null;
  const delta = GOAL_DELTA[profile.goal] ?? 0;
  return Math.max(CALORIE_FLOOR, Math.round((maintenance + delta) / 10) * 10);
}

function bmi({ weightKg, heightCm }) {
  const w = Number(weightKg), h = Number(heightCm);
  if (!(w > 0 && h > 0)) return null;
  const m = h / 100;
  return Math.round((w / (m * m)) * 10) / 10;
}

function bmiCategory(value) {
  if (value == null) return null;
  if (value < 18.5) return 'underweight';
  if (value < 23) return 'healthy';       // Asian/Singapore cut-offs (HPB)
  if (value < 27.5) return 'overweight';
  return 'obese';
}

module.exports = { recommendedCalories, tdee, bmr, bmi, bmiCategory, ACTIVITY, GOAL_DELTA };
