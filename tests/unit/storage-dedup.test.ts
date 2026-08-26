import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Job } from "@/lib/types";
import type { ScrapedJobRaw } from "@/lib/scraper/types";
import { rawToJob } from "@/lib/scraper/types";
// Import storage module to ensure it is testable and to satisfy spec's "import from storage"
import * as storage from "@/lib/scraper/storage";

// Helpers that mirror storage.ts logic but operate on an explicit temp file path
// This avoids touching the real data/scraped-jobs.json

interface StoredData {
  jobs: Job[];
  lastUpdated: string;
}

function loadJobsFromFile(filePath: string): Job[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, "utf-8");
    if (!data.trim()) return [];
    const parsed: StoredData = JSON.parse(data);
    return parsed.jobs || [];
  } catch {
    return [];
  }
}

function saveJobsToFile(filePath: string, jobs: Job[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data: StoredData = { jobs, lastUpdated: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function addJobsWithDedup(
  filePath: string,
  rawJobs: ScrapedJobRaw[]
): { added: number; skipped: number; total: number } {
  const existing = loadJobsFromFile(filePath);
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
  saveJobsToFile(filePath, all);
  return { added, skipped, total: all.length };
}

function makeRaw(url: string, title = "Test Engineer"): ScrapedJobRaw {
  return {
    title,
    company: "TestCo",
    location: "Berlin",
    url,
    description: "Need mandarin speaker, Python, Kubernetes",
    postedDate: "2026-08-20",
    sourceId: "test-source",
    sourceName: "Test Source",
  };
}

// ---------------------------------------------------------------------------
// Logic contract — mirrored helpers (documents expected behavior without
// touching real data/; kept separate from the real-storage integration suite)
// ---------------------------------------------------------------------------
describe("storage deduplication and cap — logic contract (mirrored helpers, temp file isolation)", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinotech-test-"));
    tmpFile = path.join(tmpDir, "scraped-jobs.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("duplicate URL not added twice (deduplication by URL)", () => {
    const rawA = makeRaw("https://example.com/job/1", "Job A");
    const rawB = makeRaw("https://example.com/job/1", "Job A Duplicate");
    const rawC = makeRaw("https://example.com/job/2", "Job B");

    const r1 = addJobsWithDedup(tmpFile, [rawA, rawC]);
    expect(r1.added).toBe(2);
    expect(r1.skipped).toBe(0);
    expect(r1.total).toBe(2);

    const r2 = addJobsWithDedup(tmpFile, [rawB]);
    expect(r2.added).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(r2.total).toBe(2);

    const jobs = loadJobsFromFile(tmpFile);
    expect(jobs).toHaveLength(2);
    const urls = jobs.map((j) => j.applicationUrl);
    expect(urls).toContain("https://example.com/job/1");
    expect(urls).toContain("https://example.com/job/2");
  });

  it("handles duplicates within the same batch", () => {
    const raws = [
      makeRaw("https://example.com/job/dup"),
      makeRaw("https://example.com/job/dup"),
      makeRaw("https://example.com/job/dup"),
    ];
    const result = addJobsWithDedup(tmpFile, raws);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(2);
    expect(loadJobsFromFile(tmpFile)).toHaveLength(1);
  });

  it("max 500 cap truncates oldest (newest 500 kept)", () => {
    // Seed with 500 jobs
    const initialRaws: ScrapedJobRaw[] = Array.from({ length: 500 }, (_, i) =>
      makeRaw(`https://example.com/job/seed-${i}`, `Seed Job ${i}`)
    );
    const r1 = addJobsWithDedup(tmpFile, initialRaws);
    expect(r1.total).toBe(500);
    expect(loadJobsFromFile(tmpFile)).toHaveLength(500);

    // The oldest job should be the last in the sliced array (index 499)
    const before = loadJobsFromFile(tmpFile);
    const oldestUrl = before[before.length - 1].applicationUrl;

    // Add 10 new jobs — should still cap at 500 and drop 10 oldest
    const newRaws: ScrapedJobRaw[] = Array.from({ length: 10 }, (_, i) =>
      makeRaw(`https://example.com/job/new-${i}`, `New Job ${i}`)
    );
    const r2 = addJobsWithDedup(tmpFile, newRaws);
    expect(r2.total).toBe(500);
    expect(r2.added).toBe(10);

    const after = loadJobsFromFile(tmpFile);
    expect(after).toHaveLength(500);
    // New jobs should be at the front (prepended)
    expect(after[0].applicationUrl).toBe("https://example.com/job/new-0");
    // Oldest should have been evicted
    expect(after.map((j) => j.applicationUrl)).not.toContain(oldestUrl);
  });

  it("JSON round-trip preserves job fields", () => {
    const raw = makeRaw("https://example.com/job/roundtrip", "AI Engineer München Python");
    // Create a job via rawToJob so all auto-detected fields are present
    const job = rawToJob(raw, "scraped-123-0");
    saveJobsToFile(tmpFile, [job]);

    const loaded = loadJobsFromFile(tmpFile);
    expect(loaded).toHaveLength(1);
    const lj = loaded[0];
    expect(lj.title).toBe(job.title);
    expect(lj.company).toBe(job.company);
    expect(lj.applicationUrl).toBe(job.applicationUrl);
    expect(lj.field).toBe(job.field);
    expect(lj.locationCode).toBe(job.locationCode);
    expect(lj.languageLevel).toBe(job.languageLevel);
    expect(lj.tags).toEqual(job.tags);
    expect(lj.postedDate).toBe(job.postedDate);
    // Verify file on disk is valid JSON with expected shape
    const rawJson = JSON.parse(fs.readFileSync(tmpFile, "utf-8")) as StoredData;
    expect(rawJson.jobs).toBeDefined();
    expect(rawJson.lastUpdated).toBeDefined();
    expect(typeof rawJson.lastUpdated).toBe("string");
  });

  it("empty file and missing file and invalid JSON handled gracefully", () => {
    // Missing file → []
    expect(loadJobsFromFile(tmpFile)).toEqual([]);

    // Empty file → []
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    fs.writeFileSync(tmpFile, "", "utf-8");
    expect(loadJobsFromFile(tmpFile)).toEqual([]);

    // Whitespace only → []
    fs.writeFileSync(tmpFile, "   \n", "utf-8");
    expect(loadJobsFromFile(tmpFile)).toEqual([]);

    // Invalid JSON → []
    fs.writeFileSync(tmpFile, "{ not: valid json", "utf-8");
    expect(loadJobsFromFile(tmpFile)).toEqual([]);

    // Valid JSON but no jobs key → [] (jobs undefined)
    fs.writeFileSync(tmpFile, JSON.stringify({ lastUpdated: new Date().toISOString() }), "utf-8");
    expect(loadJobsFromFile(tmpFile)).toEqual([]);
  });

  it("storage module exports expected functions without touching real data/", () => {
    expect(typeof storage.loadScrapedJobs).toBe("function");
    expect(typeof storage.saveScrapedJobs).toBe("function");
    expect(typeof storage.addScrapedJobs).toBe("function");
    expect(typeof storage.clearScrapedJobs).toBe("function");
    expect(typeof storage.loadScrapeReports).toBe("function");
    expect(typeof storage.saveScrapeReport).toBe("function");
    // Verify temp isolation: helpers used tmpFile inside os.tmpdir(), not the real data/ directory
    expect(tmpFile.startsWith(os.tmpdir())).toBe(true);
    expect(path.isAbsolute(tmpFile)).toBe(true);
    // Ensure the mirrored helper file does not exist at the real project data path after this suite
    const realDataPath = path.join(process.cwd(), "data", "scraped-jobs.json");
    // We only assert that our tmpFile is distinct from the real path (isolation guarantee)
    expect(tmpFile).not.toBe(realDataPath);
  });

  it("URL normalization: dedup is exact-string — trailing slash and query considered distinct", () => {
    // Current production dedup uses exact string comparison (no normalization)
    // so URLs differing only by trailing slash are treated as distinct.
    const rawSlash = makeRaw("https://example.com/job/1/", "With slash");
    const rawNoSlash = makeRaw("https://example.com/job/1", "Without slash");
    const rawQuery = makeRaw("https://example.com/job/1?foo=bar", "With query");
    const result = addJobsWithDedup(tmpFile, [rawSlash, rawNoSlash, rawQuery]);
    // Assert current substring/exact behavior explicitly — future normalization fix will change this
    expect(result.added).toBe(3);
    expect(result.skipped).toBe(0);
    expect(loadJobsFromFile(tmpFile)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Real storage integration — exercises production storage.ts via cwd mock
// Uses vi.spyOn(process, "cwd").mockReturnValue(tmpDir) so DATA_DIR resolves
// to tmpDir; verifies dedup and 500 cap through the real code path.
// ---------------------------------------------------------------------------
describe("real storage via cwd mock", () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinotech-real-"));
    // storage.ts computes DATA_DIR = path.join(process.cwd(), "data") at import time,
    // so we must reset modules and re-import after mocking cwd for the mock to take effect.
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("real addScrapedJobs/loadScrapedJobs/clearScrapedJobs deduplicate and enforce 500 cap via cwd-mocked storage", async () => {
    vi.resetModules();
    const storageReal = await import("@/lib/scraper/storage");

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1234567890000);

    // Ensure clean state
    storageReal.clearScrapedJobs();
    expect(storageReal.loadScrapedJobs()).toHaveLength(0);

    const rawA: ScrapedJobRaw = {
      title: "Test Engineer A",
      company: "TestCo",
      location: "Berlin",
      url: "https://example.com/real/1",
      description: "Need mandarin speaker, Python",
      postedDate: "2026-08-20",
      sourceId: "test-source",
      sourceName: "Test Source",
    };
    const rawADup: ScrapedJobRaw = {
      title: "Test Engineer A Duplicate",
      company: "TestCo",
      location: "Berlin",
      url: "https://example.com/real/1",
      description: "Need mandarin speaker, Python",
      postedDate: "2026-08-20",
      sourceId: "test-source",
      sourceName: "Test Source",
    };
    const rawB: ScrapedJobRaw = {
      title: "Test Engineer B",
      company: "TestCo",
      location: "München",
      url: "https://example.com/real/2",
      description: "General role",
      postedDate: "2026-08-20",
      sourceId: "test-source",
      sourceName: "Test Source",
    };

    const r1 = storageReal.addScrapedJobs([rawA, rawB]);
    expect(r1.added).toBe(2);
    expect(r1.skipped).toBe(0);
    expect(r1.total).toBe(2);
    expect(storageReal.loadScrapedJobs()).toHaveLength(2);
    // Verify file was written under tmpDir/data, not real data/
    const expectedFile = path.join(tmpDir, "data", "scraped-jobs.json");
    expect(fs.existsSync(expectedFile)).toBe(true);
    // Verify deterministic id prefix from mocked Date.now
    const loaded1 = storageReal.loadScrapedJobs();
    expect(loaded1[0].id).toMatch(/^scraped-1234567890000-\d+$/);

    const r2 = storageReal.addScrapedJobs([rawADup]);
    expect(r2.added).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(r2.total).toBe(2);

    // Now test 500 cap via real code path: add 500 more unique jobs
    const manyRaws: ScrapedJobRaw[] = Array.from({ length: 500 }, (_, i) => ({
      title: `Bulk Job ${i}`,
      company: "BulkCo",
      location: "Berlin",
      url: `https://example.com/real/bulk-${i}`,
      description: "Bulk job",
      postedDate: "2026-08-20",
      sourceId: "test-source",
      sourceName: "Test Source",
    }));
    const r3 = storageReal.addScrapedJobs(manyRaws);
    // 2 existing + 500 new = 502, but capped at 500
    expect(r3.total).toBe(500);
    expect(storageReal.loadScrapedJobs()).toHaveLength(500);
    // Newest bulk jobs should be at front
    expect(storageReal.loadScrapedJobs()[0].applicationUrl).toBe("https://example.com/real/bulk-0");

    // clearScrapedJobs should wipe the tmpDir store without touching real data/
    storageReal.clearScrapedJobs();
    expect(storageReal.loadScrapedJobs()).toHaveLength(0);
    expect(fs.existsSync(expectedFile)).toBe(true);
    const afterClear = JSON.parse(fs.readFileSync(expectedFile, "utf-8")) as StoredData;
    expect(afterClear.jobs).toHaveLength(0);

    dateSpy.mockRestore();
  });
});
