-- 005_job_expiry.sql — soft-expiry for jobs
-- Adds expires_at (DATE, default 60 days from insert) + is_expired flag.
-- listJobs filters is_expired=false by default; daily cron marks overdue rows.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS expires_at DATE DEFAULT (CURRENT_DATE + INTERVAL '60 days');

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS is_expired BOOLEAN NOT NULL DEFAULT false;

-- Backfill: posted_date + 60d; fall back to created_at::date + 60d, else today + 60d
UPDATE jobs
SET expires_at = COALESCE(
  posted_date + INTERVAL '60 days',
  (created_at AT TIME ZONE 'UTC')::date + INTERVAL '60 days',
  CURRENT_DATE + INTERVAL '60 days'
)::date
WHERE expires_at IS NULL;

-- Overdue rows present before this migration (but not yet flagged)
UPDATE jobs
SET is_expired = true
WHERE COALESCE(is_expired, false) = false
  AND expires_at IS NOT NULL
  AND expires_at < CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_jobs_expired_expires
  ON jobs (is_expired, expires_at);

COMMENT ON COLUMN jobs.expires_at IS 'Soft-expiry date: posted_date + 60 days. Listings hidden from board after this date.';
COMMENT ON COLUMN jobs.is_expired IS 'Soft-delete flag set by expireOverdueJobs() (daily cron). Detail page still renders with Expired badge.';
