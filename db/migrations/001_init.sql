-- Migration: 001_init
-- Date: 2026-08-27
-- Description: Initial schema for SinotechJobs (PRD §7) — jobs, scrape_reports, email_subscriptions, employer_postings, profiles
-- Authoritative DDL from docs/PRD.md §7; idempotent via IF NOT EXISTS.
-- Apply via Supabase SQL editor or Management API.

-- ---------------------------------------------------------------------------
-- jobs — core job board entries (sample + scraped + manually approved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_zh TEXT,
  company TEXT NOT NULL,
  company_zh TEXT,
  field TEXT CHECK (field IN ('ai','cs','robotics','drone','remote')),
  location TEXT,
  location_code TEXT CHECK (location_code IN ('de','at','ch','remote')),
  language_level TEXT CHECK (language_level IN ('nice-to-have','required','fluent')),
  employment_type TEXT CHECK (employment_type IN ('full-time','part-time','internship','contract')),
  salary_range TEXT,
  description TEXT NOT NULL,
  description_zh TEXT,
  requirements TEXT[] DEFAULT '{}',
  requirements_zh TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  application_url TEXT NOT NULL,
  source_url TEXT UNIQUE,
  posted_date DATE,
  remote_friendly BOOLEAN DEFAULT FALSE,
  visa_sponsorship BOOLEAN DEFAULT FALSE,
  featured BOOLEAN DEFAULT FALSE,
  featured_until TIMESTAMPTZ,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free','featured','pinned','enterprise')),
  source TEXT DEFAULT 'scraped' CHECK (source IN ('sample','scraped','manual')),
  source_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_field ON jobs(field);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(location_code);
CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);

-- ---------------------------------------------------------------------------
-- scrape_reports — history of scraper runs (last 20 retained by app logic)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_reports (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  mode TEXT DEFAULT 'incremental',
  total_sources INT,
  successful_sources INT,
  total_jobs_found INT,
  total_jobs_filtered INT,
  new_jobs_added INT,
  report JSONB
);

-- ---------------------------------------------------------------------------
-- email_subscriptions — newsletter subscribers (double opt-in via confirmed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_subscriptions (
  email TEXT PRIMARY KEY,
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  language TEXT DEFAULT 'en',
  confirmed BOOLEAN DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- employer_postings — employer-submitted jobs pending admin approval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_postings (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  job_title TEXT NOT NULL,
  job_title_zh TEXT,
  company TEXT NOT NULL,
  location TEXT,
  field TEXT,
  language_level TEXT,
  employment_type TEXT,
  salary_range TEXT,
  description TEXT,
  description_zh TEXT,
  requirements TEXT,
  application_url TEXT,
  remote_friendly BOOLEAN DEFAULT FALSE,
  visa_sponsorship BOOLEAN DEFAULT FALSE,
  tier TEXT DEFAULT 'free',
  payment_status TEXT DEFAULT 'unpaid',
  stripe_session_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- profiles — Supabase Auth user profiles (role-based access)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  role TEXT DEFAULT 'employer' CHECK (role IN ('employer','admin','candidate')),
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Row Level Security — enable on all tables
-- Service role bypasses RLS; anon policies must be added separately.
-- ---------------------------------------------------------------------------
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Permissive policies (examples; apply as needed — service_role bypasses RLS):
-- Jobs: public read for anon, write via service_role only
-- CREATE POLICY "Allow public read on jobs" ON jobs FOR SELECT TO anon USING (true);
-- CREATE POLICY "Allow service_role all on jobs" ON jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Scrape reports: admin/service_role only
-- CREATE POLICY "Allow service_role all on scrape_reports" ON scrape_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Email subscriptions: insert own email via anon, service_role manages
-- CREATE POLICY "Allow anon insert email_subscriptions" ON email_subscriptions FOR INSERT TO anon WITH CHECK (true);
-- CREATE POLICY "Allow service_role all on email_subscriptions" ON email_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Employer postings: users can SELECT/INSERT own rows; admin reviews via service_role
-- CREATE POLICY "Users can view own postings" ON employer_postings FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- CREATE POLICY "Users can insert own postings" ON employer_postings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
-- CREATE POLICY "Allow service_role all on employer_postings" ON employer_postings FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Profiles: users can SELECT/UPDATE own profile; service_role manages
-- CREATE POLICY "Users can view own profile" ON profiles FOR SELECT TO authenticated USING (auth.uid() = id);
-- CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- CREATE POLICY "Allow service_role all on profiles" ON profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
