export type WatchdogReport = {
  successful_sources: number;
  total_sources: number;
  timestamp?: string;
} | {
  successfulSources: number;
  totalSources: number;
  timestamp?: string;
};

/**
 * Success-rate threshold below which the watchdog raises a `low_rate` alert.
 * Exported so the scraper CLI (scripts/scrape.ts) fails on the same bar.
 */
export const WATCHDOG_LOW_RATE_THRESHOLD = 0.4;

export function checkWatchdog(
  reports: Array<{ successful_sources: number; total_sources: number; timestamp?: string } | { successfulSources: number; totalSources: number; timestamp?: string } | Record<string, unknown>>
): { alert: boolean; reason: string | null } {
  if (!reports || reports.length === 0) return { alert: false, reason: null };

  // Return null for an unrecognised shape rather than coercing to 0: defaulting to 0
  // made every unknown report look like a total failure (and suppressed low_rate).
  const getSuccessful = (r: Record<string, unknown>): number | null => {
    if (typeof r["successful_sources"] === "number") return r["successful_sources"] as number;
    if (typeof r["successfulSources"] === "number") return r["successfulSources"] as number;
    return null;
  };
  const getTotal = (r: Record<string, unknown>): number | null => {
    if (typeof r["total_sources"] === "number") return r["total_sources"] as number;
    if (typeof r["totalSources"] === "number") return r["totalSources"] as number;
    return null;
  };

  // Determine most recent report for low_rate check.
  // Pick the latest by comparing actual timestamp values (not a boolean "has one"
  // — a single stray old timestamp used to hijack the reduce). Untimestamped reports
  // carry no ordering information, so they are only used if nothing else is available.
  const timestampMs = (r: Record<string, unknown>): number | null => {
    if (typeof r["timestamp"] !== "string") return null;
    const t = new Date(r["timestamp"] as string).getTime();
    return Number.isNaN(t) ? null : t;
  };
  const known = reports
    .map((r) => ({ report: r as Record<string, unknown>, t: timestampMs(r as Record<string, unknown>) }))
    .filter((e): e is { report: Record<string, unknown>; t: number } => e.t !== null);

  const lastReport = known.length > 0 ? known.reduce((latest, cur) => (cur.t > latest.t ? cur : latest)).report : (reports[reports.length - 1] as Record<string, unknown>);

  const successful = getSuccessful(lastReport);
  const total = getTotal(lastReport);

  if (successful !== null && total !== null && total > 0) {
    const rate = successful / total;
    if (rate < WATCHDOG_LOW_RATE_THRESHOLD) {
      return { alert: true, reason: "low_rate" };
    }
  }

  if (known.length >= 3) {
    const recentThree = [...known]
      .sort((a, b) => b.t - a.t)
      .slice(0, 3)
      .map((e) => e.report)
      .filter((r) => getSuccessful(r) !== null);
    // A report whose shape we do not recognise carries no signal — it must not be
    // counted as a zero-success run, and a set with none recognisable cannot alert.
    if (recentThree.length === 3) {
      const allZero = recentThree.every((r) => getSuccessful(r) === 0);
      if (allZero) {
        return { alert: true, reason: "three_total_fail" };
      }
    }
  } else if (known.length === 0) {
    // No timestamp information at all: fall back to input order, still skipping
    // unrecognised shapes.
    const recentThree = (reports as Record<string, unknown>[])
      .slice(-3)
      .filter((r) => getSuccessful(r) !== null);
    if (recentThree.length === 3) {
      const allZero = recentThree.every((r) => getSuccessful(r) === 0);
      if (allZero) {
        return { alert: true, reason: "three_total_fail" };
      }
    }
  }

  return { alert: false, reason: null };
}
