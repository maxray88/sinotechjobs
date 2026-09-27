// Client-safe helpers for the /admin scraper dashboard.
// The secret is never baked into the bundle: the operator pastes it at runtime
// and it is kept in localStorage, then replayed as `Authorization: Bearer ...`.
// Intentionally no `server-only` import and no server module dependencies.

export const ADMIN_SECRET_STORAGE_KEY = "sinotechjobs:admin-secret";

/**
 * Single source of truth for "is this secret usable".
 *
 * The value is replayed as `new Headers({ Authorization: \`Bearer ${secret}\` })`,
 * and that constructor requires a ByteString value. Any code point outside
 * printable ASCII — C0/C1 control characters (CR, LF, NUL, …), DEL, and every
 * non-ASCII character such as a CJK ideograph or an emoji — makes it throw a
 * TypeError, which would fail every admin fetch at the construction site rather
 * than at the point of saving. Rejecting the whole non-ASCII range in one rule
 * covers all of those cases.
 *
 * getAdminSecret and setAdminSecret MUST both call this. They used to drift:
 * the read path rejected control characters while the write path only checked
 * for emptiness, so a "successful" save could persist a secret that
 * buildAuthHeaders() then refused to put in a header — the dashboard fired
 * unauthenticated fetches and re-prompted in a loop.
 */
export function isValidAdminSecret(value: string): boolean {
  return value.length > 0 && !/[^\x20-\x7e]/.test(value);
}

export function getAdminSecret(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(ADMIN_SECRET_STORAGE_KEY);
    if (stored === null) return null;
    const trimmed = stored.trim();
    // A hand-edited or previously-persisted value can carry CR/LF, other
    // control characters, or non-ASCII text. See isValidAdminSecret.
    if (!isValidAdminSecret(trimmed)) return null;
    return trimmed;
  } catch {
    // Private mode / disabled storage — treat as "no secret".
    return null;
  }
}

/**
 * Persist the operator's secret. Returns false when nothing was written, so
 * callers can surface a real error instead of retrying an unauthenticated
 * fetch and silently re-prompting in a loop.
 */
export function setAdminSecret(secret: string): boolean {
  const trimmed = (secret ?? "").trim();
  // Same predicate as the read path, so a secret can never be reported as
  // saved and then be unusable at the fetch site. Rejecting here is what makes
  // the false return meaningful: callers surface a real error instead of
  // retrying an unauthenticated fetch.
  if (!isValidAdminSecret(trimmed)) return false;
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(ADMIN_SECRET_STORAGE_KEY, trimmed);
    return true;
  } catch {
    // Never throw from a storage write — a failed save must not break the UI.
    // The false return is the signal that the secret was not persisted.
    return false;
  }
}

export function clearAdminSecret(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function buildAuthHeaders(): Record<string, string> {
  const secret = getAdminSecret();
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}
