'use strict';

/**
 * Store selector — picks the persistence backend from config (DB_PROVIDER):
 *
 *   "json"     -> server/store/jsonStore.js     (default, zero setup)
 *   "supabase" -> server/store/supabaseStore.js (db/schema.sql on Supabase)
 *
 * Both expose the same async interface, so the rest of the app (routes, agent
 * tools) awaits `store.*` without knowing or caring which backend is live —
 * exactly like the AI_PROVIDER (mock | foundry) split.
 *
 * ChatGPT/Gemini blueprint mapping:
 *   - profile  -> profiles table          (Feature 1 / 7)
 *   - logs     -> meal_logs table         (Feature 3 / 4)
 *   - Discover -> delivery_items table    (Feature 6)
 */

const config = require('./config');

let impl;
if (config.dbProvider === 'supabase') {
  impl = require('./store/supabaseStore'); // lazy: only loads the Supabase SDK when selected
  console.log('[store] Using Supabase (PostgreSQL).');
} else {
  impl = require('./store/jsonStore');
  console.log('[store] Using local JSON store (set DB_PROVIDER=supabase for Supabase).');
}

module.exports = impl;
