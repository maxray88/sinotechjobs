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

// ---------------------------------------------------------------------------
// Async delegation behind DATA_STORE flag
// ---------------------------------------------------------------------------

function isSupabaseStore(): boolean {
  return process.env.DATA_STORE === "supabase";
}

// Keep DATA_STORE export for backward compat but read fresh each access via getter
export const DATA_STORE: string = process.env.DATA_STORE || "json";

export async function loadScrapedJobsAsync(): Promise<Job[]> {
  if (isSupabaseStore()) {
    const { listJobs } = await import("../db/jobs-repo");
    const { items } = await listJobs({ page: 1, pageSize: 500 });
    return items;
  }
  return loadScrapedJobs();
}

export async function addScrapedJobsAsync(
  rawJobs: ScrapedJobRaw[]
): Promise<{ added: number; skipped: number; total: number }> {
  if (isSupabaseStore()) {
    const { listJobs, upsertJobs } = await import("../db/jobs-repo");
    const baseId = Date.now();
    const jobs: Job[] = rawJobs.map((raw, idx) => rawToJob(raw, `scraped-${baseId}-${idx}`));
    const { added } = await upsertJobs(jobs);
    const skipped = rawJobs.length - added;
    // Fetch total count from Supabase
    try {
      const { total } = await listJobs({ page: 1, pageSize: 1 });
      return { added, skipped, total };
    } catch {
      return { added, skipped, total: added };
    }
  }
  return addScrapedJobs(rawJobs);
}

export async function loadScrapeReportsAsync(): Promise<ScrapeReport[]> {
  if (isSupabaseStore()) {
    const { listReports } = await import("../db/reports-repo");
    return listReports();
  }
  return loadScrapeReports();
}

export async function saveScrapeReportAsync(report: ScrapeReport): Promise<void> {
  if (isSupabaseStore()) {
    const { saveReport } = await import("../db/reports-repo");
    return saveReport(report);
  }
  return saveScrapeReport(report);
}

export async function clearScrapedJobsAsync(): Promise<void> {
  if (isSupabaseStore()) {
    // For Supabase, clear would require delete; delegate to JSON clear as fallback is acceptable
    // Implement via direct Supabase delete if needed, but for now wrap sync
    // Dynamic import to avoid circular if needed
    const supabaseStore = isSupabaseStore();
    if (supabaseStore) {
      // Attempt to delete all jobs via Supabase — best effort, fallback to sync
      try {
        const { getSupabaseAdmin } = await import("../db/client");
        const supabase = getSupabaseAdmin();
        await supabase.from("jobs").delete().eq("source", "scraped");
        return;
      } catch {
        // fallback
      }
    }
  }
  return clearScrapedJobs();
}

export async function getStorageStatsAsync(): Promise<{
  totalScrapedJobs: number;
  lastUpdated: string | null;
  reportCount: number;
}> {
  if (isSupabaseStore()) {
    const { listJobs } = await import("../db/jobs-repo");
    const { listReports } = await import("../db/reports-repo");
    const [{ total }, reports] = await Promise.all([
      listJobs({ page: 1, pageSize: 1 }),
      listReports(20),
    ]);
    return {
      totalScrapedJobs: total,
      lastUpdated: null,
      reportCount: reports.length,
    };
  }
  return getStorageStats();
}

