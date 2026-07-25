'use strict';

/**
 * The agent's TOOLBOX.
 *
 * This is what makes HereForFood *agentic*: instead of a chatbot that only
 * talks, the AI can take actions — identify food, look up nutrition, log meals,
 * read the dashboard, recommend meals, and find local delivery options.
 *
 * Two things live here:
 *   1) toolSchemas  — the JSON-schema definitions we hand to the model so it
 *                     knows which functions exist and how to call them.
 *   2) dispatch()   — actually runs a tool the model asked for, against our
 *                     services + data store, and returns a JSON result.
 *
 * The SAME schemas + dispatch are used by both the Azure Foundry provider and
 * the offline mock provider, so behaviour is identical across them.
 */

const nutrition = require('../services/nutrition');
const { recommendMeals } = require('../services/recommend');
const { findLocalFood } = require('../services/restaurants');
const { macroTargets } = require('../services/macros');
const { estimateMeal } = require('../services/estimate');
const { generatePlan } = require('../services/mealPlanner');
const { getRecipe } = require('../services/recipes');
const { buildGroceryList } = require('../services/grocery');
const { bmi, bmiCategory } = require('../services/calories');
const { applyProfileUpdate } = require('../services/profileService');
const { handlesPortalTool, dispatchPortalTool } = require('./portalToolAdapter');
const store = require('../store');

// ---------------------------------------------------------------------------
// 1) Tool schemas (OpenAI / Azure function-calling format)
// ---------------------------------------------------------------------------
const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'identify_food',
      description:
        'Parse a natural-language food description into structured items. Use this first when the user tells you what they ate (Feature 3: AI identifies food).',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What the user said they ate, e.g. "a plate of chicken rice and a banana".' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_nutrition',
      description:
        'Get calories + macros (protein/carbs/fat) for a single food and quantity from the nutrition database (Feature 3).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Food name, e.g. "chicken rice".' },
          quantity: { type: 'number', description: 'Number of servings. Default 1.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_meal',
      description:
        "Save a food the user ate to today's log so it counts toward their daily totals (Feature 3 -> Feature 4).",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'], description: 'Which meal this was.' },
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
        },
        required: ['name', 'calories'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard',
      description:
        "Read today's dashboard: total calories/protein/carbs/fat logged, meals logged, and remaining calories vs the user's goal (Feature 4).",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend_meals',
      description:
        "Recommend meals that fit the user's remaining calories, dietary restrictions, allergies, preferences, budget and GOAL (Features 5 + 7). Call get_dashboard first if you don't know remaining calories.",
      parameters: {
        type: 'object',
        properties: {
          remaining_calories: { type: 'number', description: 'Calories left for the day. Optional but strongly preferred.' },
          budget_per_meal: { type: 'number', description: 'Max price per meal, if the user cares about budget.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_local_food',
      description:
        'Find restaurants / delivery options (Grab, Foodpanda, etc.) for a recommended meal, with price, rating and distance (Feature 6).',
      parameters: {
        type: 'object',
        properties: {
          meal: { type: 'string', description: 'The meal to find nearby, e.g. "salmon".' },
          max_price: { type: 'number', description: 'Optional max price filter.' },
        },
        required: ['meal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estimate_meal',
      description:
        'Estimate the nutrition of a described meal, broken down per item with adjustable portions. Use for the Log Food flow before logging (tab 2 sections 3-4). Always call this rather than inventing calorie numbers.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'The meal, e.g. "chicken rice with an egg and iced Milo".' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_meals',
      description:
        "Generate a daily or weekly meal plan for the user's goal, calories, restrictions and preferences (tab 2 section 5, the 'Plan' pillar).",
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['day', 'week'], description: 'Plan a single day or a full week. Default day.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recipe',
      description: 'Get a recipe (ingredients + steps + cost) for a meal (tab 2 section 5, "View Recipe").',
      parameters: {
        type: 'object',
        properties: {
          meal: { type: 'string', description: 'The meal/dish to fetch a recipe for.' },
        },
        required: ['meal'],
      },
    },
  },
  // --- Settings / profile: let the coach READ and CHANGE the user's setup ----
  {
    type: 'function',
    function: {
      name: 'get_profile',
      description:
        "Read the user's current settings: goal, calorie target, body metrics (age, gender, weight, height, activity level), BMI, allergies, dietary restrictions, medical condition, food preferences and budget. Call this before changing settings so you know the current values.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_profile',
      description:
        "Update the user's settings (the Settings page) when they ask you to — e.g. change goal, calorie target, budget, weight, activity level, or add/remove an allergy, dietary restriction or food preference. Only include the fields being changed. The daily calorie target is recalculated automatically from body metrics unless you set calorie_goal explicitly. Confirm what changed in your reply.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "The user's display name." },
          age: { type: 'number' },
          gender: { type: 'string', enum: ['male', 'female', 'other'] },
          weight_kg: { type: 'number', description: 'Body weight in kilograms.' },
          height_cm: { type: 'number', description: 'Height in centimetres.' },
          activity_level: {
            type: 'string',
            enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
            description: 'How often they exercise: sedentary=none, light=1-3 days/wk, moderate=3-5, active=6-7, very_active=physical job.',
          },
          medical_condition: { type: 'string', description: 'Any condition to be mindful of, e.g. "diabetes". Empty string clears it.' },
          goal: {
            type: 'string',
            enum: ['lose_weight', 'maintain', 'gain_weight', 'build_muscle', 'eat_healthier', 'manage_diet', 'track_food', 'doctor_recommendation', 'elderly_energy'],
          },
          calorie_goal: { type: 'number', description: 'Daily kcal target. Omit to auto-calculate from body metrics + goal.' },
          allergies: { type: 'array', items: { type: 'string' }, description: 'FULL replacement list, e.g. ["peanuts","shellfish"].' },
          dietary_restrictions: { type: 'array', items: { type: 'string' }, description: 'FULL replacement list, e.g. ["vegetarian","no pork"].' },
          preferences: { type: 'array', items: { type: 'string' }, description: 'FULL replacement list of liked foods.' },
          budget_per_meal: { type: 'number', description: 'Max spend per meal in SGD.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_log_entry',
      description:
        "Remove a meal from today's log when the user says they logged something by mistake or wants to undo it. Omit entry_id to remove the most recently logged meal. Call get_dashboard first if you need to identify which entry.",
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string', description: 'Id of the entry to remove. Omit for the most recent one.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_to_page',
      description:
        "Open a page in the app for the user when they ask to see or go somewhere (e.g. 'show me Discover', 'open my meal plan', 'take me to settings'). The app switches to that page immediately. Still answer in words as well.",
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['dashboard', 'log', 'plan', 'discover', 'settings'],
            description: 'dashboard=today\'s totals, log=log food, plan=meal plan, discover=order food nearby, settings=profile.',
          },
        },
        required: ['page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_meal_plan',
      description:
        "Save a meal plan for the user so they can come back to it (e.g. 'save this plan'). Call plan_meals first to build one, then pass its days here. Saving replaces any previously saved plan.",
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['day', 'week'], description: 'What the plan covers. Default week.' },
          plan: {
            type: 'object',
            description: 'The plan to save, keyed by day (e.g. {"mon":{"breakfast":"kaya toast set (450 kcal)"}}) or by meal for a single day.',
          },
          note: { type: 'string', description: 'Optional short label, e.g. "high-protein week".' },
        },
        required: ['plan'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_saved_meal_plan',
      description: "Retrieve the meal plan the user previously saved (e.g. 'what was my saved plan?'). Returns nothing if they haven't saved one.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_grocery_list',
      description:
        "Generate a consolidated shopping list of ingredients from the user's meal plan, for cooking at home. Use 'week' for a full week's shopping.",
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['day', 'week'], description: 'Default day.' },
        },
        required: [],
      },
    },
  },
];

// Names of this app's own tools, derived from the schemas above so the two
// can never drift apart.
const NATIVE_TOOL_NAMES = new Set(toolSchemas.map((t) => t.function.name));

// ---------------------------------------------------------------------------
// 2) dispatch — execute a tool call by name
// ---------------------------------------------------------------------------
async function computeDashboard(userId) {
  const user = await store.getOrCreateUser(userId);
  const logs = await store.getLogsForToday(userId);

  const totals = logs.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      carbs: acc.carbs + (m.carbs || 0),
      fat: acc.fat + (m.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const calorieGoal = user.profile.calorieGoal;
  const remaining = calorieGoal != null ? calorieGoal - totals.calories : null;

  // Group logged meals by type for the dashboard's "Today's Meals" (tab 2 s.2).
  const byType = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const m of logs) {
    const t = byType[m.mealType] ? m.mealType : 'snack';
    byType[t].push({ name: m.name, calories: m.calories });
  }
  const mealsByType = Object.entries(byType).map(([type, items]) => ({
    type,
    calories: items.reduce((s, i) => s + i.calories, 0),
    items,
  }));

  return {
    date: store.todayKey(),
    greeting: greetingForNow(),
    name: user.profile.name || '',
    goal: user.profile.goal,
    calorieGoal,
    // Targets give the dashboard progress bars their denominators (tab 2 s.2).
    targets: { calories: calorieGoal, ...macroTargets(calorieGoal, user.profile.goal) },
    consumed: totals,
    mealsLogged: logs.length,
    remainingCalories: remaining,
    meals: logs.map((m) => ({ name: m.name, calories: m.calories, mealType: m.mealType || 'snack' })),
    mealsByType,
  };
}

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * @param {string} name    tool name the model requested
 * @param {object} args    parsed arguments
 * @param {object} ctx     { userId }
 */
async function dispatch(name, args = {}, ctx = {}) {
  const userId = ctx.userId || 'demo';
  const user = await store.getOrCreateUser(userId);

  // Tool calls coming from the Foundry PORTAL agent use its own contract
  // (get_user_profile, save_meal_plan, food_name params, ...). Detect those by
  // their portal-only argument shape / name and route them to the adapter.
  // `lookup_nutrition` and `log_meal` exist in both contracts, so we
  // disambiguate on the parameter name the portal uses (`food_name`).
  const isPortalCall =
    handlesPortalTool(name) &&
    (!NATIVE_TOOL_NAMES.has(name) || 'food_name' in args);
  if (isPortalCall) {
    return dispatchPortalTool(name, args, { userId });
  }

  switch (name) {
    case 'identify_food': {
      // Lightweight parser: split on connectors, match each part against the DB.
      const parts = String(args.description || '')
        .split(/,| and | with |\+|&/i)
        .map((s) => s.trim())
        .filter(Boolean);
      const items = parts.map((p) => {
        const food = nutrition.findFood(p);
        return { text: p, matched: food ? food.name : null };
      });
      return { items };
    }

    case 'lookup_nutrition':
      return nutrition.lookupNutrition(args.name, args.quantity ?? 1);

    case 'log_meal': {
      const validTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
      const entry = await store.addLog(userId, {
        name: args.name,
        quantity: args.quantity ?? 1,
        mealType: validTypes.includes(args.meal_type) ? args.meal_type : 'snack',
        grams: args.grams,
        calories: Math.round(args.calories || 0),
        protein: Math.round(args.protein || 0),
        carbs: Math.round(args.carbs || 0),
        fat: Math.round(args.fat || 0),
      });
      return { logged: true, entry, dashboard: await computeDashboard(userId) };
    }

    case 'get_dashboard':
      return computeDashboard(userId);

    case 'recommend_meals': {
      const dash = await computeDashboard(userId);
      const remaining =
        args.remaining_calories != null ? Number(args.remaining_calories) : dash.remainingCalories;
      return recommendMeals({
        remainingCalories: remaining,
        goal: user.profile.goal || 'maintain',
        restrictions: user.profile.dietaryRestrictions,
        allergies: user.profile.allergies,
        preferences: user.profile.preferences,
        budgetPerMeal: args.budget_per_meal ?? user.profile.budgetPerMeal,
      });
    }

    case 'find_local_food':
      return findLocalFood(args.meal, { maxPrice: args.max_price });

    case 'estimate_meal':
      return estimateMeal(args.description);

    case 'plan_meals':
      return generatePlan(user.profile, args.period === 'week' ? 'week' : 'day');

    case 'get_recipe': {
      const recipe = getRecipe(args.meal);
      return recipe ? { found: true, recipe } : { found: false, meal: args.meal };
    }

    // --- Settings / profile ---------------------------------------------
    case 'get_profile': {
      const p = user.profile || {};
      const b = bmi(p);
      return { profile: { ...p, bmi: b, bmiCategory: bmiCategory(b) } };
    }

    case 'update_profile': {
      // Map the tool's snake_case args onto the app's profile field names.
      const map = {
        name: 'name', age: 'age', gender: 'gender', weight_kg: 'weightKg',
        height_cm: 'heightCm', activity_level: 'activityLevel',
        medical_condition: 'medicalCondition', goal: 'goal',
        calorie_goal: 'calorieGoal', allergies: 'allergies',
        dietary_restrictions: 'dietaryRestrictions', preferences: 'preferences',
        budget_per_meal: 'budgetPerMeal',
      };
      const patch = {};
      for (const [from, to] of Object.entries(map)) {
        if (from in args) patch[to] = args[from];
      }
      if (!Object.keys(patch).length) {
        return { updated: false, message: 'No settings were provided to change.' };
      }
      const res = await applyProfileUpdate(userId, patch);
      return {
        updated: res.changed.length > 0,
        changed: res.changed,
        rejected: res.rejected,
        calorieAutoUpdated: res.calorieAutoUpdated,
        profile: res.profile,
        dashboard: await computeDashboard(userId),
      };
    }

    case 'delete_log_entry': {
      const removed = await store.deleteLog(userId, args.entry_id);
      if (!removed) return { deleted: false, message: 'No matching meal found in today\'s log.' };
      return { deleted: true, removed, dashboard: await computeDashboard(userId) };
    }

    case 'get_grocery_list':
      return buildGroceryList(user.profile, args.period === 'week' ? 'week' : 'day');

    // --- App navigation --------------------------------------------------
    case 'navigate_to_page': {
      const pages = ['dashboard', 'log', 'plan', 'discover', 'settings'];
      if (!pages.includes(args.page)) {
        return { navigated: false, error: `Unknown page "${args.page}". Valid: ${pages.join(', ')}.` };
      }
      // The server can't move the user's screen; it returns a directive that the
      // web/mobile client acts on (see `navigate` in the /api/chat response).
      return { navigated: true, page: args.page };
    }

    // --- Saved meal plans -------------------------------------------------
    case 'save_meal_plan': {
      if (!args.plan || typeof args.plan !== 'object') {
        return { saved: false, error: 'plan must be an object.' };
      }
      const saved = await store.saveMealPlan(userId, {
        period: args.period === 'day' ? 'day' : 'week',
        note: args.note || '',
        days: args.plan,
      });
      return { saved: true, savedAt: saved.savedAt, period: saved.plan.period, note: saved.plan.note };
    }

    case 'get_saved_meal_plan': {
      const saved = await store.getSavedMealPlan(userId);
      return saved
        ? { found: true, savedAt: saved.savedAt, plan: saved.plan }
        : { found: false, message: 'No saved meal plan yet. Build one with plan_meals, then save it.' };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { toolSchemas, dispatch, computeDashboard, NATIVE_TOOL_NAMES };
