/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { getSupabaseAdmin } from "./client";
import type { ScrapeReportRow } from "./types";
import type { ScrapeReport } from "../scraper/types";

export async function saveReport(report: ScrapeReport): Promise<void> {
  const supabase = getSupabaseAdmin();

  const row = {
    timestamp: report.timestamp ?? new Date().toISOString(),
    mode: "incremental",
    total_sources: report.totalSources,
    successful_sources: report.successfulSources,
    total_jobs_found: report.totalJobsFound,
    total_jobs_filtered: report.totalJobsFiltered,
    new_jobs_added: report.newJobsAdded,
    report: report as unknown as Record<string, unknown>,
  };

  const { error } = await supabase.from("scrape_reports").insert(row as never);

  if (error) throw error;
}

export async function listReports(limit: number = 20): Promise<ScrapeReport[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("scrape_reports")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as ScrapeReportRow[];

  return rows.map((r) => {
    if (r.report && typeof r.report === "object") {
      // If report JSONB contains full ScrapeReport, return it
      const maybe = r.report as ScrapeReport;
      if (maybe.timestamp && Array.isArray((maybe as any).results)) {
        return maybe;
      }
    }
    // Fallback: reconstruct ScrapeReport from columns
    return {
      timestamp: r.timestamp ?? new Date().toISOString(),
      totalSources: r.total_sources ?? 0,
      successfulSources: r.successful_sources ?? 0,
      totalJobsFound: r.total_jobs_found ?? 0,
      totalJobsFiltered: r.total_jobs_filtered ?? 0,
      newJobsAdded: r.new_jobs_added ?? 0,
      results: (r.report as any)?.results ?? [],
    } as ScrapeReport;
  });
}
