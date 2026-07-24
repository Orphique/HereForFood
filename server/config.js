'use strict';

/**
 * Centralised configuration, loaded from environment variables (.env).
 * Keeping this in one place means the rest of the app never touches process.env
 * directly — easier to test and to reason about.
 */

require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3000,

  // "foundry" -> real Azure AI Foundry Agent Service. "mock" -> offline agent.
  aiProvider: (process.env.AI_PROVIDER || 'mock').toLowerCase(),

  foundry: {
    projectEndpoint: process.env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT || '',
    modelDeployment: process.env.AZURE_AI_FOUNDRY_MODEL_DEPLOYMENT || 'gpt-4o-mini',
  },

  // "json" -> local JSON file (default). "supabase" -> PostgreSQL via Supabase.
  dbProvider: (process.env.DB_PROVIDER || 'json').toLowerCase(),

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },
};

// Fail fast with a clear message if someone selects Foundry without configuring it.
if (config.aiProvider === 'foundry' && !config.foundry.projectEndpoint) {
  console.warn(
    '[config] AI_PROVIDER=foundry but AZURE_AI_FOUNDRY_PROJECT_ENDPOINT is empty. ' +
    'Falling back to the mock agent. Set the endpoint in .env to use real AI.'
  );
  config.aiProvider = 'mock';
}

// Same guard for the database backend.
if (config.dbProvider === 'supabase' && (!config.supabase.url || !config.supabase.serviceRoleKey)) {
  console.warn(
    '[config] DB_PROVIDER=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are empty. ' +
    'Falling back to the local JSON store. Set them in .env to use Supabase.'
  );
  config.dbProvider = 'json';
}

module.exports = config;
