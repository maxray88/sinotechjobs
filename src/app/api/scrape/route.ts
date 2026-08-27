import { NextRequest, NextResponse } from "next/server";
import { scraperSources, getEnabledSources, getSourceById } from "@/lib/scraper/sources";
import { scrapeAllSources } from "@/lib/scraper/engine";
import {
  addScrapedJobs,
  saveScrapeReport,
  getStorageStats,
  clearScrapedJobs,
  loadScrapeReports,
} from "@/lib/scraper/storage";
import type { ScrapeReport } from "@/lib/scraper/types";

// Admin-only, not for cron — use /api/cron/daily and /api/cron/weekly
// This route is for the admin dashboard (GET stats, POST scrape/clear).
// Vercel Cron branches (?mode=daily / ?mode=full) have been moved to
// src/app/api/cron/* and are authenticated via Bearer CRON_SECRET.

export async function GET() {
  // Default: return stats and sources
  const baseSources = scraperSources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    enabled: s.enabled,
    url: s.url,
    jsRendered: s.jsRendered || false,
  }));

  const dataStore: "json" | "supabase" = process.env.DATA_STORE === "supabase" ? "supabase" : "json";

  if (dataStore === "supabase") {
    try {
      const { getSupabaseAdmin } = await import("@/lib/db/client");
      const supabase = getSupabaseAdmin();

      let totalScrapedJobs = 0;
      let reportCount = 0;
      let lastUpdated: string | null = null;
      let reports: ScrapeReport[] = [];

      // totalScrapedJobs via direct count query, fallback to listJobs
      let countSucceeded = false;
      try {
        const { count, error: countError } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true });
        if (countError) throw countError;
        totalScrapedJobs = count ?? 0;
        countSucceeded = true;
      } catch {
        // fallback via jobs-repo
        try {
          const { listJobs } = await import("@/lib/db/jobs-repo");
          const { total } = await listJobs({ page: 1, pageSize: 1 });
          totalScrapedJobs = total;
          countSucceeded = true;
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }

      // reports via reports-repo
      try {
        const { listReports } = await import("@/lib/db/reports-repo");
        reports = await listReports(20);
        reportCount = reports.length;
        if (reports.length > 0 && reports[0].timestamp) {
          lastUpdated = reports[0].timestamp;
        }
      } catch {
        reports = [];
        reportCount = 0;
        // keep lastUpdated as null for now, will try jobs fallback
      }

      // if no report timestamp, derive lastUpdated from most recent job created_at
      if (!lastUpdated) {
        try {
          // Using maybeSingle: select single most recent job
          const { data } = (await supabase
            .from("jobs")
            .select("created_at")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()) as { data: { created_at: string | null } | null; error: unknown };
          if (data && data.created_at) {
            lastUpdated = data.created_at;
          }
        } catch {
          // ignore
        }
      }

      // Ensure countSucceeded is true before returning success; if not, outer catch will handle
      if (!countSucceeded) {
        throw new Error("Failed to fetch job count from Supabase");
      }

      return NextResponse.json({
        sources: baseSources,
        stats: {
          totalScrapedJobs,
          lastUpdated,
          reportCount,
          dataStore,
        },
        reports: reports.slice(0, 10),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({
        sources: baseSources,
        stats: {
          totalScrapedJobs: 0,
          lastUpdated: null,
          reportCount: 0,
          dataStore,
          error: message,
        },
        reports: [],
      });
    }
  }

  // json store (default)
  const stats = getStorageStats();
  const reports = loadScrapeReports();
  return NextResponse.json({
    sources: baseSources,
    stats: { ...stats, dataStore },
    reports: reports.slice(0, 10),
  });
}

export async function POST(request: NextRequest) {
  // Admin-only, not for cron — use /api/cron/* for scheduled jobs.
  // No Bearer check here so dashboard buttons work without extra headers.
  // `clear` could be gated by CRON_SECRET in stricter setups; currently
  // left open for admin UI (protect via deployment auth/middleware instead).
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
    return NextResponse.json(
      {
        error: "No enabled sources. Enable sources in the admin panel first.",
      },
      { status: 400 }
    );
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
