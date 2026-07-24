'use strict';

/**
 * Recipe lookup (tab 2, section 5 — "[ View Recipe ]").
 */

const path = require('path');
const data = require(path.join(__dirname, '..', 'data', 'recipes.json'));

function getRecipe(dishOrName) {
  const q = String(dishOrName || '').trim().toLowerCase();
  if (!q) return null;
  return (
    data.recipes.find((r) => r.forDish.toLowerCase() === q) ||
    data.recipes.find((r) => r.forDish.toLowerCase().includes(q) || q.includes(r.forDish.toLowerCase())) ||
    data.recipes.find((r) => r.title.toLowerCase().includes(q)) ||
    null
  );
}

module.exports = { getRecipe, recipes: data.recipes };
