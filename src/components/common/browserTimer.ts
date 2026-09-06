/**
 * Timer APIs are optional presentation capabilities. Embedded or
 * privacy-restricted hosts can expose them while still rejecting a call, so a
 * timer failure must not abort the component lifecycle.
 */
export function trySetTimeout(
  callback: () => void,
  delayMs: number,
): number | null {
  try {
    return window.setTimeout(callback, delayMs);
  } catch {
    return null;
  }
}

/** Cleanup is best effort for the same restricted-host timer environments. */
export function clearTimeoutSafely(timer: number | null): void {
  if (timer === null) return;

  try {
    window.clearTimeout(timer);
  } catch {
    // A failed optional cleanup must not interrupt React effect teardown.
  }
}
