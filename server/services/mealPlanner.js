'use strict';

/**
 * Meal planner (tab 2, section 5) — the "Plan" pillar.
 *
 * Generates a daily or weekly plan by splitting the user's calorie goal across
 * meal slots (breakfast / lunch / dinner / snack) and picking foods that fit
 * each slot's calorie target while respecting goal, allergies, restrictions and
 * preferences. Each planned meal is attached to its recipe when we have one.
 *
 * This is grounded, structured input for the AI — exactly the doc's point that
 * "the AI isn't just generating a random meal", it's given structured context.
 */

const { recommendMeals } = require('./recommend');
const { getRecipe } = require('./recipes');

// Share of daily calories per slot, plus which food tags suit each slot so we
// don't put, say, a rice plate at breakfast. Lunch/dinner accept any main.
const SLOTS = [
  { type: 'breakfast', emoji: '🍳', share: 0.25, tags: ['breakfast'] },
  { type: 'lunch', emoji: '🍜', share: 0.35, tags: [] },
  { type: 'dinner', emoji: '🍗', share: 0.30, tags: [] },
  { type: 'snack', emoji: '🍎', share: 0.10, tags: ['snack', 'fruit', 'dessert'] },
];

function planDay(profile, { seed = 0 } = {}) {
  const calorieGoal = profile.calorieGoal || 2000;
  const goal = profile.goal || 'maintain';
  const meals = [];

  SLOTS.forEach((slot, idx) => {
    const target = Math.round(calorieGoal * slot.share);
    const rec = recommendMeals({
      remainingCalories: target + 120, // small headroom so items qualify
      goal,
      restrictions: profile.dietaryRestrictions,
      allergies: profile.allergies,
      preferences: profile.preferences,
      budgetPerMeal: profile.budgetPerMeal,
      restrictToTags: slot.tags, // keep breakfast/snack slots on-theme
    });
    // Rotate through the ranked list so days/slots differ.
    const picks = rec.recommendations;
    const pick = picks.length ? picks[(idx + seed) % picks.length] : null;

    meals.push({
      type: slot.type,
      emoji: slot.emoji,
      targetCalories: target,
      meal: pick
        ? {
            name: pick.name,
            calories: pick.calories,
            protein: pick.protein,
            carbs: pick.carbs,
            fat: pick.fat,
            recipe: getRecipe(pick.name), // may be null
          }
        : null,
    });
  });

  const totals = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.meal?.calories || 0),
      protein: acc.protein + (m.meal?.protein || 0),
      carbs: acc.carbs + (m.meal?.carbs || 0),
      fat: acc.fat + (m.meal?.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return { calorieGoal, goal, meals, totals };
}

function planWeek(profile) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    period: 'week',
    goal: profile.goal || 'maintain',
    days: days.map((label, i) => ({ label, ...planDay(profile, { seed: i }) })),
  };
}

function generatePlan(profile, period = 'day') {
  return period === 'week'
    ? planWeek(profile)
    : { period: 'day', ...planDay(profile, { seed: new Date().getDay() }) };
}

module.exports = { generatePlan, SLOTS };
