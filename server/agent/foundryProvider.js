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
 * SDK: @azure/ai-agents (+ @azure/identity for auth).
 * Auth: DefaultAzureCredential — run `az login` locally, or use a Managed
 * Identity in production. No API keys in code.
 *
 * NOTE FOR THE TEAM: the Azure AI Foundry SDK is evolving. This targets the
 * @azure/ai-agents 1.x surface (client.threads / client.messages / client.runs).
 * If your installed version differs, only THIS file needs adjusting — the mock
 * provider and the rest of the app stay the same. See README "Wiring up Foundry".
 */

const { AgentsClient } = require('@azure/ai-agents');
const { DefaultAzureCredential } = require('@azure/identity');

const config = require('../config');
const { toolSchemas, dispatch } = require('./tools');
const { buildInstructions } = require('./instructions');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);

class FoundryProvider {
  constructor() {
    this.client = new AgentsClient(
      config.foundry.projectEndpoint,
      new DefaultAzureCredential()
    );
    this.model = config.foundry.modelDeployment;
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

    // A fresh agent per request keeps instructions in sync with the live
    // profile. For higher throughput you'd create the agent once and pass
    // per-run instructions instead — see README.
    const agent = await this.client.createAgent(this.model, {
      name: 'HereForFood Nutrition Agent',
      instructions: buildInstructions(profile),
      tools: toolSchemas,
    });

    try {
      const thread = await this.client.threads.create();
      await this.client.messages.create(thread.id, 'user', userMessage);

      let run = await this.client.runs.create(thread.id, agent.id);

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
        throw new Error(`Foundry run ended with status: ${run.status}`);
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
      // Clean up the throwaway agent so they don't accumulate in the project.
      try {
        await this.client.deleteAgent(agent.id);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

module.exports = { FoundryProvider };
