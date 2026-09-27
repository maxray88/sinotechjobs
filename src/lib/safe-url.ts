/** Validate an externally-ingested URL before it is used as an href. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}
