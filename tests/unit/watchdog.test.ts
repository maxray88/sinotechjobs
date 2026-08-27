import { describe, it, expect } from "vitest";
import { checkWatchdog } from "@/lib/watchdog";

describe("watchdog checkWatchdog", () => {
  it("low_rate triggers when last report successRate <0.4", () => {
    const reports = [{ successful_sources: 2, total_sources: 10 }];
    const res = checkWatchdog(reports);
    expect(res).toEqual({ alert: true, reason: "low_rate" });
  });

  it("low_rate with camelCase fields", () => {
    const reports = [{ successfulSources: 1, totalSources: 10 } as unknown as { successful_sources: number; total_sources: number }];
    const res = checkWatchdog(reports as never);
    expect(res.alert).toBe(true);
    expect(res.reason).toBe("low_rate");
  });

  it("low_rate boundary 0.4 not triggered (2/5=0.4)", () => {
    const reports = [{ successful_sources: 4, total_sources: 10 }]; // 0.4 exactly -> not <0.4
    const res = checkWatchdog(reports);
    expect(res).toEqual({ alert: false, reason: null });
  });

  it("low_rate 3/10=0.3 triggers", () => {
    expect(checkWatchdog([{ successful_sources: 3, total_sources: 10 }])).toEqual({ alert: true, reason: "low_rate" });
  });

  it("three_total_fail when last 3 reports all successful_sources===0 and total is 0 (low_rate guarded)", () => {
    // Use total=0 so low_rate is skipped (total>0 guard), allowing three_total_fail to be reached
    const reports = [
      { successful_sources: 0, total_sources: 0 },
      { successful_sources: 0, total_sources: 0 },
      { successful_sources: 0, total_sources: 0 },
    ];
    const res = checkWatchdog(reports);
    expect(res).toEqual({ alert: true, reason: "three_total_fail" });
  });

  it("three_total_fail with timestamps order-agnostic (desc input)", () => {
    const now = Date.now();
    const reports = [
      { successful_sources: 0, total_sources: 0, timestamp: new Date(now).toISOString() },
      { successful_sources: 0, total_sources: 0, timestamp: new Date(now - 10000).toISOString() },
      { successful_sources: 0, total_sources: 0, timestamp: new Date(now - 20000).toISOString() },
    ];
    // Desc order already (newest first). Our watchdog picks latest by timestamp.
    const res = checkWatchdog(reports);
    expect(res.reason).toBe("three_total_fail");
    expect(res.alert).toBe(true);
  });

  it("healthy high success rate no alert", () => {
    const reports = [
      { successful_sources: 8, total_sources: 10 },
      { successful_sources: 9, total_sources: 10 },
      { successful_sources: 8, total_sources: 10 },
    ];
    const res = checkWatchdog(reports);
    expect(res).toEqual({ alert: false, reason: null });
  });

  it("healthy single high rate no alert", () => {
    expect(checkWatchdog([{ successful_sources: 10, total_sources: 10 }])).toEqual({ alert: false, reason: null });
  });

  it("edge empty reports no alert", () => {
    expect(checkWatchdog([])).toEqual({ alert: false, reason: null });
  });

  it("edge total zero single report no low_rate (guard)", () => {
    expect(checkWatchdog([{ successful_sources: 0, total_sources: 0 }])).toEqual({ alert: false, reason: null });
  });

  it("edge two zero reports not enough for three_total_fail (low_rate triggers because total>0)", () => {
    // With 2 reports, three_total_fail requires 3, so should not trigger three_total_fail;
    // but last report 0/10 => low_rate triggers. To test edge of insufficient length without low_rate,
    // use total 0 so low_rate guarded.
    const reports = [
      { successful_sources: 0, total_sources: 0 },
      { successful_sources: 0, total_sources: 0 },
    ];
    expect(checkWatchdog(reports)).toEqual({ alert: false, reason: null });
  });

  it("edge low_rate priority over three_total_fail when total>0", () => {
    const reports = [
      { successful_sources: 0, total_sources: 10 },
      { successful_sources: 0, total_sources: 10 },
      { successful_sources: 0, total_sources: 10 },
    ];
    // low_rate triggers first (0/10 <0.4) before three_total_fail check
    const res = checkWatchdog(reports);
    expect(res).toEqual({ alert: true, reason: "low_rate" });
  });

  it("handles mixed healthy then low", () => {
    const reports = [
      { successful_sources: 10, total_sources: 10 },
      { successful_sources: 10, total_sources: 10 },
      { successful_sources: 2, total_sources: 10 },
    ];
    expect(checkWatchdog(reports)).toEqual({ alert: true, reason: "low_rate" });
  });

  it("handles timestamp asc vs desc correctly for low_rate", () => {
    const now = Date.now();
    const low = { successful_sources: 1, total_sources: 10, timestamp: new Date(now).toISOString() };
    const high = { successful_sources: 9, total_sources: 10, timestamp: new Date(now - 86400000).toISOString() };
    // asc: high older, low newer
    expect(checkWatchdog([high, low])).toEqual({ alert: true, reason: "low_rate" });
    // desc: low newer but first
    expect(checkWatchdog([low, high])).toEqual({ alert: true, reason: "low_rate" });
  });
});
