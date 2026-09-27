import type { ScrapeReport, ScraperSource } from "./types";

export type HealthStatus = "success" | "error" | "never";

export interface HealthEntry {
  sourceId: string;
  sourceName: string;
  enabled: boolean;
  type: string;
  lastStatus: HealthStatus;
  lastJobsFound: number;
  lastJobsFiltered: number;
  lastError: string | null;
  lastRunAt: string | null;
  successRate: number;
  avgDurationMs: number | null;
  isDisabled?: boolean;
}

type RawResult = {
  sourceId?: string;
  source?: { id: string };
  jobsFound: number;
  jobsFiltered: number;
  errors: string[];
  duration?: number;
  durationMs?: number;
};

function getSourceId(result: RawResult): string | undefined {
  if (typeof result.sourceId === "string") return result.sourceId;
  if (result.source && typeof result.source.id === "string") return result.source.id;
  return undefined;
}

function getDuration(result: RawResult): number | null {
  if (typeof result.duration === "number") return result.duration;
  if (typeof result.durationMs === "number") return result.durationMs;
  return null;
}

function getTimestamp(report: unknown): string | null {
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  if (typeof r["timestamp"] === "string") return r["timestamp"] as string;
  if (r["report"] && typeof r["report"] === "object") {
    const inner = r["report"] as Record<string, unknown>;
    if (typeof inner["timestamp"] === "string") return inner["timestamp"] as string;
  }
  return null;
}

function getTimestampMs(report: unknown): number | null {
  const ts = getTimestamp(report);
  if (!ts) return null;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Single source of truth for "did this run fail?".
 * A run with zero errors is a success; a run with any error is a failure.
 * (Used by both computeSuccessRate and shouldAutoDisable so the two can never disagree.)
 */
function isRunFailed(result: RawResult): boolean {
  return ((result.errors ?? []) as string[]).length > 0;
}

/**
 * Infrastructure failure: EVERY source errored in the same run (no network / DNS
 * down / proxy dead). This is not a per-source signal, so the run must not count
 * toward any source's failure streak.
 *
 * Requires more than one source: in a single-source run ("--source=x") "every
 * source errored" holds trivially, and skipping it would discard a genuine
 * per-source failure signal.
 */
function isInfraFailureRun(results: RawResult[]): boolean {
  if (results.length <= 1) return false;
  return results.every((r) => isRunFailed(r));
}

function getResults(report: unknown): RawResult[] | null {
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  if (Array.isArray(r["results"])) return r["results"] as RawResult[];
  if (r["report"] && typeof r["report"] === "object") {
    const inner = r["report"] as Record<string, unknown>;
    if (Array.isArray(inner["results"])) return inner["results"] as RawResult[];
  }
  return null;
}

function isReEnableFor(report: unknown, sourceId: string): boolean {
  if (!report || typeof report !== "object") return false;
  const r = report as Record<string, unknown>;
  // DB row shape: { report: { reEnable: sourceId } }
  if (r["report"] && typeof r["report"] === "object") {
    const inner = r["report"] as Record<string, unknown>;
    if (inner["reEnable"] === sourceId) return true;
  }
  // Direct shape: { reEnable: sourceId }
  if (r["reEnable"] === sourceId) return true;
  return false;
}

/**
 * Compute success rate as successes / examined (0..1).
 * - examines last 20 reports (slice(-20))
 * - filters by windowDays (default 7) using timestamp
 * - for each report, finds result matching sourceId; counts success if the run has no errors
 *   (same isRunFailed predicate shouldAutoDisable uses, so the two cannot disagree)
 * - if no history return 0
 */
export function computeSuccessRate(
  sourceId: string,
  reports: unknown[],
  windowDays = 7
): number {
  if (!Array.isArray(reports) || reports.length === 0) return 0;

  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  let filtered: unknown[] = reports;
  if (typeof windowDays === "number" && windowDays > 0) {
    filtered = reports.filter((r) => {
      const ts = getTimestamp(r);
      if (!ts) return true;
      const t = new Date(ts).getTime();
      if (Number.isNaN(t)) return true;
      return now - t <= windowMs;
    });
    if (filtered.length === 0) return 0;
  }

  const windowReports = filtered.slice(-20);

  let examined = 0;
  let successes = 0;

  for (const r of windowReports) {
    if (isReEnableFor(r, sourceId)) {
      examined++;
      successes++;
      continue;
    }
    const results = getResults(r);
    if (!results) continue;
    const found = results.find((rr) => getSourceId(rr) === sourceId);
    if (!found) continue;
    examined++;
    if (!isRunFailed(found as RawResult)) successes++;
  }

  if (examined === 0) return 0;
  return successes / examined;
}

/**
 * Check if source should be auto-disabled: last `consecutive` reports for this source all failed.
 * Failure = any error in the run (see isRunFailed). If fewer than consecutive relevant reports, return false.
 *
 * - A re-enable marker TERMINATES the streak: walking back past one would resurrect stale
 *   failures and immediately re-disable a source the admin just re-enabled.
 * - History is limited to `windowDays` (same window computeSuccessRate uses) so ancient
 *   failures cannot accumulate into a permanent disable.
 * - Runs where every source errored are infrastructure failures and are skipped entirely.
 */
export function shouldAutoDisable(
  sourceId: string,
  reports: unknown[],
  consecutive = 5,
  windowDays = 7
): boolean {
  if (!Array.isArray(reports) || reports.length === 0) return false;

  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  let inWindow: unknown[] = reports;
  if (typeof windowDays === "number" && windowDays > 0) {
    inWindow = reports.filter((r) => {
      const t = getTimestampMs(r);
      // Untimestamped entries are re-enable markers written at action time — keep them.
      if (t === null) return true;
      return now - t <= windowMs;
    });
  }

  // Order most-recent-first. A report with no usable timestamp is a synthetic marker
  // written when the admin acted, so treat it as the NEWEST — never sort it into the
  // past, where the walk would step over it and read pre-existing failures.
  const ordered = [...inWindow].sort((a, b) => {
    const ta = getTimestampMs(a) ?? Number.POSITIVE_INFINITY;
    const tb = getTimestampMs(b) ?? Number.POSITIVE_INFINITY;
    return tb - ta;
  });

  const relevant: RawResult[] = [];

  for (const r of ordered) {
    // A re-enable marker ends the streak outright: nothing older than it matters.
    if (isReEnableFor(r, sourceId)) break;

    const results = getResults(r);
    if (!results) continue;
    // Whole-run infrastructure failure: does not count toward any source's streak.
    if (isInfraFailureRun(results)) continue;

    const found = results.find((rr) => getSourceId(rr) === sourceId);
    if (found) {
      relevant.push(found as RawResult);
      if (relevant.length >= consecutive) break;
    }
  }

  if (relevant.length < consecutive) return false;

  for (const res of relevant) {
    if (!isRunFailed(res)) return false;
  }
  return true;
}

/**
 * Build a health matrix for each source based on the last 5 reports
 * that contain that sourceId. reports[0] is expected to be most recent.
 * Enhanced to use computeSuccessRate and shouldAutoDisable.
 */
export function buildHealthMatrix(
  sources: ScraperSource[],
  reports: ScrapeReport[]
): HealthEntry[] {
  // Cast reports to any[] for helper compatibility (ScrapeReport[] or DB rows)
  const anyReports = reports as unknown as unknown[];
  return sources.map((source) => {
    const relevant: Array<{ report: ScrapeReport; result: RawResult }> = [];

    for (const report of reports) {
      if (!report.results || !Array.isArray(report.results)) continue;
      const found = (report.results as unknown as RawResult[]).find(
        (r) => getSourceId(r) === source.id
      );
      if (found) {
        relevant.push({ report, result: found });
        if (relevant.length >= 5) break;
      }
    }

    const successRateFraction = computeSuccessRate(source.id, anyReports, 7);
    const successRate = Math.round(successRateFraction * 100);
    const isDisabled = shouldAutoDisable(source.id, anyReports, 5);

    if (relevant.length === 0) {
      // No history: check if disabled due to reEnable? If isDisabled false, keep 0.
      // If only reEnable dummy exists but no results, successRate already accounts, but relevant empty => show never but improved successRate
      // Keep computed successRate unless no examined => 0
      return {
        sourceId: source.id,
        sourceName: source.name,
        enabled: source.enabled,
        type: source.type,
        lastStatus: "never" as HealthStatus,
        lastJobsFound: 0,
        lastJobsFiltered: 0,
        lastError: null,
        lastRunAt: null,
        successRate,
        avgDurationMs: null,
        isDisabled,
      };
    }

    const last = relevant[0];
    const lastResult = last.result;
    const lastErrors = lastResult.errors ?? [];
    const lastStatus: HealthStatus = lastErrors.length === 0 ? "success" : "error";

    const durations = relevant
      .map(({ result }) => getDuration(result))
      .filter((d): d is number => typeof d === "number" && !Number.isNaN(d));

    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    return {
      sourceId: source.id,
      sourceName: source.name,
      enabled: source.enabled,
      type: source.type,
      lastStatus,
      lastJobsFound: lastResult.jobsFound ?? 0,
      lastJobsFiltered: lastResult.jobsFiltered ?? 0,
      lastError: lastErrors.length > 0 ? lastErrors[0] : null,
      lastRunAt: last.report.timestamp ?? null,
      successRate,
      avgDurationMs,
      isDisabled,
    };
  });
}
