import { NextRequest, NextResponse } from "next/server";
import { scraperSources, getEnabledSources, getSourceById } from "@/lib/scraper/sources";
import { scrapeAllSources } from "@/lib/scraper/engine";
import { addScrapedJobs, saveScrapeReport, getStorageStats, clearScrapedJobs, loadScrapeReports } from "@/lib/scraper/storage";
import type { ScrapeReport } from "@/lib/scraper/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  // Vercel Cron trigger: /api/scrape?mode=daily or /api/scrape?mode=full
  if (mode === "daily" || mode === "full") {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sources = getEnabledSources();
    if (sources.length === 0) {
      return NextResponse.json({ error: "No enabled sources" }, { status: 400 });
    }

    const results = await scrapeAllSources(sources);
    const allRawJobs = results.flatMap((r) => r.jobs);
    const { added, skipped, total } = addScrapedJobs(allRawJobs);

    const report: ScrapeReport = {
      timestamp: new Date().toISOString(),
      totalSources: sources.length,
      successfulSources: results.filter((r) => r.errors.length === 0).length,
      totalJobsFound: results.reduce((sum, r) => sum + r.jobsFound, 0),
      totalJobsFiltered: results.reduce((sum, r) => sum + r.jobsFiltered, 0),
      newJobsAdded: added,
      results,
    };

    saveScrapeReport(report);

    return NextResponse.json({
      success: true,
      mode,
      report: {
        timestamp: report.timestamp,
        totalSources: report.totalSources,
        successfulSources: report.successfulSources,
        totalJobsFound: report.totalJobsFound,
        totalJobsFiltered: report.totalJobsFiltered,
        newJobsAdded: report.newJobsAdded,
        duplicates: skipped,
        totalJobsInDb: total,
      },
    });
  }

  // Default: return stats and sources
  const stats = getStorageStats();
  const reports = loadScrapeReports();
  return NextResponse.json({
    sources: scraperSources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      enabled: s.enabled,
      url: s.url,
      jsRendered: s.jsRendered || false,
    })),
    stats,
    reports: reports.slice(0, 10),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = body.action || "scrape-all";
  const sourceId = body.sourceId as string | undefined;

  if (action === "clear") {
    clearScrapedJobs();
    return NextResponse.json({ success: true, message: "Scraped jobs cleared" });
  }

  let sources;
  if (action === "scrape-one" && sourceId) {
    const source = getSourceById(sourceId);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    sources = [source];
  } else {
    sources = getEnabledSources();
  }

  if (sources.length === 0) {
    return NextResponse.json({
      error: "No enabled sources. Enable sources in the admin panel first.",
    }, { status: 400 });
  }

  const results = await scrapeAllSources(sources);

  const allRawJobs = results.flatMap((r) => r.jobs);
  const { added, skipped, total } = addScrapedJobs(allRawJobs);

  const report: ScrapeReport = {
    timestamp: new Date().toISOString(),
    totalSources: sources.length,
    successfulSources: results.filter((r) => r.errors.length === 0).length,
    totalJobsFound: results.reduce((sum, r) => sum + r.jobsFound, 0),
    totalJobsFiltered: results.reduce((sum, r) => sum + r.jobsFiltered, 0),
    newJobsAdded: added,
    results,
  };

  saveScrapeReport(report);

  return NextResponse.json({
    success: true,
    report: {
      timestamp: report.timestamp,
      totalSources: report.totalSources,
      successfulSources: report.successfulSources,
      totalJobsFound: report.totalJobsFound,
      totalJobsFiltered: report.totalJobsFiltered,
      newJobsAdded: report.newJobsAdded,
      duplicates: skipped,
      totalJobsInDb: total,
      sources: report.results.map((r) => ({
        id: r.source.id,
        name: r.source.name,
        jobsFound: r.jobsFound,
        jobsFiltered: r.jobsFiltered,
        errors: r.errors,
        duration: r.duration,
      })),
    },
  });
}
