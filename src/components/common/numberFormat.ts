/**
 * Shared integer display formatting for browser-facing surfaces.
 *
 * `Number.prototype.toLocaleString` is normally available, but embedded or
 * privacy-restricted hosts can expose it while rejecting the call. Localized
 * formatting is presentation-only, so a deterministic grouped fallback keeps
 * already-known values readable without changing their meaning.
 */

function fallbackFormatInteger(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const truncated = Math.trunc(value);
  const sign = truncated < 0 ? "-" : "";
  const digits = Math.abs(truncated).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Format an integer with Japanese grouping when the host capability works. */
export function formatInteger(value: number): string {
  try {
    return value.toLocaleString("ja-JP");
  } catch {
    return fallbackFormatInteger(value);
  }
}
