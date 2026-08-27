// NOTE: In-memory sliding window — Vercel serverless may have per-instance store (not distributed).
// For production at scale, upgrade to a distributed store such as Upstash Redis or similar.

const store = new Map<string, number[]>(); // ip -> timestamps

export function checkRateLimit(
  ip: string,
  limit = 10,
  windowMs = 60_000
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const timestamps = (store.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    const retryAfterMs = timestamps[0] + windowMs - now;
    // persist cleaned window so expired entries don't accumulate
    store.set(ip, timestamps);
    return { allowed: false, retryAfterMs };
  }
  store.set(ip, timestamps.concat(now));
  return { allowed: true };
}

export function getClientIp(req: Request): string {
  try {
    return (
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export function __resetRateLimitStore(): void {
  store.clear();
}
