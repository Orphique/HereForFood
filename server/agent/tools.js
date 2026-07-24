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
];

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

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { toolSchemas, dispatch, computeDashboard };
