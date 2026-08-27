const SECOND_MS = 1_000;

export const OPS_AUTH_RATE_LIMITS = Object.freeze({
  global: Object.freeze({ limit: 120, windowMs: 60 * SECOND_MS }),
  source: Object.freeze({ limit: 10, windowMs: 60 * SECOND_MS }),
  // The private endpoint never needs an unbounded cardinality of caller keys.
  // Excess callers share the overflow bucket while the global limit remains
  // authoritative, bounding memory even during source rotation.
  maxTrackedSources: 64,
  maxSourceBytes: 256,
});

export interface OpsAuthRateLimitRejection {
  readonly scope: "global" | "source";
  readonly retryAfterMs: number;
}

class SlidingWindow {
  readonly #timestamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(now: number): number | null {
    this.prune(now);
    if (this.#timestamps.length >= this.limit) {
      const oldest = this.#timestamps[0];
      return Math.max(1, oldest + this.windowMs - now);
    }
    this.#timestamps.push(now);
    return null;
  }

  isIdle(now: number): boolean {
    this.prune(now);
    return this.#timestamps.length === 0;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let firstLive = 0;
    while (
      firstLive < this.#timestamps.length &&
      this.#timestamps[firstLive] <= cutoff
    ) {
      firstLive += 1;
    }
    if (firstLive > 0) this.#timestamps.splice(0, firstLive);
  }
}

function sourceWindow(): SlidingWindow {
  return new SlidingWindow(
    OPS_AUTH_RATE_LIMITS.source.limit,
    OPS_AUTH_RATE_LIMITS.source.windowMs,
  );
}

/**
 * Process-local admission boundary for private ops authentication attempts.
 *
 * Call this once for every attempt before bearer verification. The global
 * bucket is always consumed, even when the connection source is shared,
 * malformed, or the bounded source map is full. Results contain no source
 * identifier so callers cannot accidentally reflect or log one.
 */
export class OpsAuthRateLimiter {
  readonly #global = new SlidingWindow(
    OPS_AUTH_RATE_LIMITS.global.limit,
    OPS_AUTH_RATE_LIMITS.global.windowMs,
  );
  readonly #overflow = sourceWindow();
  readonly #sources = new Map<string, SlidingWindow>();
  #lastNow = Number.NEGATIVE_INFINITY;

  constructor(private readonly clock: () => number = Date.now) {}

  consume(source: string): OpsAuthRateLimitRejection | null {
    const now = Math.max(this.#lastNow, this.clock());
    this.#lastNow = now;
    const globalRetryAfterMs = this.#global.consume(now);
    const sourceRetryAfterMs = this.sourceWindowFor(source, now).consume(now);

    if (globalRetryAfterMs !== null) {
      return { scope: "global", retryAfterMs: globalRetryAfterMs };
    }
    if (sourceRetryAfterMs !== null) {
      return { scope: "source", retryAfterMs: sourceRetryAfterMs };
    }
    return null;
  }

  cleanup(): void {
    const now = Math.max(this.#lastNow, this.clock());
    this.#lastNow = now;
    for (const [source, window] of this.#sources) {
      if (window.isIdle(now)) this.#sources.delete(source);
    }
  }

  get trackedSourceCount(): number {
    return this.#sources.size;
  }

  private sourceWindowFor(source: string, now: number): SlidingWindow {
    if (
      source.length === 0 ||
      Buffer.byteLength(source, "utf8") > OPS_AUTH_RATE_LIMITS.maxSourceBytes
    ) {
      return this.#overflow;
    }
    const existing = this.#sources.get(source);
    if (existing !== undefined) return existing;
    this.cleanupAt(now);
    if (this.#sources.size >= OPS_AUTH_RATE_LIMITS.maxTrackedSources) {
      return this.#overflow;
    }
    const window = sourceWindow();
    this.#sources.set(source, window);
    return window;
  }

  private cleanupAt(now: number): void {
    for (const [source, window] of this.#sources) {
      if (window.isIdle(now)) this.#sources.delete(source);
    }
  }
}
