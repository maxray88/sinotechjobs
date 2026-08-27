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
 * - for each report, finds result matching sourceId; counts success if errors empty or jobsFiltered>0
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
    const errors = (found.errors ?? []) as string[];
    const jobsFiltered = (found.jobsFiltered ?? 0) as number;
    const isSuccess = errors.length === 0 || jobsFiltered > 0;
    if (isSuccess) successes++;
  }

  if (examined === 0) return 0;
  return successes / examined;
}

/**
 * Check if source should be auto-disabled: last `consecutive` reports for this source all failed.
 * Failure = errors non-empty or (jobsFound===0 with errors). If fewer than consecutive relevant reports, return false.
 * Handles reEnable dummy reports as success (breaks streak).
 */
export function shouldAutoDisable(
  sourceId: string,
  reports: unknown[],
  consecutive = 5
): boolean {
  if (!Array.isArray(reports) || reports.length === 0) return false;

  // Order most-recent-first: sort descending by timestamp if timestamps are available
  let ordered: unknown[] = reports;
  const withTs = reports.filter((r) => getTimestamp(r) !== null);
  if (withTs.length >= 2) {
    ordered = [...reports].sort((a, b) => {
      const ta = getTimestamp(a) ? new Date(getTimestamp(a)!).getTime() : 0;
      const tb = getTimestamp(b) ? new Date(getTimestamp(b)!).getTime() : 0;
      return tb - ta;
    });
  }

  const relevant: RawResult[] = [];

  for (const r of ordered) {
    if (isReEnableFor(r, sourceId)) {
      relevant.push({ jobsFound: 1, jobsFiltered: 1, errors: [] } as RawResult);
      if (relevant.length >= consecutive) break;
      continue;
    }
    const results = getResults(r);
    if (!results) continue;
    const found = results.find((rr) => getSourceId(rr) === sourceId);
    if (found) {
      relevant.push(found as RawResult);
      if (relevant.length >= consecutive) break;
    }
  }

  if (relevant.length < consecutive) return false;

  const slice = relevant.slice(0, consecutive);
  for (const res of slice) {
    const errors = (res.errors ?? []) as string[];
    const jobsFound = (res.jobsFound ?? 0) as number;
    const isFailed = errors.length > 0 || (jobsFound === 0 && errors.length > 0);
    // success if no errors
    if (!isFailed) return false;
    // also consider jobsFiltered>0 as success even with errors? For disable we require errors => consistent with computeSuccessRate OR logic
    // If errors empty, not failed; if errors>0 but jobsFiltered>0 we still treat as failure? Keep strict: any errors => failure
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
        successRate: examinedHasHistory(anyReports, source.id) ? successRate : 0,
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

function examinedHasHistory(reports: unknown[], sourceId: string): boolean {
  for (const r of reports) {
    if (isReEnableFor(r, sourceId)) return true;
    const results = getResults(r);
    if (!results) continue;
    if (results.find((rr) => getSourceId(rr) === sourceId)) return true;
  }
  return false;
}
