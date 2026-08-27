export type WatchdogReport = {
  successful_sources: number;
  total_sources: number;
  timestamp?: string;
} | {
  successfulSources: number;
  totalSources: number;
  timestamp?: string;
};

export function checkWatchdog(
  reports: Array<{ successful_sources: number; total_sources: number; timestamp?: string } | { successfulSources: number; totalSources: number; timestamp?: string } | Record<string, unknown>>
): { alert: boolean; reason: string | null } {
  if (!reports || reports.length === 0) return { alert: false, reason: null };

  const getSuccessful = (r: Record<string, unknown>): number => {
    if (typeof (r as Record<string, unknown>)["successful_sources"] === "number") return (r as Record<string, unknown>)["successful_sources"] as number;
    if (typeof (r as Record<string, unknown>)["successfulSources"] === "number") return (r as Record<string, unknown>)["successfulSources"] as number;
    return 0;
  };
  const getTotal = (r: Record<string, unknown>): number => {
    if (typeof (r as Record<string, unknown>)["total_sources"] === "number") return (r as Record<string, unknown>)["total_sources"] as number;
    if (typeof (r as Record<string, unknown>)["totalSources"] === "number") return (r as Record<string, unknown>)["totalSources"] as number;
    return 0;
  };

  // Determine most recent report for low_rate check.
  // If timestamp present, pick latest by timestamp (order-agnostic). Otherwise last element is considered most recent.
  let lastReport: Record<string, unknown> = reports[reports.length - 1] as Record<string, unknown>;
  const hasTimestamp = reports.some((r) => typeof (r as Record<string, unknown>)["timestamp"] === "string");
  if (hasTimestamp) {
    lastReport = (reports as Record<string, unknown>[]).reduce((latest: Record<string, unknown>, cur: Record<string, unknown>) => {
      const curTime = typeof cur["timestamp"] === "string" ? new Date(cur["timestamp"] as string).getTime() : -Infinity;
      const latestTime = typeof latest["timestamp"] === "string" ? new Date(latest["timestamp"] as string).getTime() : -Infinity;
      return curTime > latestTime ? cur : latest;
    }, reports[0] as Record<string, unknown>);
  }

  const successful = getSuccessful(lastReport);
  const total = getTotal(lastReport);

  if (total > 0) {
    const rate = successful / total;
    if (rate < 0.4) {
      return { alert: true, reason: "low_rate" };
    }
  }

  if (reports.length >= 3) {
    let recentThree: Record<string, unknown>[];
    if (hasTimestamp) {
      const sorted = [...(reports as Record<string, unknown>[])].sort((a, b) => {
        const ta = typeof a["timestamp"] === "string" ? new Date(a["timestamp"] as string).getTime() : 0;
        const tb = typeof b["timestamp"] === "string" ? new Date(b["timestamp"] as string).getTime() : 0;
        return tb - ta;
      });
      recentThree = sorted.slice(0, 3);
    } else {
      recentThree = (reports as Record<string, unknown>[]).slice(-3);
    }
    const allZero = recentThree.every((r) => getSuccessful(r) === 0);
    if (allZero) {
      return { alert: true, reason: "three_total_fail" };
    }
  }

  return { alert: false, reason: null };
}
