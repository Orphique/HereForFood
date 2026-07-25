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

## Launching the app + the AI together

There is **nothing separate to start**. The agent runs in Microsoft Foundry
(Azure's cloud) — the website calls it over the network. One command runs
everything:

```bash
npm start
```

You should see this on startup:

```
  HereForFood running:
    Local:   http://localhost:3000
  AI:       Microsoft Foundry — agent "decade-ai"
  Database: json
  ✅ Foundry connected: "decade-ai" v8, 9 app tool(s).
```

That ✅ line means the website and the AI agent are wired together. If it shows
a ⚠️ instead, the message says what to fix (almost always: run `az login`).

**The one prerequisite:** you must be signed in to Azure, because the app
authenticates with `DefaultAzureCredential` — no API keys in code.

```bash
az login
```

Sign-ins expire (typically after a while / on reboot), so if chat suddenly
errors, re-run `az login` and restart. You can always check the wiring at
<http://localhost:3000/healthz>, which reports the provider, agent and database.

To demo without Azure at all (offline, no login), set `AI_PROVIDER=mock` in
`.env` — everything else keeps working.

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

### What the AI can actually do (its tools)

The agent can only do what its **tools** allow. Adding a capability = adding a
tool in `server/agent/tools.js`, then re-running the sync script.

| Tool | What the coach can do |
|---|---|
| `identify_food`, `estimate_meal`, `lookup_nutrition` | Understand what the user ate and estimate portions/macros |
| `log_meal`, `delete_log_entry` | Log a meal — or undo a mistake ("remove that laksa") |
| `get_dashboard` | Read today's calories, macros and remaining allowance |
| `get_profile`, `update_profile` | **Read and change Settings** — goal, calorie target, budget, weight/height/activity, allergies, restrictions, preferences |
| `recommend_meals`, `find_local_food` | Suggest meals and real GrabFood/foodpanda outlets |
| `plan_meals`, `save_meal_plan`, `get_saved_meal_plan` | Build a day/week plan, **save it**, and recall it later |
| `get_recipe`, `get_grocery_list` | Give recipes and generate a shopping list |
| `navigate_to_page` | **Open a page for the user** — "show me Discover" switches the app |

**Photo logging in chat.** The chat drawer has a 📷 button. The photo is sent to
the agent as a real image (Responses API `input_image`), so it *sees* the food,
identifies it, then uses the app's database for the actual numbers. Per your
agent instructions it asks you to confirm before logging — and because the
provider keeps `previous_response_id` per user, your follow-up ("yes, chicken
rice, hawker portion") is understood as the answer and the meal gets logged.

So the user can now just say *"change my goal to build muscle and add shellfish
to my allergies"* and the coach updates Settings — the calorie target is
recalculated and the change is reflected in the UI immediately.

`update_profile` shares `services/profileService.js` with the Settings page, so
typing a change and asking for it behave identically (same validation, same
auto-calculated calories). Invalid values are rejected, not silently saved.

**To add another capability:** add a schema + a `case` in
`server/agent/tools.js`, then `node scripts/sync-foundry-agent.js`.

### Using a NEW-style Foundry agent (versioned, with Publish)

Microsoft Foundry has **two** kinds of agent, and they use different APIs:

| | Classic "assistants" | **New Foundry agents** |
|---|---|---|
| ID | `asst_…` | a **name**, e.g. `decade-ai` |
| Portal | no versions | versioned + **Publish** button |
| API | `@azure/ai-agents` SDK | Responses API (`agent_reference`) |
| Listed by the SDK | ✅ | ❌ (invisible to it) |

For a new-style agent, set its **name** in `.env`:

```
AI_PROVIDER=foundry
AZURE_AI_FOUNDRY_AGENT_NAME=decade-ai
```

**One-time step — give the agent HereForFood's tools.** New-style agents reject
per-request tools (*"Not allowed when agent is specified"*), so the functions
must live on the agent itself:

```bash
node scripts/sync-foundry-agent.js --dry-run   # preview
node scripts/sync-foundry-agent.js             # creates a new agent version
```

This **creates a new version** that keeps your instructions and hosted tools
(`web_search`, `file_search`) and adds the app's functions (`log_meal`,
`get_dashboard`, `recommend_meals`, `plan_meals`, `find_local_food`, …). The
previous version stays in the portal, so you can roll back any time. Re-run it
whenever you change the app's tools.

The provider (`server/agent/foundryAgentProvider.js`) then runs the agentic
loop: call the agent → execute any `function_call` items against the app's real
services → send the outputs back with `previous_response_id` → repeat until it
answers. The live user profile is appended per turn, so the agent's portal
instructions stay the source of truth for its persona.

### Using a CLASSIC agent you created in the Foundry portal

If you built an agent in the portal (recommended — you keep control of its
persona and tools), add its ID to `.env`:

```
AI_PROVIDER=foundry
AZURE_AI_FOUNDRY_AGENT_ID=asst_xxxxxxxxxxxxxxxx
AZURE_AI_FOUNDRY_SYNC_AGENT=false      # leave your portal agent untouched
```

Find the ID in the portal (Agents → your agent), or list them:

```bash
node -e "require('dotenv').config();const{AgentsClient}=require('@azure/ai-agents');const{DefaultAzureCredential}=require('@azure/identity');(async()=>{const c=new AgentsClient(process.env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT,new DefaultAzureCredential());for await(const a of c.listAgents())console.log(a.id,a.name,a.model)})()"
```

**How the tools connect.** A portal agent declares its own function tools. This
app implements that contract in `server/agent/portalToolAdapter.js`, mapping the
agent's tool names/params onto HereForFood's real services and database:

| Portal agent tool | HereForFood implementation |
|---|---|
| `get_user_profile` / `update_user_profile` | `store` profile |
| `lookup_nutrition` (`food_name`) | `services/nutrition.js` |
| `log_meal` (`food_name`, `meal_type`) | `store.addLog` → dashboard |
| `save_meal_plan` / `get_meal_plan` | `store` + `services/mealPlanner.js` |
| `generate_grocery_list` | `services/grocery.js` |
| `check_progress_vs_goal` | today's totals vs calorie target |

With `SYNC_AGENT=false` the app never modifies your agent — it keeps its persona
and tools, and each run gets the live user profile appended via
`additionalInstructions`. If the agent declares a tool the app doesn't
implement, the server logs a clear warning naming it; add a handler in
`portalToolAdapter.js`.

Set `AZURE_AI_FOUNDRY_SYNC_AGENT=true` only if you want the app to *overwrite*
the agent's tools with its own native set. Leave `AZURE_AI_FOUNDRY_AGENT_ID`
blank to have the app create and delete a temporary agent per request.

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
