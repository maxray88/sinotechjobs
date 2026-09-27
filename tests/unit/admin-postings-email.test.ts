/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(), getProfileRole: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getSupabaseAdmin: vi.fn() }));
// Real isValidRecipient: the behaviour under test is the iteration over
// candidates, not a second copy of the address regex.
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: vi.fn(async () => {}) };
});

import { POST as adminPostingsPOST } from "@/app/api/admin/postings/route";
import { getCurrentUser, getProfileRole } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { sendEmail } from "@/lib/email";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetProfileRole = vi.mocked(getProfileRole);
const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);
const mockSendEmail = vi.mocked(sendEmail);

/**
 * Chainable Supabase builder, thenable so `await supabase.from(..).insert(..)` works.
 *
 * `updateData` controls what `.update().eq().select()` resolves to. The real
 * supabase-js client ALWAYS resolves an array there — `[]` when the guard
 * matched no rows, `[{...}]` when it did — so this mock must never hand back a
 * data-less `{ error: null }`, which is a shape the real client cannot produce.
 * The default is the claimed-row shape; pass `updateData: []` to simulate a
 * lost race, and `updateData: null` to simulate the pathological data-less
 * payload that the old fail-open guard silently allowed through.
 */
function makeAdminMock(
  posting: Record<string, unknown> | null,
  opts: { updateData?: unknown[] | null } = {}
) {
  const calls: { table: string; op: string; arg?: unknown }[] = [];
  const getUserById = vi.fn(async () => ({ data: { user: null }, error: null }));
  const updateResult: { data?: unknown; error?: unknown } =
    opts.updateData === null
      ? { error: null }
      : { data: opts.updateData ?? (posting ? [{ id: posting.id }] : []), error: null };

  const from = vi.fn((table: string) => {
    const rec: { table: string; op: string; arg?: unknown } = { table, op: "" };
    let result: { data?: unknown; error?: unknown } = { error: null };
    let op: string | null = null;
    const builder: any = {};
    builder.select = vi.fn(() => {
      rec.op = "select";
      // Only `.update().select()` returns the rows the UPDATE touched; a
      // select on its own is just the fetch that `.single()` resolves.
      if (op === "update") result = updateResult;
      return builder;
    });
    builder.insert = vi.fn((arg: unknown) => {
      rec.op = op = "insert";
      rec.arg = arg;
      return builder;
    });
    builder.update = vi.fn((arg: unknown) => {
      rec.op = op = "update";
      rec.arg = arg;
      return builder;
    });
    builder.eq = vi.fn(() => builder);
    builder.single = vi.fn(() => {
      rec.op = "single";
      result = posting
        ? { data: posting, error: null }
        : { data: null, error: { code: "PGRST116" } };
      return Promise.resolve(result);
    });
    builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onF, onR);
    calls.push(rec);
    return builder;
  });

  return { admin: { from, auth: { admin: { getUserById } } }, from, calls, getUserById };
}

function makePosting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    status: "pending",
    // Null by default so the posting-column chain is what gets exercised.
    user_id: null,
    job_title: "AI Engineer",
    company: "Bosch",
    field: "ai",
    location: "Berlin",
    description: "Build production models",
    requirements: null,
    application_url: "https://example.com/apply/42",
    tier: "free",
    ...overrides,
  };
}

function postRequest(body: Record<string, unknown>): Parameters<typeof adminPostingsPOST>[0] {
  return new Request("http://localhost:3000/api/admin/postings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof adminPostingsPOST>[0];
}

function recipients(): unknown[] {
  return mockSendEmail.mock.calls.map((call) => call[0].to);
}

async function run(
  posting: Record<string, unknown> | null,
  body: Record<string, unknown> = { id: 42, action: "approve" },
  opts: { updateData?: unknown[] } = {}
): Promise<Response> {
  const mock = makeAdminMock(posting, opts);
  mockGetSupabaseAdmin.mockReturnValue(mock.admin as any);
  return adminPostingsPOST(postRequest(body));
}

describe("POST /api/admin/postings — email candidate chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ id: "admin-1" } as any);
    mockGetProfileRole.mockResolvedValue("admin");
    mockSendEmail.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips a present-but-invalid first candidate and uses the valid one", async () => {
    const res = await run(makePosting({ contact_email: "n/a", email: "real@example.com" }));

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["real@example.com"]);
  });

  it("skips an undefined first candidate and uses the valid one", async () => {
    const res = await run(makePosting({ contact_email: undefined, email: "a@b.de" }));

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["a@b.de"]);
  });

  it("treats a null first candidate as absent and falls through", async () => {
    const res = await run(
      makePosting({ contact_email: null, applicant_email: "third@example.com" })
    );

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["third@example.com"]);
  });

  it("reaches the third candidate when both earlier ones are invalid", async () => {
    const res = await run(
      makePosting({
        contact_email: "n/a",
        email: "also n/a",
        applicant_email: "third@example.com",
      })
    );

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["third@example.com"]);
  });

  it("prefers the first candidate when several are valid", async () => {
    const res = await run(
      makePosting({ contact_email: "first@example.com", email: "second@example.com" })
    );

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["first@example.com"]);
  });

  it("sends nothing when every candidate is invalid", async () => {
    const res = await run(
      makePosting({ contact_email: "bad", email: "also bad", applicant_email: "worse" })
    );

    // Approval still succeeds; only the notification is dropped.
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when the posting carries no email field at all", async () => {
    const res = await run(makePosting());

    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("treats a blank candidate as absent rather than as a recipient", async () => {
    const res = await run(makePosting({ contact_email: "   ", email: "real@example.com" }));

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["real@example.com"]);
  });

  it("refuses a CRLF-injected candidate and still notifies the valid one", async () => {
    const res = await run(
      makePosting({
        contact_email: "a@b.c\r\nBcc: victim@x.y",
        email: "safe@example.com",
      })
    );

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["safe@example.com"]);
    // The rejected candidate is logged: a silent drop would look like success.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("contact_email"));
  });

  it("names the posting id in the rejection log", async () => {
    await run(makePosting({ id: 42, contact_email: "n/a", email: "real@example.com" }));

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("42"));
  });

  it("applies the same candidate chain on the rejection path", async () => {
    const res = await run(
      makePosting({ contact_email: "n/a", email: "real@example.com" }),
      { id: 42, action: "reject", reason: "Not enough detail on the role" }
    );

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["real@example.com"]);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].template).toBe("posting_rejected");
  });

  it("prefers the account email over the posting columns when one is present", async () => {
    const mock = makeAdminMock(
      makePosting({ user_id: "user-9", contact_email: "posting@example.com" })
    );
    mock.getUserById.mockResolvedValue({
      data: { user: { email: "account@example.com" } },
      error: null,
    } as any);
    mockGetSupabaseAdmin.mockReturnValue(mock.admin as any);

    const res = await adminPostingsPOST(postRequest({ id: 42, action: "approve" }));

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["account@example.com"]);
  });

  it("falls back to the posting columns when the account lookup yields no email", async () => {
    const mock = makeAdminMock(
      makePosting({ user_id: "user-9", contact_email: "n/a", email: "posting@example.com" })
    );
    mock.getUserById.mockResolvedValue({
      data: { user: { email: null } },
      error: null,
    } as any);
    mockGetSupabaseAdmin.mockReturnValue(mock.admin as any);

    const res = await adminPostingsPOST(postRequest({ id: 42, action: "approve" }));

    expect(res.status).toBe(200);
    expect(recipients()).toEqual(["posting@example.com"]);
  });

  it("still publishes the job and returns 200 even when no recipient is found", async () => {
    const res = await run(makePosting({ contact_email: "n/a" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, jobId: "manual-42" });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/postings — atomic claim guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ id: "admin-1" } as any);
    mockGetProfileRole.mockResolvedValue("admin");
    mockSendEmail.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression pin for the fail-open guard. `Array.isArray(claimed) &&
  // claimed.length === 0` only trips on a present-but-empty array, so any
  // absent/null payload fell through and a posting another admin had already
  // reviewed was published to `jobs` anyway.
  it("rejects with 409 and does not publish when the guarded update claims zero rows", async () => {
    const mock = makeAdminMock(makePosting(), { updateData: [] });
    mockGetSupabaseAdmin.mockReturnValue(mock.admin as any);

    const res = await adminPostingsPOST(postRequest({ id: 42, action: "approve" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict: already reviewed", ok: false });
    // The whole point: an already-reviewed posting must never reach `jobs`.
    expect(mock.calls.some((c) => c.table === "jobs" && c.op === "insert")).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rejects with 409 on the reject path when the guarded update claims zero rows", async () => {
    const mock = makeAdminMock(makePosting(), { updateData: [] });
    mockGetSupabaseAdmin.mockReturnValue(mock.admin as any);

    const res = await adminPostingsPOST(
      postRequest({ id: 42, action: "reject", reason: "Not enough detail on the role" })
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict: already reviewed", ok: false });
    // A reject must not overwrite an approve that already went live.
    expect(mock.calls.some((c) => c.table === "jobs")).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still publishes when the guarded update claims exactly one row", async () => {
    const res = await run(makePosting(), { id: 42, action: "approve" }, { updateData: [{ id: 42 }] });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, jobId: "manual-42" });
  });

  // The half of the fix the `[]` case above cannot catch: `Array.isArray(...)`
  // is false for a data-less payload, so the old guard fell straight through
  // and published an unproven claim. This is the test that fails against it.
  it("fails closed when the guarded update returns no payload at all", async () => {
    const mock = makeAdminMock(makePosting(), { updateData: null });
    mockGetSupabaseAdmin.mockReturnValue(mock.admin as any);

    const res = await adminPostingsPOST(postRequest({ id: 42, action: "approve" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict: already reviewed", ok: false });
    expect(mock.calls.some((c) => c.table === "jobs" && c.op === "insert")).toBe(false);
  });
});
