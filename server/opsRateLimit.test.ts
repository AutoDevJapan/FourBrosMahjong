import { describe, expect, it } from "vitest";
import { OPS_AUTH_RATE_LIMITS, OpsAuthRateLimiter } from "./opsRateLimit";

describe("ops authentication rate limiter", () => {
  it("applies a per-source limit without disclosing the source", () => {
    const limiter = new OpsAuthRateLimiter(() => 0);
    for (let index = 0; index < OPS_AUTH_RATE_LIMITS.source.limit; index += 1) {
      expect(limiter.consume("203.0.113.10")).toBeNull();
    }

    const rejection = limiter.consume("203.0.113.10");
    expect(rejection).toEqual({
      scope: "source",
      retryAfterMs: OPS_AUTH_RATE_LIMITS.source.windowMs,
    });
    expect(JSON.stringify(rejection)).not.toContain("203.0.113.10");
    expect(limiter.consume("203.0.113.11")).toBeNull();
  });

  it("keeps a process-global limit when attempts rotate sources", () => {
    const limiter = new OpsAuthRateLimiter(() => 0);
    for (let index = 0; index < OPS_AUTH_RATE_LIMITS.global.limit; index += 1) {
      expect(limiter.consume(`source-${index % 60}`)).toBeNull();
    }

    expect(limiter.consume("one-more-source")).toEqual({
      scope: "global",
      retryAfterMs: OPS_AUTH_RATE_LIMITS.global.windowMs,
    });
  });

  it("gives the process-global rejection precedence when both scopes reject", () => {
    const limiter = new OpsAuthRateLimiter(() => 0);
    for (let index = 0; index < OPS_AUTH_RATE_LIMITS.source.limit; index += 1) {
      expect(limiter.consume("blocked-source")).toBeNull();
    }
    for (
      let index = OPS_AUTH_RATE_LIMITS.source.limit;
      index < OPS_AUTH_RATE_LIMITS.global.limit;
      index += 1
    ) {
      expect(limiter.consume(`rotating-${index % 55}`)).toBeNull();
    }

    expect(limiter.consume("blocked-source")?.scope).toBe("global");
  });

  it("uses one bounded overflow bucket for invalid and excess source keys", () => {
    const limiter = new OpsAuthRateLimiter(() => 0);
    for (
      let index = 0;
      index < OPS_AUTH_RATE_LIMITS.maxTrackedSources;
      index += 1
    ) {
      expect(limiter.consume(`source-${index}`)).toBeNull();
    }
    expect(limiter.trackedSourceCount).toBe(
      OPS_AUTH_RATE_LIMITS.maxTrackedSources,
    );

    for (let index = 0; index < OPS_AUTH_RATE_LIMITS.source.limit; index += 1) {
      expect(limiter.consume(`overflow-${index}`)?.scope).not.toBe("source");
    }
    expect(limiter.consume("overflow-final")?.scope).toBe("source");

    const invalid = new OpsAuthRateLimiter(() => 0);
    const oversized = "é".repeat(OPS_AUTH_RATE_LIMITS.maxSourceBytes);
    for (let index = 0; index < OPS_AUTH_RATE_LIMITS.source.limit; index += 1) {
      expect(invalid.consume(index % 2 === 0 ? "" : oversized)).toBeNull();
    }
    expect(invalid.consume(oversized)?.scope).toBe("source");
    expect(invalid.trackedSourceCount).toBe(0);
  });

  it("expires buckets at the exact window boundary", () => {
    let now = 0;
    const limiter = new OpsAuthRateLimiter(() => now);
    for (let index = 0; index < OPS_AUTH_RATE_LIMITS.source.limit; index += 1) {
      expect(limiter.consume("source")).toBeNull();
    }
    expect(limiter.consume("source")?.retryAfterMs).toBe(
      OPS_AUTH_RATE_LIMITS.source.windowMs,
    );

    now = OPS_AUTH_RATE_LIMITS.source.windowMs - 1;
    expect(limiter.consume("source")?.retryAfterMs).toBe(1);
    now = OPS_AUTH_RATE_LIMITS.source.windowMs;
    expect(limiter.consume("source")).toBeNull();
  });

  it("does not let a wall-clock regression reset the active window", () => {
    let now = 1_000;
    const limiter = new OpsAuthRateLimiter(() => now);
    for (let index = 0; index < OPS_AUTH_RATE_LIMITS.source.limit; index += 1) {
      expect(limiter.consume("source")).toBeNull();
    }
    now = 0;

    expect(limiter.consume("source")).toEqual({
      scope: "source",
      retryAfterMs: OPS_AUTH_RATE_LIMITS.source.windowMs,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    "fails closed before consuming an invalid clock sample: %s",
    (now) => {
      const limiter = new OpsAuthRateLimiter(() => now);

      expect(() => limiter.consume("source")).toThrow(
        "ops authentication clock must return a finite non-negative value",
      );
      expect(() => limiter.cleanup()).toThrow(RangeError);
      expect(limiter.trackedSourceCount).toBe(0);
    },
  );

  it("removes expired source state without growing the tracked map", () => {
    let now = 0;
    const limiter = new OpsAuthRateLimiter(() => now);
    expect(limiter.consume("source")).toBeNull();
    expect(limiter.trackedSourceCount).toBe(1);

    now += OPS_AUTH_RATE_LIMITS.source.windowMs;
    limiter.cleanup();
    expect(limiter.trackedSourceCount).toBe(0);
  });
});
