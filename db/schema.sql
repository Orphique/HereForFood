-- ============================================================================
-- HereForFood — Supabase (PostgreSQL) schema
--
-- Source: the "Gemini code ideas" tab of the HereForFood brainstorm doc
-- (Supabase + Node.js setup). Lines marked [HFF] are additions made to
-- integrate this schema with the existing HereForFood app, which stores a few
-- more fields than the original draft (goal, age, budget, preferences on the
-- profile; meal type + portion on logs; Singapore outlet details on items).
--
-- Run in the Supabase SQL Editor:  Dashboard -> SQL Editor -> New Query.
-- ============================================================================

-- 1. Create Profiles Table (Tied to Supabase Auth)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  daily_calorie_target INT DEFAULT 2000,
  food_restrictions TEXT[] DEFAULT '{}', -- e.g. ['Halal', 'Vegetarian']
  allergies TEXT[] DEFAULT '{}',           -- e.g. ['Peanuts', 'Dairy', 'Gluten']
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- [HFF] fields the app also uses (onboarding + Settings)
  full_name TEXT,
  age INT,
  goal TEXT CHECK (goal IN ('lose_weight','maintain','gain_weight','build_muscle','eat_healthier','manage_diet','track_food','doctor_recommendation','elderly_energy')),
  budget_per_meal NUMERIC(6,2),
  preferences TEXT[] DEFAULT '{}',         -- [HFF] liked foods, e.g. ['chicken rice','laksa']
  -- [HFF] body metrics + activity for personalised calorie targets (BMR/TDEE)
  gender TEXT CHECK (gender IN ('male','female','other')),
  weight_kg NUMERIC(5,1),
  height_cm NUMERIC(5,1),
  activity_level TEXT CHECK (activity_level IN ('sedentary','light','moderate','active','very_active')),
  medical_condition TEXT
);

-- 2. Create Delivery Items Table
CREATE TABLE public.delivery_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  -- Singapore active delivery platforms (Deliveroo has left the SG market)
  platform TEXT NOT NULL CHECK (platform IN ('GrabFood', 'Foodpanda', 'Both')),
  calories INT NOT NULL,
  protein_g NUMERIC(5,1) DEFAULT 0,
  carbs_g NUMERIC(5,1) DEFAULT 0,
  fats_g NUMERIC(5,1) DEFAULT 0,
  price_sgd NUMERIC(5,2) NOT NULL,
  rating NUMERIC(2,1) CHECK (rating >= 1.0 AND rating <= 5.0),
  image_url TEXT,
  dietary_tags TEXT[] DEFAULT '{}', -- e.g. ['Halal', 'High-Protein', 'Keto']
  allergen_tags TEXT[] DEFAULT '{}', -- e.g. ['Peanuts', 'Shellfish', 'Dairy']
  -- [HFF] Singapore outlet context surfaced on Discover cards
  venue TEXT,                     -- e.g. 'Maxwell Food Centre'
  outlet_type TEXT,               -- 'hawker centre' | 'kopitiam' | 'food court' | ...
  distance_km NUMERIC(4,1),
  eta TEXT
);

-- 3. Create Daily Meal Logs
CREATE TABLE public.meal_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  food_name TEXT NOT NULL,
  calories INT NOT NULL,
  protein_g NUMERIC(5,1) DEFAULT 0,
  carbs_g NUMERIC(5,1) DEFAULT 0,
  fats_g NUMERIC(5,1) DEFAULT 0,
  log_type TEXT CHECK (log_type IN ('image', 'text', 'voice')),
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- [HFF] which meal + portion, for the dashboard's grouped view
  meal_type TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  grams INT,
  quantity NUMERIC(5,2) DEFAULT 1
);

-- Helpful index for the "today's logs" dashboard query. [HFF]
CREATE INDEX meal_logs_user_day_idx ON public.meal_logs (user_id, logged_at);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Public read delivery items" ON public.delivery_items FOR SELECT USING (true);
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users manage own meal logs" ON public.meal_logs FOR ALL USING (auth.uid() = user_id);

-- 5. Auto-create Profile Trigger on User Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, food_restrictions, allergies)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    ARRAY[]::TEXT[],
    ARRAY[]::TEXT[]
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
