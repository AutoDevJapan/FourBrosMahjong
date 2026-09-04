import type { OnlineRateLimitScope } from "../src/domain/online/types";

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

/**
 * Process-local limits for the unauthenticated WebSocket surface.
 *
 * These are deliberately conservative for a four-player room, but large
 * enough to tolerate a browser retrying a connection or a small household
 * sharing one source address. They are process-local because the MVP runs one
 * Railway process; a distributed limiter belongs to a separate follow-up.
 */
export const ABUSE_LIMITS = {
  maxConnections: 256,
  maxConnectionsPerSource: 32,
  maxTrackedSources: 4_096,
  connectionAttempts: { limit: 60, windowMs: 10 * SECOND_MS },
  roomAttempts: {
    create: { limit: 5, windowMs: 10 * MINUTE_MS },
    join: { limit: 30, windowMs: MINUTE_MS },
    resume: { limit: 30, windowMs: MINUTE_MS },
  },
  messages: { limit: 240, windowMs: 10 * SECOND_MS },
  actions: { limit: 120, windowMs: 10 * SECOND_MS },
  sourceMessages: { limit: 600, windowMs: 10 * SECOND_MS },
  sourceActions: { limit: 300, windowMs: 10 * SECOND_MS },
  connectionRetryAfterMs: 5 * SECOND_MS,
} as const;

export type RoomAttemptScope = "create" | "join" | "resume";

export type AbuseRejection =
  | {
      readonly code: "connection_limit";
      readonly retryAfterMs: number;
    }
  | {
      readonly code: "rate_limited";
      readonly scope: OnlineRateLimitScope;
      readonly retryAfterMs: number;
    };

/** A bounded sliding-window counter used by each abuse-control bucket. */
class SlidingWindow {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(now: number): number | null {
    this.prune(now);
    if (this.timestamps.length >= this.limit) {
      const oldest = this.timestamps[0];
      return Math.max(1, oldest + this.windowMs - now);
    }
    this.timestamps.push(now);
    return null;
  }

  isIdle(now: number): boolean {
    this.prune(now);
    return this.timestamps.length === 0;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let firstLive = 0;
    while (
      firstLive < this.timestamps.length &&
      this.timestamps[firstLive] <= cutoff
    ) {
      firstLive += 1;
    }
    if (firstLive > 0) this.timestamps.splice(0, firstLive);
  }
}

export interface ClientAbuseState {
  readonly messages: SlidingWindow;
  readonly actions: SlidingWindow;
}

interface SourceAbuseState {
  /**
   * Upgrade-admission reservations held by the limiter. Established sockets
   * are counted by the server's client set, so this is intentionally not an
   * authoritative active-connection count.
   */
  pendingUpgradeReservations: number;
  readonly connectionAttempts: SlidingWindow;
  readonly roomAttempts: {
    readonly create: SlidingWindow;
    readonly join: SlidingWindow;
    readonly resume: SlidingWindow;
  };
  readonly messages: SlidingWindow;
  readonly actions: SlidingWindow;
}

function sourceStateFor(): SourceAbuseState {
  return {
    pendingUpgradeReservations: 0,
    connectionAttempts: new SlidingWindow(
      ABUSE_LIMITS.connectionAttempts.limit,
      ABUSE_LIMITS.connectionAttempts.windowMs,
    ),
    roomAttempts: {
      create: new SlidingWindow(
        ABUSE_LIMITS.roomAttempts.create.limit,
        ABUSE_LIMITS.roomAttempts.create.windowMs,
      ),
      join: new SlidingWindow(
        ABUSE_LIMITS.roomAttempts.join.limit,
        ABUSE_LIMITS.roomAttempts.join.windowMs,
      ),
      resume: new SlidingWindow(
        ABUSE_LIMITS.roomAttempts.resume.limit,
        ABUSE_LIMITS.roomAttempts.resume.windowMs,
      ),
    },
    messages: new SlidingWindow(
      ABUSE_LIMITS.sourceMessages.limit,
      ABUSE_LIMITS.sourceMessages.windowMs,
    ),
    actions: new SlidingWindow(
      ABUSE_LIMITS.sourceActions.limit,
      ABUSE_LIMITS.sourceActions.windowMs,
    ),
  };
}

function rateRejection(
  scope: OnlineRateLimitScope,
  retryAfterMs: number,
): AbuseRejection {
  return { code: "rate_limited", scope, retryAfterMs };
}

export class OnlineAbuseControls {
  private readonly sources = new Map<string, SourceAbuseState>();

  constructor(private readonly clock: () => number = Date.now) {}

  /**
   * Returns a rejection before a WebSocket upgrade is accepted. A successful
   * admission reserves one connection until `releasePendingUpgrade` is called.
   */
  admitConnection(
    source: string,
    activeConnections: number,
    activeSourceConnections: number,
  ): AbuseRejection | null {
    const now = this.clock();
    if (activeConnections >= ABUSE_LIMITS.maxConnections) {
      return {
        code: "connection_limit",
        retryAfterMs: ABUSE_LIMITS.connectionRetryAfterMs,
      };
    }

    const state = this.getOrCreateSource(source);
    if (state === null) {
      return {
        code: "connection_limit",
        retryAfterMs: ABUSE_LIMITS.connectionRetryAfterMs,
      };
    }
    if (
      activeSourceConnections >= ABUSE_LIMITS.maxConnectionsPerSource ||
      state.pendingUpgradeReservations >= ABUSE_LIMITS.maxConnectionsPerSource
    ) {
      return {
        code: "connection_limit",
        retryAfterMs: ABUSE_LIMITS.connectionRetryAfterMs,
      };
    }

    const retryAfterMs = state.connectionAttempts.consume(now);
    if (retryAfterMs !== null) {
      return rateRejection("connection", retryAfterMs);
    }
    state.pendingUpgradeReservations += 1;
    return null;
  }

  releasePendingUpgrade(source: string): void {
    const state = this.sources.get(source);
    if (state === undefined) return;
    state.pendingUpgradeReservations = Math.max(
      0,
      state.pendingUpgradeReservations - 1,
    );
  }

  createClientState(): ClientAbuseState {
    return {
      messages: new SlidingWindow(
        ABUSE_LIMITS.messages.limit,
        ABUSE_LIMITS.messages.windowMs,
      ),
      actions: new SlidingWindow(
        ABUSE_LIMITS.actions.limit,
        ABUSE_LIMITS.actions.windowMs,
      ),
    };
  }

  consumeMessage(
    source: string,
    state: ClientAbuseState,
  ): AbuseRejection | null {
    const now = this.clock();
    const clientRetryAfterMs = state.messages.consume(now);
    if (clientRetryAfterMs !== null)
      return rateRejection("message", clientRetryAfterMs);
    const sourceState = this.getOrCreateSource(source);
    if (sourceState === null)
      return rateRejection("message", ABUSE_LIMITS.connectionRetryAfterMs);
    const sourceRetryAfterMs = sourceState.messages.consume(now);
    return sourceRetryAfterMs === null
      ? null
      : rateRejection("message", sourceRetryAfterMs);
  }

  consumeAction(
    source: string,
    state: ClientAbuseState,
  ): AbuseRejection | null {
    const now = this.clock();
    const clientRetryAfterMs = state.actions.consume(now);
    if (clientRetryAfterMs !== null)
      return rateRejection("action", clientRetryAfterMs);
    const sourceState = this.getOrCreateSource(source);
    if (sourceState === null)
      return rateRejection("action", ABUSE_LIMITS.connectionRetryAfterMs);
    const sourceRetryAfterMs = sourceState.actions.consume(now);
    return sourceRetryAfterMs === null
      ? null
      : rateRejection("action", sourceRetryAfterMs);
  }

  consumeRoomAttempt(
    source: string,
    scope: RoomAttemptScope,
  ): AbuseRejection | null {
    const state = this.getOrCreateSource(source);
    if (state === null)
      return rateRejection(scope, ABUSE_LIMITS.connectionRetryAfterMs);
    const retryAfterMs = state.roomAttempts[scope].consume(this.clock());
    return retryAfterMs === null ? null : rateRejection(scope, retryAfterMs);
  }

  /** Remove expired source buckets while retaining state for active sockets. */
  cleanup(): void {
    const now = this.clock();
    for (const [source, state] of this.sources) {
      if (
        state.pendingUpgradeReservations === 0 &&
        state.connectionAttempts.isIdle(now) &&
        state.roomAttempts.create.isIdle(now) &&
        state.roomAttempts.join.isIdle(now) &&
        state.roomAttempts.resume.isIdle(now) &&
        state.messages.isIdle(now) &&
        state.actions.isIdle(now)
      ) {
        this.sources.delete(source);
      }
    }
  }

  get trackedSourceCount(): number {
    return this.sources.size;
  }

  private getOrCreateSource(source: string): SourceAbuseState | null {
    const existing = this.sources.get(source);
    if (existing !== undefined) return existing;
    this.cleanup();
    if (this.sources.size >= ABUSE_LIMITS.maxTrackedSources) return null;
    const state = sourceStateFor();
    this.sources.set(source, state);
    return state;
  }
}
