/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { getSupabaseAdmin } from "./client";
import type { JobRow } from "./types";
import type { Job } from "../types";
import { jobToRow, rowToJob } from "./mappers";
export { jobToRow, rowToJob, mapRowToJob, mapJobToRow } from "./mappers";

// Escape a search term into a Postgres ILIKE *pattern* body: `%`, `_` and
// backslash are pattern metacharacters, so they are backslash-escaped, and the
// term is length-capped.
//
// The comma is deliberately NOT escaped here. A comma inside a PostgREST
// `or=(...)` argument is a filter separator, and backslash-escaping it (`\,`)
// does not survive: PostgREST splits the argument on commas before it applies
// SQL string-literal escaping, so `\,` still reads as a separator and the
// remainder is parsed as its own (invalid) condition -> HTTP 400. Use
// ilikeSearchValue() for the `or=` path; it quotes the value instead.
const MAX_ILIKE_LEN = 100;
export function escapeIlike(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const capped = trimmed.slice(0, MAX_ILIKE_LEN);
  // Escape backslash first to avoid double-escaping the escapes added below.
  return capped.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Characters PostgREST reads as structure in an unquoted `or=` operand: the
// comma (operand separator), the parens (postgrest-js wraps the whole `or=`
// argument in them), and the double quote (the quoting character itself).
const PGREST_STRUCTURAL = /[,"()]/;

// Build the `col.ilike.<value>` operand for a PostgREST `or=(...)` filter.
//
// PostgREST's grammar for `or=` splits the argument on top-level commas before
// it applies any SQL string-literal escaping, so a comma in the search term
// used to be read as an operand separator and the remainder as its own
// (invalid) condition -> HTTP 400. Backslash-escaping it does not help,
// because that escaping is Postgres' job and happens after the split. The one
// form PostgREST does honour is a double-quoted value, so a term containing a
// structural character is wrapped in double quotes, with any literal double
// quote inside written as `\"`.
//
// A term with nothing structural in it is emitted unquoted, unchanged from
// before: the quotes carry no meaning for Postgres, and adding them
// unconditionally would only make the emitted filter harder to read.
//
// `%`, `_` and backslash keep their ILIKE backslash-escapes in both forms,
// because Postgres — not PostgREST — is what interprets those.
export function ilikeSearchValue(raw: string): string {
  const escaped = escapeIlike(raw);
  if (!escaped) return "";
  // The double quotes are the PostgREST transport, not part of the pattern.
  // The `.ilike()` fallback below passes the pattern straight to Postgres, so
  // it must keep using escapeIlike() and stay unquoted — a stray quote there
  // would be a literal `"` in the pattern and match nothing.
  const pattern = `%${escaped}%`;
  if (!PGREST_STRUCTURAL.test(escaped)) return pattern;
  return `"${pattern.replace(/"/g, '\\"')}"`;
}

// PostgREST's hard page limit. Keeps a single caller from ranging the table.
export const MAX_PAGE_SIZE = 1000;

// Clamp pagination inputs: `page: 0` (or a NaN from parseInt) yields a
// negative `from`, which PostgREST rejects -> 500, and an uncapped pageSize
// lets any caller pull the whole table in one request.
function clampPagination(filter: ListJobsFilter): { page: number; pageSize: number } {
  const rawPage = filter.page;
  const rawPageSize = filter.pageSize;
  const page =
    typeof rawPage === "number" && Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const pageSize =
    typeof rawPageSize === "number" && Number.isFinite(rawPageSize)
      ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(rawPageSize)))
      : 20;
  return { page, pageSize };
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

// True when an error means migration 005 hasn't been applied yet
// (is_expired / expires_at columns missing). Covers Postgres 42703
// (undefined_column), PostgREST PGRST204, and message variants.
//
// The structured `code` is preferred, because it is unambiguous: 42703 and
// PGRST204 *are* the not-found signal. The message fallback is deliberately
// strict — it must name the expiry column AND say the column does not exist.
// A bare "column" (or a message that merely names a column while complaining
// about something else) is not evidence of a missing column, and taking the
// degraded path on those costs a second full query on every single call.
export function isMissingExpiryColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.code === "42703" || record.code === "PGRST204") return true;
  const message = typeof record.message === "string" ? record.message : "";
  if (!message) return false;
  const lower = message.toLowerCase();
  const mentionsColumn = lower.includes("is_expired") || lower.includes("expires_at");
  return mentionsColumn && lower.includes("does not exist");
}

// ---------------------------------------------------------------------------
// listJobs — filtered, paginated query
// ---------------------------------------------------------------------------
export async function listJobs(
  filter: ListJobsFilter = {}
): Promise<{ items: Job[]; total: number }> {
  const supabase = getSupabaseAdmin();

  const { page, pageSize } = clampPagination(filter);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  // Computed once so the whole page of rows is compared against a stable date.
  const today = new Date().toISOString().split("T")[0];

  // Build a fresh query; extracted so the degraded path can retry without
  // the is_expired filter when migration 005 hasn't been applied yet.
  const buildQuery = (applyExpiryFilter: boolean): any => {
    let q: any = supabase.from("jobs").select("*", { count: "exact" });
    // The expiry group and the free-text search group are each internally an OR,
    // but they must combine with AND. Verified against postgrest-js 1.19.4:
    // PostgrestFilterBuilder.or() does url.searchParams.append('or', `(${filters})`),
    // i.e. it appends one `or=` param per call, and PostgREST ANDs multiple
    // top-level params. So each group is emitted as its own `.or()` call below,
    // giving (expiryGroup) AND (searchGroup).
    //
    // Do NOT merge them into one `or(and(a),and(b))`: that is an OR of ANDs, so
    // `expires_at IS NULL` (true) AND `expires_at >= today` (NULL) -> false/never
    // true, which would hide every job with no expiry date as soon as a search
    // term is present, and would additionally let past-dated rows matching the
    // search slip through. That regression is what this shape avoids.
    let expiryClause: string | null = null;
    let searchClause: string | null = null;

    // Soft-expiry: hide expired by default (admin can opt in via includeExpired)
    if (applyExpiryFilter) {
      q = q.eq("is_expired", false);
      // is_expired is only ever set by the daily cron, so between runs a job
      // past expires_at would still ship. Re-check the date in the query.
      // Rows with expires_at IS NULL never expire (see isJobExpired), so they
      // are kept explicitly: a bare .lt() would drop them, since SQL NULL < date
      // evaluates to NULL and is therefore never true.
      expiryClause = `expires_at.is.null,expires_at.gte.${today}`;
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
      // Two encodings of the same pattern, because the two sinks differ:
      // `or=` needs the PostgREST-quoted value (a comma in the term would
      // otherwise split the argument -> 400), while the bare `.ilike()`
      // fallback is handed the pattern as a plain value by Postgres and must
      // stay unquoted. Both are empty exactly when the term is blank.
      const orValue = ilikeSearchValue(filter.q);
      // empty or whitespace-only query -> skip filter
      if (!orValue) {
        // no search clause
      } else if (typeof q.or !== "function") {
        // Client without .or() (e.g. a partial mock) — degrade to one column.
        q = q.ilike("title", `%${escapeIlike(filter.q)}%`);
      } else {
        // Use or with ilike across title/company/description (contains ilike for spec compliance)
        // Also support ilike fallback for mocks that track ilike separately
        searchClause = `title.ilike.${orValue},company.ilike.${orValue},description.ilike.${orValue}`;
      }
    }

    // `.or()` appends rather than replaces, so one call per group yields two
    // `or=` params that PostgREST ANDs together. Search is appended first; the
    // AND makes the order semantically irrelevant.
    if (typeof q.or === "function") {
      if (searchClause) q = q.or(searchClause);
      if (expiryClause) q = q.or(expiryClause);
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

  // Degraded mode: migration 005 not applied yet -> retry without the SQL expiry
  // filter, then drop expired rows in JS via isJobExpired so an unapplied
  // migration can never publish expired jobs to the board or the sitemap.
  let degraded = false;
  if (error && applyExpiryFilter && isMissingExpiryColumn(error)) {
    console.warn("[jobs-repo] listJobs: expiry columns missing, retrying without is_expired filter and filtering expired jobs in memory");
    degraded = true;
    ({ data, error, count } = await buildQuery(false));
  }

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as JobRow[];
  let items = rows.map(rowToJob);
  // isJobExpired reads the mapped domain Job (isExpired/expiresAt), not a row,
  // so the JS pass has to run after rowToJob.
  if (degraded) {
    items = items.filter((job) => !isJobExpired(job));
  }
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
// Bound the sweep. The first run after a long gap can have tens of thousands
// of overdue rows, and an unbounded UPDATE ... RETURNING pulls every one of
// those ids back into the function's memory at once. 500 rows per pass is
// ample for a daily cron.
const EXPIRE_BATCH_LIMIT = 500;

export async function expireOverdueJobs(): Promise<{ expiredCount: number; degraded?: boolean }> {
  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("jobs")
    .update({ is_expired: true } as never)
    .eq("is_expired", false)
    .lt("expires_at", today)
    .limit(EXPIRE_BATCH_LIMIT)
    .select("id");
  if (error) {
    // Degraded mode: migration 005 not applied yet -> no-op instead of throwing.
    if (isMissingExpiryColumn(error)) {
      console.warn("[jobs-repo] expireOverdueJobs: expiry columns missing, skipping sweep");
      return { expiredCount: 0, degraded: true };
    }
    throw error;
  }
  // NOTE: expiredCount is this pass's batch size, not the number of overdue
  // rows still in the table. If more than EXPIRE_BATCH_LIMIT rows were due,
  // the remainder keeps is_expired=false until a later run; the daily cron
  // converges on them (500/day) and nothing user-visible depends on the flag
  // lagging, because listJobs re-checks expires_at in SQL and in the in-memory
  // isJobExpired() pass, so those rows stay hidden from the board meanwhile.
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
// `added` counts rows actually INSERTED, never rows the upsert merely touched.
// `upserted` is the DB-reported affected-row count (inserts + updates merged
// on source_url); it normally equals `added` and only differs when a concurrent
// writer inserted the same URL between our dedup read and the upsert, which is
// why it is reported separately instead of being folded into `added`.
// `skippedNoUrl` counts rows dropped for having no dedup/linkable URL.
export type UpsertJobsResult = { added: number; upserted: number; skippedNoUrl: number };

// The URL a job is de-duplicated on, and that jobToRow stores in source_url.
// A blank/whitespace-only value counts as absent. The raw (untrimmed) string is
// returned so the dedup key matches byte-for-byte what lands in the unique
// index; only the emptiness test is trimming.
function dedupUrl(job: Job): string {
  const raw = (job as any).sourceUrl ?? job.applicationUrl;
  if (typeof raw !== "string") return "";
  return raw.trim() ? raw : "";
}

export async function upsertJobs(jobs: Job[]): Promise<UpsertJobsResult> {
  if (jobs.length === 0) return { added: 0, upserted: 0, skippedNoUrl: 0 };

  const supabase = getSupabaseAdmin();

  // A job with neither sourceUrl nor applicationUrl has no unique key and no
  // link to apply through: it can never be matched by the dedup read below
  // (dedupUrl() is "" for it, and "" is not in the DB), and Postgres treats
  // NULLs as distinct in a unique index, so every scrape would append another
  // copy and the duplicates would grow without bound. Such a job is not
  // actionable, so drop it and report the count once per batch rather than
  // letting it stay invisible.
  const usable: Job[] = [];
  let skippedNoUrl = 0;
  for (const job of jobs) {
    if (dedupUrl(job)) usable.push(job);
    else skippedNoUrl += 1;
  }
  if (skippedNoUrl > 0) {
    console.warn(
      `[jobs-repo] upsertJobs: skipped ${skippedNoUrl} of ${jobs.length} job(s) with no sourceUrl/applicationUrl — they cannot be de-duplicated or linked to`,
    );
  }
  if (usable.length === 0) return { added: 0, upserted: 0, skippedNoUrl };

  // Dedup by source_url (fallback to applicationUrl)
  const urls = [...new Set(usable.map(dedupUrl))];

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

  // Already in the table -> not an insert, so it must not reach the upsert at
  // all (and must not be counted as added afterwards).
  const notYetStored = usable.filter((j) => !existingSet.has(dedupUrl(j)));

  if (notYetStored.length === 0) return { added: 0, upserted: 0, skippedNoUrl };

  // Deduplicate within batch by source_url to avoid ON CONFLICT duplicate in same command
  const seen = new Set<string>();
  const toInsert: Job[] = [];
  for (const j of notYetStored) {
    const url = dedupUrl(j);
    if (seen.has(url)) continue;
    seen.add(url);
    toInsert.push(j);
  }

  if (toInsert.length === 0) return { added: 0, upserted: 0, skippedNoUrl };

  const rows = toInsert.map(jobToRow);

  // Upsert by source_url (UNIQUE) to handle concurrent same URL with different scraped-id
  const { data, error, count } = await supabase
    .from("jobs")
    .upsert(rows, { onConflict: "source_url", count: "exact" })
    .select("id");

  if (error) {
    const code = (error as any)?.code;
    const msg = (error as any)?.message ?? "";
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      // Concurrent insert with same source_url but different id caused unique violation
      // Treat as skipped (already exists)
      return { added: 0, upserted: 0, skippedNoUrl };
    }
    throw error;
  }

  // `Prefer: count=exact` on a merge-duplicates upsert counts rows *affected*,
  // i.e. inserted and updated together, so it can never be reported as "added".
  // The pre-upsert dedup above is what makes the honest split possible: every
  // row in `toInsert` had a source_url that was absent from the table when we
  // read it, so the database inserted it. `upserted` keeps the raw affected-row
  // count so the one residual race — a concurrent writer inserting the same URL
  // between the read and the upsert, which turns a would-be insert into an
  // update — surfaces as upserted > added instead of inflating "new jobs".
  const upserted =
    typeof count === "number" ? count : Array.isArray(data) ? data.length : toInsert.length;

  return { added: toInsert.length, upserted, skippedNoUrl };
}
