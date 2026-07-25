'use strict';

/**
 * Macro targets (tab 2, sections 2 & 10).
 *
 * The dashboard shows progress bars for Calories / Protein / Carbs / Fat as
 * "consumed / target". Calories come from the user's calorie goal; the macro
 * gram targets are derived here from a goal-specific split of those calories.
 *
 * Energy per gram: protein 4 kcal, carbs 4 kcal, fat 9 kcal.
 */

// % of daily calories from each macro, by goal (tab 2, section 10).
const MACRO_SPLIT = {
  lose_weight:   { protein: 0.35, carbs: 0.35, fat: 0.30 }, // higher protein = satiety
  maintain:      { protein: 0.25, carbs: 0.50, fat: 0.25 },
  gain_weight:   { protein: 0.25, carbs: 0.50, fat: 0.25 },
  build_muscle:  { protein: 0.35, carbs: 0.45, fat: 0.20 }, // protein-forward
  eat_healthier: { protein: 0.25, carbs: 0.50, fat: 0.25 },
  manage_diet:   { protein: 0.30, carbs: 0.40, fat: 0.30 },
  track_food:    { protein: 0.25, carbs: 0.50, fat: 0.25 },
  doctor_recommendation: { protein: 0.30, carbs: 0.40, fat: 0.30 }, // balanced, clinician-guided
  elderly_energy:        { protein: 0.30, carbs: 0.50, fat: 0.20 }, // protein to preserve muscle
};

const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 };

function macroTargets(calorieGoal, goal) {
  if (!calorieGoal) return { protein: null, carbs: null, fat: null };
  const split = MACRO_SPLIT[goal] || MACRO_SPLIT.maintain;
  return {
    protein: Math.round((calorieGoal * split.protein) / KCAL_PER_GRAM.protein),
    carbs: Math.round((calorieGoal * split.carbs) / KCAL_PER_GRAM.carbs),
    fat: Math.round((calorieGoal * split.fat) / KCAL_PER_GRAM.fat),
  };
}

module.exports = { macroTargets, MACRO_SPLIT };
