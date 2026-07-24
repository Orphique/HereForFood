'use strict';

/**
 * Feature 3 — AI nutrition estimation (the "Nutrition database" step).
 *
 * The AI agent identifies a food from the user's input, then calls
 * lookupNutrition() to turn a food name + quantity into calories + macros.
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'data', 'nutrition-db.json'));

const foods = db.foods;

function normalise(s) {
  return String(s || '').trim().toLowerCase();
}

/** Find the best matching food entry by name or alias (fuzzy-ish, no deps). */
function findFood(query) {
  const q = normalise(query);
  if (!q) return null;

  // 1) exact name / alias match
  for (const f of foods) {
    if (normalise(f.name) === q) return f;
    if (f.aliases.some((a) => normalise(a) === q)) return f;
  }
  // 2) substring match (either direction)
  for (const f of foods) {
    const names = [f.name, ...f.aliases].map(normalise);
    if (names.some((n) => n.includes(q) || q.includes(n))) return f;
  }
  return null;
}

/**
 * @param {string} name     food name (e.g. "chicken rice")
 * @param {number} quantity number of servings (default 1)
 * @returns nutrition object or an "unknown" result the agent can relay honestly
 */
function lookupNutrition(name, quantity = 1) {
  const qty = Number(quantity) > 0 ? Number(quantity) : 1;
  const food = findFood(name);

  if (!food) {
    return {
      found: false,
      query: name,
      message: `No nutrition data found for "${name}". Ask the user to rephrase or add it to the database.`,
    };
  }

  const round = (n) => Math.round(n * qty);
  return {
    found: true,
    name: food.name,
    servings: qty,
    serving: food.serving,
    calories: round(food.calories),
    protein: round(food.protein),
    carbs: round(food.carbs),
    fat: round(food.fat),
    tags: food.tags,
  };
}

/**
 * Scale a food's nutrition to an arbitrary weight in grams (tab 2, section 4:
 * "Adjust Portions"). This is how the Log Food page recalculates calories when
 * the user changes a portion. The AI identifies the food; the DATABASE (this)
 * provides the numbers — never the AI directly.
 *
 * @param {string} name   food name
 * @param {number} grams  desired portion weight in grams
 */
function nutritionForGrams(name, grams) {
  const food = findFood(name);
  if (!food) return { found: false, query: name };
  const g = Number(grams) > 0 ? Number(grams) : food.grams;
  const factor = g / food.grams;
  const round = (n) => Math.round(n * factor);
  return {
    found: true,
    name: food.name,
    grams: Math.round(g),
    defaultGrams: food.grams,
    calories: round(food.calories),
    protein: round(food.protein),
    carbs: round(food.carbs),
    fat: round(food.fat),
    tags: food.tags,
  };
}

module.exports = { lookupNutrition, nutritionForGrams, findFood, foods };
