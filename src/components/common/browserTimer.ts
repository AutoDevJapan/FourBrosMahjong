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

/** Register an optional repeating timer without leaking host capability errors. */
export function trySetInterval(
  callback: () => void,
  delayMs: number,
): number | null {
  try {
    return window.setInterval(callback, delayMs);
  } catch {
    return null;
  }
}

/** Cleanup is best effort for repeating timers in restricted host environments. */
export function clearIntervalSafely(timer: number | null): void {
  if (timer === null) return;

  try {
    window.clearInterval(timer);
  } catch {
    // A failed optional cleanup must not interrupt connection teardown.
  }
}
