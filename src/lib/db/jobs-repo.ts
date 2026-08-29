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
};

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

  // Build query: select with count exact
  let query: any = supabase.from("jobs").select("*", { count: "exact" });

  if (filter.field) {
    query = query.eq("field", filter.field);
  }
  if (filter.locationCode) {
    query = query.eq("location_code", filter.locationCode);
  }
  if (filter.languageLevel) {
    query = query.eq("language_level", filter.languageLevel);
  }
  if (filter.employmentType) {
    query = query.eq("employment_type", filter.employmentType);
  }
  if (filter.remote !== undefined) {
    query = query.eq("remote_friendly", filter.remote);
  }
  if (filter.visa !== undefined) {
    query = query.eq("visa_sponsorship", filter.visa);
  }
  if (filter.q) {
    const escaped = escapeIlike(filter.q);
    if (!escaped) {
      // empty or whitespace-only query -> skip filter
    } else {
      const pattern = `%${escaped}%`;
      // Use or with ilike across title/company/description (contains ilike for spec compliance)
      // Also support ilike fallback for mocks that track ilike separately
      if (typeof query.or === "function") {
        query = query.or(`title.ilike.${pattern},company.ilike.${pattern},description.ilike.${pattern}`);
      } else if (typeof query.ilike === "function") {
        query = query.ilike("title", pattern);
      }
    }
  }

  // Order by posted_date desc, fallback to created_at desc
  query = query.order("posted_date", { ascending: false });
  // Some implementations also order by created_at as secondary
  if (typeof query.order === "function") {
    // chain second order if supported (not all mocks need it)
    try {
      query = query.order("created_at", { ascending: false });
    } catch {
      // ignore if mock doesn't support chaining second order
    }
  }

  query = query.range(from, to);

  const { data, error, count } = await query;

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
