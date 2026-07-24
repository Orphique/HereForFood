# Database — Supabase (PostgreSQL)

The database schema from the brainstorm's **"Gemini code ideas"** tab, integrated
into HereForFood. The app runs on a local JSON store by default; switch to
Supabase when you want a real Postgres DB with auth.

## Files
| File | What it is |
|---|---|
| `schema.sql` | The tables (`profiles`, `delivery_items`, `meal_logs`) + RLS + signup trigger. Faithful to the tab; lines marked `[HFF]` are additions so the schema matches the app's fields (goal, age, budget, preferences, meal type, portions, SG outlet details). |
| `seed.js` | Populates `delivery_items` from the app's own Singapore data (`server/data/*.json`) so the DB matches the rest of the app. |
| `frontend-helpers.js` | Reference client snippets from the tab (Google OAuth, recommendations query, logMeal). Optional — for when auth moves to the client. |

## Setup (about 10 minutes)
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New Query →** paste `schema.sql` → Run.
3. In the app's `.env` (copy from `.env.example`) set:
   ```
   DB_PROVIDER=supabase
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
   SUPABASE_ANON_KEY=<anon key>
   ```
4. Seed the delivery items:
   ```bash
   node db/seed.js
   ```
5. Start the app — it now reads/writes Supabase:
   ```bash
   npm start
   ```

Set `DB_PROVIDER=json` (or leave it unset) to go back to the local file store.

## How it integrates
`server/store.js` picks the backend from `DB_PROVIDER`. Both
`server/store/jsonStore.js` and `server/store/supabaseStore.js` expose the same
async interface, so routes and the AI agent never change. The Supabase adapter
maps the app's field names to the SQL columns (e.g. `calorieGoal` ↔
`daily_calorie_target`, `fat` ↔ `fats_g`, `dietaryRestrictions` ↔
`food_restrictions`).

## Notes / fixes applied to the original tab code
- The tab's meal-logs RLS policy read `... ON public.meal_logs ALL USING (...)`;
  valid Postgres needs `FOR ALL` — corrected in `schema.sql`.
- `platform` CHECK covers the active SG platforms **GrabFood** and **foodpanda**
  (Deliveroo has exited Singapore, so it was removed from the data and schema).
- `seed.js` was rebuilt to source the app's own SG dishes/outlets instead of the
  tab's generic 30 items, so the DB and the app agree.

## Auth note
The tab's schema keys `profiles` to Supabase Auth (`auth.users`). The demo backend
still identifies users by the email in the `x-user-id` header, so
`supabaseStore.js` bridges that to a Supabase Auth user via the admin API. For
production, do real Supabase Auth on the client (see `frontend-helpers.js`) and
pass the user's JWT instead.
