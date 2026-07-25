'use strict';

/**
 * Microsoft Foundry — NEW-STYLE AGENT provider ("New Foundry").
 *
 * These are the versioned agents you build in the portal (with Save/Publish and
 * a version number). They are a DIFFERENT resource from the classic
 * "assistants" that @azure/ai-agents talks to, and are invoked through the
 * Responses API:
 *
 *   POST {projectEndpoint}/openai/v1/responses
 *   { "input": ..., "agent_reference": { "type": "agent_reference", "name": "<agent>" } }
 *
 * Function tools must be declared ON the agent (per-request `tools` are
 * rejected with "Not allowed when agent is specified"), so run
 * `node scripts/sync-foundry-agent.js` once to add HereForFood's tools to it.
 *
 * This provider implements the agentic loop: send the turn, execute any
 * function_call items the agent emits against our real services, send the
 * outputs back with `previous_response_id`, and repeat until it answers.
 *
 * Auth: DefaultAzureCredential (`az login` locally, Managed Identity in prod).
 */

const { DefaultAzureCredential } = require('@azure/identity');

const config = require('../config');
const { dispatch } = require('./tools');

const TOKEN_SCOPE = 'https://ai.azure.com/.default';
const MAX_TOOL_ROUNDS = 6;

class FoundryAgentProvider {
  constructor() {
    this.endpoint = (config.foundry.projectEndpoint || '').replace(/\/$/, '');
    this.agentName = config.foundry.agentName;
    this.credential = new DefaultAzureCredential();
    this._token = null; // { token, expiresOnTimestamp }
    // Last response id per user, so multi-turn conversations keep their context
    // (the agent often asks a clarifying question — e.g. about a photo — and the
    // user's next message has to be understood as the answer to it).
    this._lastResponseByUser = new Map();
    console.log(`[foundry] Using new-style Foundry agent: ${this.agentName}`);
  }

  async getToken() {
    const now = Date.now();
    if (this._token && this._token.expiresOnTimestamp - now > 60_000) return this._token.token;
    const t = await this.credential.getToken(TOKEN_SCOPE);
    if (!t) throw new Error('Could not acquire an Azure token. Run `az login`.');
    this._token = t;
    return t.token;
  }

  async post(body) {
    const res = await fetch(`${this.endpoint}/openai/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Foundry Responses API: ${msg}`);
    }
    return data;
  }

  agentRef() {
    return { type: 'agent_reference', name: this.agentName };
  }

  /**
   * Startup preflight: confirm we can authenticate and that the agent exists,
   * so problems surface when you START the app rather than mid-demo.
   * Never throws — the server keeps running either way.
   */
  async verifyConnection() {
    try {
      const res = await fetch(`${this.endpoint}/agents/${this.agentName}?api-version=v1`, {
        headers: { Authorization: `Bearer ${await this.getToken()}` },
      });
      if (!res.ok) {
        console.warn(
          `  ⚠️  Foundry agent "${this.agentName}" not reachable (HTTP ${res.status}). ` +
          `Check AZURE_AI_FOUNDRY_AGENT_NAME / project endpoint.\n`
        );
        return false;
      }
      const agent = await res.json();
      const def = agent.versions?.latest?.definition || {};
      const fns = (def.tools || []).filter((t) => t.type === 'function').map((t) => t.name);
      console.log(`  ✅ Foundry connected: "${agent.name}" v${agent.versions.latest.version}, ${fns.length} app tool(s).`);
      if (!fns.length) {
        console.warn('  ⚠️  This agent has no function tools — it cannot log meals or read the dashboard.');
        console.warn('      Fix: node scripts/sync-foundry-agent.js\n');
      }
      return true;
    } catch (e) {
      console.warn(`  ⚠️  Could not reach Microsoft Foundry: ${e.message}`);
      console.warn('      Most common cause: your Azure login expired — run `az login`.\n');
      return false;
    }
  }

  /** Pull the assistant's text out of a Responses payload. */
  static textFrom(response) {
    if (typeof response.output_text === 'string' && response.output_text.trim()) {
      return response.output_text.trim();
    }
    const parts = [];
    for (const item of response.output || []) {
      if (item.type !== 'message') continue;
      for (const c of item.content || []) {
        if (c.type === 'output_text' || c.type === 'text') parts.push(c.text || '');
      }
    }
    return parts.join('\n').trim();
  }

  /**
   * Run one user turn.
   * @returns {Promise<{reply: string, toolTrace: Array}>}
   */
  async runConversation({ userMessage, profile, ctx, imageUrl }) {
    const toolTrace = [];

    // The agent's own instructions live in the portal; we only append the live
    // user context so replies are personalised (never invent these numbers).
    // A photo (data: URI or https URL) makes this a multimodal turn — the model
    // sees the food image itself, then uses our tools for the actual numbers.
    const userContent = imageUrl
      ? [
          { type: 'input_text', text: String(userMessage || 'What food is in this photo? Estimate it and log it.') },
          { type: 'input_image', image_url: imageUrl },
        ]
      : String(userMessage);

    const input = [
      { type: 'message', role: 'developer', content: userContext(profile) },
      { type: 'message', role: 'user', content: userContent },
    ];

    // Continue the user's existing conversation when we have one.
    const userKey = ctx?.userId || 'demo';
    const previousId = this._lastResponseByUser.get(userKey);

    let response;
    try {
      response = await this.post({
        input,
        agent_reference: this.agentRef(),
        ...(previousId ? { previous_response_id: previousId } : {}),
      });
    } catch (e) {
      // An expired/unknown previous response must not break the conversation.
      if (!previousId) throw e;
      this._lastResponseByUser.delete(userKey);
      response = await this.post({ input, agent_reference: this.agentRef() });
    }

    // Agentic loop: satisfy function calls until the agent produces an answer.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = (response.output || []).filter((o) => o.type === 'function_call');
      if (!calls.length) break;

      const outputs = [];
      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          /* malformed args -> empty */
        }
        let result;
        try {
          result = await dispatch(call.name, args, ctx);
        } catch (e) {
          result = { error: e.message };
        }
        toolTrace.push({ tool: call.name, args, result });
        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }

      response = await this.post({
        input: outputs,
        agent_reference: this.agentRef(),
        previous_response_id: response.id,
      });
    }

    // Remember where this conversation ended so the next turn continues it.
    if (response.id) this._lastResponseByUser.set(userKey, response.id);

    const reply = FoundryAgentProvider.textFrom(response);
    return {
      reply: reply || "I couldn't produce a reply just now — please try again.",
      toolTrace,
    };
  }
}

/** Live user context appended to the agent's portal instructions. */
function userContext(profile = {}) {
  const list = (a) => (a && a.length ? a.join(', ') : 'none');
  return [
    'CURRENT USER CONTEXT (from the HereForFood app — authoritative):',
    `- Name: ${profile.name || 'not set'}`,
    `- Age: ${profile.age ?? 'not set'} | Gender: ${profile.gender || 'not set'}`,
    `- Goal: ${profile.goalText || profile.goal || 'not set'}`,
    `- Daily calorie target: ${profile.calorieGoal != null ? profile.calorieGoal + ' kcal' : 'not set'}`,
    `- Allergies (NEVER recommend these): ${list(profile.allergies)}`,
    `- Dietary restrictions: ${list(profile.dietaryRestrictions)}`,
    `- Medical condition: ${profile.medicalCondition || 'none stated'}`,
    `- Likes: ${list(profile.preferences)}`,
    `- Budget per meal: ${profile.budgetPerMeal != null ? 'S$' + profile.budgetPerMeal : 'not set'}`,
    '',
    'The user is in Singapore. Use your function tools for all food data and',
    'actions — the app database is the source of truth for calories, macros,',
    'hawker/kopitiam/food-court options and prices. Never invent numbers.',
  ].join('\n');
}

module.exports = { FoundryAgentProvider };
