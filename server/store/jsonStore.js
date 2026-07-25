'use strict';

/**
 * JSON-file persistence (the zero-setup default; DB_PROVIDER=json).
 *
 * Same behaviour as the original store, but the functions are async so this and
 * the Supabase store expose an identical Promise-based interface — the rest of
 * the app awaits either one without caring which is active.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join('/tmp', 'users.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: {} };
  }
}

function save(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function blankUser(userId) {
  return {
    id: userId,
    profile: {
      name: '',
      age: null,
      gender: null,            // 'male' | 'female' | 'other'
      weightKg: null,          // updated requirements: body metrics -> calorie target
      heightCm: null,
      activityLevel: null,     // sedentary | light | moderate | active | very_active
      medicalCondition: '',    // "specific condition a user might have"
      goal: null,
      calorieGoal: null,
      allergies: [],
      dietaryRestrictions: [],
      preferences: [],
      budgetPerMeal: null,
    },
    logs: {}, // { 'YYYY-MM-DD': [ { ...meal } ] }
    createdAt: new Date().toISOString(),
  };
}

async function getOrCreateUser(userId) {
  const db = load();
  if (!db.users[userId]) {
    db.users[userId] = blankUser(userId);
    save(db);
  }
  return db.users[userId];
}

async function updateProfile(userId, patch) {
  const db = load();
  if (!db.users[userId]) db.users[userId] = blankUser(userId);
  db.users[userId] = { ...db.users[userId], profile: { ...db.users[userId].profile, ...patch } };
  save(db);
  return db.users[userId].profile;
}

async function addLog(userId, meal) {
  const db = load();
  if (!db.users[userId]) db.users[userId] = blankUser(userId);
  const key = todayKey();
  const entry = { ...meal, id: `${Date.now()}`, loggedAt: new Date().toISOString() };
  db.users[userId].logs[key] = db.users[userId].logs[key] || [];
  db.users[userId].logs[key].push(entry);
  save(db);
  return entry;
}

async function getLogsForToday(userId) {
  const user = await getOrCreateUser(userId);
  return user.logs[todayKey()] || [];
}

/**
 * Remove a logged meal from today (used by the agent's delete_log_entry).
 * Pass an entry id, or omit it to remove the most recent entry.
 */
async function deleteLog(userId, entryId) {
  const db = load();
  if (!db.users[userId]) return null;
  const key = todayKey();
  const list = db.users[userId].logs[key] || [];
  if (!list.length) return null;
  const idx = entryId ? list.findIndex((m) => String(m.id) === String(entryId)) : list.length - 1;
  if (idx < 0) return null;
  const [removed] = list.splice(idx, 1);
  save(db);
  return removed;
}

/** Persist a weekly meal plan (used by the Foundry agent's save_meal_plan). */
async function saveMealPlan(userId, plan) {
  const db = load();
  if (!db.users[userId]) db.users[userId] = blankUser(userId);
  db.users[userId].savedMealPlan = { plan, savedAt: new Date().toISOString() };
  save(db);
  return db.users[userId].savedMealPlan;
}

async function getSavedMealPlan(userId) {
  const user = await getOrCreateUser(userId);
  return user.savedMealPlan || null;
}

module.exports = {
  getOrCreateUser, updateProfile, addLog, getLogsForToday, todayKey,
  deleteLog, saveMealPlan, getSavedMealPlan,
};
