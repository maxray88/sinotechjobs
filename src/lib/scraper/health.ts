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

/**
 * Build a health matrix for each source based on the last 5 reports
 * that contain that sourceId. reports[0] is expected to be most recent.
 */
export function buildHealthMatrix(
  sources: ScraperSource[],
  reports: ScrapeReport[]
): HealthEntry[] {
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

    if (relevant.length === 0) {
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
        successRate: 0,
        avgDurationMs: null,
      };
    }

    const last = relevant[0];
    const lastResult = last.result;
    const lastErrors = lastResult.errors ?? [];
    const lastStatus: HealthStatus = lastErrors.length === 0 ? "success" : "error";

    const successCount = relevant.filter(
      ({ result }) => (result.errors?.length ?? 0) === 0
    ).length;
    const successRate = Math.round((successCount / relevant.length) * 100);

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
    };
  });
}
