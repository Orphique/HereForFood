'use strict';

/**
 * Shared profile-update logic.
 *
 * Used by BOTH the Settings page (PUT /api/profile) and the AI agent's
 * `update_profile` tool, so changing your goal by typing in Settings and
 * changing it by asking the coach behave identically — same validation, same
 * auto-calculated calorie target.
 */

const store = require('../store');
const { recommendedCalories, bmi, bmiCategory } = require('./calories');

const GOALS = [
  'lose_weight', 'maintain', 'gain_weight', 'build_muscle', 'eat_healthier',
  'manage_diet', 'track_food', 'doctor_recommendation', 'elderly_energy',
];
const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const GENDERS = ['male', 'female', 'other'];

// Flat defaults used only when we lack the body metrics to compute properly.
const FALLBACK_CALORIES = {
  lose_weight: 1600, maintain: 2000, gain_weight: 2600, build_muscle: 2500,
  eat_healthier: 2000, manage_diet: 1800, track_food: 2000,
  doctor_recommendation: 1900, elderly_energy: 1900,
};

const FIELDS = [
  'name', 'age', 'gender', 'weightKg', 'heightCm', 'activityLevel',
  'medicalCondition', 'goal', 'calorieGoal', 'allergies',
  'dietaryRestrictions', 'preferences', 'budgetPerMeal',
];

const asArray = (v) =>
  Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean)
    : typeof v === 'string'
      ? v.split(',').map((x) => x.trim()).filter(Boolean)
      : undefined;

const asNumber = (v) => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Validate + normalise an incoming patch.
 * @returns {{patch: object, rejected: string[]}}
 */
function sanitise(input = {}) {
  const patch = {};
  const rejected = [];

  for (const key of FIELDS) {
    if (!(key in input)) continue;
    const v = input[key];

    switch (key) {
      case 'goal':
        if (GOALS.includes(v)) patch.goal = v;
        else rejected.push(`goal "${v}" (valid: ${GOALS.join(', ')})`);
        break;
      case 'activityLevel':
        if (v === null || ACTIVITY_LEVELS.includes(v)) patch.activityLevel = v;
        else rejected.push(`activityLevel "${v}" (valid: ${ACTIVITY_LEVELS.join(', ')})`);
        break;
      case 'gender':
        if (v === null || GENDERS.includes(v)) patch.gender = v;
        else rejected.push(`gender "${v}" (valid: ${GENDERS.join(', ')})`);
        break;
      case 'allergies':
      case 'dietaryRestrictions':
      case 'preferences': {
        const arr = asArray(v);
        if (arr) patch[key] = arr;
        else rejected.push(`${key} (expected a list)`);
        break;
      }
      case 'age':
      case 'weightKg':
      case 'heightCm':
      case 'calorieGoal':
      case 'budgetPerMeal': {
        const n = asNumber(v);
        if (n === undefined) rejected.push(`${key} (expected a number)`);
        else if (n !== null && n < 0) rejected.push(`${key} (must be positive)`);
        else patch[key] = n;
        break;
      }
      default:
        patch[key] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return { patch, rejected };
}

/**
 * Apply a profile patch for a user, recomputing the calorie target from body
 * metrics unless the caller set one explicitly.
 * @returns {Promise<{profile, changed: string[], rejected: string[], calorieAutoUpdated: boolean}>}
 */
async function applyProfileUpdate(userId, input = {}) {
  const { patch, rejected } = sanitise(input);
  const current = await store.getOrCreateUser(userId);
  const before = current.profile || {};

  const userSetCalorie = 'calorieGoal' in patch && patch.calorieGoal != null;
  let calorieAutoUpdated = false;

  if (!userSetCalorie) {
    const merged = { ...before, ...patch };
    const computed = recommendedCalories(merged); // needs gender+age+weight+height+activity
    if (computed != null && computed !== before.calorieGoal) {
      patch.calorieGoal = computed;
      calorieAutoUpdated = true;
    } else if (patch.goal && before.calorieGoal == null && computed == null) {
      patch.calorieGoal = FALLBACK_CALORIES[patch.goal] || 2000;
      calorieAutoUpdated = true;
    }
  }

  const changed = Object.keys(patch).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(patch[k])
  );

  const profile = Object.keys(patch).length
    ? await store.updateProfile(userId, patch)
    : before;

  const b = bmi(profile);
  return {
    profile: { ...profile, bmi: b, bmiCategory: bmiCategory(b) },
    changed,
    rejected,
    calorieAutoUpdated,
  };
}

module.exports = { applyProfileUpdate, sanitise, GOALS, ACTIVITY_LEVELS, GENDERS };
