'use strict';

/**
 * Microsoft Azure AI Foundry Agent Service provider.
 *
 * This is the "real AI" brain. It uses the Azure AI Foundry Agent Service,
 * which manages the agent, conversation threads, and runs on the server side.
 * We supply our function tools; when the model decides to call one, the run
 * enters "requires_action" and we execute the tool locally and submit the
 * output back — this is the agentic tool-use loop.
 *
 * TWO MODES:
 *  1. REUSE A PORTAL AGENT (recommended) — set AZURE_AI_FOUNDRY_AGENT_ID to the
 *     agent you created in the Foundry portal ("asst_..."). On first use the app
 *     pushes HereForFood's tool schemas onto that agent so it can actually call
 *     our functions (disable with AZURE_AI_FOUNDRY_SYNC_AGENT=false).
 *  2. EPHEMERAL AGENT — leave AZURE_AI_FOUNDRY_AGENT_ID empty and the app
 *     creates a temporary agent per request and deletes it afterwards.
 *
 * Per-request personalisation (the user's goal/allergies/etc.) is passed as the
 * run's `instructions`, which override the agent's stored instructions for that
 * run — so one shared agent still gives each user a personalised coach.
 *
 * SDK: @azure/ai-agents (verified against 1.1.0) + @azure/identity for auth.
 * Auth: DefaultAzureCredential — run `az login` locally, or use a Managed
 * Identity in production. No API keys in code.
 */

const { AgentsClient } = require('@azure/ai-agents');
const { DefaultAzureCredential } = require('@azure/identity');

const config = require('../config');
const { toolSchemas, dispatch, NATIVE_TOOL_NAMES } = require('./tools');
const { buildInstructions } = require('./instructions');
const { handlesPortalTool } = require('./portalToolAdapter');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);

/**
 * Compact per-user context appended to a PORTAL agent's own instructions, so
 * each reply is personalised without replacing the persona built in the portal.
 */
function userContext(profile = {}) {
  const list = (a) => (a && a.length ? a.join(', ') : 'none');
  return [
    'CURRENT USER CONTEXT (from the HereForFood app — treat as authoritative):',
    `- Name: ${profile.name || 'not set'}`,
    `- Goal: ${profile.goalText || profile.goal || 'not set'}`,
    `- Daily calorie target: ${profile.calorieGoal != null ? profile.calorieGoal + ' kcal' : 'not set'}`,
    `- Allergies (NEVER recommend these): ${list(profile.allergies)}`,
    `- Dietary restrictions: ${list(profile.dietaryRestrictions)}`,
    `- Likes: ${list(profile.preferences)}`,
    `- Budget per meal: ${profile.budgetPerMeal != null ? 'S$' + profile.budgetPerMeal : 'not set'}`,
    `- Medical condition: ${profile.medicalCondition || 'none stated'}`,
    'Use your tools for all numbers — never invent calories, macros or sodium.',
  ].join('\n');
}

class FoundryProvider {
  constructor() {
    this.client = new AgentsClient(
      config.foundry.projectEndpoint,
      new DefaultAzureCredential()
    );
    this.model = config.foundry.modelDeployment;
    this.agentId = config.foundry.agentId; // '' => ephemeral mode
    this.syncAgent = config.foundry.syncAgent;
    this.readyPromise = null;               // memoised one-time preparation
  }

  /**
   * Resolve the agent we run against, once per process.
   * Returns { id, ephemeral:false } for a portal agent.
   */
  async ensureAgent() {
    if (!this.agentId) return null; // ephemeral mode — created per request
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        let agent;
        try {
          agent = await this.client.getAgent(this.agentId);
        } catch (e) {
          throw new Error(
            `Could not load Foundry agent "${this.agentId}". Check ` +
            `AZURE_AI_FOUNDRY_AGENT_ID and that your signed-in identity has access ` +
            `to the project. Original error: ${e.message}`
          );
        }

        const portalTools = (agent.tools || [])
          .filter((t) => t.type === 'function')
          .map((t) => t.function.name);

        if (this.syncAgent) {
          // OPT-IN ONLY: replace the portal agent's tools with this app's own.
          // Off by default — it overwrites whatever you configured in the portal.
          try {
            await this.client.updateAgent(agent.id, { tools: toolSchemas });
            console.log(`[foundry] Synced ${toolSchemas.length} app tools onto agent ${agent.id}.`);
          } catch (e) {
            console.warn(`[foundry] Could not sync tools onto agent ${agent.id}: ${e.message}`);
          }
        } else if (portalTools.length) {
          // Respect the portal agent's own tools; the adapter implements them.
          const unsupported = portalTools.filter(
            (n) => !handlesPortalTool(n) && !NATIVE_TOOL_NAMES.has(n)
          );
          console.log(
            `[foundry] Using portal agent "${agent.name || agent.id}" with its own ` +
            `${portalTools.length} tool(s): ${portalTools.join(', ')}`
          );
          if (unsupported.length) {
            console.warn(
              `[foundry] NOT IMPLEMENTED by this app: ${unsupported.join(', ')}. ` +
              `Add handlers in server/agent/portalToolAdapter.js, or the agent will get an error for those calls.`
            );
          }
        }
        return agent;
      })().catch((e) => {
        this.readyPromise = null; // allow a retry on the next request
        throw e;
      });
    }
    return this.readyPromise;
  }

  /**
   * Run one user turn through the Foundry agent.
   * @param {object} p
   * @param {string} p.userMessage
   * @param {object} p.profile      user profile (grounds the instructions)
   * @param {object} p.ctx          { userId } passed to tool dispatch
   * @returns {Promise<{reply: string, toolTrace: Array}>}
   */
  async runConversation({ userMessage, profile, ctx }) {
    const toolTrace = [];

    // Prefer the agent you created in the Foundry portal; otherwise spin up a
    // temporary one for this request.
    let agent = await this.ensureAgent();
    const ephemeral = !agent;
    if (ephemeral) {
      agent = await this.client.createAgent(this.model, {
        name: 'HereForFood Nutrition Agent',
        instructions: buildInstructions(profile),
        tools: toolSchemas,
      });
    }

    try {
      const thread = await this.client.threads.create();
      await this.client.messages.create(thread.id, 'user', userMessage);

      // Personalise this turn.
      //  - Ephemeral agent: it already carries our full instructions/tools.
      //  - Portal agent: keep ITS persona and tools intact; just append the
      //    live user context via additionalInstructions so replies are
      //    personalised without clobbering what you built in the portal.
      const runOptions = ephemeral
        ? { instructions: buildInstructions(profile), tools: toolSchemas }
        : { additionalInstructions: userContext(profile) };

      let run = await this.client.runs.create(thread.id, agent.id, runOptions);

      // Poll until the run finishes, servicing tool calls along the way.
      let guard = 0;
      while (!TERMINAL.has(run.status) && guard++ < 40) {
        if (run.status === 'requires_action') {
          const calls =
            run.requiredAction?.submitToolOutputs?.toolCalls || [];
          const toolOutputs = [];

          for (const call of calls) {
            const name = call.function.name;
            let args = {};
            try {
              args = JSON.parse(call.function.arguments || '{}');
            } catch {
              /* leave args empty on malformed JSON */
            }
            const result = await dispatch(name, args, ctx);
            toolTrace.push({ tool: name, args, result });
            toolOutputs.push({
              toolCallId: call.id,
              output: JSON.stringify(result),
            });
          }

          run = await this.client.runs.submitToolOutputs(
            thread.id,
            run.id,
            toolOutputs
          );
          continue;
        }

        await sleep(800);
        run = await this.client.runs.get(thread.id, run.id);
      }

      if (run.status !== 'completed') {
        // Surface Azure's own reason — invaluable when wiring this up.
        const err = run.lastError || run.last_error;
        const detail = err ? ` — ${err.code}: ${err.message}` : '';
        throw new Error(`Foundry run ended with status "${run.status}"${detail}`);
      }

      // Grab the newest assistant message.
      let reply = '';
      const messages = this.client.messages.list(thread.id, { order: 'desc' });
      for await (const m of messages) {
        if (m.role === 'assistant') {
          reply = (m.content || [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text?.value || '')
            .join('\n')
            .trim();
          break;
        }
      }

      return { reply, toolTrace };
    } finally {
      // Only delete agents WE created. Never delete the user's portal agent.
      if (ephemeral) {
        try {
          await this.client.deleteAgent(agent.id);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }
}

module.exports = { FoundryProvider };
