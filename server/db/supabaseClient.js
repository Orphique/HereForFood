'use strict';

/**
 * Server-side Supabase client.
 *
 * Uses the SERVICE ROLE key so the backend can read/write on the user's behalf
 * (the demo uses header-based auth rather than end-to-end Supabase Auth). Keep
 * the service role key server-only — never ship it to the app.
 *
 * Only constructed when DB_PROVIDER=supabase; otherwise this module is never
 * required, so the app runs with no Supabase dependency at all.
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  throw new Error(
    'DB_PROVIDER=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in .env'
  );
}

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = { supabase };
