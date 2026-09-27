/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  for (const m of ["select", "eq", "or", "order", "range", "lt", "in", "limit"]) b[m] = rec(m);
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

// The real client accepts a single string or an array of clauses for .or();
// normalise both so the assertions read the emitted PostgREST `or=` value.
function asClauseString(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (Array.isArray(arg)) {
    return arg.filter((c): c is string => typeof c === "string").join(",");
  }
  throw new Error(`unexpected .or() argument: ${JSON.stringify(arg)}`);
}

function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function evaluateAnd(part: string, row: Record<string, unknown>): boolean {
  const cond = part.trim();
  const wrapped = /^and\(([\s\S]*)\)$/.exec(cond);
  if (wrapped) return splitTopLevel(wrapped[1]).every((sub) => evaluateAnd(sub, row));
  return evaluateCondition(cond, row);
}

function evaluateCondition(cond: string, row: Record<string, unknown>): boolean {
  const m = /^([A-Za-z0-9_.]+)\.(is\.null|gte\.[^.]+|ilike\..+)$/.exec(cond);
  if (!m) throw new Error(`unsupported PostgREST condition: ${cond}`);
  const col = m[1];
  const op = m[2];
  const value = row[col];
  if (op === "is.null") return value === null || value === undefined;
  if (op.startsWith("gte.")) {
    // SQL three-valued logic: NULL >= bound is NULL, which is never true.
    if (value === null || value === undefined) return false;
    return String(value) >= op.slice(4);
  }
  const pattern = op
    .slice("ilike.".length)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, "[\\s\\S]*");
  return new RegExp(`^${pattern}$`, "i").test(String(value ?? ""));
}

// Minimal evaluator for the `or=` grammar that jobs-repo emits. Throws on any
// shape it does not understand, so it can never silently pass a clause it did
// not actually evaluate.
function evaluateOrClause(clause: string, row: Record<string, unknown>): boolean {
  return splitTopLevel(clause).some((part) => evaluateAnd(part, row));
}

// postgrest-js appends one `or=` param per .or() call and PostgREST ANDs
// multiple top-level params, so a query built from several .or() calls keeps a
// row only when every one of its groups matches.
function evaluateOrGroups(groups: string[], row: Record<string, unknown>): boolean {
  return groups.every((group) => evaluateOrClause(group, row));
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

describe("expires_at NULL semantics (never expires)", () => {
  const FROZEN = "2026-09-27";

  beforeEach(() => {
    // jobs-repo derives `today` from new Date(); freeze it so the emitted
    // clause is deterministic and cannot flake across a midnight boundary.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${FROZEN}T12:00:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps NULL expires_at, drops past dates, and never uses a bare .lt()", async () => {
    const { builder, calls } = chainable({ data: [], error: null, count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    await listJobs({});

    // A bare .lt("expires_at", today) is exactly the trap this test pins: in
    // SQL `NULL < date` is NULL, never true, so it would hide every job that
    // simply has no expiry date, i.e. the entire board.
    expect((calls["lt"] ?? []).some((a) => a[0] === "expires_at")).toBe(false);

    const orCalls = calls["or"] ?? [];
    expect(orCalls).toHaveLength(1);
    const clause = asClauseString(orCalls[0][0]);
    expect(clause).toBe(`expires_at.is.null,expires_at.gte.${FROZEN}`);

    // Evaluate the emitted clause with PostgREST/SQL semantics rather than
    // string-matching it, so the assertion reflects real filtering.
    expect(evaluateOrClause(clause, { expires_at: null })).toBe(true);
    expect(evaluateOrClause(clause, { expires_at: undefined })).toBe(true);
    expect(evaluateOrClause(clause, { expires_at: "2000-01-01" })).toBe(false);
    expect(evaluateOrClause(clause, { expires_at: "2026-09-26" })).toBe(false);
    expect(evaluateOrClause(clause, { expires_at: FROZEN })).toBe(true);
    expect(evaluateOrClause(clause, { expires_at: "2999-01-01" })).toBe(true);

    // The in-memory degraded path must agree with the SQL clause.
    expect(isJobExpired({ isExpired: false })).toBe(false);
    expect(isJobExpired({ isExpired: false, expiresAt: "2000-01-01" })).toBe(true);
    expect(isJobExpired({ isExpired: false, expiresAt: FROZEN })).toBe(false);
  });

  it("ANDs the expiry and free-text groups across two .or() calls, so a search keeps NULL-expiry jobs and still drops past-dated ones", async () => {
    const { builder, calls } = chainable({ data: [], error: null, count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    await listJobs({ q: "robotics" });

    // postgrest-js *appends* one `or=` param per .or() call, and PostgREST ANDs
    // multiple top-level params, so the two groups are emitted separately to get
    // (expiryGroup) AND (searchGroup). Merging them into a single `or(and(a),and(b))`
    // would be an OR of ANDs, which is both the wrong connective and inexpressible
    // any other way: the top level of an `or=` argument is always disjunctive.
    const groups = (calls["or"] ?? []).map((c) => asClauseString(c[0]));
    expect(groups).toHaveLength(2);

    // Matches the free-text group in every column, so the row is a genuine
    // search hit under any encoding of the search group.
    const matching = {
      title: "Robotics Engineer",
      company: "Robotics GmbH",
      description: "Robotics fleet ops",
    };

    // expires_at IS NULL means "never expires": a row matching the search is kept.
    expect(evaluateOrGroups(groups, { ...matching, expires_at: null })).toBe(true);
    expect(evaluateOrGroups(groups, { ...matching, expires_at: undefined })).toBe(true);

    // A genuinely past-dated, not-yet-cron-flagged row must not leak through
    // just because it matched the search.
    expect(evaluateOrGroups(groups, { ...matching, expires_at: "2000-01-01" })).toBe(false);
    expect(evaluateOrGroups(groups, { ...matching, expires_at: "2026-09-26" })).toBe(false);

    // Today and later are still live.
    expect(evaluateOrGroups(groups, { ...matching, expires_at: FROZEN })).toBe(true);
    expect(evaluateOrGroups(groups, { ...matching, expires_at: "2999-01-01" })).toBe(true);

    // The search group still constrains: the expiry group alone must not admit a
    // NULL-expiry row matching nothing, which is what the merged OR-of-ANDs did.
    expect(
      evaluateOrGroups(groups, {
        title: "Sales Manager",
        company: "Beispiel GmbH",
        description: "supply chain and logistics",
        expires_at: null,
      })
    ).toBe(false);

    // Each column of the free-text group participates in its internal OR: a hit
    // in any single column is enough, on its own, to survive the expiry filter.
    expect(evaluateOrGroups(groups, { title: "ROBOTICS lead", company: "y", description: "z", expires_at: null })).toBe(true);
    expect(evaluateOrGroups(groups, { title: "x", company: "Robotics AG", description: "y", expires_at: null })).toBe(true);
    expect(evaluateOrGroups(groups, { title: "x", company: "y", description: "ROBOTICS fleet ops", expires_at: null })).toBe(true);
  });

  it("emits exactly one .or() call — the bare expiry group — when there is no search term", async () => {
    const { builder, calls } = chainable({ data: [], error: null, count: 0 });
    mockGetSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) } as any);
    await listJobs({});

    const groups = (calls["or"] ?? []).map((c) => asClauseString(c[0]));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toBe(`expires_at.is.null,expires_at.gte.${FROZEN}`);
    expect(evaluateOrGroups(groups, { expires_at: null })).toBe(true);
    expect(evaluateOrGroups(groups, { expires_at: "2000-01-01" })).toBe(false);
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
