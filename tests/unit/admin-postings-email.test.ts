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

/** Chainable Supabase builder, thenable so `await supabase.from(..).insert(..)` works. */
function makeAdminMock(posting: Record<string, unknown> | null) {
  const calls: { table: string; op: string; arg?: unknown }[] = [];
  const getUserById = vi.fn(async () => ({ data: { user: null }, error: null }));

  const from = vi.fn((table: string) => {
    const rec: { table: string; op: string; arg?: unknown } = { table, op: "" };
    let result: { data?: unknown; error?: unknown } = { error: null };
    const builder: any = {};
    builder.select = vi.fn(() => {
      rec.op = "select";
      return builder;
    });
    builder.insert = vi.fn((arg: unknown) => {
      rec.op = "insert";
      rec.arg = arg;
      return builder;
    });
    builder.update = vi.fn((arg: unknown) => {
      rec.op = "update";
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
  body: Record<string, unknown> = { id: 42, action: "approve" }
): Promise<Response> {
  const mock = makeAdminMock(posting);
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
