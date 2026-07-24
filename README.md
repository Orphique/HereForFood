# 🥗 HereForFood — Agentic AI Nutrition Coach

An agentic AI app that helps users improve their nutrition and dieting. The AI
"brain" is a **Microsoft Azure AI Foundry Agent Service** agent with
function-calling **tools**, wrapped in a **Node.js + Express** backend and a
**vanilla-JavaScript** front end.

This build follows the **ChatGPT suggestions** from the team's *HereForFood
Brainstorm* document — and nothing beyond them.

---

## What "agentic" means here

Instead of a chatbot that only talks, HereForFood's AI can **take actions**. It
has a toolbox (`server/agent/tools.js`) and decides which tools to call to
satisfy the user:

| Tool | What it does | Blueprint feature |
|------|--------------|-------------------|
| `identify_food` | Parse "I had chicken rice and a banana" into items | 3 – AI identifies food |
| `lookup_nutrition` | Food + quantity → calories + macros | 3 – Nutrition database |
| `log_meal` | Save a meal to today's log | 3 → 4 |
| `get_dashboard` | Today's totals + calories remaining | 4 – Dashboard |
| `recommend_meals` | Goal-aware meal suggestions | 5 + 7 |
| `find_local_food` | Delivery options (Grab/Foodpanda) | 6 – Local food |

The user just chats naturally; the agent orchestrates the tools.

## ChatGPT-blueprint → code map

| # | ChatGPT suggestion | Where it lives |
|---|--------------------|----------------|
| 1 | User account + profile (allergies, restrictions, prefs, calorie goal, **age**) | `routes/api.js` (`/login`, `/profile`), `store.js` |
| 2 | Food logging — 📷 image / ⌨️ text / 🎤 voice | `public/app.js` (image picker, Web Speech API), `/api/estimate`, `/api/log` |
| 3 | AI nutrition estimation (identify → DB → calories+macros) | `agent/tools.js`, `services/nutrition.js`, `services/estimate.js` |
| 4 | Dashboard (calories, protein, carbs, fat, meals, remaining) | `agent/tools.js` `computeDashboard`, Dashboard page in `app.js` |
| 5 | AI meal recommendation (remaining cals + restrictions + prefs + budget) | `services/recommend.js` |
| 6 | Local food recommendations (restaurant, price, rating, distance, platform) | `services/restaurants.js` |
| 7 | **User goals** — reshapes the whole app | goal picker, `GOAL_PREFERENCES` in `recommend.js`, `MACRO_SPLIT` in `macros.js` |

Feature 7 is the big one from the brainstorm: pick *Lose weight* and the app
steers toward a deficit and high-satiety foods; pick *Build muscle* and it
prioritises protein and a slight surplus.

## Tab-2 additions (the "very specific ideas")

The second ChatGPT tab turned the MVP into a structured product. What's new:

| Idea (tab 2) | Where it lives |
|---|---|
| **Track / Plan / Discover** framing + **5-page nav** (Dashboard · Log Food · Meal Plan · Discover · Settings) | `public/index.html`, page router in `app.js` |
| Dashboard **progress bars** for all 4 macros (consumed / target) | `services/macros.js` (goal-based macro targets), `renderDashboard` |
| **Meals grouped by Breakfast / Lunch / Dinner / Snack** + greeting | `computeDashboard` (`mealsByType`), dashboard page |
| **"Remaining calories → what would you like?"** action hub | dashboard hero in `index.html` / `app.js` |
| Log Food: **detected items with adjustable portions** that recalc live, framed as an *estimate* | `services/estimate.js`, `nutritionForGrams` in `nutrition.js`, `/api/estimate` |
| **Meal Plan** page (daily / weekly) + **recipes** (View Recipe / Find Nearby) | `services/mealPlanner.js`, `services/recipes.js`, `/api/mealplan`, `/api/recipe` |
| **Discover** page — "meals you can actually order" (rating / price / calories) | `/api/discover` (recommend × restaurants) |
| **Settings** page + **age** in profile | settings page in `app.js`, `/api/profile` |

New agent tools for these: `estimate_meal`, `plan_meals`, `get_recipe`
(in `agent/tools.js`), so the AI can drive them conversationally too — e.g.
*"plan my meals for today"* or *"recipe for salmon"* in the Ask AI drawer.

**Architectural principle from tab 2 (already enforced):** the AI *identifies*
food; the *database* provides the nutrition numbers. The model never invents
calories — it calls `estimate_meal` / `lookup_nutrition`, which read the DB.

## Updated-requirements additions

From the team's updated requirements brainstorm:

| Requirement | Where it lives |
|---|---|
| Sign-up asks **gender, weight, height, activity level, medical condition** (+ age) | onboarding + Settings (web & mobile), `profiles` schema, `store` profile |
| **Calorie target computed from body metrics** (BMR → TDEE, Mifflin–St Jeor) + goal | `services/calories.js`, applied in `PUT /profile` (manual entry still wins) |
| **BMI** shown with Singapore (HPB) cut-offs | `services/calories.js`, Settings |
| Two more goals: **Doctor's advice**, **Energy (elderly)** | `recommend.js`, `macros.js`, `calories.js`, both UIs, schema goal CHECK |
| **Smart grocery list** auto-built from the meal plan's recipes | `services/grocery.js`, `GET /api/grocery`, Meal Plan page (web & mobile) |

Deferred per the doc's own priority notes: behavior-nudge reminders *(when there
is time)*, weekly/monthly progress charts *(if we have the time)*, and full
micronutrient breakdown (vitamins/minerals — needs a richer data source).

---

## Quick start (no Azure needed)

The app ships with an **offline "mock" agent** so you can run and demo the whole
flow immediately.

```bash
cd HereForFood
npm install
npm start
```

Open **http://localhost:3000**, sign in with any email, pick a goal, then try:

- `I had chicken rice and a banana` → it logs them and updates your dashboard
- `How am I doing today?` → your daily totals + calories remaining
- `What should I eat?` → goal-aware suggestions
- `Find delivery options for salmon` → nearby restaurants

## Wiring up the real AI (Azure AI Foundry)

1. In the [Azure AI Foundry portal](https://ai.azure.com), create a **project**
   and deploy a model (e.g. `gpt-4o-mini`).
2. `cp .env.example .env` and fill in:
   ```
   AI_PROVIDER=foundry
   AZURE_AI_FOUNDRY_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
   AZURE_AI_FOUNDRY_MODEL_DEPLOYMENT=gpt-4o-mini
   ```
3. Authenticate (no secrets in code — uses `DefaultAzureCredential`):
   ```bash
   az login
   ```
4. `npm start`. The agent now runs on Azure AI Foundry.

> The Foundry integration lives entirely in `server/agent/foundryProvider.js`.
> It targets the `@azure/ai-agents` 1.x SDK surface (`client.threads` /
> `client.messages` / `client.runs`). If your installed SDK version differs,
> **only that one file** needs adjusting — the mock agent and the rest of the
> app are provider-agnostic (see `server/agent/index.js`).

---

## Architecture

```
Browser (public/)
  index.html · styles.css · app.js        ← UI: login, onboarding, dashboard, chat
        │  fetch /api/*
        ▼
Express (server/)
  index.js            ← server bootstrap
  routes/api.js       ← REST endpoints
  agent/
    index.js          ← picks provider (foundry | mock)
    foundryProvider.js← Azure AI Foundry Agent Service + tool-use loop
    mockProvider.js   ← offline agent (same tools, no LLM)
    tools.js          ← tool schemas + dispatch  ⟵ the agent's "hands"
    instructions.js   ← agent persona + goal logic (system prompt)
  services/
    nutrition.js      ← DB lookup + per-gram scaling   (Feature 3 / tab 2 s.4)
    estimate.js       ← parse a meal into items         (tab 2 s.3-4)
    macros.js         ← goal-based macro targets         (tab 2 s.2 & 10)
    recommend.js      ← goal-aware recommender           (Features 5 + 7)
    mealPlanner.js    ← daily/weekly plans               (tab 2 s.5)
    recipes.js        ← recipe lookup                    (tab 2 s.5)
    restaurants.js    ← delivery matching                (Feature 6)
  store.js            ← store selector (DB_PROVIDER: json | supabase)
  store/
    jsonStore.js      ← local JSON file (default)
    supabaseStore.js  ← Supabase/Postgres adapter
  db/supabaseClient.js← server Supabase client (service role)
  data/               ← seed nutrition DB, recipes, restaurants
db/                   ← Supabase schema.sql, seed.js, frontend helpers (see db/README.md)
```

## Notes & next steps for the team

- **Swap the seed data for real APIs.** `data/nutrition-db.json` →
  USDA FoodData Central / Nutritionix / Edamam. `data/restaurants.json` →
  a real Grab/Foodpanda integration.
- **Real login.** `/login` is a demo stub — replace with Google OAuth / a
  session or JWT (Feature 1).
- **Real image/voice.** `/api/log/media` is the hook: forward photos to an
  Azure AI Vision–capable deployment and audio to Azure AI Speech, then feed the
  resulting text to the agent. The front end already captures both.
- **Real database (Supabase).** A PostgreSQL schema (from the brainstorm's Gemini
  tab) is wired in — see [db/README.md](db/README.md). Run `db/schema.sql` on
  Supabase, set `DB_PROVIDER=supabase` + the `SUPABASE_*` keys in `.env`, seed
  with `node db/seed.js`, and the app reads/writes Postgres instead of the JSON
  file. `store.js` is the single seam; `store/jsonStore.js` and
  `store/supabaseStore.js` share one async interface.
- **Not medical advice.** The agent is instructed to defer to professionals for
  medical conditions.
