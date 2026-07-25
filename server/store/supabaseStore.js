'use strict';

/**
 * Supabase-backed store (DB_PROVIDER=supabase).
 *
 * Implements the same async interface as jsonStore against the schema in
 * db/schema.sql, translating between the app's field names and the SQL columns:
 *
 *   app.profile.name              <-> profiles.full_name
 *   app.profile.calorieGoal       <-> profiles.daily_calorie_target
 *   app.profile.dietaryRestrictions <-> profiles.food_restrictions
 *   app.meal.fat / protein / carbs <-> meal_logs.fats_g / protein_g / carbs_g
 *   app.meal.mealType             <-> meal_logs.meal_type
 *
 * Auth bridge: the demo identifies users by the email in the x-user-id header,
 * while the schema keys profiles by a Supabase Auth UUID. Using the service-role
 * client we look up (or create) the auth user for that email — the
 * on_auth_user_created trigger then makes the matching profiles row. A real
 * build would use Supabase Auth on the client and pass the JWT instead.
 */

const { supabase } = require('../db/supabaseClient');

const emailToUid = new Map(); // small cache: email -> profile UUID

// ---- field mapping -------------------------------------------------------
function profileFromDb(row) {
  return {
    name: row.full_name || '',
    age: row.age ?? null,
    gender: row.gender ?? null,
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : null,
    heightCm: row.height_cm != null ? Number(row.height_cm) : null,
    activityLevel: row.activity_level ?? null,
    medicalCondition: row.medical_condition || '',
    goal: row.goal ?? null,
    calorieGoal: row.daily_calorie_target ?? null,
    allergies: row.allergies || [],
    dietaryRestrictions: row.food_restrictions || [],
    preferences: row.preferences || [],
    budgetPerMeal: row.budget_per_meal != null ? Number(row.budget_per_meal) : null,
  };
}

function profilePatchToDb(patch) {
  const out = {};
  if ('name' in patch) out.full_name = patch.name;
  if ('age' in patch) out.age = patch.age;
  if ('gender' in patch) out.gender = patch.gender;
  if ('weightKg' in patch) out.weight_kg = patch.weightKg;
  if ('heightCm' in patch) out.height_cm = patch.heightCm;
  if ('activityLevel' in patch) out.activity_level = patch.activityLevel;
  if ('medicalCondition' in patch) out.medical_condition = patch.medicalCondition;
  if ('goal' in patch) out.goal = patch.goal;
  if ('calorieGoal' in patch) out.daily_calorie_target = patch.calorieGoal;
  if ('allergies' in patch) out.allergies = patch.allergies;
  if ('dietaryRestrictions' in patch) out.food_restrictions = patch.dietaryRestrictions;
  if ('preferences' in patch) out.preferences = patch.preferences;
  if ('budgetPerMeal' in patch) out.budget_per_meal = patch.budgetPerMeal;
  return out;
}

function logToDb(uid, meal) {
  return {
    user_id: uid,
    food_name: meal.name,
    calories: Math.round(meal.calories || 0),
    protein_g: meal.protein || 0,
    carbs_g: meal.carbs || 0,
    fats_g: meal.fat || 0,
    log_type: meal.logType || 'text',
    meal_type: meal.mealType || 'snack',
    grams: meal.grams ?? null,
    quantity: meal.quantity ?? 1,
  };
}

function logFromDb(row) {
  return {
    id: row.id,
    name: row.food_name,
    calories: row.calories,
    protein: Number(row.protein_g) || 0,
    carbs: Number(row.carbs_g) || 0,
    fat: Number(row.fats_g) || 0,
    mealType: row.meal_type || 'snack',
    grams: row.grams ?? undefined,
    quantity: row.quantity != null ? Number(row.quantity) : 1,
    loggedAt: row.logged_at,
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ---- auth bridge: email -> profile UUID ----------------------------------
async function findAuthUserByEmail(email) {
  // Scan a few pages of users (demo scale). Real auth would avoid this.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const match = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

async function resolveUid(email) {
  if (emailToUid.has(email)) return emailToUid.get(email);

  let uid = await findAuthUserByEmail(email);
  if (!uid) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { username: email },
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    uid = data.user.id; // trigger creates the profiles row
  }
  emailToUid.set(email, uid);
  return uid;
}

async function fetchProfile(uid) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
  if (error) throw new Error(error.message);
  return data;
}

// ---- public interface (mirrors jsonStore) --------------------------------
async function getOrCreateUser(email) {
  const uid = await resolveUid(email);
  const row = await fetchProfile(uid);
  return { id: email, uid, profile: profileFromDb(row) };
}

async function updateProfile(email, patch) {
  const uid = await resolveUid(email);
  const dbPatch = profilePatchToDb(patch);
  if (Object.keys(dbPatch).length) {
    const { error } = await supabase.from('profiles').update(dbPatch).eq('id', uid);
    if (error) throw new Error(error.message);
  }
  return profileFromDb(await fetchProfile(uid));
}

async function addLog(email, meal) {
  const uid = await resolveUid(email);
  const { data, error } = await supabase.from('meal_logs').insert(logToDb(uid, meal)).select().single();
  if (error) throw new Error(error.message);
  return logFromDb(data);
}

async function getLogsForToday(email) {
  const uid = await resolveUid(email);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('meal_logs')
    .select('*')
    .eq('user_id', uid)
    .gte('logged_at', start.toISOString())
    .order('logged_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(logFromDb);
}

/** Remove a logged meal from today (agent's delete_log_entry). Omit id = latest. */
async function deleteLog(email, entryId) {
  const uid = await resolveUid(email);
  let target = entryId;
  if (!target) {
    const logs = await getLogsForToday(email);
    if (!logs.length) return null;
    target = logs[logs.length - 1].id;
  }
  const { data, error } = await supabase
    .from('meal_logs')
    .delete()
    .eq('user_id', uid)     // never let one user delete another's row
    .eq('id', target)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? logFromDb(data) : null;
}

/** Persist a weekly meal plan (Foundry agent's save_meal_plan) — profiles.saved_meal_plan JSONB. */
async function saveMealPlan(email, plan) {
  const uid = await resolveUid(email);
  const payload = { plan, savedAt: new Date().toISOString() };
  const { error } = await supabase.from('profiles').update({ saved_meal_plan: payload }).eq('id', uid);
  if (error) throw new Error(error.message);
  return payload;
}

async function getSavedMealPlan(email) {
  const uid = await resolveUid(email);
  const row = await fetchProfile(uid);
  return row.saved_meal_plan || null;
}

module.exports = {
  getOrCreateUser, updateProfile, addLog, getLogsForToday, todayKey,
  deleteLog, saveMealPlan, getSavedMealPlan,
};
