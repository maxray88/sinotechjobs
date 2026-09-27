import "server-only";

import { getSupabaseAdmin } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// match_scores persistence — fault-tolerant (004 may not be applied yet)
// ---------------------------------------------------------------------------
// Table (db/migrations/004_matching_legal.sql):
//   match_scores(candidate_id UUID, job_posting_id TEXT, score INT,
//                match_reasons TEXT[], hard_filter_pass BOOL, computed_at)
//   UNIQUE (candidate_id, job_posting_id)
// If the table is missing (42P01) or Supabase is unconfigured, all functions
// degrade gracefully instead of throwing: writes return { saved: 0 },
// reads return [].

export interface MatchScoreInput {
  candidate_id: string;
  /** Board job id — mapped to the `job_posting_id` column. */
  job_id: string;
  score: number;
  reasons: string[];
  hard_filter_pass?: boolean;
}

export interface SaveMatchScoresResult {
  saved: number;
  /** True when the write was skipped because the table/env is unavailable. */
  degraded?: boolean;
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.code === "42P01") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return (
    message.includes("match_scores") && message.toLowerCase().includes("does not exist")
  );
}

/**
 * Upsert match scores on (candidate_id, job_posting_id).
 * Returns { saved: 0, degraded: true } when the 004 table is missing or
 * Supabase is unconfigured — never throws for persistence-layer absence.
 */
export async function saveMatchScores(
  scores: MatchScoreInput[],
): Promise<SaveMatchScoresResult> {
  if (scores.length === 0) return { saved: 0 };
  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { saved: 0, degraded: true };
  }
  try {
    // FIX: Math.max/Math.min propagate NaN (Math.min(100, NaN) === NaN), and a
    // NaN fails the INT column, which aborts the entire all-or-nothing upsert
    // and loses every row. Non-finite scores are SKIPPED (not coerced to 0) so
    // one bad row cannot discard the rest of the batch.
    const rows = scores
      .filter((s) => Number.isFinite(s.score))
      .map((s) => ({
        candidate_id: s.candidate_id,
        job_posting_id: s.job_id,
        score: Math.max(0, Math.min(100, Math.round(s.score))),
        match_reasons: s.reasons,
        hard_filter_pass: s.hard_filter_pass ?? true,
      }));
    if (rows.length === 0) return { saved: 0 };
    const { data, error } = await admin
      .from("match_scores")
      .upsert(rows, { onConflict: "candidate_id,job_posting_id" })
      .select("candidate_id,job_posting_id");
    if (error) {
      if (isMissingTableError(error)) return { saved: 0, degraded: true };
      throw error;
    }
    return { saved: data?.length ?? 0 };
  } catch (error) {
    if (isMissingTableError(error)) return { saved: 0, degraded: true };
    throw error;
  }
}

export interface TopMatch {
  job_id: string;
  score: number;
  reasons: string[];
}

/**
 * Top-N persisted matches for a candidate, highest score first.
 * Returns [] when the 004 table is missing or Supabase is unconfigured.
 */
export async function getTopMatches(
  candidateId: string,
  limit = 10,
): Promise<TopMatch[]> {
  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return [];
  }
  try {
    const { data, error } = await admin
      .from("match_scores")
      .select("job_posting_id,score,match_reasons")
      .eq("candidate_id", candidateId)
      .order("score", { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
    // FIX: String(null) produces the literal "null" and Number(null) produces
    // NaN. Drop rows with a null/undefined job_posting_id and any non-finite
    // score instead of propagating those sentinels into TopMatch.
    return (data ?? [])
      .filter(
        (row) =>
          row.job_posting_id !== null &&
          row.job_posting_id !== undefined &&
          Number.isFinite(Number(row.score))
      )
      .map((row) => ({
        job_id: String(row.job_posting_id),
        score: Number(row.score),
        reasons: Array.isArray(row.match_reasons) ? row.match_reasons : [],
      }));
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}
