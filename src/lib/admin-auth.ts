// Client-safe helpers for the /admin scraper dashboard.
// The secret is never baked into the bundle: the operator pastes it at runtime
// and it is kept in localStorage, then replayed as `Authorization: Bearer ...`.
// Intentionally no `server-only` import and no server module dependencies.

export const ADMIN_SECRET_STORAGE_KEY = "sinotechjobs:admin-secret";

export function getAdminSecret(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ADMIN_SECRET_STORAGE_KEY);
  } catch {
    // Private mode / disabled storage — treat as "no secret".
    return null;
  }
}

export function setAdminSecret(secret: string): void {
  const trimmed = (secret ?? "").trim();
  if (!trimmed) return;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_SECRET_STORAGE_KEY, trimmed);
  } catch {
    // Never throw from a storage write — a failed save must not break the UI.
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
