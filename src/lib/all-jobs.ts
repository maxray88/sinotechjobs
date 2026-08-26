import type { Job } from "./types";
import { sampleJobs } from "./jobs";
import { loadScrapedJobs } from "./scraper/storage";

export function getAllJobs(): Job[] {
  const scraped = loadScrapedJobs();
  return [...sampleJobs, ...scraped];
}

export function getJobById(id: string): Job | undefined {
  const all = getAllJobs();
  return all.find((j) => j.id === id);
}
