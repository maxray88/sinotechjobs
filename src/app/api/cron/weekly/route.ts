import { NextRequest, NextResponse } from "next/server";
import { getEnabledSources } from "@/lib/scraper/sources";
import { scrapeAllSources } from "@/lib/scraper/engine";
import { addScrapedJobsAsync, saveScrapeReportAsync } from "@/lib/scraper/storage";
import type { ScrapeReport } from "@/lib/scraper/types";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Vercel Cron: when invoked by Vercel Scheduler it sends `x-vercel-cron: 1`.
  // We keep Bearer verification as the primary gate; x-vercel-cron is noted
  // for future use but not trusted alone while CRON_SECRET is configured.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!cronSecret) {
    console.warn("[cron/weekly] CRON_SECRET not set — allowing unauthenticated request (dev only)");
  }

  const sources = getEnabledSources();
  if (sources.length === 0) {
    return NextResponse.json({ error: "No enabled sources" }, { status: 400 });
  }

  // Weekly = full (re-scrapes all sources, slower, more thorough). Engine
  // currently exposes scrapeAllSources(sources); mode is semantic — weekly
  // still benefits from dedup in storage but is scheduled less frequently
  // and can be extended to bypass caches if ScrapeOptions.mode is added.
  const results = await scrapeAllSources(sources);
  const allRawJobs = results.flatMap((r) => r.jobs);
  const { added, skipped, total } = await addScrapedJobsAsync(allRawJobs);

  const report: ScrapeReport = {
    timestamp: new Date().toISOString(),
    totalSources: sources.length,
    successfulSources: results.filter((r) => r.errors.length === 0).length,
    totalJobsFound: results.reduce((sum, r) => sum + r.jobsFound, 0),
    totalJobsFiltered: results.reduce((sum, r) => sum + r.jobsFiltered, 0),
    newJobsAdded: added,
    results,
  };

  try {
    await saveScrapeReportAsync(report);
  } catch (err) {
    console.error("[cron/weekly] saveScrapeReportAsync failed", err);
  }

  const result = {
    timestamp: report.timestamp,
    totalSources: report.totalSources,
    successfulSources: report.successfulSources,
    totalJobsFound: report.totalJobsFound,
    totalJobsFiltered: report.totalJobsFiltered,
    newJobsAdded: report.newJobsAdded,
    duplicates: skipped,
    totalJobsInDb: total,
  };

  return NextResponse.json({ ok: true, mode: "weekly", result });
}
