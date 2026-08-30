import type { Job } from "./types";
import { sampleJobs } from "./jobs"; // kept for seed/fallback compat, not used in supabase mode (real jobs only)
import { loadScrapedJobs } from "./scraper/storage";

export async function getAllJobs(): Promise<Job[]> {
  if (process.env.DATA_STORE === "supabase") {
    const { listJobs } = await import("./db/jobs-repo");
    const { items: dbJobs } = await listJobs({ pageSize: 1000 });
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
    const dbJob = await getDbJobById(id);
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
