import { scraperSources, getEnabledSources } from "../src/lib/scraper/sources";
import { scrapeAllSources } from "../src/lib/scraper/engine";
import { addScrapedJobs, saveScrapeReport, getStorageStats } from "../src/lib/scraper/storage";
import { WATCHDOG_LOW_RATE_THRESHOLD } from "../src/lib/watchdog";
import type { ScrapeReport } from "../src/lib/scraper/types";

const USAGE = `Usage: npm run scrape [options]

Options:
  --source=<id>     Scrape a single source by id
  --verbose, -v     Print per-source results
  --dry-run         Run the scrape but write nothing to storage
  --help, -h        Show this help
`;

interface CliArgs {
  sourceId: string | undefined;
  verbose: boolean;
  dryRun: boolean;
  help: boolean;
}

/**
 * Strict flag parsing: an unrecognised flag is a hard error rather than being
 * silently dropped. Silently ignoring a flag gives false confidence — e.g. a
 * user typing --dry-run would otherwise have the script write anyway.
 */
function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { sourceId: undefined, verbose: false, dryRun: false, help: false };
  const unknown: string[] = [];

  for (const arg of argv) {
    if (arg === "--verbose" || arg === "-v") {
      parsed.verbose = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (!value) unknown.push(arg);
      else parsed.sourceId = value;
    } else {
      unknown.push(arg);
    }
  }

  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(", ")}`);
    console.error(USAGE);
    process.exit(1);
  }

  return parsed;
}

async function main() {
  const { sourceId, verbose, dryRun, help } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log(USAGE);
    return;
  }

  console.log("=== SinotechJobs Scraper ===");
  console.log(`Started at: ${new Date().toISOString()}`);
  if (dryRun) console.log("Mode: DRY RUN — nothing will be written to storage");

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
  // Dry run must not write, so measure what WOULD be written instead of calling
  // the mutating helpers.
  const { added, skipped, total } = dryRun
    ? {
        added: allRawJobs.length,
        skipped: 0,
        total: getStorageStats().totalScrapedJobs + allRawJobs.length,
      }
    : addScrapedJobs(allRawJobs);

  const report: ScrapeReport = {
    timestamp: new Date().toISOString(),
    totalSources: sources.length,
    successfulSources: results.filter((r) => r.errors.length === 0).length,
    totalJobsFound: results.reduce((sum, r) => sum + r.jobsFound, 0),
    totalJobsFiltered: results.reduce((sum, r) => sum + r.jobsFiltered, 0),
    newJobsAdded: added,
    results,
  };

  if (dryRun) {
    console.log(`\n[DRY RUN] Would insert ${allRawJobs.length} job(s) and write 1 scrape report.`);
  } else {
    saveScrapeReport(report);
  }

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

  // Exit code is a signal to cron/CI: a dead scraper must not report GREEN.
  //  - 0 successful sources at all => total failure, exit non-zero.
  //  - success rate below the watchdog's own threshold => non-zero exitCode.
  //  - otherwise exit 0.
  const successRate =
    report.totalSources > 0 ? report.successfulSources / report.totalSources : 0;

  if (report.successfulSources === 0) {
    console.error(
      `\nFAILED: 0/${report.totalSources} sources succeeded — scrape produced nothing.`
    );
    process.exit(1);
  }

  if (successRate < WATCHDOG_LOW_RATE_THRESHOLD) {
    console.error(
      `FAILED: success rate ${(successRate * 100).toFixed(0)}% is below the watchdog threshold of ${(WATCHDOG_LOW_RATE_THRESHOLD * 100).toFixed(0)}%.`
    );
    process.exitCode = 1;
    return;
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
