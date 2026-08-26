import { scraperSources, getEnabledSources } from "../src/lib/scraper/sources";
import { scrapeAllSources } from "../src/lib/scraper/engine";
import { addScrapedJobs, saveScrapeReport, getStorageStats } from "../src/lib/scraper/storage";
import type { ScrapeReport } from "../src/lib/scraper/types";

async function main() {
  const args = process.argv.slice(2);
  const sourceId = args.find((a) => a.startsWith("--source="))?.split("=")[1];
  const verbose = args.includes("--verbose") || args.includes("-v");

  console.log("=== SinotechJobs Scraper ===");
  console.log(`Started at: ${new Date().toISOString()}`);

  let sources;
  if (sourceId) {
    const source = scraperSources.find((s) => s.id === sourceId);
    if (!source) {
      console.error(`Source not found: ${sourceId}`);
      process.exit(1);
    }
    sources = [source];
    console.log(`Scraping single source: ${source.name}`);
  } else {
    sources = getEnabledSources();
    console.log(`Scraping ${sources.length} enabled sources...`);
  }

  if (sources.length === 0) {
    console.error("No enabled sources found. Check src/lib/scraper/sources.ts");
    process.exit(1);
  }

  console.log("\nSources:");
  for (const s of sources) {
    const jsTag = s.jsRendered ? " [JS+Puppeteer]" : "";
    console.log(`  - [${s.type}]${jsTag} ${s.name} (${s.url})`);
  }

  const puppeteerSources = sources.filter((s) => s.jsRendered);
  if (puppeteerSources.length > 0) {
    console.log(`\n  ${puppeteerSources.length} source(s) will use Puppeteer (headless Chrome).`);
    console.log(`  This will be slower but handles JS-rendered pages.`);
  }
  console.log("");

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

  console.log("\n=== Scrape Complete ===");
  console.log(`Timestamp:       ${report.timestamp}`);
  console.log(`Sources:         ${report.successfulSources}/${report.totalSources} successful`);
  console.log(`Jobs found:      ${report.totalJobsFound}`);
  console.log(`Jobs filtered:   ${report.totalJobsFiltered} (Chinese-related)`);
  console.log(`New jobs added:  ${report.newJobsAdded}`);
  console.log(`Duplicates:      ${skipped}`);
  console.log(`Total in DB:     ${total}`);

  if (verbose) {
    console.log("\n=== Per-Source Results ===");
    for (const r of results) {
      const jsTag = r.source.jsRendered ? " [Puppeteer]" : "";
      console.log(`\n${r.source.name}${jsTag} (${r.source.id}):`);
      console.log(`  Jobs found:    ${r.jobsFound}`);
      console.log(`  Jobs filtered: ${r.jobsFiltered}`);
      console.log(`  Duration:      ${(r.duration / 1000).toFixed(1)}s`);
      if (r.errors.length > 0) {
        console.log(`  Errors:`);
        for (const e of r.errors) {
          console.log(`    - ${e}`);
        }
      }
      if (r.jobs.length > 0 && verbose) {
        console.log(`  Jobs:`);
        for (const job of r.jobs.slice(0, 5)) {
          console.log(`    - ${job.title} @ ${job.company} (${job.location})`);
        }
        if (r.jobs.length > 5) {
          console.log(`    ... and ${r.jobs.length - 5} more`);
        }
      }
    }
  }

  const stats = getStorageStats();
  console.log(`\n=== Storage ===`);
  console.log(`Total scraped jobs: ${stats.totalScrapedJobs}`);
  console.log(`Total reports:      ${stats.reportCount}`);
  console.log(`Last updated:       ${stats.lastUpdated ?? "—"}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
