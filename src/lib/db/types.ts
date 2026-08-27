// ---------------------------------------------------------------------------
// Supabase row types — mirrors db/migrations/001_init.sql
// Keep in sync with migration DDL. Nullable columns are `string | null` etc.
// ---------------------------------------------------------------------------

export type JobRow = {
  id: string;
  title: string;
  title_zh: string | null;
  company: string;
  company_zh: string | null;
  field: string | null;
  location: string | null;
  location_code: string | null;
  language_level: string | null;
  employment_type: string | null;
  salary_range: string | null;
  description: string;
  description_zh: string | null;
  requirements: string[];
  requirements_zh: string[];
  tags: string[];
  application_url: string;
  source_url: string | null;
  posted_date: string | null;
  remote_friendly: boolean | null;
  visa_sponsorship: boolean | null;
  featured: boolean | null;
  featured_until: string | null;
  tier: string | null;
  source: string | null;
  source_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ScrapeReportRow = {
  id: number;
  timestamp: string | null;
  mode: string | null;
  total_sources: number | null;
  successful_sources: number | null;
  total_jobs_found: number | null;
  total_jobs_filtered: number | null;
  new_jobs_added: number | null;
  report: unknown | null;
};

export type EmailSubscriptionRow = {
  email: string;
  subscribed_at: string | null;
  language: string | null;
  confirmed: boolean | null;
};

export type EmployerPostingRow = {
  id: number;
  user_id: string | null;
  job_title: string;
  job_title_zh: string | null;
  company: string;
  location: string | null;
  field: string | null;
  language_level: string | null;
  employment_type: string | null;
  salary_range: string | null;
  description: string | null;
  description_zh: string | null;
  requirements: string | null;
  application_url: string | null;
  remote_friendly: boolean | null;
  visa_sponsorship: boolean | null;
  tier: string | null;
  payment_status: string | null;
  stripe_session_id: string | null;
  status: string | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
};

export type ProfileRow = {
  id: string;
  role: string | null;
  display_name: string | null;
  created_at: string | null;
};
