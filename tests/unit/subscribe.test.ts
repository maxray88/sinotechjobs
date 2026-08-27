import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only to prevent throw in node/test env
vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/email-repo", () => ({
  subscribeEmail: vi.fn(),
}));

// Import after mocks
import { POST } from "@/app/api/subscribe/route";
import { subscribeEmail } from "@/lib/db/email-repo";

const mockSubscribeEmail = vi.mocked(subscribeEmail);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/subscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valid email → 200 with ok true and duplicate false", async () => {
    mockSubscribeEmail.mockResolvedValueOnce({ email: "valid@example.com", created: true });

    const req = makeRequest({ email: "valid@example.com", language: "en" });
    const res = await POST(req);
    const data = (await res.json()) as { ok: boolean; email: string; duplicate: boolean };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.email).toBe("valid@example.com");
    expect(data.duplicate).toBe(false);
    expect(mockSubscribeEmail).toHaveBeenCalledWith("valid@example.com", "en");
  });

  it("duplicate email → 200 with duplicate true", async () => {
    mockSubscribeEmail.mockResolvedValueOnce({ email: "dup@example.com", created: false });

    const req = makeRequest({ email: "dup@example.com" });
    const res = await POST(req);
    const data = (await res.json()) as { ok: boolean; email: string; duplicate: boolean };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.duplicate).toBe(true);
    expect(data.email).toBe("dup@example.com");
  });

  it("invalid email → 400", async () => {
    const req = makeRequest({ email: "not-an-email" });
    const res = await POST(req);
    const data = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid email");
    expect(mockSubscribeEmail).not.toHaveBeenCalled();
  });

  it("missing email → 400", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    const data = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid email");
    expect(mockSubscribeEmail).not.toHaveBeenCalled();
  });

  it("case-insensitive duplicate: Test@Example.com twice → second duplicate", async () => {
    mockSubscribeEmail
      .mockResolvedValueOnce({ email: "test@example.com", created: true })
      .mockResolvedValueOnce({ email: "test@example.com", created: false });

    const req1 = makeRequest({ email: "Test@Example.com" });
    const res1 = await POST(req1);
    const data1 = (await res1.json()) as { ok: boolean; duplicate: boolean; email: string };

    expect(res1.status).toBe(200);
    expect(data1.duplicate).toBe(false);
    expect(data1.email).toBe("test@example.com");
    expect(mockSubscribeEmail).toHaveBeenCalledWith("test@example.com", "en");

    const req2 = makeRequest({ email: "TEST@EXAMPLE.COM" });
    const res2 = await POST(req2);
    const data2 = (await res2.json()) as { ok: boolean; duplicate: boolean; email: string };

    expect(res2.status).toBe(200);
    expect(data2.duplicate).toBe(true);
    expect(data2.email).toBe("test@example.com");
    expect(mockSubscribeEmail).toHaveBeenNthCalledWith(2, "test@example.com", "en");
  });

  it("trims and lowercases email before calling subscribeEmail", async () => {
    mockSubscribeEmail.mockResolvedValueOnce({ email: "spaced@example.com", created: true });

    const req = makeRequest({ email: "  Spaced@Example.COM  " });
    const res = await POST(req);
    const data = (await res.json()) as { email: string };

    expect(res.status).toBe(200);
    expect(data.email).toBe("spaced@example.com");
    expect(mockSubscribeEmail).toHaveBeenCalledWith("spaced@example.com", "en");
  });

  it("returns 500 when subscribeEmail throws", async () => {
    mockSubscribeEmail.mockRejectedValueOnce(new Error("db failure"));

    const req = makeRequest({ email: "error@example.com" });
    const res = await POST(req);
    const data = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(data.error).toBe("Internal error");
  });
});
