/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only to prevent throw in node/test env
vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/db/client";
import { listJobs, getJobById, upsertJobs, rowToJob, jobToRow, mapRowToJob, mapJobToRow } from "@/lib/db/jobs-repo";
import type { JobRow } from "@/lib/db/types";
import type { Job } from "@/lib/types";

const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);

// Helper to create a chainable thenable builder
function createChainableBuilder(result: { data: unknown; error?: unknown; count?: number | null }) {
  const calls: Record<string, unknown[][]> = {
    select: [],
    eq: [],
    ilike: [],
    or: [],
    order: [],
    range: [],
    in: [],
    limit: [],
  };

  const builder: any = {};

  builder.select = vi.fn((...args: unknown[]) => {
    calls.select.push(args);
    return builder;
  });
  builder.eq = vi.fn((...args: unknown[]) => {
    calls.eq.push(args);
    return builder;
  });
  builder.ilike = vi.fn((...args: unknown[]) => {
    calls.ilike.push(args);
    return builder;
  });
  builder.or = vi.fn((...args: unknown[]) => {
    calls.or.push(args);
    return builder;
  });
  builder.order = vi.fn((...args: unknown[]) => {
    calls.order.push(args);
    return builder;
  });
  builder.range = vi.fn((...args: unknown[]) => {
    calls.range.push(args);
    return builder;
  });
  builder.in = vi.fn((...args: unknown[]) => {
    calls.in.push(args);
    return builder;
  });
  builder.limit = vi.fn((...args: unknown[]) => {
    calls.limit.push(args);
    return builder;
  });
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));

  // thenable so `await builder` works
  builder.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected);

  // Support .upsert(...).select() pattern: upsert returns builder with select
  builder.upsert = vi.fn((...args: unknown[]) => {
    calls["upsert"] = calls["upsert"] || [];
    (calls["upsert"] as unknown[][]).push(args);
    return builder;
  });
  builder.insert = vi.fn((...args: unknown[]) => {
    calls["insert"] = calls["insert"] || [];
    (calls["insert"] as unknown[][]).push(args);
    return builder;
  });
  builder.delete = vi.fn(() => builder);
  builder.neq = vi.fn(() => builder);

  return { builder, calls };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "test-id",
    title: "Test Engineer",
    titleZh: "测试工程师",
    company: "TestCo",
    field: "ai",
    location: "Berlin, Germany",
    locationCode: "de",
    languageLevel: "required",
    employmentType: "full-time",
    description: "Test description",
    descriptionZh: "测试描述",
    requirements: ["Req 1"],
    requirementsZh: ["要求1"],
    tags: ["Python"],
    applicationUrl: "https://example.com/job/1",
    postedDate: "2026-08-20",
    remoteFriendly: false,
    visaSponsorship: false,
    featured: false,
    ...overrides,
  };
}

function makeRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "row-id",
    title: "Row Title",
    title_zh: "行标题",
    company: "RowCo",
    company_zh: null,
    field: "cs",
    location: "Berlin",
    location_code: "de",
    language_level: "nice-to-have",
    employment_type: "full-time",
    salary_range: null,
    description: "Row desc",
    description_zh: null,
    requirements: [],
    requirements_zh: [],
    tags: [],
    application_url: "https://example.com/row/1",
    source_url: "https://example.com/row/1",
    posted_date: "2026-08-20",
    remote_friendly: false,
    visa_sponsorship: false,
    featured: false,
    featured_until: null,
    tier: null,
    source: null,
    source_id: null,
    created_at: "2026-08-20T10:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

describe("jobs-repo — mappers", () => {
  it("rowToJob maps JobRow to Job correctly", () => {
    const row = makeRow({
      id: "abc",
      title: "Engineer",
      title_zh: "工程师",
      company: "Bosch",
      company_zh: "博世",
      field: "robotics",
      location: "Stuttgart",
      location_code: "de",
      language_level: "fluent",
      employment_type: "contract",
      salary_range: "€80k",
      description: "Desc",
      description_zh: "描述",
      requirements: ["R1"],
      requirements_zh: ["要求1"],
      tags: ["ROS"],
      application_url: "https://example.com/a",
      posted_date: "2026-08-15",
      remote_friendly: true,
      visa_sponsorship: true,
      featured: true,
    });
    const job = rowToJob(row);
    expect(job.id).toBe("abc");
    expect(job.title).toBe("Engineer");
    expect(job.titleZh).toBe("工程师");
    expect(job.company).toBe("Bosch");
    expect(job.companyZh).toBe("博世");
    expect(job.field).toBe("robotics");
    expect(job.location).toBe("Stuttgart");
    expect(job.locationCode).toBe("de");
    expect(job.languageLevel).toBe("fluent");
    expect(job.employmentType).toBe("contract");
    expect(job.salaryRange).toBe("€80k");
    expect(job.description).toBe("Desc");
    expect(job.descriptionZh).toBe("描述");
    expect(job.requirements).toEqual(["R1"]);
    expect(job.tags).toEqual(["ROS"]);
    expect(job.applicationUrl).toBe("https://example.com/a");
    expect(job.postedDate).toBe("2026-08-15");
    expect(job.remoteFriendly).toBe(true);
    expect(job.visaSponsorship).toBe(true);
    expect(job.featured).toBe(true);
  });

  it("jobToRow maps Job to JobRow with source_url fallback", () => {
    const job = makeJob({
      id: "my-id",
      title: "AI Engineer",
      titleZh: "AI工程师",
      company: "SAP",
      field: "ai",
      applicationUrl: "https://example.com/apply",
    });
    const row = jobToRow(job);
    expect(row.id).toBe("my-id");
    expect(row.title).toBe("AI Engineer");
    expect(row.title_zh).toBe("AI工程师");
    expect(row.application_url).toBe("https://example.com/apply");
    expect(row.source_url).toBe("https://example.com/apply");
    expect(row.field).toBe("ai");
  });

  it("exported aliases mapRowToJob/mapJobToRow are same as mappers", () => {
    expect(mapRowToJob).toBe(rowToJob);
    expect(mapJobToRow).toBe(jobToRow);
  });

  it("rowToJob handles nulls with defaults", () => {
    const row = makeRow({
      title_zh: null,
      company_zh: null,
      field: null,
      location: null,
      location_code: null,
      language_level: null,
      employment_type: null,
      posted_date: null,
      created_at: null,
    });
    const job = rowToJob(row);
    expect(job.titleZh).toBe(row.title);
    expect(job.field).toBeTruthy();
    expect(job.locationCode).toBe("de");
  });
});

describe("jobs-repo — listJobs filter->query mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("field filter calls eq('field', 'ai')", async () => {
    const row = makeRow();
    const { builder, calls } = createChainableBuilder({ data: [row], count: 1 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    const result = await listJobs({ field: "ai" });
    expect(calls.eq).toContainEqual(["field", "ai"]);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("locationCode filter calls eq('location_code', 'de')", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({ locationCode: "de" });
    expect(calls.eq).toContainEqual(["location_code", "de"]);
  });

  it("languageLevel filter calls eq('language_level', 'fluent')", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({ languageLevel: "fluent" });
    expect(calls.eq).toContainEqual(["language_level", "fluent"]);
  });

  it("employmentType filter calls eq('employment_type', 'full-time')", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({ employmentType: "full-time" });
    expect(calls.eq).toContainEqual(["employment_type", "full-time"]);
  });

  it("remote filter calls eq('remote_friendly', true)", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({ remote: true });
    expect(calls.eq).toContainEqual(["remote_friendly", true]);
  });

  it("visa filter calls eq('visa_sponsorship', true)", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({ visa: true });
    expect(calls.eq).toContainEqual(["visa_sponsorship", true]);
  });

  it("q uses ilike or or with ilike pattern on title/company/description", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({ q: "chinese" });

    const hasIlike = calls.ilike.length > 0;
    const hasOr = calls.or.length > 0 && String(calls.or[0][0]).includes("ilike");
    expect(hasIlike || hasOr).toBe(true);
    if (hasOr) {
      const orArg = String(calls.or[0][0]);
      expect(orArg).toContain("title.ilike");
      expect(orArg).toContain("company.ilike");
      expect(orArg).toContain("description.ilike");
    }
    if (hasIlike) {
      expect(calls.ilike[0][0]).toBe("title");
      expect(String(calls.ilike[0][1])).toContain("chinese");
    }
  });

  it("pagination via range: page 2 pageSize 10 => range(10,19)", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({ page: 2, pageSize: 10 });
    expect(calls.range[0]).toEqual([10, 19]);
  });

  it("default pagination page 1 pageSize 20 => range(0,19)", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({});
    expect(calls.range[0]).toEqual([0, 19]);
  });

  it("ordering by posted_date desc (and created_at)", async () => {
    const { builder, calls } = createChainableBuilder({ data: [], count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    await listJobs({});
    expect(calls.order.length).toBeGreaterThan(0);
    expect(calls.order[0][0]).toBe("posted_date");
    expect(calls.order[0][1]).toEqual({ ascending: false });
    // select with count exact
    expect(calls.select[0]).toEqual(["*", { count: "exact" }]);
  });

  it("maps rows to Jobs", async () => {
    const row = makeRow({ id: "mapped-1", title: "Mapped" });
    const { builder } = createChainableBuilder({ data: [row], count: 1 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    const { items } = await listJobs({});
    expect(items[0].id).toBe("mapped-1");
    expect(items[0].title).toBe("Mapped");
  });
});

describe("jobs-repo — getJobById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns Job when found", async () => {
    const row = makeRow({ id: "found-id" });
    const builder: any = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.single = vi.fn(() => Promise.resolve({ data: row, error: null }));
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    const job = await getJobById("found-id");
    expect(job?.id).toBe("found-id");
    expect(builder.eq).toHaveBeenCalledWith("id", "found-id");
  });

  it("returns null when not found", async () => {
    const builder: any = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.single = vi.fn(() =>
      Promise.resolve({ data: null, error: { code: "PGRST116", message: "Not found" } })
    );
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);

    const job = await getJobById("missing");
    expect(job).toBeNull();
  });
});

describe("jobs-repo — upsertJobs dedup on source_url", () => {
  beforeEach(() => vi.clearAllMocks());

  it("when existing source_url found, only new ones upserted", async () => {
    const jobA = makeJob({ id: "a", applicationUrl: "https://example.com/job/a" });
    const jobB = makeJob({ id: "b", applicationUrl: "https://example.com/job/b" });
    const jobC = makeJob({ id: "c", applicationUrl: "https://example.com/job/c" });

    // First query: existing source_url = jobA's url (already in DB)
    const existingRows = [{ source_url: "https://example.com/job/a" }];

    // Build first builder for select+in
    const firstBuilder: any = {};
    const inCalls: unknown[][] = [];
    firstBuilder.select = vi.fn(() => firstBuilder);
    firstBuilder.in = vi.fn((...args: unknown[]) => {
      inCalls.push(args);
      return firstBuilder;
    });
    firstBuilder.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve({ data: existingRows, error: null }).then(onFulfilled, onRejected);

    // Build second builder for upsert
    const upsertCalls: unknown[][] = [];
    const secondBuilder: any = {};
    secondBuilder.upsert = vi.fn((...args: unknown[]) => {
      upsertCalls.push(args);
      return secondBuilder;
    });
    secondBuilder.select = vi.fn(() => secondBuilder);
    secondBuilder.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve({ data: [{ id: "b" }, { id: "c" }], error: null, count: 2 }).then(onFulfilled, onRejected);

    const mockFrom = vi.fn((table: string) => {
      expect(table).toBe("jobs");
      // First call returns firstBuilder, second call returns secondBuilder
      if (mockFrom.mock.calls.length === 1) return firstBuilder;
      return secondBuilder;
    });

    mockGetSupabaseAdmin.mockReturnValue({ from: mockFrom } as any);

    const result = await upsertJobs([jobA, jobB, jobC]);

    expect(inCalls[0][0]).toBe("source_url");
    // Should have filtered out jobA (existing), only b and c inserted
    expect(upsertCalls.length).toBe(1);
    const insertedRows = upsertCalls[0][0] as JobRow[];
    expect(insertedRows).toHaveLength(2);
    const insertedUrls = insertedRows.map((r) => r.source_url);
    expect(insertedUrls).not.toContain("https://example.com/job/a");
    expect(insertedUrls).toContain("https://example.com/job/b");
    expect(insertedUrls).toContain("https://example.com/job/c");
    expect(upsertCalls[0][1]).toEqual(expect.objectContaining({ onConflict: "source_url" }));
    expect(result.added).toBe(2);
  });

  it("when all new, all upserted", async () => {
    const jobX = makeJob({ id: "x", applicationUrl: "https://example.com/job/x" });
    const jobY = makeJob({ id: "y", applicationUrl: "https://example.com/job/y" });

    const firstBuilder: any = {};
    firstBuilder.select = vi.fn(() => firstBuilder);
    firstBuilder.in = vi.fn(() => firstBuilder);
    firstBuilder.then = (onFulfilled: any) => Promise.resolve({ data: [], error: null }).then(onFulfilled);

    const upsertCalls: unknown[][] = [];
    const secondBuilder: any = {};
    secondBuilder.upsert = vi.fn((...args: unknown[]) => {
      upsertCalls.push(args);
      return secondBuilder;
    });
    secondBuilder.select = vi.fn(() => secondBuilder);
    secondBuilder.then = (onFulfilled: any) => Promise.resolve({ data: [{ id: "x" }, { id: "y" }], error: null, count: 2 }).then(onFulfilled);

    const mockFrom = vi.fn(() => {
      if (mockFrom.mock.calls.length === 1) return firstBuilder;
      return secondBuilder;
    });
    mockGetSupabaseAdmin.mockReturnValue({ from: mockFrom } as any);

    const result = await upsertJobs([jobX, jobY]);
    expect(upsertCalls[0][0]).toHaveLength(2);
    expect(result.added).toBe(2);
  });

  it("when all duplicates, no upsert and added 0", async () => {
    const jobD = makeJob({ id: "d", applicationUrl: "https://example.com/job/d" });

    const firstBuilder: any = {};
    firstBuilder.select = vi.fn(() => firstBuilder);
    firstBuilder.in = vi.fn(() => firstBuilder);
    firstBuilder.then = (onFulfilled: any) => Promise.resolve({ data: [{ source_url: "https://example.com/job/d" }], error: null }).then(onFulfilled);

    const mockFrom = vi.fn(() => firstBuilder);
    mockGetSupabaseAdmin.mockReturnValue({ from: mockFrom } as any);

    const result = await upsertJobs([jobD]);
    expect(result.added).toBe(0);
    // upsert should not have been called at all
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("returns added 0 for empty input without calling Supabase", async () => {
    const result = await upsertJobs([]);
    expect(result.added).toBe(0);
    expect(mockGetSupabaseAdmin).not.toHaveBeenCalled();
  });
});
