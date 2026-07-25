'use strict';

/**
 * Feature 5 — AI meal recommendation, made goal-aware per Feature 7.
 *
 * Input:  remaining calories + restrictions + preferences + budget + goal
 * Output: a ranked list of meals that fit.
 *
 * The Foundry agent can call this directly as a tool, OR use it as structured
 * grounding and then phrase the recommendation in its own (Gordon-Ramsay-ish)
 * voice. The scoring here encodes the ChatGPT blueprint's goal logic:
 *   - Lose weight  -> favour high-satiety, lower-calorie foods (calorie deficit)
 *   - Build muscle -> favour high-protein, post-workout foods
 *   - Eat healthier-> favour wholegrain / high-fiber / vegetable-forward foods
 */

const { foods } = require('./nutrition');

// How each goal reshapes what we recommend (Feature 7).
const GOAL_PREFERENCES = {
  lose_weight:   { favourTags: ['high-satiety', 'low-calorie', 'lean', 'high-fiber', 'salad'], caloriePenalty: 1.0 },
  maintain:      { favourTags: [], caloriePenalty: 0.3 },
  gain_weight:   { favourTags: ['carb', 'healthy-fat'], caloriePenalty: -0.5 },
  build_muscle:  { favourTags: ['high-protein', 'post-workout', 'lean'], caloriePenalty: 0.2 },
  eat_healthier: { favourTags: ['wholegrain', 'high-fiber', 'vegetarian', 'vegan', 'omega-3'], caloriePenalty: 0.5 },
  manage_diet:   { favourTags: ['low-calorie', 'high-fiber'], caloriePenalty: 0.6 },
  track_food:    { favourTags: [], caloriePenalty: 0.3 },
  // Updated requirements: two more goals.
  doctor_recommendation: { favourTags: ['low-calorie', 'high-fiber', 'lean', 'soup', 'high-satiety'], caloriePenalty: 0.7 },
  elderly_energy:        { favourTags: ['high-protein', 'high-satiety', 'soup', 'high-fiber'], caloriePenalty: 0.3 },
};

function violatesRestrictions(food, restrictions = [], allergies = []) {
  const hay = `${food.name} ${food.tags.join(' ')}`.toLowerCase();
  const blocked = [...restrictions, ...allergies].map((r) => String(r).toLowerCase());

  for (const r of blocked) {
    if (!r) continue;

    // Diet-type restrictions are INCLUSIVE rules: the food must carry the tag.
    // (Handle these first and continue — don't fall through to the keyword
    // exclusion below, or a food's own "vegetarian" tag would exclude it.)
    if (r.includes('vegetarian')) {
      if (!food.tags.includes('vegetarian') && !food.tags.includes('vegan')) return true;
      continue;
    }
    if (r.includes('vegan')) {
      if (!food.tags.includes('vegan')) return true;
      continue;
    }

    // Everything else (allergies, "no pork", etc.) is EXCLUSIVE keyword match.
    // Extend with a real allergen map in production.
    if (hay.includes(r)) return true;
  }
  return false;
}

/**
 * @param {object} p
 * @param {number} p.remainingCalories
 * @param {string} p.goal                  one of GOAL_PREFERENCES keys
 * @param {string[]} p.restrictions
 * @param {string[]} p.allergies
 * @param {string[]} p.preferences         free-text likes (e.g. "chicken", "salad")
 * @param {number} [p.budgetPerMeal]
 * @param {string[]} [p.restrictToTags]     if set, only consider foods carrying
 *                                          one of these tags (e.g. ["breakfast"]
 *                                          for a breakfast slot). Falls back to
 *                                          all foods if nothing matches.
 */
function recommendMeals(p = {}) {
  const remaining = Number(p.remainingCalories);
  const goal = GOAL_PREFERENCES[p.goal] ? p.goal : 'maintain';
  const cfg = GOAL_PREFERENCES[goal];
  const restrictions = p.restrictions || [];
  const allergies = p.allergies || [];
  const preferences = (p.preferences || []).map((x) => String(x).toLowerCase());

  // Aim each meal at roughly the remaining budget (or a sensible meal size).
  const target = Number.isFinite(remaining) && remaining > 0 ? Math.min(remaining, 800) : 500;

  // Optional meal-slot filter: keep only foods suited to this slot (e.g. only
  // breakfast dishes for the breakfast slot). Fall back to everything if the
  // filter would leave nothing to recommend.
  const restrictToTags = p.restrictToTags || [];
  let pool = foods;
  if (restrictToTags.length) {
    const suited = foods.filter((f) => f.tags.some((t) => restrictToTags.includes(t)));
    if (suited.length) pool = suited;
  }

  const scored = pool
    .filter((f) => !violatesRestrictions(f, restrictions, allergies))
    // Don't recommend a meal that blows the remaining calorie budget.
    .filter((f) => !Number.isFinite(remaining) || remaining <= 0 || f.calories <= remaining + 50)
    .map((f) => {
      let score = 0;

      // Closeness to the target calories (0..1, higher is better).
      const closeness = 1 - Math.min(1, Math.abs(f.calories - target) / target);
      score += closeness * (1 + cfg.caloriePenalty);

      // Goal tag bonus.
      const tagHits = f.tags.filter((t) => cfg.favourTags.includes(t)).length;
      score += tagHits * 0.6;

      // Preference bonus (user said they like X).
      const prefHit = preferences.some(
        (pref) => pref && (f.name.includes(pref) || f.tags.some((t) => t.includes(pref)))
      );
      if (prefHit) score += 1.0;

      return { food: f, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ food, score }) => ({
      name: food.name,
      serving: food.serving,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      tags: food.tags,
      score: Number(score.toFixed(2)),
    }));

  return {
    goal,
    target,
    remainingCalories: Number.isFinite(remaining) ? remaining : null,
    recommendations: scored,
  };
}

module.exports = { recommendMeals, GOAL_PREFERENCES };
