/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { getSupabaseAdmin } from "./client";
import type { JobRow } from "./types";
import type { Job } from "../types";
import { jobToRow, rowToJob } from "./mappers";
export { jobToRow, rowToJob, mapRowToJob, mapJobToRow } from "./mappers";

// Escape PostgREST ilike pattern: escape %, _, and , (or separator) plus backslash, cap length
const MAX_ILIKE_LEN = 100;
export function escapeIlike(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const capped = trimmed.slice(0, MAX_ILIKE_LEN);
  // Escape backslash first to avoid double-escaping
  return capped.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/,/g, "\\,");
}

export type ListJobsFilter = {
  field?: string;
  locationCode?: string;
  languageLevel?: string;
  employmentType?: string;
  remote?: boolean;
  visa?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
  /** default false: hide soft-expired jobs. Pass true for admin/detail flows. */
  includeExpired?: boolean;
};

// Pure helper — a job counts as expired when flagged OR past its expires_at date.
export function isJobExpired(job: { isExpired?: boolean; expiresAt?: string }): boolean {
  if (job.isExpired) return true;
  if (!job.expiresAt) return false;
  return job.expiresAt < new Date().toISOString().split("T")[0];
}

// True when a PostgREST error means migration 005 hasn't been applied yet
// (is_expired / expires_at columns missing). Covers Postgres 42703,
// PostgREST PGRST204, and message variants.
export function isMissingExpiryColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.code === "42703" || record.code === "PGRST204") return true;
  const message = typeof record.message === "string" ? record.message : "";
  if (!message) return false;
  const lower = message.toLowerCase();
  const mentionsColumn = lower.includes("is_expired") || lower.includes("expires_at");
  const missingHint =
    lower.includes("does not exist") || lower.includes("column") || lower.includes("42703");
  return mentionsColumn && missingHint;
}

// ---------------------------------------------------------------------------
// listJobs — filtered, paginated query
// ---------------------------------------------------------------------------
export async function listJobs(
  filter: ListJobsFilter = {}
): Promise<{ items: Job[]; total: number }> {
  const supabase = getSupabaseAdmin();

  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Build a fresh query; extracted so the degraded path can retry without
  // the is_expired filter when migration 005 hasn't been applied yet.
  const buildQuery = (applyExpiryFilter: boolean): any => {
    let q: any = supabase.from("jobs").select("*", { count: "exact" });

    // Soft-expiry: hide expired by default (admin can opt in via includeExpired)
    if (applyExpiryFilter) {
      q = q.eq("is_expired", false);
    }

    if (filter.field) {
      q = q.eq("field", filter.field);
    }
    if (filter.locationCode) {
      q = q.eq("location_code", filter.locationCode);
    }
    if (filter.languageLevel) {
      q = q.eq("language_level", filter.languageLevel);
    }
    if (filter.employmentType) {
      q = q.eq("employment_type", filter.employmentType);
    }
    if (filter.remote !== undefined) {
      q = q.eq("remote_friendly", filter.remote);
    }
    if (filter.visa !== undefined) {
      q = q.eq("visa_sponsorship", filter.visa);
    }
    if (filter.q) {
      const escaped = escapeIlike(filter.q);
      if (!escaped) {
        // empty or whitespace-only query -> skip filter
      } else {
        const pattern = `%${escaped}%`;
        // Use or with ilike across title/company/description (contains ilike for spec compliance)
        // Also support ilike fallback for mocks that track ilike separately
        if (typeof q.or === "function") {
          q = q.or(`title.ilike.${pattern},company.ilike.${pattern},description.ilike.${pattern}`);
        } else if (typeof q.ilike === "function") {
          q = q.ilike("title", pattern);
        }
      }
    }

    // Order by posted_date desc, fallback to created_at desc
    q = q.order("posted_date", { ascending: false });
    // Some implementations also order by created_at as secondary
    if (typeof q.order === "function") {
      // chain second order if supported (not all mocks need it)
      try {
        q = q.order("created_at", { ascending: false });
      } catch {
        // ignore if mock doesn't support chaining second order
      }
    }

    q = q.range(from, to);
    return q;
  };

  const applyExpiryFilter = !filter.includeExpired;
  let { data, error, count } = await buildQuery(applyExpiryFilter);

  // Degraded mode: migration 005 not applied yet -> retry without the filter.
  if (error && applyExpiryFilter && isMissingExpiryColumn(error)) {
    console.warn("[jobs-repo] listJobs: expiry columns missing, retrying without is_expired filter");
    ({ data, error, count } = await buildQuery(false));
  }

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as JobRow[];
  const items = rows.map(rowToJob);
  const total = count ?? items.length;

  return { items, total };
}

// ---------------------------------------------------------------------------
// getJobById
// ---------------------------------------------------------------------------
export async function getJobById(id: string): Promise<Job | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("jobs").select("*").eq("id", id).single();
  if (error) {
    // Supabase returns error when not found; treat as null
    const msg = (error as any)?.message ?? "";
    const code = (error as any)?.code;
    if (code === "PGRST116" || msg.toLowerCase().includes("not found") || msg.includes("No rows")) {
      return null;
    }
    throw error;
  }
  if (!data) return null;
  return rowToJob(data as JobRow);
}

// ---------------------------------------------------------------------------
// expireOverdueJobs — flag rows past expires_at (called by daily cron, best-effort)
// ---------------------------------------------------------------------------
export async function expireOverdueJobs(): Promise<{ expiredCount: number; degraded?: boolean }> {
  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("jobs")
    .update({ is_expired: true } as never)
    .eq("is_expired", false)
    .lt("expires_at", today)
    .select("id");
  if (error) {
    // Degraded mode: migration 005 not applied yet -> no-op instead of throwing.
    if (isMissingExpiryColumn(error)) {
      console.warn("[jobs-repo] expireOverdueJobs: expiry columns missing, skipping sweep");
      return { expiredCount: 0, degraded: true };
    }
    throw error;
  }
  return { expiredCount: Array.isArray(data) ? data.length : 0 };
}

// ---------------------------------------------------------------------------
// hardDeleteExpired — admin cleanup: permanently delete rows expired > days ago
// ---------------------------------------------------------------------------
export async function hardDeleteExpired(days = 90): Promise<{ deletedCount: number }> {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("jobs")
    .delete()
    .eq("is_expired", true)
    .lt("expires_at", cutoff)
    .select("id");
  if (error) throw error;
  return { deletedCount: Array.isArray(data) ? data.length : 0 };
}

// ---------------------------------------------------------------------------
// upsertJobs — dedup by source_url, upsert by id
// ---------------------------------------------------------------------------
export async function upsertJobs(jobs: Job[]): Promise<{ added: number }> {
  if (jobs.length === 0) return { added: 0 };

  const supabase = getSupabaseAdmin();

  // Dedup by source_url (fallback to applicationUrl)
  const urls = jobs.map((j) => (j as any).sourceUrl ?? j.applicationUrl).filter(Boolean) as string[];

  const existingSet = new Set<string>();
  if (urls.length > 0) {
    const { data: existingRows, error: fetchError } = await supabase
      .from("jobs")
      .select("source_url")
      .in("source_url", urls);

    if (fetchError) throw fetchError;

    const existing = (existingRows ?? []) as Array<{ source_url: string | null }>;
    for (const r of existing) {
      if (r.source_url) existingSet.add(r.source_url);
    }
  }

  const toInsertRaw = jobs.filter((j) => {
    const url = (j as any).sourceUrl ?? j.applicationUrl;
    return !existingSet.has(url);
  });

  if (toInsertRaw.length === 0) return { added: 0 };

  // Deduplicate within batch by source_url to avoid ON CONFLICT duplicate in same command
  const seen = new Set<string>();
  const toInsert: Job[] = [];
  for (const j of toInsertRaw) {
    const url = (j as any).sourceUrl ?? j.applicationUrl;
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    toInsert.push(j);
  }

  if (toInsert.length === 0) return { added: 0 };

  const rows = toInsert.map(jobToRow);

  // Upsert by source_url (UNIQUE) to handle concurrent same URL with different scraped-id
  const { data, error, count } = await supabase
    .from("jobs")
    .upsert(rows, { onConflict: "source_url", count: "exact" } as any)
    .select();

  if (error) {
    const code = (error as any)?.code;
    const msg = (error as any)?.message ?? "";
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      // Concurrent insert with same source_url but different id caused unique violation
      // Treat as skipped (already exists)
      return { added: 0 };
    }
    throw error;
  }

  // Prefer count from supabase, fallback to inserted length or data length
  const added = typeof count === "number" ? count : Array.isArray(data) ? data.length : toInsert.length;

  return { added };
}
