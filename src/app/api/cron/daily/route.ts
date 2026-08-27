import { NextRequest, NextResponse } from "next/server";
import { getEnabledSources } from "@/lib/scraper/sources";
import { scrapeAllSources } from "@/lib/scraper/engine";
import { addScrapedJobsAsync, saveScrapeReportAsync } from "@/lib/scraper/storage";
import type { ScrapeReport } from "@/lib/scraper/types";
import { getSupabaseAdmin } from "@/lib/db/client";
import { checkWatchdog } from "@/lib/watchdog";
import { sendEmail } from "@/lib/email";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Auth: Vercel Cron automatically sends `authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set in env.
  // We verify Bearer token strictly. The `x-vercel-cron: 1` header is sent by Vercel but not trusted alone
  // while CRON_SECRET is configured — it is noted for future use / debugging only.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  if (!cronSecret) {
    console.warn("[cron/daily] CRON_SECRET not set — allowing unauthenticated request (dev only)");
  }

  // Rate limiting: no-op — Vercel Cron invokes at most once per schedule (daily).
  // Auth gate above is sufficient; no in-memory throttle needed. Relies on Vercel edge / cron schedule.

  const sources = getEnabledSources();
  if (sources.length === 0) {
    return NextResponse.json({ error: "No enabled sources" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    // Guard against hanging scrapes — Vercel maxDuration is 300s, we timeout at 280s to allow graceful error handling.
    const results = (await Promise.race([
      scrapeAllSources(sources),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Cron timeout after 280s")), 280000)),
    ])) as Awaited<ReturnType<typeof scrapeAllSources>>;

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
      console.error("[cron/daily] saveScrapeReportAsync failed", err);
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

    // Watchdog: fetch last 3 reports and alert if needed (non-blocking)
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("scrape_reports")
        .select("successful_sources,total_sources,timestamp")
        .order("timestamp", { ascending: false })
        .limit(3);
      if (!error && data) {
        const recentReports = (data as { successful_sources: number | null; total_sources: number | null; timestamp: string | null }[]).map((r) => ({
          successful_sources: r.successful_sources ?? 0,
          total_sources: r.total_sources ?? 0,
          timestamp: r.timestamp ?? undefined,
        }));
        const { alert, reason } = checkWatchdog(recentReports);
        if (alert && reason) {
          if (!process.env.RESEND_API_KEY) {
            console.warn("[cron/daily] RESEND_API_KEY missing — skipping watchdog email");
          }
          const adminRaw = process.env.ADMIN_EMAILS ?? "";
          const adminEmails = adminRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (adminEmails.length === 0) {
            console.warn("[cron/daily] ADMIN_EMAILS not set — skipping watchdog email");
          } else {
            for (const to of adminEmails) {
              void sendEmail({
                to,
                locale: "en",
                template: "scrape_watchdog" as unknown as import("@/lib/email").EmailTemplate,
                data: { reason, jobTitle: `Scrape watchdog: ${reason}`, count: recentReports.length },
              }).catch((err) => console.error("[cron/daily] watchdog email failed", err));
            }
          }
        }
      } else if (error) {
        console.warn("[cron/daily] watchdog fetch failed", error);
      }
    } catch (watchdogErr) {
      console.warn("[cron/daily] watchdog check failed", watchdogErr);
    }

    return NextResponse.json({ ok: true, mode: "daily", result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorReport = {
      timestamp: new Date().toISOString(),
      totalSources: sources.length,
      successfulSources: 0,
      totalJobsFound: 0,
      totalJobsFiltered: 0,
      newJobsAdded: 0,
      results: [],
      error: message,
    } as unknown as ScrapeReport;

    try {
      await saveScrapeReportAsync(errorReport);
    } catch {}

    console.error(`[cron/daily] failed`, err);
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
