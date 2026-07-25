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
    // NEW-STYLE Foundry agent (versioned, built in the "New Foundry" portal).
    // Referenced by NAME and invoked via the Responses API. Takes precedence
    // over agentId below. Run scripts/sync-foundry-agent.js once so it carries
    // HereForFood's function tools.
    agentName: process.env.AZURE_AI_FOUNDRY_AGENT_NAME || '',

    // Optional: the ID of a CLASSIC agent/assistant ("asst_..."). When set, the
    // app REUSES that agent instead of creating a throwaway one per request.
    agentId: process.env.AZURE_AI_FOUNDRY_AGENT_ID || '',
    // When reusing a portal agent, should the app push its own instructions +
    // tool schemas onto it at startup? Default true — without the tool schemas
    // the agent cannot call HereForFood's functions. Set to "false" to keep the
    // agent exactly as configured in the portal.
    syncAgent: (process.env.AZURE_AI_FOUNDRY_SYNC_AGENT || 'true').toLowerCase() !== 'false',
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
