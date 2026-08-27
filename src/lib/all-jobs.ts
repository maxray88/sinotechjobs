import type { Job } from "./types";
import { sampleJobs } from "./jobs";
import { loadScrapedJobs } from "./scraper/storage";

export async function getAllJobs(): Promise<Job[]> {
  if (process.env.DATA_STORE === "supabase") {
    const { listJobs } = await import("./db/jobs-repo");
    const { items: dbJobs } = await listJobs({ pageSize: 1000 });
    return [...sampleJobs, ...dbJobs];
  } else {
    const scraped = loadScrapedJobs();
    return [...sampleJobs, ...scraped];
  }
}

export async function getJobById(id: string): Promise<Job | undefined> {
  const fromSample = sampleJobs.find((j) => j.id === id);
  if (fromSample) return fromSample;
  if (process.env.DATA_STORE === "supabase") {
    const { getJobById: getDbJobById } = await import("./db/jobs-repo");
    const dbJob = await getDbJobById(id);
    return dbJob ?? undefined;
  } else {
    const scraped = loadScrapedJobs();
    return scraped.find((j) => j.id === id);
  }
}

// Deprecated sync wrappers for backward compat
/** @deprecated Use async getAllJobs instead */
export function getAllJobsSync(): Job[] {
  const scraped = loadScrapedJobs();
  return [...sampleJobs, ...scraped];
}

/** @deprecated Use async getJobById instead */
export function getJobByIdSync(id: string): Job | undefined {
  const all = getAllJobsSync();
  return all.find((j) => j.id === id);
}
