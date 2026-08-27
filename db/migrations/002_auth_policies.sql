-- Migration: 002_auth_policies
-- Date: 2026-08-27
-- Description: Activate RLS policies for magic-link auth + profiles trigger
-- Dependencies: 001_init.sql (tables jobs, scrape_reports, email_subscriptions, employer_postings, profiles)
-- Idempotent: DROP POLICY IF EXISTS / CREATE POLICY, CREATE OR REPLACE FUNCTION/TRIGGER

-- ---------------------------------------------------------------------------
-- Jobs — public read (anon + authenticated), service_role full access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read on jobs" ON jobs;
CREATE POLICY "Allow public read on jobs"
  ON jobs FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow service_role all on jobs" ON jobs;
CREATE POLICY "Allow service_role all on jobs"
  ON jobs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Scrape reports — service_role only (admin via service_role)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow service_role all on scrape_reports" ON scrape_reports;
CREATE POLICY "Allow service_role all on scrape_reports"
  ON scrape_reports FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Email subscriptions — anon can INSERT, service_role full access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anon insert email_subscriptions" ON email_subscriptions;
CREATE POLICY "Allow anon insert email_subscriptions"
  ON email_subscriptions FOR INSERT
  TO anon
  WITH CHECK (true);

-- Optional: allow anon/authenticated to select? Not required per spec, but keep insert-only.
-- Service role bypasses and manages all rows.
DROP POLICY IF EXISTS "Allow service_role all on email_subscriptions" ON email_subscriptions;
CREATE POLICY "Allow service_role all on email_subscriptions"
  ON email_subscriptions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Employer postings — authenticated users can SELECT/INSERT own rows
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own postings" ON employer_postings;
CREATE POLICY "Users can view own postings"
  ON employer_postings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own postings" ON employer_postings;
CREATE POLICY "Users can insert own postings"
  ON employer_postings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service_role all on employer_postings" ON employer_postings;
CREATE POLICY "Allow service_role all on employer_postings"
  ON employer_postings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Profiles — authenticated users can SELECT/UPDATE own profile
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Allow service_role all on profiles" ON profiles;
CREATE POLICY "Allow service_role all on profiles"
  ON profiles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Function + trigger: auto-create profile on new auth.users insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, display_name)
  VALUES (
    NEW.id,
    'employer',
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
