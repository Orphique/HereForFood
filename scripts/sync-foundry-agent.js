#!/usr/bin/env node
'use strict';

/**
 * Add HereForFood's function tools to a NEW-STYLE Microsoft Foundry agent.
 *
 * New Foundry agents (the versioned ones with a Publish button) are NOT the
 * same as the classic "assistants" that @azure/ai-agents talks to. They live at
 *   {projectEndpoint}/agents?api-version=v1
 * and are invoked through the Responses API with an `agent_reference`.
 *
 * Crucially, you CANNOT pass function tools per request to such an agent
 * ("Not allowed when agent is specified") — the tools must be part of the agent
 * definition. This script creates a NEW VERSION of the agent that keeps its
 * existing instructions and hosted tools (web_search / file_search) and adds
 * HereForFood's function tools, so the agent can actually call back into the app.
 *
 * The previous version is untouched and can be restored in the portal.
 *
 * Usage:  node scripts/sync-foundry-agent.js [--dry-run]
 * Reads AZURE_AI_FOUNDRY_PROJECT_ENDPOINT and AZURE_AI_FOUNDRY_AGENT_NAME.
 */

require('dotenv').config();
const { DefaultAzureCredential } = require('@azure/identity');
const { toolSchemas } = require('../server/agent/tools');

const ENDPOINT = (process.env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT || '').replace(/\/$/, '');
const AGENT = process.env.AZURE_AI_FOUNDRY_AGENT_NAME || '';
const API = 'api-version=v1';
const DRY = process.argv.includes('--dry-run');

if (!ENDPOINT || !AGENT) {
  console.error('Set AZURE_AI_FOUNDRY_PROJECT_ENDPOINT and AZURE_AI_FOUNDRY_AGENT_NAME in .env');
  process.exit(1);
}

/** Classic tool schema {type,function:{...}} -> new flat shape {type,name,...}. */
function toNewToolShape(t) {
  if (t.type !== 'function' || !t.function) return t;
  return {
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  };
}

async function token() {
  const cred = new DefaultAzureCredential();
  const t = await cred.getToken('https://ai.azure.com/.default');
  if (!t) throw new Error('Could not get an Azure token. Run: az login');
  return t.token;
}

async function main() {
  const tok = await token();
  const headers = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

  // 1. Read the current agent definition.
  const getRes = await fetch(`${ENDPOINT}/agents/${AGENT}?${API}`, { headers });
  if (!getRes.ok) {
    throw new Error(`Could not read agent "${AGENT}" (HTTP ${getRes.status}). ${await getRes.text()}`);
  }
  const agent = await getRes.json();
  const latest = agent.versions?.latest;
  if (!latest) throw new Error(`Agent "${AGENT}" has no versions.`);
  const def = latest.definition || {};

  const existing = def.tools || [];
  const hosted = existing.filter((t) => t.type !== 'function');   // web_search, file_search, ...
  const ourTools = toolSchemas.map(toNewToolShape);
  const ourNames = new Set(ourTools.map((t) => t.name));
  // Keep any function tools the user added that aren't ours.
  const foreign = existing.filter((t) => t.type === 'function' && !ourNames.has(t.name));

  const newDefinition = {
    ...def,
    tools: [...hosted, ...foreign, ...ourTools],
  };

  console.log(`Agent   : ${AGENT}`);
  console.log(`Current : v${latest.version} — ${existing.length} tool(s): ${existing.map((t) => t.name || t.type).join(', ')}`);
  console.log(`New     : ${newDefinition.tools.length} tool(s)`);
  console.log(`  kept  : ${[...hosted, ...foreign].map((t) => t.name || t.type).join(', ') || '(none)'}`);
  console.log(`  added : ${ourTools.map((t) => t.name).join(', ')}`);
  console.log(`Instructions preserved: ${(def.instructions || '').length} chars`);

  if (DRY) {
    console.log('\n--dry-run: no changes made.');
    return;
  }

  // 2. Create a NEW VERSION (the old one stays available in the portal).
  const putRes = await fetch(`${ENDPOINT}/agents/${AGENT}/versions?${API}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ definition: newDefinition }),
  });
  if (!putRes.ok) {
    throw new Error(`Failed to create new version (HTTP ${putRes.status}). ${await putRes.text()}`);
  }
  const created = await putRes.json();
  console.log(`\n✅ Created ${AGENT} v${created.version} with ${created.definition?.tools?.length ?? '?'} tools.`);
  console.log('   The previous version is still in the portal if you want to roll back.');
}

main().catch((e) => {
  console.error('\n❌ ' + e.message);
  process.exit(1);
});
