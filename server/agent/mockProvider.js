'use strict';

/**
 * Offline "mock" agent — no Azure required.
 *
 * This is NOT the AI; it's a deterministic stand-in so your team can develop
 * the UI, demo the full flow, and run automated tests without spending Azure
 * credits or needing `az login`. It uses a small intent router to decide which
 * of the SAME tools (tools.js) to call, then writes a friendly reply from the
 * tool results — mirroring what the Foundry agent does, just without an LLM.
 *
 * Swap AI_PROVIDER=foundry in .env to use the real agent.
 */

const { dispatch } = require('./tools');
const nutrition = require('../services/nutrition');

const has = (text, words) => words.some((w) => text.includes(w));

function fmtMeal(m) {
  return `${m.name} — ${m.calories} kcal (P ${m.protein}g / C ${m.carbs}g / F ${m.fat}g)`;
}

class MockProvider {
  async runConversation({ userMessage, profile, ctx }) {
    const text = String(userMessage || '').toLowerCase();
    const toolTrace = [];
    const run = async (name, args) => {
      const result = await dispatch(name, args, ctx);
      toolTrace.push({ tool: name, args, result });
      return result;
    };

    // --- Intent: dashboard / progress ------------------------------------
    if (has(text, ['dashboard', 'how am i', 'how are we', 'progress', 'remaining', 'left today', 'so far'])) {
      const d = await run('get_dashboard', {});
      const rem = d.remainingCalories;
      const remLine =
        rem == null
          ? `Set a calorie goal in your profile and I'll track what's left.`
          : rem >= 0
          ? `You've got ${rem} kcal left today. Keep it tidy.`
          : `You're ${Math.abs(rem)} kcal over — ease off for the rest of the day.`;
      return {
        reply:
          `Today so far: ${d.consumed.calories} kcal across ${d.mealsLogged} meal(s) — ` +
          `P ${d.consumed.protein}g / C ${d.consumed.carbs}g / F ${d.consumed.fat}g. ${remLine}`,
        toolTrace,
      };
    }

    // --- Intent: recipe --------------------------------------------------
    if (has(text, ['recipe', 'how do i cook', 'how to cook', 'how do i make', 'ingredients for'])) {
      let meal = null;
      for (const f of nutrition.foods) { if (text.includes(f.name)) { meal = f.name; break; } }
      if (!meal) return { reply: `Which dish would you like the recipe for?`, toolTrace };
      const r = await run('get_recipe', { meal });
      if (!r.found) return { reply: `I don't have a recipe for ${meal} yet.`, toolTrace };
      const rc = r.recipe;
      return {
        reply:
          `${rc.title} — ~$${rc.estimatedCost}, ${rc.timeMinutes} min\n` +
          `Ingredients: ${rc.ingredients.join(', ')}\n` +
          rc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
        toolTrace,
      };
    }

    // --- Intent: meal plan (day / week) ----------------------------------
    if (has(text, ['meal plan', 'plan my', 'plan for', 'weekly plan', 'daily plan', 'plan the', 'what to eat this week'])) {
      const period = has(text, ['week', 'weekly']) ? 'week' : 'day';
      const plan = await run('plan_meals', { period });
      if (period === 'week') {
        const lines = plan.days.map((d) => `${d.label}: ` +
          d.meals.filter((m) => m.meal).map((m) => `${m.emoji} ${m.meal.name}`).join(', ')).join('\n');
        return { reply: `Here's your week:\n${lines}`, toolTrace };
      }
      const lines = plan.meals.filter((m) => m.meal)
        .map((m) => `${m.emoji} ${m.type[0].toUpperCase() + m.type.slice(1)}: ${m.meal.name} (${m.meal.calories} kcal)`).join('\n');
      return { reply: `Today's plan (${plan.totals.calories} kcal total):\n${lines}`, toolTrace };
    }

    // --- Intent: recommend a meal ----------------------------------------
    if (has(text, ['recommend', 'what should i eat', 'suggest', 'meal idea', 'hungry', 'what can i eat'])) {
      const rec = await run('recommend_meals', {});
      if (!rec.recommendations.length) {
        return { reply: `I couldn't find a meal that fits right now — try logging some food first.`, toolTrace };
      }
      const top = rec.recommendations.slice(0, 3).map((m, i) => `${i + 1}. ${fmtMeal(m)}`).join('\n');
      const goalNote = {
        lose_weight: `Aiming for a deficit — these lean toward satiety.`,
        build_muscle: `Protein first — these will help you build.`,
        eat_healthier: `Wholesome picks, nothing processed.`,
      }[profile.goal] || `Balanced picks for your goal.`;
      return { reply: `${goalNote}\nHere's what I'd cook up:\n${top}`, toolTrace };
    }

    // --- Intent: find local / delivery food ------------------------------
    if (has(text, ['order', 'delivery', 'deliver', 'grab', 'foodpanda', 'restaurant', 'hawker', 'kopitiam', 'food court', 'koufu', 'near me', 'buy'])) {
      // Try to pull a known food name out of the message.
      let meal = null;
      for (const f of nutrition.foods) {
        if (text.includes(f.name)) { meal = f.name; break; }
      }
      if (!meal) {
        const rec = await run('recommend_meals', {});
        meal = rec.recommendations[0]?.name;
      }
      if (!meal) return { reply: `Tell me what you fancy and I'll find it nearby.`, toolTrace };

      const local = await run('find_local_food', { meal });
      if (!local.matches.length) return { reply: `No delivery options for ${meal} nearby right now.`, toolTrace };
      const list = local.matches
        .map((r) => `• ${r.name} — $${r.price.toFixed(2)}, ⭐${r.rating}, ${r.distanceKm}km on ${r.platform} (${r.eta})`)
        .join('\n');
      return { reply: `For ${meal}, here are your best delivery options:\n${list}`, toolTrace };
    }

    // --- Intent: log food (default when they mention a known food) -------
    const mentioned = nutrition.foods.filter((f) =>
      [f.name, ...f.aliases].some((n) => text.includes(n))
    );
    const soundsLikeEating = has(text, ['ate', 'had', 'eat', 'log', 'just finished', 'for lunch', 'for breakfast', 'for dinner']);

    if (mentioned.length && (soundsLikeEating || !has(text, ['?']))) {
      // Infer meal type from the message, else from the time of day.
      const mealType =
        has(text, ['breakfast']) ? 'breakfast' :
        has(text, ['lunch']) ? 'lunch' :
        has(text, ['dinner', 'supper']) ? 'dinner' :
        has(text, ['snack']) ? 'snack' :
        (() => { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack'; })();

      const est = await run('estimate_meal', { description: userMessage });
      const logged = [];
      for (const item of est.items) {
        if (!item.found) continue;
        await run('log_meal', {
          name: item.name, grams: item.grams, meal_type: mealType,
          calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat,
        });
        logged.push(item);
      }
      if (!logged.length) {
        return { reply: `I couldn't match that to my food database. Try a simpler name?`, toolTrace };
      }
      const d = await run('get_dashboard', {});
      const lines = logged.map((m) => `✓ ${fmtMeal(m)}`).join('\n');
      const remLine = d.remainingCalories == null ? '' : ` You've ${d.remainingCalories} kcal left today.`;
      return { reply: `Logged to ${mealType} (estimated — adjust portions on the Log page if needed):\n${lines}\nNice one.${remLine}`, toolTrace };
    }

    // --- Fallback: guidance ----------------------------------------------
    return {
      reply:
        `I'm your Singapore nutrition coach. Try:\n` +
        `• "I had chicken rice and a kopi" — I'll log it\n` +
        `• "How am I doing today?" — your dashboard\n` +
        `• "What should I eat?" — a local meal idea for your goal\n` +
        `• "Order laksa nearby" — hawker/food-court delivery options`,
      toolTrace,
    };
  }
}

module.exports = { MockProvider };
