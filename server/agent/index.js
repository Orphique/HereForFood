'use strict';

/**
 * Agent factory — picks the provider based on config (AI_PROVIDER) and exposes
 * a single, stable interface to the rest of the app:
 *
 *     const agent = getAgent();
 *     const { reply, toolTrace } = await agent.runConversation({ userMessage, profile, ctx });
 *
 * Both providers implement runConversation() identically, so routes never care
 * whether they're talking to real Azure AI Foundry or the offline mock.
 */

const config = require('./../config');
const { MockProvider } = require('./mockProvider');

let instance = null;

function getAgent() {
  if (instance) return instance;

  if (config.aiProvider === 'foundry') {
    // Require lazily so the heavy Azure SDK only loads when actually used.
    const { FoundryProvider } = require('./foundryProvider');
    instance = new FoundryProvider();
    console.log('[agent] Using Azure AI Foundry Agent Service.');
  } else {
    instance = new MockProvider();
    console.log('[agent] Using offline MOCK agent (set AI_PROVIDER=foundry for real AI).');
  }
  return instance;
}

module.exports = { getAgent };
