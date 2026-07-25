'use strict';

/**
 * Meal estimation (tab 2, sections 3 & 4).
 *
 * Turns a natural-language / photo-caption / voice-transcript meal description
 * into a list of DETECTED ITEMS, each with a default portion (grams) and the
 * nutrition the database gives for that portion. The front end then lets the
 * user ADJUST portions before logging, and we recalc via nutritionForGrams().
 *
 * Framing is deliberately "estimate", not "exact" — the doc is explicit that a
 * photo can't reveal portion size, oil, sauce, etc.
 */

const { findFood, nutritionForGrams } = require('./nutrition');

// Pull rough quantities like "two slices", "2 eggs", "a cup of" out of text.
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function detectQuantity(fragment) {
  const m = fragment.match(/\b(\d+(?:\.\d+)?)\b/);
  if (m) return Number(m[1]);
  for (const [w, n] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(fragment)) return n;
  }
  return 1;
}

/**
 * @param {string} description  e.g. "chicken rice with an egg and iced Milo"
 * @returns {{ description, items: Array, totals }}
 */
function estimateMeal(description) {
  const fragments = String(description || '')
    .split(/,| and | with | plus |\+|&/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const frag of fragments) {
    const food = findFood(frag);
    if (!food) {
      items.push({ text: frag, matched: null });
      continue;
    }
    const qty = detectQuantity(frag);
    const grams = food.grams * qty;
    const nut = nutritionForGrams(food.name, grams);
    items.push({ text: frag, matched: food.name, quantityGuess: qty, ...nut });
  }

  const totals = items
    .filter((i) => i.found)
    .reduce(
      (acc, i) => ({
        calories: acc.calories + i.calories,
        protein: acc.protein + i.protein,
        carbs: acc.carbs + i.carbs,
        fat: acc.fat + i.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

  return {
    description,
    disclaimer: 'AI-powered estimate. Adjust portions for a more accurate figure.',
    items,
    totals,
  };
}

module.exports = { estimateMeal };
