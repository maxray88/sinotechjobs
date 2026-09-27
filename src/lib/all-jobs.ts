import type { Job } from "./types";
import { sampleJobs } from "./jobs"; // kept for seed/fallback compat, not used in supabase mode (real jobs only)
import { loadScrapedJobs } from "./scraper/storage";

// listJobs caps pageSize at MAX_PAGE_SIZE (1000), and its `total` is the row
// count for the whole filter, not for the page. So a single call silently
// dropped everything from job 1001 onwards — those jobs never reached the
// sitemap and nothing logged it. Page through the remainder instead.
const SITEMAP_PAGE_SIZE = 1000;
// Hard stop for the loop below, so a stale or non-advancing `total` can never
// spin forever.
const MAX_PAGES = 20;

export async function getAllJobs(): Promise<Job[]> {
  if (process.env.DATA_STORE === "supabase") {
    const { listJobs } = await import("./db/jobs-repo");
    // listJobs defaults to includeExpired=false → expired jobs hidden from board.
    // Detail page (getJobById) still returns them with an Expired badge.
    // Guarded: listJobs throws on a DB error, and an unhandled throw here would
    // turn /sitemap.xml into a 500 and take its static URLs down with it.
    // Degrade to static-only instead.
    let dbJobs: Job[] = [];
    try {
      let page = 1;
      const first = await listJobs({ page, pageSize: SITEMAP_PAGE_SIZE });
      dbJobs = first.items;
      const total = first.total;
      while (dbJobs.length < total && page < MAX_PAGES) {
        page += 1;
        const next = await listJobs({ page, pageSize: SITEMAP_PAGE_SIZE });
        // An empty page proves the server has nothing left, so an inflated
        // `total` cannot make us spin. (A *short* page is not a safe stop
        // signal: in listJobs' degraded path items are filtered in memory, so
        // short pages are normal there.)
        if (next.items.length === 0) break;
        dbJobs.push(...next.items);
      }
      if (dbJobs.length < total) {
        console.warn(
          `[all-jobs] getAllJobs: stopped after ${page} page(s) (cap ${MAX_PAGES}) with ${dbJobs.length} of ${total} jobs loaded; the remainder is missing from the sitemap`,
        );
      }
    } catch (error) {
      // A first-page failure leaves dbJobs empty (the sitemap-500 guard above);
      // a later page failing leaves whatever was already collected, which is
      // still worth publishing rather than throwing away.
      console.warn(
        `[all-jobs] getAllJobs: Supabase load failed after ${dbJobs.length} job(s); ${dbJobs.length > 0 ? "returning the partial list" : "degrading to empty list"}`,
        error,
      );
    }
    // Real jobs only — demo sampleJobs deprecated (see jobs.ts SAMPLE_MODE=false). Return live DB jobs exclusively.
    return [...dbJobs];
  } else {
    const scraped = loadScrapedJobs();
    // Real jobs only — JSON fallback returns scraped live jobs only, no sample/demo jobs.
    return [...scraped];
  }
}

export async function getJobById(id: string): Promise<Job | undefined> {
  // In supabase mode, only check DB; in json fallback, check scraped storage.
  // Sample lookup kept as last-resort fallback for legacy IDs, but not primary.
  if (process.env.DATA_STORE === "supabase") {
    const { getJobById: getDbJobById } = await import("./db/jobs-repo");
    // Same exposure as getAllJobs: getDbJobById throws on a DB error, which
    // would 500 the job detail page. Response shape stays "not found"
    // (undefined) so existing callers keep working.
    let dbJob: Job | null = null;
    try {
      dbJob = await getDbJobById(id);
    } catch (error) {
      console.warn(`[all-jobs] getJobById: failed to load job ${id} from Supabase, treating as not found`, error);
    }
    if (dbJob) return dbJob;
    // Fallback: legacy sample ID lookup (deprecated, SAMPLE_MODE=false) — only if not found in DB
    return sampleJobs.find((j) => j.id === id);
  } else {
    const scraped = loadScrapedJobs();
    const foundScraped = scraped.find((j) => j.id === id);
    if (foundScraped) return foundScraped;
    // Deprecated sample fallback for json mode — kept for backwards compat, real mode uses scraped only
    return sampleJobs.find((j) => j.id === id);
  }
}

// Deprecated sync wrappers for backward compat
/** @deprecated Use async getAllJobs instead — now real-only (scraped), samples deprecated (SAMPLE_MODE=false) */
export function getAllJobsSync(): Job[] {
  const scraped = loadScrapedJobs();
  // Real jobs only — no sample/demo jobs
  return [...scraped];
}

/** @deprecated Use async getJobById instead */
export function getJobByIdSync(id: string): Job | undefined {
  const all = getAllJobsSync();
  const found = all.find((j) => j.id === id);
  if (found) return found;
  return sampleJobs.find((j) => j.id === id);
}
