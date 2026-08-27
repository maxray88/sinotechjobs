declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props?: Record<string, string | number | boolean> }
    ) => void;
  }
}

/**
 * Track a Plausible custom event.
 * No-op if Plausible is not loaded (e.g. script blocked, env disabled, or SSR).
 *
 * @param event - event name, e.g. "Job Apply Click"
 * @param props - optional custom props forwarded as plausible props
 */
export function track(
  event: string,
  props?: Record<string, string | number | boolean>
): void {
  if (typeof window === "undefined") return;
  const plausible = window.plausible;
  if (typeof plausible !== "function") return;
  try {
    if (props && Object.keys(props).length > 0) {
      plausible(event, { props });
    } else {
      plausible(event);
    }
  } catch {
    // no-op: Plausible may throw if misconfigured
  }
}
