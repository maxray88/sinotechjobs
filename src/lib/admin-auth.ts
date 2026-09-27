// Client-safe helpers for the /admin scraper dashboard.
// The secret is never baked into the bundle: the operator pastes it at runtime
// and it is kept in localStorage, then replayed as `Authorization: Bearer ...`.
// Intentionally no `server-only` import and no server module dependencies.

export const ADMIN_SECRET_STORAGE_KEY = "sinotechjobs:admin-secret";

export function getAdminSecret(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(ADMIN_SECRET_STORAGE_KEY);
    if (stored === null) return null;
    const trimmed = stored.trim();
    if (!trimmed) return null;
    // A hand-edited value can carry CR/LF or other control characters. Such a
    // value makes `new Headers({ Authorization: ... })` throw a TypeError,
    // which would fail every admin fetch at the construction site, so it is
    // rejected here instead.
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
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
  if (!trimmed) return false;
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
