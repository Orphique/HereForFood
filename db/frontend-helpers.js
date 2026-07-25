// ============================================================================
// Frontend Supabase helpers  (from the "Gemini code ideas" tab, section 4)
//
// REFERENCE / OPTIONAL. The current app uses a Node backend with header-based
// demo auth, so it doesn't need these. Keep them for when you move auth to the
// client (real Google Sign-In) and query Supabase directly from the web/Expo
// app. Uses the ANON key (safe for the client) — never the service role key.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; // or EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 1. Google OAuth Sign-In
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
  if (error) console.error('Auth error:', error.message);
  return data;
}

// 2. Fetch Delivery Recommendations matching remaining calories & filtering allergies
export async function getRecommendations(remainingCalories, maxPrice, userAllergies = []) {
  const { data, error } = await supabase
    .from('delivery_items')
    .select('*')
    .lte('calories', remainingCalories)
    .lte('price_sgd', maxPrice)
    .order('rating', { ascending: false });

  if (error) {
    console.error('Error fetching recommendations:', error.message);
    return [];
  }
  // Filter out items containing any of the user's allergies
  return data.filter(
    (item) => !item.allergen_tags.some((allergen) => userAllergies.includes(allergen))
  );
}

// 3. Log a Meal to the Database
export async function logMeal(userId, foodName, calories, macros, logType = 'image') {
  const { data, error } = await supabase.from('meal_logs').insert([
    {
      user_id: userId,
      food_name: foodName,
      calories,
      protein_g: macros.protein_g,
      carbs_g: macros.carbs_g,
      fats_g: macros.fats_g,
      log_type: logType,
    },
  ]);
  if (error) console.error('Error logging meal:', error.message);
  return data;
}
