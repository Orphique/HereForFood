'use strict';

/**
 * Seed Supabase `delivery_items` from HereForFood's Singapore data.
 *
 * This adapts the Gemini-tab seed script to reuse the app's own data
 * (server/data/restaurants.json joined with nutrition-db.json) so the database
 * matches what the rest of the app already knows — hawker centres, kopitiams,
 * food courts, on GrabFood / foodpanda, priced in SGD.
 *
 * Run:  node db/seed.js
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (service role bypasses
 * RLS so it can write the public delivery_items table).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const restaurants = require('../server/data/restaurants.json').restaurants;
const foods = require('../server/data/nutrition-db.json').foods;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// tag -> nicely-cased dietary / allergen labels used by the schema.
const DIETARY = {
  'high-protein': 'High-Protein', vegetarian: 'Vegetarian', vegan: 'Vegan',
  'low-calorie': 'Low-Calorie', 'high-fiber': 'High-Fiber', lean: 'Lean',
  wholegrain: 'Wholegrain', 'omega-3': 'Omega-3', spicy: 'Spicy', halal: 'Halal',
};
const ALLERGENS = { peanuts: 'Peanuts', shellfish: 'Shellfish', egg: 'Egg', coconut: 'Coconut', dairy: 'Dairy' };

const normalise = (s) => String(s || '').trim().toLowerCase();
const platform = (p) => (normalise(p) === 'foodpanda' ? 'Foodpanda' : p); // schema wants title-case

function findFood(dish) {
  const q = normalise(dish);
  return (
    foods.find((f) => normalise(f.name) === q) ||
    foods.find((f) => (f.aliases || []).some((a) => normalise(a) === q)) ||
    foods.find((f) => normalise(f.name).includes(q) || q.includes(normalise(f.name)))
  );
}

function toDeliveryItem(r) {
  const food = findFood(r.dish);
  if (!food) return null;
  const tags = food.tags || [];
  return {
    name: food.name,
    restaurant_name: r.name,
    platform: platform(r.platform),
    calories: food.calories,
    protein_g: food.protein,
    carbs_g: food.carbs,
    fats_g: food.fat,
    price_sgd: r.price,
    rating: r.rating,
    image_url: null,
    dietary_tags: tags.map((t) => DIETARY[t]).filter(Boolean),
    allergen_tags: tags.map((t) => ALLERGENS[t]).filter(Boolean),
    venue: r.venue || null,
    outlet_type: r.type || null,
    distance_km: r.distanceKm ?? null,
    eta: r.eta || null,
  };
}

async function seed() {
  const items = restaurants.map(toDeliveryItem).filter(Boolean);

  console.log('Clearing existing delivery items...');
  const { error: delErr } = await supabase
    .from('delivery_items')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) console.error('Error clearing table:', delErr.message);

  console.log(`Seeding ${items.length} Singapore delivery items...`);
  const { data, error } = await supabase.from('delivery_items').insert(items).select();

  if (error) console.error('❌ Seeding failed:', error.message);
  else console.log(`✅ Successfully seeded ${data.length} delivery items!`);
}

seed();
