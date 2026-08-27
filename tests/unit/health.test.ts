import { describe, it, expect } from "vitest";
import { computeSuccessRate, shouldAutoDisable, buildHealthMatrix } from "@/lib/scraper/health";
import type { ScraperSource } from "@/lib/scraper/types";

function makeSource(id: string): ScraperSource {
  return {
    id,
    name: `Source ${id}`,
    nameZh: `来源 ${id}`,
    type: "html",
    url: "https://example.com",
    enabled: true,
    keywords: ["chinese"],
  } as ScraperSource;
}

function makeReport(sourceId: string, opts: { errors?: string[]; jobsFound?: number; jobsFiltered?: number; duration?: number; timestamp?: string }) {
  const errors = opts.errors ?? [];
  const jobsFound = opts.jobsFound ?? (errors.length ? 0 : 5);
  const jobsFiltered = opts.jobsFiltered ?? (errors.length ? 0 : 2);
  return {
    timestamp: opts.timestamp ?? new Date().toISOString(),
    totalSources: 1,
    successfulSources: errors.length === 0 ? 1 : 0,
    totalJobsFound: jobsFound,
    totalJobsFiltered: jobsFiltered,
    newJobsAdded: 0,
    results: [
      {
        sourceId,
        source: { id: sourceId },
        jobsFound,
        jobsFiltered,
        errors,
        duration: opts.duration ?? 1000,
      },
    ],
  };
}

function makeDbRow(sourceId: string, opts: { errors?: string[]; jobsFound?: number; jobsFiltered?: number; timestamp?: string }) {
  const reportInner = makeReport(sourceId, opts);
  return {
    timestamp: opts.timestamp ?? new Date().toISOString(),
    report: { results: reportInner.results, timestamp: reportInner.timestamp } as unknown as Record<string, unknown>,
    successful_sources: reportInner.successfulSources,
    total_sources: reportInner.totalSources,
  };
}

describe("computeSuccessRate", () => {
  it("empty -> 0", () => {
    expect(computeSuccessRate("a", [])).toBe(0);
  });

  it("all success -> 1", () => {
    const reports = [makeReport("src1", { errors: [] }), makeReport("src1", { errors: [] }), makeReport("src1", { errors: [] })];
    expect(computeSuccessRate("src1", reports as unknown as unknown[])).toBe(1);
  });

  it("mixed -> 0.5", () => {
    const reports = [
      makeReport("src1", { errors: [] }),
      makeReport("src1", { errors: ["fail"] }),
    ];
    expect(computeSuccessRate("src1", reports as unknown as unknown[])).toBe(0.5);
  });

  it("handles DB row shape (report JSONB)", () => {
    const rows = [makeDbRow("src1", { errors: [] }), makeDbRow("src1", { errors: ["fail"] })];
    expect(computeSuccessRate("src1", rows as unknown as unknown[])).toBe(0.5);
  });

  it("windowDays filter excludes old reports", () => {
    const oldTs = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    const recentTs = new Date().toISOString();
    const reports = [
      makeReport("src1", { errors: ["fail"], timestamp: oldTs }),
      makeReport("src1", { errors: [], timestamp: recentTs }),
    ];
    // window 7 days should exclude old fail, only recent success -> 1
    expect(computeSuccessRate("src1", reports as unknown as unknown[], 7)).toBe(1);
    // window 14 days includes both -> 0.5
    expect(computeSuccessRate("src1", reports as unknown as unknown[], 14)).toBe(0.5);
  });

  it("returns 0 when no history for source", () => {
    const reports = [makeReport("other", { errors: [] })];
    expect(computeSuccessRate("src1", reports as unknown as unknown[])).toBe(0);
  });

  it("reEnable dummy counts as success", () => {
    const failRows = Array.from({ length: 5 }, () => makeReport("src1", { errors: ["fail"] }));
    const reEnableRow = { timestamp: new Date().toISOString(), report: { reEnable: "src1", timestamp: new Date().toISOString() } };
    const reports = [...failRows, reEnableRow];
    // last 20 includes reEnable success, so not all fails
    expect(computeSuccessRate("src1", reports as unknown as unknown[])).toBeGreaterThan(0);
  });
});

describe("shouldAutoDisable", () => {
  it("5 consecutive fails -> true", () => {
    const reports = Array.from({ length: 5 }, () => makeReport("src1", { errors: ["fail"], jobsFound: 0 }));
    expect(shouldAutoDisable("src1", reports as unknown as unknown[], 5)).toBe(true);
  });

  it("4 fails +1 success -> false", () => {
    const reports = [
      makeReport("src1", { errors: [] }),
      ...Array.from({ length: 4 }, () => makeReport("src1", { errors: ["fail"], jobsFound: 0 })),
    ];
    // Most recent is success, so not all 5 fails
    expect(shouldAutoDisable("src1", reports as unknown as unknown[], 5)).toBe(false);
  });

  it("fewer than 5 reports -> false", () => {
    const reports = Array.from({ length: 3 }, () => makeReport("src1", { errors: ["fail"], jobsFound: 0 }));
    expect(shouldAutoDisable("src1", reports as unknown as unknown[])).toBe(false);
  });

  it("5 fails with DB row shape -> true", () => {
    const rows = Array.from({ length: 5 }, () => makeDbRow("src1", { errors: ["fail"], jobsFound: 0 }));
    expect(shouldAutoDisable("src1", rows as unknown as unknown[], 5)).toBe(true);
  });

  it("reEnable breaks disable streak", () => {
    const fails = Array.from({ length: 5 }, () => makeReport("src1", { errors: ["fail"], jobsFound: 0 }));
    const reEnableRow = { timestamp: new Date().toISOString(), report: { reEnable: "src1", timestamp: new Date().toISOString() } };
    const reports = [reEnableRow, ...fails] as unknown as unknown[];
    // Most recent is reEnable success -> should not disable
    expect(shouldAutoDisable("src1", reports, 5)).toBe(false);
  });

  it("buildHealthMatrix includes isDisabled and successRate", () => {
    const source = makeSource("src1");
    const reports = Array.from({ length: 5 }, () => makeReport("src1", { errors: ["fail"], jobsFound: 0 }));
    const matrix = buildHealthMatrix([source], reports as unknown as import("@/lib/scraper/types").ScrapeReport[]);
    expect(matrix[0].isDisabled).toBe(true);
    expect(matrix[0].successRate).toBe(0);
    // success case
    const goodReports = [makeReport("src1", { errors: [] }), makeReport("src1", { errors: [] })];
    const matrix2 = buildHealthMatrix([source], goodReports as unknown as import("@/lib/scraper/types").ScrapeReport[]);
    expect(matrix2[0].isDisabled).toBe(false);
    expect(matrix2[0].successRate).toBe(100);
  });
});
