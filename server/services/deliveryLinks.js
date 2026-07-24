'use strict';

/**
 * Deep links to Singapore delivery platforms for the Discover "Order" button.
 *
 * IMPORTANT / honest limitation: neither GrabFood nor foodpanda exposes a
 * public URL that drops a stranger onto a *pre-filled checkout* for a specific
 * dish — that requires the user's cart, login and address, which only each
 * platform's official partner API can do. The best a public link can do is open
 * the platform (the installed APP on a phone, via https universal links, or the
 * website) with the restaurant + dish as a search query, so the user taps the
 * item, adds to cart and pays there.
 *
 * To wire real partner deep links later, only this file changes.
 */

// Singapore landing pages per active platform. (Deliveroo has exited Singapore,
// so it is intentionally not listed — unknown platforms return no link.)
const PLATFORM_HOME = {
  grabfood: 'https://food.grab.com/sg/en/',
  foodpanda: 'https://www.foodpanda.sg/',
};

const norm = (p) => String(p || '').trim().toLowerCase();

/**
 * @param {string} platform  'GrabFood' | 'foodpanda'
 * @param {object} opts       { restaurant, dish }
 * @returns {string|null} URL to open, or null for an unknown platform
 */
function orderUrl(platform, opts = {}) {
  const base = PLATFORM_HOME[norm(platform)];
  if (!base) return null;
  const query = [opts.restaurant, opts.dish].filter(Boolean).join(' ').trim();
  // Pass the restaurant/dish as a search hint; platforms that don't use it just
  // land the user on their homepage, still on the right app/site.
  return query ? `${base}?q=${encodeURIComponent(query)}` : base;
}

module.exports = { orderUrl, PLATFORM_HOME };
