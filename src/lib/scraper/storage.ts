import * as fs from "fs";
import * as path from "path";
import type { Job } from "../types";
import type { ScrapedJobRaw, ScrapeReport } from "./types";
import { rawToJob } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SCRAPED_JOBS_FILE = path.join(DATA_DIR, "scraped-jobs.json");
const SCRAPE_REPORTS_FILE = path.join(DATA_DIR, "scrape-reports.json");

interface StoredData {
  jobs: Job[];
  lastUpdated: string;
}

interface ReportStore {
  reports: ScrapeReport[];
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadScrapedJobs(): Job[] {
  try {
    if (!fs.existsSync(SCRAPED_JOBS_FILE)) return [];
    const data = fs.readFileSync(SCRAPED_JOBS_FILE, "utf-8");
    const parsed: StoredData = JSON.parse(data);
    return parsed.jobs || [];
  } catch {
    return [];
  }
}

export function saveScrapedJobs(jobs: Job[]): void {
  ensureDataDir();
  const data: StoredData = {
    jobs,
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(SCRAPED_JOBS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function addScrapedJobs(rawJobs: ScrapedJobRaw[]): { added: number; skipped: number; total: number } {
  const existing = loadScrapedJobs();
  const existingUrls = new Set(existing.map((j) => j.applicationUrl));

  let added = 0;
  let skipped = 0;

  const baseId = Date.now();
  const newJobs: Job[] = [];

  for (const raw of rawJobs) {
    if (existingUrls.has(raw.url)) {
      skipped++;
      continue;
    }
    const id = `scraped-${baseId}-${added}`;
    const job = rawToJob(raw, id);
    newJobs.push(job);
    existingUrls.add(raw.url);
    added++;
  }

  const all = [...newJobs, ...existing].slice(0, 500);
  saveScrapedJobs(all);

  return { added, skipped, total: all.length };
}

export function clearScrapedJobs(): void {
  ensureDataDir();
  saveScrapedJobs([]);
}

export function deleteScrapedJob(id: string): void {
  const jobs = loadScrapedJobs();
  const filtered = jobs.filter((j) => j.id !== id);
  saveScrapedJobs(filtered);
}

export function loadScrapeReports(): ScrapeReport[] {
  try {
    if (!fs.existsSync(SCRAPE_REPORTS_FILE)) return [];
    const data = fs.readFileSync(SCRAPE_REPORTS_FILE, "utf-8");
    const parsed: ReportStore = JSON.parse(data);
    return (parsed.reports || []).slice(0, 20);
  } catch {
    return [];
  }
}

export function saveScrapeReport(report: ScrapeReport): void {
  ensureDataDir();
  const reports = loadScrapeReports();
  reports.unshift(report);
  const trimmed = reports.slice(0, 20);
  const data: ReportStore = { reports: trimmed };
  fs.writeFileSync(SCRAPE_REPORTS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function getStorageStats(): {
  totalScrapedJobs: number;
  lastUpdated: string | null;
  reportCount: number;
} {
  const jobs = loadScrapedJobs();
  const reports = loadScrapeReports();

  let lastUpdated: string | null = null;
  try {
    if (fs.existsSync(SCRAPED_JOBS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCRAPED_JOBS_FILE, "utf-8"));
      lastUpdated = data.lastUpdated || null;
    }
  } catch {
    // ignore
  }

  return {
    totalScrapedJobs: jobs.length,
    lastUpdated,
    reportCount: reports.length,
  };
}
