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
import { buildHealthMatrix } from "@/lib/scraper/health";

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

      const health = buildHealthMatrix(scraperSources, reports);
      return NextResponse.json({
        sources: baseSources,
        stats: {
          totalScrapedJobs,
          lastUpdated,
          reportCount,
          dataStore,
        },
        reports: reports.slice(0, 10),
        health,
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
        health: buildHealthMatrix(scraperSources, []),
      });
    }
  }

  // json store (default)
  const stats = getStorageStats();
  const reports = loadScrapeReports();
  const health = buildHealthMatrix(scraperSources, reports);
  return NextResponse.json({
    sources: baseSources,
    stats: { ...stats, dataStore },
    reports: reports.slice(0, 10),
    health,
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

  if (action === "re-enable") {
    if (!sourceId || typeof sourceId !== "string") {
      return NextResponse.json({ error: "sourceId required" }, { status: 400 });
    }
    const source = getSourceById(sourceId);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    const dataStore: "json" | "supabase" = process.env.DATA_STORE === "supabase" ? "supabase" : "json";
    const timestamp = new Date().toISOString();
    if (dataStore === "supabase") {
      try {
        const { getSupabaseAdmin } = await import("@/lib/db/client");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase.from("scrape_reports").insert({
          mode: "re-enable",
          total_sources: 1,
          successful_sources: 1,
          total_jobs_found: 1,
          total_jobs_filtered: 1,
          new_jobs_added: 0,
          report: { reEnable: sourceId, timestamp },
          timestamp,
        } as never);
        if (error) throw error;
      } catch (err) {
        // Fallback to JSON append if Supabase insert fails
        try {
          const dummy: ScrapeReport = {
            timestamp,
            totalSources: 1,
            successfulSources: 1,
            totalJobsFound: 1,
            totalJobsFiltered: 1,
            newJobsAdded: 0,
            results: [
              {
                source,
                jobsFound: 1,
                jobsFiltered: 1,
                jobs: [],
                errors: [],
                duration: 0,
              } as unknown as ScrapeReport["results"][number],
            ],
          };
          // include reEnable marker in report JSON for health helpers
          (dummy as unknown as Record<string, unknown>)["report"] = { reEnable: sourceId, timestamp };
          saveScrapeReport(dummy);
        } catch {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: message }, { status: 500 });
        }
      }
    } else {
      // json fallback: append dummy report
      const dummy: ScrapeReport = {
        timestamp,
        totalSources: 1,
        successfulSources: 1,
        totalJobsFound: 1,
        totalJobsFiltered: 1,
        newJobsAdded: 0,
        results: [
          {
            source,
            jobsFound: 1,
            jobsFiltered: 1,
            jobs: [],
            errors: [],
            duration: 0,
          } as unknown as ScrapeReport["results"][number],
        ],
      };
      // attach reEnable marker for computeSuccessRate / shouldAutoDisable to recognize
      const withMarker = { ...dummy, report: { reEnable: sourceId, timestamp } } as unknown as ScrapeReport;
      // Save using JSON storage; also handle plain object with extra field via direct file append fallback
      try {
        saveScrapeReport(withMarker);
      } catch {
        saveScrapeReport(dummy);
      }
    }
    return NextResponse.json({ reEnabled: true, sourceId });
  }

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
