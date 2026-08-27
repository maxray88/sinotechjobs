import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, getClientIp, __resetRateLimitStore } from "@/lib/ratelimit";

describe("ratelimit", () => {
  beforeEach(() => {
    __resetRateLimitStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("10 requests allowed, 11th blocked", () => {
    const ip = "1.1.1.1";
    for (let i = 0; i < 10; i++) {
      const res = checkRateLimit(ip, 10, 60_000);
      expect(res.allowed).toBe(true);
      expect(res.retryAfterMs).toBeUndefined();
    }
    const blocked = checkRateLimit(ip, 10, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeDefined();
  });

  it("window expiry allows again", () => {
    const ip = "2.2.2.2";
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, 10, 60_000);
    }
    const blocked = checkRateLimit(ip, 10, 60_000);
    expect(blocked.allowed).toBe(false);

    // advance past window
    vi.advanceTimersByTime(60_001);

    const after = checkRateLimit(ip, 10, 60_000);
    expect(after.allowed).toBe(true);
  });

  it("different IPs isolated", () => {
    const ipA = "10.0.0.1";
    const ipB = "10.0.0.2";
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ipA, 10, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit(ipA, 10, 60_000).allowed).toBe(false);
    // ipB should still be allowed
    expect(checkRateLimit(ipB, 10, 60_000).allowed).toBe(true);
  });

  it("retryAfterMs positive", () => {
    const ip = "3.3.3.3";
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, 10, 60_000);
    }
    const blocked = checkRateLimit(ip, 10, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("getClientIp parses x-forwarded-for", () => {
    const req1 = new Request("http://localhost", {
      headers: { "x-forwarded-for": "5.6.7.8, 9.10.11.12" },
    });
    expect(getClientIp(req1)).toBe("5.6.7.8");

    const req2 = new Request("http://localhost", {
      headers: { "x-forwarded-for": "  1.2.3.4  " },
    });
    expect(getClientIp(req2)).toBe("1.2.3.4");

    const req3 = new Request("http://localhost", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req3)).toBe("9.9.9.9");

    const req4 = new Request("http://localhost");
    expect(getClientIp(req4)).toBe("unknown");

    // x-forwarded-for takes precedence over x-real-ip
    const req5 = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" },
    });
    expect(getClientIp(req5)).toBe("1.1.1.1");
  });

  it("cleans expired timestamps with sliding window", () => {
    const ip = "4.4.4.4";
    // 5 requests at T=0
    for (let i = 0; i < 5; i++) checkRateLimit(ip, 10, 60_000);
    // advance 30s, add 5 more (total 10 in window)
    vi.advanceTimersByTime(30_000);
    for (let i = 0; i < 5; i++) checkRateLimit(ip, 10, 60_000);
    expect(checkRateLimit(ip, 10, 60_000).allowed).toBe(false);
    // advance another 31s — first 5 should have expired, so 5 slots free
    vi.advanceTimersByTime(31_000);
    expect(checkRateLimit(ip, 10, 60_000).allowed).toBe(true);
  });
});
