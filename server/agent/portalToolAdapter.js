'use strict';

/**
 * Adapter for the tool contract defined on the Foundry PORTAL agent
 * ("NutriPal-Coach"), implemented on top of HereForFood's existing services.
 *
 * WHY THIS EXISTS
 * The agent created in the Azure AI Foundry portal declares its own function
 * tools, with different names/parameters from this app's native tools:
 *
 *   portal agent            ->  HereForFood implementation
 *   ----------------------------------------------------------------
 *   get_user_profile        ->  store.getOrCreateUser().profile
 *   update_user_profile     ->  store.updateProfile()
 *   lookup_nutrition        ->  services/nutrition (param: food_name)
 *   log_meal                ->  store.addLog()      (param: food_name)
 *   save_meal_plan          ->  store.saveMealPlan()
 *   get_meal_plan           ->  saved plan, else services/mealPlanner
 *   generate_grocery_list   ->  services/grocery
 *   check_progress_vs_goal  ->  dashboard vs calorie target
 *
 * Rather than overwrite the portal agent's carefully-designed tools, we honour
 * its contract here. That keeps the portal as the source of truth for the
 * agent's persona/tools, while the real data and logic stay in this app.
 */

const nutrition = require('../services/nutrition');
const { generatePlan } = require('../services/mealPlanner');
const { buildGroceryList } = require('../services/grocery');
const { recommendedCalories } = require('../services/calories');
const store = require('../store');

// HPB daily sodium guideline the portal agent references.
const SODIUM_GUIDELINE_MG = 2000;

const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Map the portal's free-text/loose profile fields onto our profile shape. */
function toProfilePatch(args = {}) {
  const patch = {};
  if (args.name != null) patch.name = String(args.name);
  if (args.daily_kcal_target != null) patch.calorieGoal = Number(args.daily_kcal_target);
  if (Array.isArray(args.dietary_restrictions)) patch.dietaryRestrictions = args.dietary_restrictions;
  if (Array.isArray(args.allergies)) patch.allergies = args.allergies;
  if (args.activity_level != null) {
    const a = String(args.activity_level).toLowerCase();
    const known = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
    patch.activityLevel = known.find((k) => a.includes(k.replace('_', ' ')) || a.includes(k)) || null;
  }
  // The portal uses a per-DAY budget; this app reasons per meal (~3 meals/day).
  if (args.budget_per_day_sgd != null) {
    patch.budgetPerMeal = Math.round((Number(args.budget_per_day_sgd) / 3) * 100) / 100;
  }
  // The portal's goal is free text ("lose 3kg in 2 months"); map to our enum
  // when we can recognise it, and keep the raw text either way.
  if (args.goal != null) {
    const g = String(args.goal).toLowerCase();
    const mapped =
      /lose|deficit|slim|cut/.test(g) ? 'lose_weight' :
      /muscle|bulk|strength|gain muscle/.test(g) ? 'build_muscle' :
      /gain|bulk up|put on/.test(g) ? 'gain_weight' :
      /healthy|healthier|clean/.test(g) ? 'eat_healthier' :
      /maintain|stay/.test(g) ? 'maintain' :
      /doctor|medical|clinic/.test(g) ? 'doctor_recommendation' :
      /track|log/.test(g) ? 'track_food' : null;
    if (mapped) patch.goal = mapped;
    patch.goalText = String(args.goal);
  }
  return patch;
}

function totalsFor(logs) {
  return logs.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      carbs: acc.carbs + (m.carbs || 0),
      fat: acc.fat + (m.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

/** The portal agent's tool implementations. */
const handlers = {
  async get_user_profile(_args, userId) {
    const user = await store.getOrCreateUser(userId);
    const p = user.profile;
    return {
      name: p.name || null,
      goal: p.goalText || p.goal || null,
      daily_kcal_target: p.calorieGoal ?? recommendedCalories(p) ?? null,
      dietary_restrictions: p.dietaryRestrictions || [],
      allergies: p.allergies || [],
      budget_per_meal_sgd: p.budgetPerMeal ?? null,
      activity_level: p.activityLevel || null,
      medical_condition: p.medicalCondition || null,
      preferences: p.preferences || [],
    };
  },

  async update_user_profile(args, userId) {
    const patch = toProfilePatch(args);
    const profile = await store.updateProfile(userId, patch);
    return { updated: true, profile };
  },

  async lookup_nutrition(args) {
    const name = args.food_name ?? args.name;
    const result = nutrition.lookupNutrition(name, args.servings ?? 1);
    if (!result.found) return result;
    return {
      ...result,
      // Be explicit rather than inventing a number the database doesn't have.
      sodium_mg: null,
      sodium_note:
        'Sodium is not in this nutrition database yet. Hawker dishes are often high in sodium — ' +
        `keep the day under the HPB guideline of ${SODIUM_GUIDELINE_MG} mg.`,
    };
  },

  async log_meal(args, userId) {
    const name = args.food_name ?? args.name;
    const mealType = VALID_MEAL_TYPES.includes(args.meal_type) ? args.meal_type : 'snack';
    const known = nutrition.lookupNutrition(name, 1);

    // Prefer database nutrition; fall back to the agent's estimate only when
    // the food genuinely isn't in our database (that's what the portal tool's
    // `estimated_kcal` is for).
    const entry = known.found
      ? { name: known.name, mealType, calories: known.calories, protein: known.protein, carbs: known.carbs, fat: known.fat }
      : { name: String(name), mealType, calories: Math.round(Number(args.estimated_kcal) || 0), protein: 0, carbs: 0, fat: 0 };

    await store.addLog(userId, entry);

    const user = await store.getOrCreateUser(userId);
    const logs = await store.getLogsForToday(userId);
    const totals = totalsFor(logs);
    const target = user.profile.calorieGoal ?? null;
    return {
      logged: true,
      meal: entry,
      source: known.found ? 'nutrition_database' : 'agent_estimate',
      today_total_kcal: totals.calories,
      daily_kcal_target: target,
      remaining_kcal: target != null ? target - totals.calories : null,
    };
  },

  async save_meal_plan(args, userId) {
    if (!args.plan || typeof args.plan !== 'object') {
      return { saved: false, error: 'plan must be an object keyed by lowercase day name.' };
    }
    const saved = await store.saveMealPlan(userId, args.plan);
    return { saved: true, savedAt: saved.savedAt, days: Object.keys(args.plan) };
  },

  async get_meal_plan(_args, userId) {
    const saved = await store.getSavedMealPlan(userId);
    if (saved) return { source: 'saved', savedAt: saved.savedAt, plan: saved.plan };
    // Nothing saved yet — generate one from the user's profile so the agent
    // always has something concrete to work with.
    const user = await store.getOrCreateUser(userId);
    const generated = generatePlan(user.profile, 'week');
    const plan = {};
    for (const day of generated.days) {
      plan[day.label.toLowerCase()] = Object.fromEntries(
        day.meals.filter((m) => m.meal).map((m) => [m.type, `${m.meal.name} (${m.meal.calories} kcal)`])
      );
    }
    return { source: 'generated', plan };
  },

  async generate_grocery_list(_args, userId) {
    const user = await store.getOrCreateUser(userId);
    const list = buildGroceryList(user.profile, 'week');
    return { period: list.period, item_count: list.itemCount, items: list.items, note: list.note };
  },

  async check_progress_vs_goal(_args, userId) {
    const user = await store.getOrCreateUser(userId);
    const logs = await store.getLogsForToday(userId);
    const totals = totalsFor(logs);
    const target = user.profile.calorieGoal ?? recommendedCalories(user.profile) ?? null;
    return {
      consumed_kcal: totals.calories,
      daily_kcal_target: target,
      remaining_kcal: target != null ? target - totals.calories : null,
      status: target == null ? 'no_target_set' : totals.calories > target ? 'over' : 'on_track',
      macros: { protein_g: totals.protein, carbs_g: totals.carbs, fat_g: totals.fat },
      meals_logged: logs.length,
      sodium_mg: null,
      sodium_note:
        `Sodium tracking is not available in this database yet (HPB guideline: ${SODIUM_GUIDELINE_MG} mg/day). ` +
        'Do not state a sodium figure.',
    };
  },
};

const PORTAL_TOOL_NAMES = Object.keys(handlers);

/** @returns {boolean} whether this tool name belongs to the portal contract. */
const handlesPortalTool = (name) => Object.prototype.hasOwnProperty.call(handlers, name);

/** Execute a portal-contract tool. */
async function dispatchPortalTool(name, args = {}, ctx = {}) {
  const userId = ctx.userId || 'demo';
  return handlers[name](args, userId);
}

module.exports = { handlesPortalTool, dispatchPortalTool, PORTAL_TOOL_NAMES };
