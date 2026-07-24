'use strict';

/**
 * Feature 6 — Local food recommendations.
 * Given a recommended meal, find matching restaurants on delivery platforms
 * and rank them by price / rating / distance.
 */

const path = require('path');
const data = require(path.join(__dirname, '..', 'data', 'restaurants.json'));

function findLocalFood(meal, opts = {}) {
  const q = String(meal || '').trim().toLowerCase();
  const maxPrice = Number(opts.maxPrice) || Infinity;

  let matches = data.restaurants.filter((r) => {
    const dish = r.dish.toLowerCase();
    return dish.includes(q) || q.includes(dish);
  });

  // If nothing matches the exact dish, don't return junk — say so.
  if (matches.length === 0) {
    return { meal, matches: [], message: `No delivery options found for "${meal}".` };
  }

  matches = matches
    .filter((r) => r.price <= maxPrice)
    // Rank: higher rating first, then cheaper, then closer.
    .sort((a, b) => b.rating - a.rating || a.price - b.price || a.distanceKm - b.distanceKm)
    .slice(0, 5);

  return { meal, matches };
}

module.exports = { findLocalFood };
