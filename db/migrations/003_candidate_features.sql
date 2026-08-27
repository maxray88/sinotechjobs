-- Migration: 003_candidate_features
-- Date: 2026-08-28
-- Description: Candidate profile CRUD + visibility toggle + saved jobs/filters/applications/cvs
-- Dependencies: 001_init.sql (jobs), auth.users
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE

-- ---------------------------------------------------------------------------
-- candidate_profiles — one row per auth user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  headline TEXT,
  bio TEXT,
  skills TEXT[] DEFAULT '{}',
  languages TEXT[] DEFAULT '{}',
  preferred_locations TEXT[] DEFAULT '{}',
  preferred_fields TEXT[] DEFAULT '{}',
  visible BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- saved_jobs — bookmarked jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, job_id)
);

-- ---------------------------------------------------------------------------
-- saved_filters — named filter presets (JSONB)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_filters (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- applications — status tracking per candidate × job
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'saved' CHECK (status IN ('saved','applied','screening','interview','offer','rejected')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, job_id)
);

-- ---------------------------------------------------------------------------
-- cvs — uploaded CV metadata (file stored in storage bucket 'cvs')
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cvs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Storage bucket for CVs (private)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('cvs', 'cvs', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_id ON saved_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_job_id ON saved_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_saved_filters_user_id ON saved_filters(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_cvs_user_id ON cvs(user_id);
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_visible ON candidate_profiles(visible);

-- ---------------------------------------------------------------------------
-- Row Level Security — enable on all new tables
-- ---------------------------------------------------------------------------
ALTER TABLE candidate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE cvs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- candidate_profiles — owner + service_role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own candidate profile" ON candidate_profiles;
CREATE POLICY "Users can manage own candidate profile"
  ON candidate_profiles FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service_role all on candidate_profiles" ON candidate_profiles;
CREATE POLICY "Allow service_role all on candidate_profiles"
  ON candidate_profiles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- saved_jobs — owner + service_role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own saved jobs" ON saved_jobs;
CREATE POLICY "Users can manage own saved jobs"
  ON saved_jobs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service_role all on saved_jobs" ON saved_jobs;
CREATE POLICY "Allow service_role all on saved_jobs"
  ON saved_jobs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- saved_filters — owner + service_role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own saved filters" ON saved_filters;
CREATE POLICY "Users can manage own saved filters"
  ON saved_filters FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service_role all on saved_filters" ON saved_filters;
CREATE POLICY "Allow service_role all on saved_filters"
  ON saved_filters FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- applications — owner + service_role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own applications" ON applications;
CREATE POLICY "Users can manage own applications"
  ON applications FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service_role all on applications" ON applications;
CREATE POLICY "Allow service_role all on applications"
  ON applications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- cvs — owner + service_role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own cvs" ON cvs;
CREATE POLICY "Users can manage own cvs"
  ON cvs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service_role all on cvs" ON cvs;
CREATE POLICY "Allow service_role all on cvs"
  ON cvs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
