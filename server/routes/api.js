'use strict';

/**
 * REST API — the bridge between the front end and the agent/services.
 *
 * Endpoints (mapped to the ChatGPT blueprint + tab 2):
 *   POST /api/login              Feature 1 — mock Google/Email login
 *   GET  /api/profile            Feature 1/7 — read profile + goal
 *   PUT  /api/profile            Feature 1/7 — onboarding / Settings page
 *   POST /api/estimate           tab 2 s.3-4 — estimate a meal (adjustable portions)
 *   POST /api/log                Feature 2/3 — log food (single OR adjusted items)
 *   GET  /api/dashboard          Feature 4 / tab 2 s.2 — totals, macro targets, meals by type
 *   POST /api/recommend          Feature 5/7 — goal-aware meal recommendations
 *   GET  /api/mealplan           tab 2 s.5 — daily/weekly plan ("Plan")
 *   GET  /api/recipe             tab 2 s.5 — recipe for a meal
 *   GET  /api/discover           tab 2 s.6 — orderable meals near you ("Discover")
 *   GET  /api/local              Feature 6 — delivery options for a meal
 *   POST /api/chat               The agent — natural-language, tool-using coach
 */

const express = require('express');
const router = express.Router();

const store = require('../store');
const { getAgent } = require('../agent');
const { computeDashboard, dispatch } = require('../agent/tools');
const { recommendMeals } = require('../services/recommend');
const { findLocalFood } = require('../services/restaurants');
const { nutritionForGrams } = require('../services/nutrition');
const { estimateMeal } = require('../services/estimate');
const { generatePlan } = require('../services/mealPlanner');
const { getRecipe } = require('../services/recipes');
const { recommendedCalories, bmi, bmiCategory } = require('../services/calories');
const { buildGroceryList } = require('../services/grocery');
const { applyProfileUpdate } = require('../services/profileService');
const { orderUrl } = require('../services/deliveryLinks');

/**
 * Identify the user. This demo trusts an "x-user-id" header (set at login).
 * A real app would use Google OAuth / session cookies / JWT here (Feature 1).
 */
function userId(req) {
  return req.get('x-user-id') || req.body.userId || 'demo';
}

// --- Feature 1: (mock) login ------------------------------------------------
router.post('/login', async (req, res, next) => {
  try {
    // In production: verify a Google ID token or email+password here.
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email required' });
    const id = email; // use the email as the stable user id for the demo
    const user = await store.getOrCreateUser(id);
    const needsOnboarding = !user.profile.goal;
    res.json({ userId: id, profile: user.profile, needsOnboarding });
  } catch (e) { next(e); }
});

// --- Feature 1/7: profile ---------------------------------------------------
router.get('/profile', async (req, res, next) => {
  try {
    const user = await store.getOrCreateUser(userId(req));
    res.json(user.profile);
  } catch (e) { next(e); }
});

router.put('/profile', async (req, res, next) => {
  try {
    // Shared with the agent's update_profile tool, so typing a change in
    // Settings and asking the coach to change it behave identically.
    const { profile } = await applyProfileUpdate(userId(req), req.body);
    res.json(profile);
  } catch (e) { next(e); }
});

// --- tab 2 s.3-4: estimate a described meal (no logging yet) -----------------
// Returns detected items + default portions + nutrition so the Log Food page
// can show "AI detected ... / Adjust portions" before the user commits.
router.post('/estimate', (req, res) => {
  const description = (req.body.description || '').trim();
  if (!description) return res.status(400).json({ error: 'description required' });
  res.json(estimateMeal(description));
});

// --- Feature 2/3: log food. Accepts either a single item, or a list of -------
// portion-adjusted items from the estimate flow. mealType groups it on the
// dashboard (tab 2 s.2). Nutrition is always recomputed server-side from grams
// so the client can't submit bogus numbers.
router.post('/log', async (req, res, next) => {
  try {
    const ctx = { userId: userId(req) };
    const mealType = ['breakfast', 'lunch', 'dinner', 'snack'].includes(req.body.mealType)
      ? req.body.mealType : 'snack';

    // Shape A: { items: [{ name, grams }], mealType } — the adjust-portions flow.
    if (Array.isArray(req.body.items) && req.body.items.length) {
      const logged = [];
      for (const it of req.body.items) {
        if (!it.name) continue;
        const nut = nutritionForGrams(it.name, it.grams);
        if (!nut.found) continue;
        const r = await dispatch('log_meal', {
          name: nut.name, grams: nut.grams, meal_type: mealType,
          calories: nut.calories, protein: nut.protein, carbs: nut.carbs, fat: nut.fat,
        }, ctx);
        logged.push(r.entry);
      }
      if (!logged.length) return res.status(404).json({ error: 'No known foods to log.' });
      return res.json({ logged: true, entries: logged, dashboard: await computeDashboard(ctx.userId) });
    }

    // Shape B: { name, quantity, mealType } — quick single-item log.
    const { name, quantity } = req.body;
    if (!name) return res.status(400).json({ error: 'name or items[] required' });
    const nut = await dispatch('lookup_nutrition', { name, quantity: quantity ?? 1 }, ctx);
    if (!nut.found) return res.status(404).json(nut);
    const result = await dispatch('log_meal', {
      name: nut.name, quantity: nut.servings, meal_type: mealType,
      calories: nut.calories, protein: nut.protein, carbs: nut.carbs, fat: nut.fat,
    }, ctx);
    res.json(result);
  } catch (e) { next(e); }
});

/**
 * Feature 2 — image/voice logging hook.
 * The front end can send a base64 image or a transcript. In "foundry" mode you
 * would forward the image to a vision-capable model deployment and the audio to
 * Azure AI Speech, then feed the resulting text into the agent. For now this
 * accepts a transcript/caption and routes it straight to the agent.
 */
router.post('/log/media', async (req, res, next) => {
  try {
    const { transcript } = req.body; // caption from vision, or speech-to-text
    if (!transcript) {
      return res.status(400).json({
        error: 'Send { transcript } (caption from image OCR/vision or speech-to-text). ' +
               'Wire Azure AI Vision / Speech here to generate it.',
      });
    }
    const agent = getAgent();
    const user = await store.getOrCreateUser(userId(req));
    const out = await agent.runConversation({
      userMessage: transcript, profile: user.profile, ctx: { userId: user.id },
    });
    res.json(out);
  } catch (e) { next(e); }
});

// --- Feature 4: dashboard ---------------------------------------------------
router.get('/dashboard', async (req, res, next) => {
  try {
    res.json(await computeDashboard(userId(req)));
  } catch (e) { next(e); }
});

// --- Feature 5/7: recommendations ------------------------------------------
router.post('/recommend', async (req, res, next) => {
  try {
    const user = await store.getOrCreateUser(userId(req));
    const dash = await computeDashboard(user.id);
    const out = recommendMeals({
      remainingCalories: req.body.remainingCalories ?? dash.remainingCalories,
      goal: user.profile.goal || 'maintain',
      restrictions: user.profile.dietaryRestrictions,
      allergies: user.profile.allergies,
      preferences: user.profile.preferences,
      budgetPerMeal: req.body.budgetPerMeal ?? user.profile.budgetPerMeal,
    });
    res.json(out);
  } catch (e) { next(e); }
});

// --- tab 2 s.5: meal plan (daily / weekly) — the "Plan" pillar --------------
router.get('/mealplan', async (req, res, next) => {
  try {
    const user = await store.getOrCreateUser(userId(req));
    const period = req.query.period === 'week' ? 'week' : 'day';
    res.json(generatePlan(user.profile, period));
  } catch (e) { next(e); }
});

// --- updated req: smart grocery list from the meal plan --------------------
router.get('/grocery', async (req, res, next) => {
  try {
    const user = await store.getOrCreateUser(userId(req));
    const period = req.query.period === 'week' ? 'week' : 'day';
    res.json(buildGroceryList(user.profile, period));
  } catch (e) { next(e); }
});

// --- tab 2 s.5: recipe for a meal ------------------------------------------
router.get('/recipe', (req, res) => {
  const meal = req.query.meal;
  if (!meal) return res.status(400).json({ error: 'meal query param required' });
  const recipe = getRecipe(meal);
  if (!recipe) return res.status(404).json({ error: `No recipe for "${meal}".` });
  res.json(recipe);
});

// --- tab 2 s.6: Discover — meals you can actually order near you ------------
// Combines goal-aware recommendations with delivery matches so each card has
// rating + price + calories (the doc's Singapore differentiator).
router.get('/discover', async (req, res, next) => {
  try {
    const user = await store.getOrCreateUser(userId(req));
    const dash = await computeDashboard(user.id);
    const rec = recommendMeals({
      remainingCalories: dash.remainingCalories,
      goal: user.profile.goal || 'maintain',
      restrictions: user.profile.dietaryRestrictions,
      allergies: user.profile.allergies,
      preferences: user.profile.preferences,
      budgetPerMeal: user.profile.budgetPerMeal,
    });

    const cards = [];
    for (const meal of rec.recommendations) {
      const local = findLocalFood(meal.name, { maxPrice: user.profile.budgetPerMeal || undefined });
      for (const r of local.matches.slice(0, 1)) {
        cards.push({
          meal: meal.name, calories: meal.calories, protein: meal.protein,
          restaurant: r.name, venue: r.venue, type: r.type,
          price: r.price, rating: r.rating,
          distanceKm: r.distanceKm, platform: r.platform, eta: r.eta,
          orderUrl: orderUrl(r.platform, { restaurant: r.name, dish: meal.name }),
        });
      }
    }
    res.json({
      remainingCalories: dash.remainingCalories,
      budget: user.profile.budgetPerMeal,
      cards: cards.slice(0, 5),
    });
  } catch (e) { next(e); }
});

// --- Feature 6: local delivery options -------------------------------------
router.get('/local', (req, res) => {
  const { meal, maxPrice } = req.query;
  if (!meal) return res.status(400).json({ error: 'meal query param required' });
  res.json(findLocalFood(meal, { maxPrice: maxPrice ? Number(maxPrice) : undefined }));
});

// --- The agent: conversational, tool-using coach ---------------------------
router.post('/chat', async (req, res, next) => {
  try {
    const message = (req.body.message || '').trim();
    // `image` is an optional data: URI or https URL — photo logging via chat.
    const image = typeof req.body.image === 'string' ? req.body.image.trim() : '';
    if (!message && !image) return res.status(400).json({ error: 'message or image required' });
    if (image && !/^(data:image\/(png|jpe?g|webp|gif);base64,|https:\/\/)/i.test(image)) {
      return res.status(400).json({ error: 'image must be a base64 image data URI or an https URL.' });
    }

    const user = await store.getOrCreateUser(userId(req));
    const agent = getAgent();
    const out = await agent.runConversation({
      userMessage: message,
      profile: user.profile,
      ctx: { userId: user.id },
      imageUrl: image || undefined,
    });

    // If the agent asked to open a page, pass that directive to the client.
    const navCall = [...(out.toolTrace || [])]
      .reverse()
      .find((t) => t.tool === 'navigate_to_page' && t.result && t.result.navigated);

    // Return the live profile too — the agent can now change settings, so the
    // UI needs the latest values to stay in sync.
    const after = await store.getOrCreateUser(user.id);
    res.json({
      reply: out.reply,
      toolTrace: out.toolTrace,
      dashboard: await computeDashboard(user.id),
      profile: after.profile,
      navigate: navCall ? navCall.result.page : undefined,
    });
  } catch (e) { next(e); }
});

module.exports = router;
