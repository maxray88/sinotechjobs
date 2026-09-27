/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// --- module mocks (route/lib boundary) -------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/all-jobs", () => ({ getAllJobs: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
// Spy on computeMatchScore while keeping real scoring behaviour, so we can
// assert on the exact CandidateProfile the route hands to the engine.
vi.mock("@/lib/matching", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/matching")>();
  return { ...actual, computeMatchScore: vi.fn(actual.computeMatchScore) };
});

import { GET as jobsGET } from "@/app/api/jobs/route";
import { POST as matchPOST } from "@/app/api/match/route";
import { saveMatchScores, getTopMatches } from "@/lib/match-scores";
import { computeMatchScore } from "@/lib/matching";
import { getAllJobs } from "@/lib/all-jobs";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import type { Job } from "@/lib/types";

// --- fixtures --------------------------------------------------------------
function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    title: "AI Engineer",
    titleZh: "AI 工程师",
    company: "Bosch",
    field: "ai",
    location: "Berlin",
    locationCode: "de",
    languageLevel: "required",
    employmentType: "full-time",
    salaryRange: "€70k-€80k",
    description: "Build production models",
    descriptionZh: "构建生产模型",
    requirements: ["Python"],
    requirementsZh: ["Python"],
    tags: ["Python"],
    applicationUrl: "https://example.com/apply/1",
    postedDate: "2026-08-01",
    remoteFriendly: false,
    visaSponsorship: true,
    featured: false,
    ...overrides,
  };
}

/** A job whose zh columns are NULL, as scraped rows can carry. */
function makeJobWithNullZh(overrides: Partial<Job> = {}): Job {
  return {
    ...makeJob(),
    titleZh: null,
    descriptionZh: null,
    companyZh: null,
    ...overrides,
  } as unknown as Job;
}

function makeJobsRequest(query = ""): Parameters<typeof jobsGET>[0] {
  return new Request(`http://localhost:3000/api/jobs${query}`) as unknown as Parameters<
    typeof jobsGET
  >[0];
}

function makeRawMatchRequest(raw: string): Request {
  return new Request("http://localhost:3000/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

function matchRequestBody(candidate: Record<string, unknown>): Request {
  return makeRawMatchRequest(JSON.stringify({ candidate }));
}

/** A candidate that scores >= 70, so POST /api/match wants to persist it. */
const HIGH_SCORE_CANDIDATE = {
  focus_area: "ai",
  visa_status: "eu_citizen",
  languages: { en: "C1" },
  hsk_level: 6,
  desired_location: "Berlin",
  salary_min: 75000,
  salary_max: 78000,
  sub_specializations: ["NLP", "CV"],
};

// --- supabase admin mock (chainable-builder style used by expiry.test.ts) ---
interface AdminCall {
  table: string;
  upsertRows?: unknown[];
  upsertOptions?: unknown;
}

function makeAdminMock(result: { data?: unknown; error?: unknown } = {}) {
  const calls: AdminCall[] = [];
  const resolved = { data: null, error: null, ...result };
  const from = vi.fn((table: string) => {
    const rec: AdminCall = { table };
    calls.push(rec);
    const builder: any = {};
    const chain = () => builder;
    for (const method of ["select", "eq", "order", "limit", "range", "in"]) {
      builder[method] = vi.fn(() => chain());
    }
    builder.upsert = vi.fn((rows: unknown[], options: unknown) => {
      rec.upsertRows = rows;
      rec.upsertOptions = options;
      return chain();
    });
    builder.insert = vi.fn(() => chain());
    builder.single = vi.fn(() => Promise.resolve(resolved));
    builder.then = (onF: any, onR: any) => Promise.resolve(resolved).then(onF, onR);
    return builder;
  });
  return { admin: { from } as any, from, calls };
}

// --- helpers ---------------------------------------------------------------
const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);
const mockGetAllJobs = vi.mocked(getAllJobs);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockComputeMatchScore = vi.mocked(computeMatchScore);

function capturedCandidates(): any[] {
  return mockComputeMatchScore.mock.calls.map((call) => call[0]);
}

const ORIGINAL_DATA_STORE = process.env.DATA_STORE;

beforeEach(() => {
  vi.clearAllMocks();
  // Force the in-memory branch of GET /api/jobs (the branch that filters + paginates).
  process.env.DATA_STORE = "json";
  mockGetCurrentUser.mockResolvedValue(null);
});

afterAll(() => {
  process.env.DATA_STORE = ORIGINAL_DATA_STORE;
});

// ---------------------------------------------------------------------------
describe("GET /api/jobs — ?q= search over zh columns", () => {
  it("returns matches without throwing when titleZh/descriptionZh are null", async () => {
    mockGetAllJobs.mockResolvedValue([
      makeJobWithNullZh({ id: "hit", title: "Bosch AI Engineer", company: "Bosch" }),
      makeJobWithNullZh({
        id: "miss",
        title: "Datenanalyse",
        company: "SAP",
        description: "Statistik",
        tags: ["SQL"],
      }),
    ]);

    const res = await jobsGET(makeJobsRequest("?q=bosch"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { items: Job[]; total: number };
    // The matching null-zh row survives the filter ...
    expect(body.items.map((j) => j.id)).toEqual(["hit"]);
    // ... and the non-matching null-zh row is also evaluated without throwing.
    expect(body.total).toBe(1);
  });

  it("matches Latin text inside a Chinese title case-insensitively", async () => {
    mockGetAllJobs.mockResolvedValue([
      makeJob({
        id: "cn",
        // Only the zh title contains "ros" — title/company/description/tags do not.
        title: "Senior Automatisierung",
        titleZh: "Senior ROS 机器人工程师",
        company: "KUKA",
        description: "Steuerungstechnik",
        descriptionZh: "控制技术",
        tags: ["C++"],
      }),
    ]);

    const res = await jobsGET(makeJobsRequest("?q=ros"));
    const body = (await res.json()) as { items: Job[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe("cn");
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/jobs — pagination", () => {
  const five = [0, 1, 2, 3, 4].map((n) => makeJob({ id: `job-${n}`, title: `Engineer ${n}` }));

  beforeEach(() => {
    mockGetAllJobs.mockResolvedValue(five);
  });

  it("slices a half-open window per page and reports the full filtered total", async () => {
    const first = (await (await jobsGET(makeJobsRequest("?page=1&pageSize=2"))).json()) as any;
    expect(first.items.map((j: Job) => j.id)).toEqual(["job-0", "job-1"]);
    expect(first.jobs).toEqual(first.items);
    expect(first.total).toBe(5);
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(2);

    const second = (await (await jobsGET(makeJobsRequest("?page=2&pageSize=2"))).json()) as any;
    expect(second.items.map((j: Job) => j.id)).toEqual(["job-2", "job-3"]);
    expect(second.total).toBe(5);

    // Half-open slice: last page is short, not empty and not overlapping.
    const third = (await (await jobsGET(makeJobsRequest("?page=3&pageSize=2"))).json()) as any;
    expect(third.items.map((j: Job) => j.id)).toEqual(["job-4"]);
    expect(third.total).toBe(5);

    // Past the end: empty page, total unchanged.
    const fourth = (await (await jobsGET(makeJobsRequest("?page=9&pageSize=2"))).json()) as any;
    expect(fourth.items).toEqual([]);
    expect(fourth.total).toBe(5);
  });

  it("clamps page < 1 and non-numeric page to 1", async () => {
    for (const page of ["0", "-4", "abc", ""]) {
      const body = (await (await jobsGET(makeJobsRequest(`?page=${page}&pageSize=2`))).json()) as any;
      expect(body.page).toBe(1);
      expect(body.items.map((j: Job) => j.id)).toEqual(["job-0", "job-1"]);
    }
  });

  it("defaults pageSize to 20 when missing/zero/non-numeric and clamps above 1000", async () => {
    for (const pageSize of ["", "0", "-3", "abc"]) {
      const body = (await (await jobsGET(makeJobsRequest(`?pageSize=${pageSize}`))).json()) as any;
      expect(body.pageSize).toBe(20);
      expect(body.items).toHaveLength(5);
    }

    const clamped = (await (await jobsGET(makeJobsRequest("?pageSize=5000"))).json()) as any;
    expect(clamped.pageSize).toBe(1000);
  });

  it("paginates after filtering, so total is the filtered count", async () => {
    mockGetAllJobs.mockResolvedValue([
      makeJob({ id: "de-1", locationCode: "de" }),
      makeJob({ id: "at-1", locationCode: "at" }),
      makeJob({ id: "de-2", locationCode: "de" }),
    ]);

    const body = (await (
      await jobsGET(makeJobsRequest("?location=de&page=2&pageSize=1"))
    ).json()) as any;
    expect(body.items.map((j: Job) => j.id)).toEqual(["de-2"]);
    expect(body.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/match — request body validation", () => {
  it("rejects a literal null JSON body with 400 instead of throwing", async () => {
    const res = await matchPOST(makeRawMatchRequest("null"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; usage: string };
    expect(body.error).toBe("Invalid JSON body");
    expect(body.usage).toContain("POST /api/match");
    expect(mockGetAllJobs).not.toHaveBeenCalled();
  });

  it("rejects a JSON array body with 400", async () => {
    const res = await matchPOST(makeRawMatchRequest("[1,2,3]"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid JSON body");
    expect(mockGetAllJobs).not.toHaveBeenCalled();
  });

  it("rejects an empty array body with 400", async () => {
    const res = await matchPOST(makeRawMatchRequest("[]"));
    expect(res.status).toBe(400);
    expect(mockGetAllJobs).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/match — focus_area alias resolution", () => {
  beforeEach(() => {
    mockGetAllJobs.mockResolvedValue([makeJob({ id: "ai-1" })]);
  });

  it("falls back to ai_ml for focus_area 'toString' (no prototype leak)", async () => {
    const res = await matchPOST(matchRequestBody({ focus_area: "toString" }));
    expect(res.status).toBe(200);

    const candidate = capturedCandidates()[0];
    expect(candidate.focus_area).toBe("ai_ml");
    // A leaked prototype member would be a function, not a FocusArea string.
    expect(typeof candidate.focus_area).toBe("string");
  });

  it("falls back to ai_ml for focus_area 'constructor'", async () => {
    await matchPOST(matchRequestBody({ focus_area: "constructor" }));
    expect(capturedCandidates()[0].focus_area).toBe("ai_ml");
  });

  it("falls back to ai_ml for focus_area '__proto__'", async () => {
    await matchPOST(matchRequestBody({ focus_area: "__proto__" }));
    expect(capturedCandidates()[0].focus_area).toBe("ai_ml");
  });

  it("resolves real aliases and unknown values (control)", async () => {
    await matchPOST(matchRequestBody({ focus_area: "robotics" }));
    expect(capturedCandidates()[0].focus_area).toBe("robotics");

    mockComputeMatchScore.mockClear();
    await matchPOST(matchRequestBody({ focus_area: "quantum-computing" }));
    expect(capturedCandidates()[0].focus_area).toBe("ai_ml");
  });

  it("resolves a prototype-leaking focus_area to ai_ml, so it matches the ai job and excludes a non-ai job", async () => {
    // Observable effect of the hasOwn guard: "toString" resolves to "ai_ml",
    // which matches the ai job, passes the hard filters, and scores > 0.
    //
    // NOTE the hsk_level: 6 below. `makeJob` has languageLevel "required",
    // which `adaptJob` now turns into a real `zh: HSK4` requirement, so a
    // candidate with no HSK is rejected by the LANGUAGE filter and scores 0
    // for an unrelated reason. That masked this test entirely: it returned 0
    // with the guard and 0 without it, so it could not tell a working
    // prototype fix from a broken one. Declaring an HSK removes the
    // confounder so the score reflects the focus-area decision alone.
    // Do not drop it — see the revert check in the round-12 notes.
    mockGetAllJobs.mockResolvedValue([
      makeJob({ id: "ai-1" }),
      makeJob({ id: "robotics-1", field: "robotics", tags: ["ROS"] }),
    ]);

    const res = await matchPOST(
      matchRequestBody({ focus_area: "toString", desired_location: "Berlin", hsk_level: 6 }),
    );
    const results = (await res.json()) as Array<{ jobId: string; score: number }>;

    // Sorted by score descending: the resolved ai_ml job wins.
    expect(results[0].jobId).toBe("ai-1");
    expect(results[0].score).toBeGreaterThan(0);

    // Stronger than a bare > 0: the leaked value must resolve to a REAL focus
    // area, not merely to something non-empty. It matches the ai job and
    // excludes the robotics job, so it cannot be a wildcard that passes every
    // hard filter regardless of the job's field.
    const robotics = results.find((r) => r.jobId === "robotics-1");
    expect(robotics?.score).toBe(0);
    expect(results[0].score).toBeGreaterThan(robotics!.score);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/match — languages coercion", () => {
  beforeEach(() => {
    mockGetAllJobs.mockResolvedValue([makeJob({ id: "ai-1" })]);
  });

  it("ignores an array languages value instead of passing it to computeMatchScore", async () => {
    const res = await matchPOST(matchRequestBody({ languages: [] }));
    expect(res.status).toBe(200);

    const candidate = capturedCandidates()[0];
    expect(Array.isArray(candidate.languages)).toBe(false);
    expect(candidate.languages).toEqual({});
  });

  it("ignores a non-empty array languages value", async () => {
    await matchPOST(matchRequestBody({ languages: ["en", "de"] }));
    const candidate = capturedCandidates()[0];
    expect(Array.isArray(candidate.languages)).toBe(false);
    expect(candidate.languages).toEqual({});
  });

  it("ignores non-object languages values (string, number, null)", async () => {
    for (const languages of ["en", 7, null]) {
      mockComputeMatchScore.mockClear();
      await matchPOST(matchRequestBody({ languages }));
      const candidate = capturedCandidates()[0];
      expect(Array.isArray(candidate.languages)).toBe(false);
      expect(candidate.languages).toEqual({});
    }
  });

  it("preserves a valid languages object (control)", async () => {
    await matchPOST(matchRequestBody({ languages: { en: "C1", de: "B2" } }));
    const candidate = capturedCandidates()[0];
    expect(candidate.languages).toEqual({ en: "C1", de: "B2" });
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/match — session-scoped persistence", () => {
  beforeEach(() => {
    mockGetAllJobs.mockResolvedValue([makeJob({ id: "ai-1", tags: ["NLP", "CV"] })]);
  });

  it("anonymous POST returns scores but issues NO match_scores write", async () => {
    const { admin, from } = makeAdminMock({ data: [] });
    mockGetSupabaseAdmin.mockReturnValue(admin);
    mockGetCurrentUser.mockResolvedValue(null);

    const res = await matchPOST(
      matchRequestBody({ ...HIGH_SCORE_CANDIDATE, id: "attacker-supplied-id" }),
    );
    expect(res.status).toBe(200);
    const results = (await res.json()) as Array<{ jobId: string; score: number }>;
    // Proves the batch was strong enough to be persisted had a session existed.
    expect(results[0].score).toBeGreaterThanOrEqual(70);

    expect(mockGetCurrentUser).toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the session user id, not the body candidate id, when persisting", async () => {
    const { admin, from, calls } = makeAdminMock({ data: [{ candidate_id: "session-user" }] });
    mockGetSupabaseAdmin.mockReturnValue(admin);
    mockGetCurrentUser.mockResolvedValue({ id: "session-user" } as any);

    const res = await matchPOST(
      matchRequestBody({ ...HIGH_SCORE_CANDIDATE, id: "attacker-supplied-id" }),
    );
    expect(res.status).toBe(200);

    expect(from).toHaveBeenCalledWith("match_scores");
    const rows = calls.find((c) => c.upsertRows)?.upsertRows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate_id).toBe("session-user");
    expect(rows[0].candidate_id).not.toBe("attacker-supplied-id");
  });

  it("treats a getCurrentUser throw (Supabase unconfigured) as anonymous", async () => {
    const { admin, from } = makeAdminMock({ data: [] });
    mockGetSupabaseAdmin.mockReturnValue(admin);
    mockGetCurrentUser.mockRejectedValue(new Error("Missing Supabase URL"));

    const res = await matchPOST(
      matchRequestBody({ ...HIGH_SCORE_CANDIDATE, id: "attacker-supplied-id" }),
    );
    expect(res.status).toBe(200);
    expect(from).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("saveMatchScores — non-finite score filtering", () => {
  it("persists finite rows and drops a NaN score instead of aborting the batch", async () => {
    const { admin, calls } = makeAdminMock({
      data: [
        { candidate_id: "c1", job_posting_id: "job-a" },
        { candidate_id: "c1", job_posting_id: "job-c" },
      ],
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const result = await saveMatchScores([
      { candidate_id: "c1", job_id: "job-a", score: 90, reasons: ["ok"] },
      { candidate_id: "c1", job_id: "job-b", score: Number.NaN, reasons: ["bad"] },
      { candidate_id: "c1", job_id: "job-c", score: 71.4, reasons: ["ok"] },
    ]);

    expect(result).toEqual({ saved: 2 });
    const rows = calls[0].upsertRows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.job_posting_id)).toEqual(["job-a", "job-c"]);
    expect(rows.every((r) => typeof r.score === "number" && Number.isFinite(r.score))).toBe(true);
    // Scores stay integers inside the INT column range.
    expect(rows[0].score).toBe(90);
    expect(rows[1].score).toBe(71);
    expect(calls[0].upsertOptions).toEqual({ onConflict: "candidate_id,job_posting_id" });
  });

  it("drops Infinity and -Infinity rows too", async () => {
    const { admin, calls } = makeAdminMock({ data: [{ candidate_id: "c1" }] });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    await saveMatchScores([
      { candidate_id: "c1", job_id: "job-inf", score: Number.POSITIVE_INFINITY, reasons: [] },
      { candidate_id: "c1", job_id: "job-ninf", score: Number.NEGATIVE_INFINITY, reasons: [] },
      { candidate_id: "c1", job_id: "job-ok", score: 80, reasons: [] },
    ]);

    const rows = calls[0].upsertRows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.job_posting_id)).toEqual(["job-ok"]);
  });

  it("returns saved 0 and issues no upsert when every score is non-finite", async () => {
    const { admin, from } = makeAdminMock({ data: [] });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const result = await saveMatchScores([
      { candidate_id: "c1", job_id: "job-a", score: Number.NaN, reasons: [] },
      { candidate_id: "c1", job_id: "job-b", score: Number.NaN, reasons: [] },
    ]);

    expect(result).toEqual({ saved: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it("clamps out-of-range finite scores into 0..100", async () => {
    const { admin, calls } = makeAdminMock({ data: [] });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    await saveMatchScores([
      { candidate_id: "c1", job_id: "high", score: 250, reasons: [] },
      { candidate_id: "c1", job_id: "low", score: -20, reasons: [] },
    ]);

    const rows = calls[0].upsertRows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.score)).toEqual([100, 0]);
  });
});

// ---------------------------------------------------------------------------
describe("getTopMatches — row filtering", () => {
  it("drops rows with a null job_posting_id instead of returning 'null'", async () => {
    const { admin } = makeAdminMock({
      data: [
        { job_posting_id: "job-a", score: 95, match_reasons: ["great"] },
        { job_posting_id: null, score: 90, match_reasons: ["orphan"] },
        { job_posting_id: "job-b", score: 80, match_reasons: null },
      ],
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const matches = await getTopMatches("c1");
    expect(matches.map((m) => m.job_id)).toEqual(["job-a", "job-b"]);
    expect(matches.every((m) => m.job_id !== "null" && m.job_id !== "undefined")).toBe(true);
    expect(matches[1].reasons).toEqual([]);
  });

  it("drops rows whose score is not numeric / non-finite", async () => {
    const { admin } = makeAdminMock({
      data: [
        { job_posting_id: "job-a", score: 95, match_reasons: ["ok"] },
        { job_posting_id: "job-bad", score: "not-a-number", match_reasons: [] },
        { job_posting_id: "job-missing", score: undefined, match_reasons: [] },
        { job_posting_id: "job-c", score: 0, match_reasons: [] },
      ],
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const matches = await getTopMatches("c1");
    expect(matches.map((m) => m.job_id)).toEqual(["job-a", "job-c"]);
    expect(matches.every((m) => Number.isFinite(m.score))).toBe(true);
  });

  it("returns [] (not a throw) when the match_scores table is missing", async () => {
    const { admin } = makeAdminMock({
      data: null,
      error: { code: "42P01", message: 'relation "match_scores" does not exist' },
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    await expect(getTopMatches("c1")).resolves.toEqual([]);
  });
});
