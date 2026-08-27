import "server-only";

import { getSupabaseAdmin } from "@/lib/db/client";
import { rowToJob } from "@/lib/db/mappers";
import type { Job } from "@/lib/types";

// ---------------------------------------------------------------------------
// Saved filter shape (matches POST validation)
// ---------------------------------------------------------------------------
export type DigestFilter = {
  field?: "ai" | "cs" | "robotics" | "drone" | "remote";
  location?: "de" | "at" | "ch" | "remote";
  languageLevel?: "nice-to-have" | "required" | "fluent";
  employmentType?: "full-time" | "part-time" | "internship" | "contract";
  remote?: boolean;
  visa?: boolean;
  q?: string;
};

// Keep alias for spec compatibility
export type SavedFilterInput = DigestFilter;

/**
 * Return true if job matches a single filter.
 * All defined fields must match (AND). q is substring case-insensitive across title, titleZh, company, description, descriptionZh, tags, location.
 */
export function matchesFilter(job: Job, filter: DigestFilter): boolean {
  if (filter.field && job.field !== filter.field) return false;
  if (filter.location && job.locationCode !== filter.location) return false;
  if (filter.languageLevel && job.languageLevel !== filter.languageLevel) return false;
  if (filter.employmentType && job.employmentType !== filter.employmentType) return false;
  if (typeof filter.remote === "boolean" && job.remoteFriendly !== filter.remote) return false;
  if (typeof filter.visa === "boolean" && job.visaSponsorship !== filter.visa) return false;
  if (filter.q !== undefined && filter.q !== null) {
    const q = String(filter.q).trim();
    if (q.length > 0) {
      const needle = q.toLowerCase();
      const haystack = [
        job.title ?? "",
        job.titleZh ?? "",
        job.company ?? "",
        job.companyZh ?? "",
        job.location ?? "",
        job.description ?? "",
        job.descriptionZh ?? "",
        ...(job.tags ?? []),
        ...(job.requirements ?? []),
        ...(job.requirementsZh ?? []),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
  }
  return true;
}

/**
 * Build digest for a user: fetch jobs created since `since` (max 100) and filter in JS.
 * Returns deduplicated jobs that match ANY of the provided filters (OR across filters).
 * If filters is empty, returns [].
 */
export async function buildDigestForUser(
  userId: string,
  filters: DigestFilter[],
  since: Date
): Promise<Job[]> {
  // userId is kept for API symmetry (cron passes userId), but filtering uses provided filters.
  void userId;
  if (!filters || filters.length === 0) return [];

  const supabase = getSupabaseAdmin();

  // Fetch recent jobs — simple JS filtering for M3 (32 jobs scale is tiny)
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .gte("created_at", since.toISOString())
    .limit(100);

  if (error) {
    console.error("[digest] jobs fetch error", error);
    return [];
  }

  const rows = (data ?? []) as unknown[];
  // Map DB rows to domain Jobs; if mapping fails, skip row
  const jobs: Job[] = [];
  for (const r of rows) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jobs.push(rowToJob(r as any));
    } catch (e) {
      console.warn("[digest] rowToJob failed", e);
    }
  }

  const matched: Job[] = [];
  const seen = new Set<string>();

  for (const job of jobs) {
    const isMatch = filters.some((f) => matchesFilter(job, f));
    if (isMatch && !seen.has(job.id)) {
      seen.add(job.id);
      matched.push(job);
    }
  }

  return matched;
}
