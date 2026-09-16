/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/db/client";
import {
  listJobs,
  expireOverdueJobs,
  hardDeleteExpired,
  isJobExpired,
  isMissingExpiryColumn,
} from "@/lib/db/jobs-repo";
import { rowToJob, jobToRow } from "@/lib/db/mappers";

const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);

function chainable(result: any, extra: Record<string, any> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const b: any = {};
  const rec = (name: string) => (...args: unknown[]) => {
    calls[name] = calls[name] || [];
    calls[name].push(args);
    return b;
  };
  for (const m of ["select", "eq", "order", "range", "lt", "in", "limit"]) b[m] = rec(m);
  b.update = vi.fn((...args: unknown[]) => {
    calls["update"] = calls["update"] || [];
    (calls["update"] as unknown[][]).push(args);
    return b;
  });
  b.delete = vi.fn(() => {
    calls["delete"] = calls["delete"] || [];
    (calls["delete"] as unknown[][]).push([]);
    return b;
  });
  b.single = vi.fn(() => Promise.resolve(result));
  b.then = (onF: any, onR: any) => Promise.resolve(result).then(onF, onR);
  Object.assign(b, extra);
  return { builder: b, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isJobExpired (pure)", () => {
  it("flagged jobs are expired", () => {
    expect(isJobExpired({ isExpired: true })).toBe(true);
  });
  it("no expiresAt + no flag => not expired", () => {
    expect(isJobExpired({})).toBe(false);
  });
  it("past expires_at => expired, future => not", () => {
    expect(isJobExpired({ expiresAt: "2000-01-01" })).toBe(true);
    expect(isJobExpired({ expiresAt: "2999-01-01" })).toBe(false);
  });
});

describe("mapper expiry passthrough", () => {
  it("rowToJob passes expires_at/is_expired", () => {
    const job = rowToJob({
      id: "1", title: "T", title_zh: null, company: "C", company_zh: null,
      field: "ai", location: "Berlin", location_code: "de",
      language_level: "required", employment_type: "full-time",
      salary_range: null, description: "d", description_zh: null,
      requirements: [], requirements_zh: [], tags: [],
      application_url: "https://x", source_url: null,
      posted_date: "2026-01-01", expires_at: "2026-03-02", is_expired: true,
      remote_friendly: false, visa_sponsorship: false, featured: false,
      featured_until: null, tier: null, source: null, source_id: null,
      created_at: null, updated_at: null,
    } as any);
    expect(job.expiresAt).toBe("2026-03-02");
    expect(job.isExpired).toBe(true);
  });
  it("rowToJob defaults isExpired=false when null", () => {
    const job = rowToJob({
      id: "1", title: "T", title_zh: null, company: "C", company_zh: null,
      field: "ai", location: "Berlin", location_code: "de",
      language_level: "required", employment_type: "full-time",
      salary_range: null, description: "d", description_zh: null,
      requirements: [], requirements_zh: [], tags: [],
      application_url: "https://x", source_url: null,
      posted_date: "2026-01-01", expires_at: null, is_expired: null,
      remote_friendly: false, visa_sponsorship: false, featured: false,
      featured_until: null, tier: null, source: null, source_id: null,
      created_at: null, updated_at: null,
    } as any);
    expect(job.isExpired).toBe(false);
    expect(job.expiresAt).toBeUndefined();
  });
  it("jobToRow passes expiresAt/isExpired", () => {
    const row = jobToRow({
      id: "1", title: "T", titleZh: "T", company: "C", field: "ai",
      location: "Berlin", locationCode: "de", languageLevel: "required",
      employmentType: "full-time", description: "d", descriptionZh: "d",
      requirements: [], requirementsZh: [], tags: [],
      applicationUrl: "https://x", postedDate: "2026-01-01",
      expiresAt: "2026-03-02", isExpired: true,
      remoteFriendly: false, visaSponsorship: false,
    } as any);
    expect(row.expires_at).toBe("2026-03-02");
    expect(row.is_expired).toBe(true);
  });
});

describe("listJobs expiry filter", () => {
  it("filters is_expired=false by default", async () => {
    const { builder, calls } = chainable({ data: [], error: null, count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    await listJobs({});
    expect(calls["eq"]?.some((a) => a[0] === "is_expired" && a[1] === false)).toBe(true);
  });
  it("includeExpired=true skips the filter", async () => {
    const { builder, calls } = chainable({ data: [], error: null, count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    await listJobs({ includeExpired: true });
    expect((calls["eq"] ?? []).some((a) => a[0] === "is_expired")).toBe(false);
  });
});

describe("missing-column degraded mode (005 not applied)", () => {
  const sampleRow = {
    id: "9", title: "T", title_zh: null, company: "C", company_zh: null,
    field: "ai", location: "Berlin", location_code: "de",
    language_level: "required", employment_type: "full-time",
    salary_range: null, description: "d", description_zh: null,
    requirements: [], requirements_zh: [], tags: [],
    application_url: "https://x", source_url: null,
    posted_date: "2026-01-01", expires_at: null, is_expired: null,
    remote_friendly: false, visa_sponsorship: false, featured: false,
    featured_until: null, tier: null, source: null, source_id: null,
    created_at: null, updated_at: null,
  };

  it("listJobs retries without is_expired filter on 42703", async () => {
    const first = chainable({ data: null, error: { code: "42703", message: 'column "is_expired" does not exist' }, count: 0 });
    const second = chainable({ data: [sampleRow], error: null, count: 1 });
    const fromFn = vi.fn().mockReturnValueOnce(first.builder).mockReturnValueOnce(second.builder);
    mockGetSupabaseAdmin.mockReturnValue({ from: fromFn } as any);
    const res = await listJobs({});
    expect(res.items).toHaveLength(1);
    expect(first.calls["eq"]?.some((a) => a[0] === "is_expired")).toBe(true);
    expect((second.calls["eq"] ?? []).some((a) => a[0] === "is_expired")).toBe(false);
    expect(fromFn).toHaveBeenCalledTimes(2);
  });

  it("listJobs degrades on message-variant missing-column error", async () => {
    const first = chainable({ data: null, error: { code: "PGRST204", message: "Could not find the 'expires_at' column" }, count: 0 });
    const second = chainable({ data: [], error: null, count: 0 });
    const fromFn = vi.fn().mockReturnValueOnce(first.builder).mockReturnValueOnce(second.builder);
    mockGetSupabaseAdmin.mockReturnValue({ from: fromFn } as any);
    const res = await listJobs({});
    expect(res.items).toHaveLength(0);
    expect(fromFn).toHaveBeenCalledTimes(2);
  });

  it("listJobs still throws on non-missing-column errors (no retry)", async () => {
    const { builder } = chainable({ data: null, error: { code: "500", message: "boom" }, count: 0 });
    const fromFn = vi.fn(() => builder);
    mockGetSupabaseAdmin.mockReturnValue({ from: fromFn } as any);
    await expect(listJobs({})).rejects.toMatchObject({ message: "boom" });
    expect(fromFn).toHaveBeenCalledTimes(1);
  });

  it("expireOverdueJobs returns degraded instead of throwing on missing column", async () => {
    const { builder } = chainable({ data: null, error: { code: "42703", message: 'column "expires_at" does not exist' } });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    await expect(expireOverdueJobs()).resolves.toEqual({ expiredCount: 0, degraded: true });
  });

  it("isMissingExpiryColumn detects codes and message variants", () => {
    expect(isMissingExpiryColumn({ code: "42703" })).toBe(true);
    expect(isMissingExpiryColumn({ code: "PGRST204" })).toBe(true);
    expect(isMissingExpiryColumn({ message: 'column "is_expired" does not exist' })).toBe(true);
    expect(isMissingExpiryColumn({ message: "boom" })).toBe(false);
    expect(isMissingExpiryColumn(null)).toBe(false);
  });
});

describe("expireOverdueJobs / hardDeleteExpired", () => {
  it("expireOverdueJobs flags overdue and returns count", async () => {
    const { builder, calls } = chainable({ data: [{ id: "a" }, { id: "b" }], error: null });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    const res = await expireOverdueJobs();
    expect(res.expiredCount).toBe(2);
    expect(calls["update"]?.[0]?.[0]).toEqual({ is_expired: true });
    expect(calls["eq"]?.some((a) => a[0] === "is_expired" && a[1] === false)).toBe(true);
    expect(calls["lt"]?.some((a) => a[0] === "expires_at")).toBe(true);
  });
  it("hardDeleteExpired deletes with cutoff and returns count", async () => {
    const { builder, calls } = chainable({ data: [{ id: "a" }], error: null });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    const res = await hardDeleteExpired(90);
    expect(res.deletedCount).toBe(1);
    expect(calls["delete"]?.length).toBe(1);
    expect(calls["eq"]?.some((a) => a[0] === "is_expired" && a[1] === true)).toBe(true);
    expect(calls["lt"]?.some((a) => a[0] === "expires_at")).toBe(true);
  });
});
