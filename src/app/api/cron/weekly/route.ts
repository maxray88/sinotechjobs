import { NextRequest, NextResponse } from "next/server";
import { getEnabledSources } from "@/lib/scraper/sources";
import { scrapeAllSources } from "@/lib/scraper/engine";
import { addScrapedJobsAsync, saveScrapeReportAsync } from "@/lib/scraper/storage";
import type { ScrapeReport, ScrapeResult } from "@/lib/scraper/types";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Auth: Vercel Cron automatically sends `authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set in env.
  // We verify Bearer token strictly. The `x-vercel-cron: 1` header is sent by Vercel but not trusted alone
  // while CRON_SECRET is configured — it is noted for future use / debugging only.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    // Fail closed: a missing secret in production means an anonymous client
    // could trigger a full paid scrape. Only dev runs unauthenticated.
    if (process.env.NODE_ENV === "production") {
      console.error("[cron/weekly] CRON_SECRET not set — refusing unauthenticated request in production");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    console.warn("[cron/weekly] CRON_SECRET not set — allowing unauthenticated request (dev only)");
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  // Rate limiting: no-op — Vercel Cron invokes at most once per schedule (weekly).
  // Auth gate above is sufficient; no in-memory throttle needed. Relies on Vercel edge / cron schedule.

  const sources = getEnabledSources();
  if (sources.length === 0) {
    return NextResponse.json({ error: "No enabled sources" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  // Results are collected as each source completes, so a timeout still has a
  // partial report to write instead of discarding everything already scraped.
  const partialResults: ScrapeResult[] = [];
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    // Guard against hanging scrapes — Vercel maxDuration is 300s, we timeout at 280s to allow graceful error handling.
    // The signal is what actually stops the work: the timer aborts the in-flight
    // fetch/render, scrapeAllSources unwinds through its finally block (closing
    // Chromium), and only then do we report the timeout. A bare Promise.race
    // would leave the scrape running with an orphaned browser.
    timeout = setTimeout(() => controller.abort(), 280000);
    const results = await scrapeAllSources(
      sources,
      undefined,
      (r) => {
        partialResults.push(r);
      },
      controller.signal
    );

    if (controller.signal.aborted) {
      throw new Error("Cron timeout after 280s");
    }

    const allRawJobs = results.flatMap((r) => r.jobs);
    // DATA_STORE switching is handled inside addScrapedJobsAsync (json vs supabase)
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

    return NextResponse.json({ ok: true, mode: "weekly", result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Bank whatever the aborted run managed to scrape before it died, so a
    // timeout does not throw away already-fetched jobs. Best-effort only.
    let bankedAdded = 0;
    const partialJobs = partialResults.flatMap((r) => r.jobs);
    if (partialJobs.length > 0) {
      try {
        const res = await addScrapedJobsAsync(partialJobs);
        bankedAdded = res.added;
        console.log(`[cron/weekly] banked ${bankedAdded} of ${partialJobs.length} partial jobs after failure`);
      } catch (bankErr) {
        console.error("[cron/weekly] partial jobs could not be written", bankErr);
      }
    }

    const errorReport = {
      timestamp: new Date().toISOString(),
      totalSources: sources.length,
      successfulSources: partialResults.filter((r) => r.errors.length === 0).length,
      totalJobsFound: partialResults.reduce((sum, r) => sum + r.jobsFound, 0),
      totalJobsFiltered: partialResults.reduce((sum, r) => sum + r.jobsFiltered, 0),
      newJobsAdded: bankedAdded,
      results: partialResults,
      error: message,
    } as unknown as ScrapeReport;

    try {
      await saveScrapeReportAsync(errorReport);
    } catch (saveErr) {
      console.error("[cron/weekly] partial scrape report could not be saved", saveErr);
    }

    console.error(`[cron/weekly] failed`, err);
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
