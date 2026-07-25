'use strict';

/**
 * Smart grocery list (updated requirements: "Smart grocery lists:
 * Auto-generating shopping lists based on planned meals").
 *
 * Builds a consolidated shopping list from the recipes in a generated meal plan,
 * counting how many times each ingredient is needed across the day/week.
 */

const { generatePlan } = require('./mealPlanner');

function collectMeals(plan) {
  if (plan.period === 'week') return plan.days.flatMap((d) => d.meals);
  return plan.meals;
}

function buildGroceryList(profile, period = 'day') {
  const plan = generatePlan(profile, period);
  const counts = new Map(); // ingredient -> times needed

  for (const slot of collectMeals(plan)) {
    const recipe = slot.meal && slot.meal.recipe;
    if (!recipe) continue;
    for (const ing of recipe.ingredients || []) {
      const key = ing.trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const items = [...counts.entries()]
    .map(([item, qty]) => ({ item, qty }))
    .sort((a, b) => b.qty - a.qty || a.item.localeCompare(b.item));

  return {
    period: plan.period,
    goal: plan.goal || profile.goal || null,
    itemCount: items.length,
    items,
    note: 'Cook-at-home ingredients from your meal plan. Delivery meals are excluded.',
  };
}

module.exports = { buildGroceryList };
