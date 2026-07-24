'use strict';

/**
 * HereForFood front end (vanilla JS, no build step).
 * Five pages (tab 2, section 2): Dashboard · Log Food · Meal Plan · Discover · Settings.
 * Talks to the REST API in server/routes/api.js.
 */

const $ = (id) => document.getElementById(id);
const api = (path, opts = {}) =>
  fetch(`/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(state.userId ? { 'x-user-id': state.userId } : {}),
      ...(opts.headers || {}),
    },
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  });

const state = { userId: localStorage.getItem('hff_user') || null, goal: null, profile: null };

const GOALS = [
  { key: 'lose_weight',   emoji: '📉', label: 'Lose weight' },
  { key: 'maintain',      emoji: '⚖️', label: 'Maintain weight' },
  { key: 'gain_weight',   emoji: '📈', label: 'Gain weight' },
  { key: 'build_muscle',  emoji: '💪', label: 'Build muscle' },
  { key: 'eat_healthier', emoji: '🥦', label: 'Eat healthier' },
  { key: 'manage_diet',   emoji: '🩺', label: 'Manage my diet' },
  { key: 'doctor_recommendation', emoji: '👩‍⚕️', label: 'Doctor’s advice' },
  { key: 'elderly_energy', emoji: '🧓', label: 'Energy (elderly)' },
  { key: 'track_food',    emoji: '📝', label: 'Just track food' },
];
const GOAL_LABEL = Object.fromEntries(GOALS.map((g) => [g.key, `${g.emoji} ${g.label}`]));
const ACTIVITY = [
  { key: 'sedentary', label: 'Sedentary (little/no exercise)' },
  { key: 'light', label: 'Light (1–3 days/week)' },
  { key: 'moderate', label: 'Moderate (3–5 days/week)' },
  { key: 'active', label: 'Active (6–7 days/week)' },
  { key: 'very_active', label: 'Very active (hard/physical job)' },
];
const GENDERS = [{ key: 'male', label: 'Male' }, { key: 'female', label: 'Female' }, { key: 'other', label: 'Other' }];
const MEAL_EMOJI = { breakfast: '🍳', lunch: '🍜', dinner: '🍗', snack: '🍎' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const splitCsv = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// View + page routing
// ---------------------------------------------------------------------------
function show(view) {
  for (const v of ['loginView', 'onboardView', 'appView']) $(v).classList.add('hidden');
  $(view).classList.remove('hidden');
}

const PAGES = ['dashboard', 'log', 'plan', 'discover', 'settings'];
function goto(page) {
  PAGES.forEach((p) => $(`page-${p}`).classList.toggle('hidden', p !== page));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'dashboard') refreshDashboard();
  if (page === 'plan') loadPlan(currentPeriod);
  if (page === 'discover') loadDiscover();
  if (page === 'settings') fillSettings();
  window.scrollTo(0, 0);
}
window.goto = goto; // used by inline onclick handlers
document.querySelectorAll('.nav-btn').forEach((b) => (b.onclick = () => goto(b.dataset.page)));

// ---------------------------------------------------------------------------
// Login (Feature 1)
// ---------------------------------------------------------------------------
async function login(email) {
  const res = await api('/login', { method: 'POST', body: JSON.stringify({ email }) });
  state.userId = res.userId;
  state.profile = res.profile;
  localStorage.setItem('hff_user', res.userId);
  $('userChip').textContent = res.userId;
  $('userChip').classList.remove('hidden');
  if (res.needsOnboarding) { renderGoals(); show('onboardView'); }
  else { await enterApp(); }
}
$('loginBtn').onclick = () => {
  const email = $('loginEmail').value.trim();
  if (!email) return alert('Enter an email to continue.');
  login(email).catch((e) => alert(e.message));
};
$('googleBtn').onclick = () => login('demo.google.user@gmail.com').catch((e) => alert(e.message));

// ---------------------------------------------------------------------------
// Onboarding (Feature 7)
// ---------------------------------------------------------------------------
const optionsHtml = (arr, blank) =>
  (blank ? `<option value="">${blank}</option>` : '') +
  arr.map((o) => `<option value="${o.key}">${o.label}</option>`).join('');

function renderGoals() {
  $('goalGrid').innerHTML = '';
  for (const g of GOALS) {
    const el = document.createElement('div');
    el.className = 'goal-card';
    el.innerHTML = `<span class="emoji">${g.emoji}</span>${g.label}`;
    el.onclick = () => {
      document.querySelectorAll('.goal-card').forEach((c) => c.classList.remove('selected'));
      el.classList.add('selected');
      state.goal = g.key;
    };
    $('goalGrid').appendChild(el);
  }
  // Populate onboarding gender/activity dropdowns.
  $('obGender').innerHTML = optionsHtml(GENDERS, 'Select…');
  $('obActivity').innerHTML = optionsHtml(ACTIVITY, 'Select…');
}
$('saveOnboardBtn').onclick = async () => {
  if (!state.goal) return alert('Pick a goal first.');
  const patch = {
    goal: state.goal,
    name: $('obName').value.trim(),
    age: $('obAge').value ? Number($('obAge').value) : null,
    gender: $('obGender').value || null,
    weightKg: $('obWeight').value ? Number($('obWeight').value) : null,
    heightCm: $('obHeight').value ? Number($('obHeight').value) : null,
    activityLevel: $('obActivity').value || null,
    medicalCondition: $('obCondition').value.trim(),
    calorieGoal: $('calorieGoal').value ? Number($('calorieGoal').value) : null,
    budgetPerMeal: $('budget').value ? Number($('budget').value) : null,
    allergies: splitCsv($('allergies').value),
    dietaryRestrictions: splitCsv($('restrictions').value),
    preferences: splitCsv($('preferences').value),
  };
  try { await api('/profile', { method: 'PUT', body: JSON.stringify(patch) }); await enterApp(); }
  catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------------------
// Enter the app
// ---------------------------------------------------------------------------
async function enterApp() {
  show('appView');
  $('nav').classList.remove('hidden');
  $('chatFab').classList.remove('hidden');
  state.profile = await api('/profile');
  fetch('/healthz').then((r) => r.json()).then((h) => {
    $('providerTag').textContent = h.provider === 'foundry' ? '· Azure AI Foundry' : '· offline demo';
  });
  if (!$('chatLog').children.length) addMsg('bot', `Hey! Log a meal, ask what to eat, or plan your day.`);
  goto('dashboard');
}

// ---------------------------------------------------------------------------
// PAGE: Dashboard (Feature 4 / tab 2 sections 2 & 7)
// ---------------------------------------------------------------------------
async function refreshDashboard() { renderDashboard(await api('/dashboard')); }

function bar(label, consumed, target, cls) {
  const has = target != null && target > 0;
  const pct = has ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const over = has && consumed > target;
  const right = has ? `${consumed} / ${target}` : `${consumed}`;
  return `<div class="bar-row">
    <div class="bar-top"><span>${label}</span><span class="muted">${right}${label==='Calories'?' kcal':' g'}</span></div>
    <div class="bar-track"><div class="bar-fill ${over ? 'over' : cls}" style="width:${pct}%"></div></div>
  </div>`;
}

function renderDashboard(d) {
  $('greeting').textContent = `${d.greeting}${d.name ? ', ' + d.name : ''}!`;
  $('goalBadge').textContent = GOAL_LABEL[d.goal] || 'No goal set';
  $('remCal').textContent = d.remainingCalories == null ? '–' : d.remainingCalories;

  const t = d.targets || {};
  $('bars').innerHTML =
    bar('Calories', d.consumed.calories, t.calories, 'cal') +
    bar('Protein', d.consumed.protein, t.protein, 'pro') +
    bar('Carbs', d.consumed.carbs, t.carbs, 'carb') +
    bar('Fat', d.consumed.fat, t.fat, 'fat');

  const groups = d.mealsByType.filter((g) => g.items.length);
  $('mealsByType').innerHTML = groups.length
    ? groups.map((g) => `<div class="meal-group">
        <div class="mg-head"><span>${MEAL_EMOJI[g.type]} ${cap(g.type)}</span><span>${g.calories} kcal</span></div>
        <ul>${g.items.map((i) => `<li><span>${i.name}</span><span>${i.calories} kcal</span></li>`).join('')}</ul>
      </div>`).join('')
    : '<p class="muted tiny">Nothing logged yet. Tap “+ Log Food”.</p>';
}

// ---------------------------------------------------------------------------
// PAGE: Log Food (Feature 2/3 · tab 2 sections 3 & 4)
// ---------------------------------------------------------------------------
let estimateItems = []; // [{ name, grams, perGram:{cal,pro,carb,fat} }]

document.querySelectorAll('.itab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.itab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.input;
    if (mode === 'photo') triggerPhoto();
    if (mode === 'voice') triggerVoice();
    if (mode === 'text') $('logInput').focus();
  };
});

async function runEstimate(description) {
  if (!description.trim()) return;
  $('logInput').value = description;
  try {
    const res = await api('/estimate', { method: 'POST', body: JSON.stringify({ description }) });
    renderEstimate(res);
  } catch (e) { alert(e.message); }
}
$('estimateBtn').onclick = () => runEstimate($('logInput').value);
$('logInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runEstimate($('logInput').value); });

function renderEstimate(res) {
  estimateItems = [];
  $('estimateResult').classList.remove('hidden');
  const rows = res.items.map((it, idx) => {
    if (!it.found) {
      return `<div class="est-item unknown"><span class="ei-name">${it.text}<small>not in database</small></span></div>`;
    }
    // Store per-gram ratios so we can recalc live as the user adjusts portions.
    estimateItems[idx] = {
      name: it.name, grams: it.grams,
      perGram: { cal: it.calories / it.grams, pro: it.protein / it.grams, carb: it.carbs / it.grams, fat: it.fat / it.grams },
    };
    return `<div class="est-item" data-idx="${idx}">
      <span class="ei-name">${it.name}<small>${it.tags?.slice(0,2).join(', ') || ''}</small></span>
      <input class="ei-grams" type="number" min="0" step="10" value="${it.grams}" data-idx="${idx}" />
      <span class="ei-cal" id="eical-${idx}">${it.calories} kcal</span>
    </div>`;
  }).join('');
  $('estItems').innerHTML = rows;
  document.querySelectorAll('.ei-grams').forEach((inp) => (inp.oninput = onPortionChange));
  updateEstTotal();
}

function onPortionChange(e) {
  const idx = Number(e.target.dataset.idx);
  const grams = Number(e.target.value) || 0;
  estimateItems[idx].grams = grams;
  $(`eical-${idx}`).textContent = `${Math.round(estimateItems[idx].perGram.cal * grams)} kcal`;
  updateEstTotal();
}

function updateEstTotal() {
  const total = estimateItems.filter(Boolean).reduce((s, i) => s + i.perGram.cal * i.grams, 0);
  $('estTotal').textContent = `${Math.round(total)} kcal`;
}

$('logCommitBtn').onclick = async () => {
  const items = estimateItems.filter(Boolean).map((i) => ({ name: i.name, grams: i.grams }));
  if (!items.length) return alert('Nothing to log — estimate a meal first.');
  try {
    await api('/log', { method: 'POST', body: JSON.stringify({ items, mealType: $('mealType').value }) });
    $('estimateResult').classList.add('hidden');
    $('logInput').value = '';
    estimateItems = [];
    goto('dashboard');
  } catch (e) { alert(e.message); }
};

// Photo logging (tab 2 section 3) — in production the backend forwards the image
// to an Azure AI Vision deployment. Demo: caption -> same estimate flow.
function triggerPhoto() { $('logImgInput').click(); }
$('logImgInput').onchange = () => {
  const file = $('logImgInput').files[0];
  if (!file) return;
  const caption = prompt(`📷 "${file.name}" selected.\nIn production this photo goes to Azure AI Vision.\nFor the demo, describe the food:`);
  if (caption) runEstimate(caption);
  $('logImgInput').value = '';
};

// Voice logging via Web Speech API (falls back to typing).
function triggerVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { const t = prompt('🎤 Voice not supported here. Type what you ate:'); if (t) runEstimate(t); return; }
  const rec = new SR();
  rec.lang = 'en-US';
  rec.onresult = (e) => runEstimate(e.results[0][0].transcript);
  rec.onerror = () => alert('Could not capture voice. Try typing.');
  rec.start();
}

// ---------------------------------------------------------------------------
// PAGE: Meal Plan (tab 2 section 5)
// ---------------------------------------------------------------------------
let currentPeriod = 'day';
document.querySelectorAll('.ptab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.ptab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentPeriod = tab.dataset.period;
    loadPlan(currentPeriod);
  };
});

async function loadPlan(period) {
  $('planBody').innerHTML = 'Loading…';
  const plan = await api(`/mealplan?period=${period}`);
  $('planBody').innerHTML = period === 'week' ? renderWeek(plan) : renderDay(plan);
  wirePlanButtons();
}

function renderDay(plan) {
  const slots = plan.meals.map((m) => {
    if (!m.meal) return '';
    const meal = m.meal;
    return `<div class="slot">
      <div class="slot-head"><span>${m.emoji} ${cap(m.type)}</span><span>${meal.calories} kcal</span></div>
      <div class="slot-meal">${meal.name}</div>
      <div class="macros-line">P ${meal.protein}g · C ${meal.carbs}g · F ${meal.fat}g${meal.recipe ? ' · ~$' + meal.recipe.estimatedCost : ''}</div>
      <div class="slot-actions">
        ${meal.recipe ? `<button class="ghost" data-recipe="${meal.name}">View Recipe</button>` : ''}
        <button class="ghost" data-find="${meal.name}">Find Nearby</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="plan-day">${slots}</div>
    <p class="tiny muted" style="margin-top:10px">Planned total: ${plan.totals.calories} kcal (goal ${plan.calorieGoal})</p>`;
}

function renderWeek(plan) {
  return `<div class="week-grid">${plan.days.map((d) => `
    <div class="week-col"><h4>${d.label}</h4>
      ${d.meals.filter((m) => m.meal).map((m) => `<div class="wc-meal">${m.emoji} ${m.meal.name}</div>`).join('')}
      <div class="wc-meal" style="margin-top:6px;color:var(--brand)">${d.totals.calories} kcal</div>
    </div>`).join('')}</div>`;
}

function wirePlanButtons() {
  document.querySelectorAll('[data-recipe]').forEach((b) => (b.onclick = () => openRecipe(b.dataset.recipe)));
  document.querySelectorAll('[data-find]').forEach((b) => (b.onclick = () => { goto('discover'); }));
}

// Smart grocery list (updated requirements) — reuses the recipe modal.
$('groceryBtn').onclick = async () => {
  try {
    const g = await api(`/grocery?period=${currentPeriod}`);
    $('recipeBody').innerHTML = `
      <h3>🛒 Grocery list (${g.period})</h3>
      <p class="muted tiny">${g.itemCount} items · ${g.note}</p>
      ${g.items.length
        ? `<ul>${g.items.map((i) => `<li>${i.item}${i.qty > 1 ? ` <span class="muted">×${i.qty}</span>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">This plan is mostly delivery/no-recipe dishes — switch to Week for a fuller list.</p>'}`;
    $('recipeModal').classList.remove('hidden');
  } catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------------------
// PAGE: Discover (tab 2 section 6)
// ---------------------------------------------------------------------------
async function loadDiscover() {
  $('discoverBody').innerHTML = 'Loading…';
  const d = await api('/discover');
  $('discoverSub').textContent = d.remainingCalories != null
    ? `You have ${d.remainingCalories} kcal remaining${d.budget ? ' · budget S$' + d.budget : ''}. Here's what fits:`
    : `Meals that fit your goals${d.budget ? ' · budget S$' + d.budget : ''}:`;
  $('discoverBody').innerHTML = d.cards.length
    ? d.cards.map((c) => `<div class="disc-card">
        <div class="dc-main">
          <div class="dc-meal">${c.meal}</div>
          <div class="dc-rest">${c.restaurant}${c.venue ? ` · ${c.venue}` : ''}${c.type ? ` <span class="dc-tag">${c.type}</span>` : ''}</div>
        </div>
        <div class="dc-meta">
          <span class="dc-cal">🔥 ${c.calories} kcal</span>
          <span>⭐ ${c.rating}</span>
          <span>💰 S$${c.price.toFixed(2)}</span>
          <span>📍 ${c.distanceKm} km</span>
        </div>
        <button class="primary order-btn" data-url="${encodeURIComponent(c.orderUrl || '')}" data-platform="${c.platform}">Order · ${c.platform}</button>
      </div>`).join('')
    : '<p class="muted">No matching options right now. Try widening your budget or preferences in Settings.</p>';
  // Open the delivery platform (its app on mobile via universal links, else web).
  document.querySelectorAll('.order-btn').forEach((b) => {
    b.onclick = () => {
      const url = decodeURIComponent(b.dataset.url || '');
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else alert(`No online ordering link for ${b.dataset.platform}.`);
    };
  });
}

// ---------------------------------------------------------------------------
// PAGE: Settings
// ---------------------------------------------------------------------------
function bmiFor(p) {
  if (!(p.weightKg > 0 && p.heightCm > 0)) return null;
  const m = p.heightCm / 100;
  return Math.round((p.weightKg / (m * m)) * 10) / 10;
}
function bmiCat(v) {
  if (v == null) return '';
  if (v < 18.5) return 'underweight';
  if (v < 23) return 'healthy';
  if (v < 27.5) return 'overweight';
  return 'obese';
}
function fillSettings() {
  const p = state.profile || {};
  $('setGoal').innerHTML = GOALS.map((g) => `<option value="${g.key}">${g.emoji} ${g.label}</option>`).join('');
  $('setGender').innerHTML = optionsHtml(GENDERS, 'Select…');
  $('setActivity').innerHTML = optionsHtml(ACTIVITY, 'Select…');
  $('setName').value = p.name || '';
  $('setAge').value = p.age ?? '';
  $('setGender').value = p.gender || '';
  $('setActivity').value = p.activityLevel || '';
  $('setWeight').value = p.weightKg ?? '';
  $('setHeight').value = p.heightCm ?? '';
  $('setGoal').value = p.goal || 'maintain';
  $('setCalorie').value = p.calorieGoal ?? '';
  $('setBudget').value = p.budgetPerMeal ?? '';
  $('setAllergies').value = (p.allergies || []).join(', ');
  $('setRestrictions').value = (p.dietaryRestrictions || []).join(', ');
  $('setCondition').value = p.medicalCondition || '';
  $('setPreferences').value = (p.preferences || []).join(', ');
  const b = bmiFor(p);
  $('setBmi').textContent = b ? `BMI ${b} (${bmiCat(b)}). Leave calorie goal blank to auto-calculate from your body metrics + activity.`
    : 'Add weight, height & activity to auto-calculate your calorie target.';
}
$('saveSettingsBtn').onclick = async () => {
  const patch = {
    name: $('setName').value.trim(),
    age: $('setAge').value ? Number($('setAge').value) : null,
    gender: $('setGender').value || null,
    activityLevel: $('setActivity').value || null,
    weightKg: $('setWeight').value ? Number($('setWeight').value) : null,
    heightCm: $('setHeight').value ? Number($('setHeight').value) : null,
    goal: $('setGoal').value,
    calorieGoal: $('setCalorie').value ? Number($('setCalorie').value) : null,
    budgetPerMeal: $('setBudget').value ? Number($('setBudget').value) : null,
    allergies: splitCsv($('setAllergies').value),
    dietaryRestrictions: splitCsv($('setRestrictions').value),
    medicalCondition: $('setCondition').value.trim(),
    preferences: splitCsv($('setPreferences').value),
  };
  try {
    state.profile = await api('/profile', { method: 'PUT', body: JSON.stringify(patch) });
    fillSettings(); // reflect any auto-computed calorie goal + BMI
    $('settingsSaved').classList.remove('hidden');
    setTimeout(() => $('settingsSaved').classList.add('hidden'), 1800);
  } catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------------------
// Recipe modal
// ---------------------------------------------------------------------------
async function openRecipe(meal) {
  try {
    const r = await api(`/recipe?meal=${encodeURIComponent(meal)}`);
    $('recipeBody').innerHTML = `
      <h3>${r.title}</h3>
      <p class="muted tiny">~$${r.estimatedCost} · ${r.timeMinutes} min · ${r.servings} serving(s)</p>
      <h4>Ingredients</h4><ul>${r.ingredients.map((i) => `<li>${i}</li>`).join('')}</ul>
      <h4>Steps</h4><ol>${r.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
    $('recipeModal').classList.remove('hidden');
  } catch (e) { alert(e.message); }
}
$('recipeClose').onclick = () => $('recipeModal').classList.add('hidden');
$('recipeModal').onclick = (e) => { if (e.target.id === 'recipeModal') $('recipeModal').classList.add('hidden'); };

// ---------------------------------------------------------------------------
// Ask AI (agent chat drawer)
// ---------------------------------------------------------------------------
function openChat() { $('chatDrawer').classList.remove('hidden'); $('chatFab').classList.add('hidden'); $('chatInput').focus(); }
function closeChat() { $('chatDrawer').classList.add('hidden'); $('chatFab').classList.remove('hidden'); }
window.openChat = openChat;
$('chatFab').onclick = openChat;
$('chatClose').onclick = closeChat;

function addMsg(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  $('chatLog').appendChild(el);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  return el;
}

async function sendMessage(text) {
  if (!text.trim()) return;
  addMsg('user', text);
  $('chatInput').value = '';
  const thinking = addMsg('bot', 'thinking…');
  thinking.classList.add('thinking');
  try {
    const res = await api('/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
    thinking.remove();
    addMsg('bot', res.reply);
    if (res.dashboard) renderDashboard(res.dashboard); // keep dashboard live
  } catch (e) { thinking.remove(); addMsg('bot', `⚠️ ${e.message}`); }
}
$('sendBtn').onclick = () => sendMessage($('chatInput').value);
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage($('chatInput').value); });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  if (state.userId) {
    $('userChip').textContent = state.userId;
    $('userChip').classList.remove('hidden');
    try {
      const profile = await api('/profile');
      state.profile = profile;
      if (profile.goal) { await enterApp(); return; }
      renderGoals(); show('onboardView'); return;
    } catch { /* fall through to login */ }
  }
  show('loginView');
})();
