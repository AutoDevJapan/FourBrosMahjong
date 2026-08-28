import type { DrainTransition } from "./drainController";

export interface MaintenanceTimelineStatus {
  readonly drainStartedAt: string | null;
  readonly deadline: string | null;
}

export interface MaintenanceTimelineOptions {
  readonly wallNow?: () => number;
  readonly shutdownGraceMs: number;
}

export function maintenanceIsoTimestamp(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError(
      "maintenance wall clock must be finite and non-negative",
    );
  }
  const value = new Date(milliseconds);
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError("maintenance wall clock is outside the Date range");
  }
  const year = value.getUTCFullYear();
  if (year < 0 || year > 9_999) {
    throw new RangeError(
      "maintenance wall clock must use the client-compatible four-digit year",
    );
  }
  return value.toISOString();
}

/**
 * Server-owned display timeline. Admission and deadline decisions remain on
 * the monotonic DrainController/GracefulShutdownController clocks.
 */
export class MaintenanceTimeline {
  private readonly wallNow: () => number;
  private readonly shutdownGraceMs: number;
  private drainStartedAt: string | null = null;
  private deadline: string | null = null;

  constructor(options: MaintenanceTimelineOptions) {
    if (
      !Number.isSafeInteger(options.shutdownGraceMs) ||
      options.shutdownGraceMs <= 0
    ) {
      throw new RangeError("shutdownGraceMs must be a positive safe integer");
    }
    this.wallNow = options.wallNow ?? Date.now;
    this.shutdownGraceMs = options.shutdownGraceMs;
  }

  startDrain(transition: () => DrainTransition): DrainTransition {
    if (this.drainStartedAt !== null) return transition();
    // Pre-sample before the at-most-once transition so an invalid display
    // clock cannot commit drain while returning an error to the operator.
    const startedAt = maintenanceIsoTimestamp(this.wallNow());
    const result = transition();
    if (result.changed) {
      this.drainStartedAt ??= startedAt;
      this.deadline = null;
    }
    return result;
  }

  releaseDrain(transition: () => DrainTransition): DrainTransition {
    const result = transition();
    if (result.changed && result.status.phase === "accepting") {
      this.drainStartedAt = null;
      this.deadline = null;
    }
    return result;
  }

  /** Commits the first signal-owned wall boundary without ever extending it. */
  beginTermination(deadline: Date | null): void {
    if (deadline === null || this.deadline !== null) return;
    const deadlineMs = deadline.getTime();
    const safeDeadline = maintenanceIsoTimestamp(deadlineMs);
    this.drainStartedAt ??= maintenanceIsoTimestamp(
      Math.max(0, deadlineMs - this.shutdownGraceMs),
    );
    this.deadline = safeDeadline;
  }

  status(): MaintenanceTimelineStatus {
    return Object.freeze({
      drainStartedAt: this.drainStartedAt,
      deadline: this.deadline,
    });
  }
}
