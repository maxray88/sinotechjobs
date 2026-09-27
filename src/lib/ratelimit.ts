// NOTE: In-memory sliding window — Vercel serverless may have per-instance store (not distributed).
// For production at scale, upgrade to a distributed store such as Upstash Redis or similar.

const store = new Map<string, number[]>(); // ip -> timestamps

// Hard ceiling on tracked keys. The key is the client IP, which is
// attacker-controlled via x-forwarded-for, so without a cap a single client
// rotating header values grows this Map without bound for the lifetime of a
// long-lived instance — a slow memory leak.
const MAX_TRACKED_KEYS = 10_000;

// Pruning is garbage collection, not correctness: the per-key filter below is
// always exact. So the store-wide sweep is amortised rather than run on every
// request — a full O(n) walk per request is real work on a public endpoint.
// A sweep is forced immediately if the store is over the key cap, since that
// is the case where memory actually matters.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

// Distinct misconfigured limits already reported, so a broken env var does not
// turn into one console.error per request. Bounded, and the oldest entry is
// dropped rather than growing without limit.
const warnedBadLimits = new Set<string>();
const MAX_WARNED_LIMITS = 10;

function warnBadLimit(limit: number): void {
  const key = String(limit);
  if (warnedBadLimits.has(key)) return;
  if (warnedBadLimits.size >= MAX_WARNED_LIMITS) {
    const oldest = warnedBadLimits.values().next();
    if (!oldest.done) warnedBadLimits.delete(oldest.value);
  }
  warnedBadLimits.add(key);
  console.error(
    `[ratelimit] non-positive or non-finite limit (${key}) — rate limiting is DISABLED for this call. ` +
      "Fix the configured limit; this is a fail-open on a misconfiguration, not an intentional setting.",
  );
}

// Drop keys whose most recent hit has fallen out of the window. Without this,
// a key seen exactly once is never revisited and never removed.
function sweep(now: number, windowMs: number): void {
  lastSweepAt = now;
  for (const [key, timestamps] of store) {
    const newest = timestamps[timestamps.length - 1];
    if (newest === undefined || now - newest >= windowMs) {
      store.delete(key);
    }
  }
}

// Re-insert so that Map iteration order is least-recently-used first: Map.set
// on an existing key does NOT move it, so we delete first. That makes
// eviction an O(1) `keys().next()` instead of a scan for the oldest key.
function touch(key: string, timestamps: number[]): void {
  store.delete(key);
  store.set(key, timestamps);
  while (store.size > MAX_TRACKED_KEYS) {
    const lru = store.keys().next();
    if (lru.done) break;
    store.delete(lru.value);
  }
}

export function checkRateLimit(
  ip: string,
  limit = 10,
  windowMs = 60_000
): { allowed: boolean; retryAfterMs?: number } {
  // A limit of 0 (reachable from a misconfigured env var) made
  // `timestamps.length >= limit` true on an EMPTY array, so timestamps[0] was
  // undefined, retryAfterMs was NaN, and no timestamp was ever recorded — the
  // key could never grow, so the caller was locked out permanently with a
  // `Retry-After: NaN` header.
  //
  // Choice: fail OPEN, loudly. A non-positive/non-finite limit cannot mean
  // "block everyone", and it must not throw either — throwing would turn a
  // config typo into a 500 on every rate-limited route, which locks users out
  // just as hard. Allowing the request keeps the site serving; the
  // console.error is what makes the misconfiguration visible instead of
  // silent. Fail-closed belongs on auth and payments, not on a limiter.
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    warnBadLimit(limit);
    return { allowed: true };
  }

  const now = Date.now();

  if (store.size > MAX_TRACKED_KEYS || now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    sweep(now, windowMs);
  }

  const timestamps = (store.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    // No recorded timestamp means there is nothing left to wait for — the
    // window has already expired. 0 is the honest answer; NaN would serialise
    // as `Retry-After: NaN`.
    const oldest = timestamps[0];
    const retryAfterMs = oldest === undefined ? 0 : Math.max(0, oldest + windowMs - now);
    // persist cleaned window so expired entries don't accumulate
    touch(ip, timestamps);
    return { allowed: false, retryAfterMs };
  }
  touch(ip, timestamps.concat(now));
  return { allowed: true };
}

export function getClientIp(req: Request): string {
  // Reading the FIRST hop of x-forwarded-for is correct behind Vercel, which
  // appends to the header — do not "fix" this to take the last hop. The
  // attacker-controlled key space is handled by MAX_TRACKED_KEYS above, not by
  // changing how the header is read.
  //
  // The "unknown" fallback is deliberately SHARED, not randomised per request.
  // A per-request random key would be fail-OPEN: each headerless request would
  // land in a brand-new bucket and get a full fresh allowance, so any client
  // able to omit the headers would be effectively unlimited. A shared bucket is
  // fail-closed — it under-permits rather than over-permits. It is also
  // unreachable on Vercel, which sets x-forwarded-for on every request; it only
  // occurs when there is no proxy at all (local dev, direct-to-node), where
  // collapsing those callers onto one bucket is the conservative choice.
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
  lastSweepAt = 0;
  warnedBadLimits.clear();
}
