import type {
  ConnectionAggregateCounts,
  DrainAggregateObserver,
  MonotonicClock,
  RoomManagerAggregateSnapshot,
  RoomSession,
} from "./roomManager";

export type DrainPhase = "accepting" | "draining" | "drained" | "terminating";

export type ResumeAdmission = "normal" | "bounded" | "blocked";

export interface DrainControllerStatus {
  readonly phase: DrainPhase;
  /** Monotonic process-local value for duration calculations, never wall time. */
  readonly drainStartedMonotonicMs: number | null;
  /** First SIGTERM/SIGINT boundary; independent from an earlier manual drain. */
  readonly terminationStartedMonotonicMs: number | null;
  readonly aggregate: RoomManagerAggregateSnapshot;
}

export interface DrainTransition {
  readonly changed: boolean;
  readonly status: DrainControllerStatus;
}

export interface DrainControllerOptions {
  readonly monotonicNow?: MonotonicClock;
  /** Live socket/attachment/upgrade counts shared by every drain phase. */
  readonly currentConnections: () => ConnectionAggregateCounts;
  /** Aggregate used while accepting, where abandonedDuringDrainRooms is zero. */
  readonly currentAggregate: (
    connections: ConnectionAggregateCounts,
  ) => RoomManagerAggregateSnapshot;
  /** Creates fresh private abandonment tracking for one drain epoch. */
  readonly beginDrainObservation: () => DrainAggregateObserver;
}

export interface ResumeCallbacks {
  readonly normal: () => RoomSession | null;
  readonly bounded: () => RoomSession | null;
}

export type ResumeAttempt =
  | {
      readonly outcome: "blocked";
      readonly session: null;
      readonly transition: DrainTransition;
    }
  | {
      readonly outcome: "completed";
      readonly session: RoomSession | null;
      readonly transition: DrainTransition;
    }
  | {
      readonly outcome: "failed";
      readonly session: null;
      /** Internal only; server wiring must never serialize this value. */
      readonly error: unknown;
      readonly transition: DrainTransition;
    };

/**
 * I/O-free drain state machine. Server handlers remain responsible for gates
 * and must call `afterRoomMutation` in the same event-loop turn as each room
 * mutation. Once sealed as drained, a late mutation can never reactivate it.
 */
export class DrainController {
  private readonly monotonicNow: MonotonicClock;
  private readonly currentConnections: () => ConnectionAggregateCounts;
  private readonly currentAggregate: (
    connections: ConnectionAggregateCounts,
  ) => RoomManagerAggregateSnapshot;
  private readonly beginDrainObservation: () => DrainAggregateObserver;
  private phase: DrainPhase = "accepting";
  private drainStartedMonotonicMs: number | null = null;
  private terminationStartedMonotonicMs: number | null = null;
  private drainObserver: DrainAggregateObserver | null = null;
  private lastMonotonicNow = Number.NEGATIVE_INFINITY;

  constructor(options: DrainControllerOptions) {
    this.monotonicNow = options.monotonicNow ?? Date.now;
    this.currentConnections = options.currentConnections;
    this.currentAggregate = options.currentAggregate;
    this.beginDrainObservation = options.beginDrainObservation;
  }

  status(): DrainControllerStatus {
    return this.tick().status;
  }

  /** Future server wiring must pair `bounded` with RoomManager.resumeDuringDrain. */
  resumeAdmission(): ResumeAdmission {
    this.reevaluateDrain();
    return this.resumeAdmissionWithoutReevaluation();
  }

  /**
   * Synchronous admission boundary: a sealed or terminating controller never
   * invokes either mutation callback, preventing a late resume from changing
   * room state after `drained` has been observed.
   */
  attemptResume(callbacks: ResumeCallbacks): ResumeAttempt {
    const phaseBeforeAdmission = this.phase;
    const admissionStatus = this.reevaluateDrain();
    const admission = this.resumeAdmissionWithoutReevaluation();
    if (admission === "blocked") {
      return Object.freeze({
        outcome: "blocked",
        session: null,
        transition: {
          changed: phaseBeforeAdmission !== admissionStatus.phase,
          status: admissionStatus,
        },
      });
    }
    let session: RoomSession | null;
    try {
      session =
        admission === "normal" ? callbacks.normal() : callbacks.bounded();
    } catch (error) {
      // The callback is deliberately synchronous and RoomSession-specific.
      // Reevaluate even when it rejects or throws so wiring cannot forget the
      // same-event-loop atomicity requirement.
      const failed = {
        outcome: "failed",
        session: null,
        transition: this.tick(),
      } as ResumeAttempt;
      // Keep the unexpected cause available for explicit internal handling,
      // but make accidental JSON serialization incapable of exposing it.
      Object.defineProperty(failed, "error", {
        value: error,
        enumerable: false,
      });
      return Object.freeze(failed);
    }
    return Object.freeze({
      outcome: "completed",
      session,
      transition: this.tick(),
    });
  }

  startDrain(): DrainTransition {
    if (this.phase === "terminating" || this.phase === "drained") {
      return { changed: false, status: this.status() };
    }
    const previousPhase = this.phase;
    if (this.phase === "accepting") {
      this.drainObserver = this.beginDrainObservation();
      this.drainStartedMonotonicMs = this.now();
      this.phase = "draining";
    }
    const status = this.reevaluateDrain();
    return {
      changed: previousPhase !== status.phase,
      status,
    };
  }

  /** Atomic post-mutation hook for create/join/resume/disconnect/leave/apply/newGame/sweep. */
  afterRoomMutation(): DrainTransition {
    return this.tick();
  }

  /** Time-driven reevaluation for reconnect-grace expiry. */
  tick(): DrainTransition {
    const previousPhase = this.phase;
    const status = this.reevaluateDrain();
    return { changed: previousPhase !== status.phase, status };
  }

  /** Manual drain cancellation is allowed until process termination begins. */
  releaseDrain(): DrainTransition {
    if (this.phase === "terminating" || this.phase === "accepting") {
      return { changed: false, status: this.status() };
    }
    this.phase = "accepting";
    this.drainStartedMonotonicMs = null;
    this.drainObserver = null;
    return { changed: true, status: this.status() };
  }

  /** SIGTERM/SIGINT boundary: irreversible and idempotent. */
  beginTermination(): DrainTransition {
    if (this.phase === "terminating") {
      return { changed: false, status: this.status() };
    }
    const terminationStartedMonotonicMs = this.now();
    if (this.drainObserver === null) {
      this.drainObserver = this.beginDrainObservation();
      this.drainStartedMonotonicMs = terminationStartedMonotonicMs;
    }
    this.terminationStartedMonotonicMs = terminationStartedMonotonicMs;
    this.phase = "terminating";
    return { changed: true, status: this.status() };
  }

  private reevaluateDrain(): DrainControllerStatus {
    const aggregate = this.readAggregate();
    if (this.phase === "draining" && aggregate.blockingDrainRooms === 0) {
      this.phase = "drained";
    }
    return this.makeStatus(aggregate);
  }

  private readAggregate(): RoomManagerAggregateSnapshot {
    const connections = this.currentConnections();
    return (
      this.drainObserver?.snapshot(connections) ??
      this.currentAggregate(connections)
    );
  }

  private makeStatus(
    aggregate: RoomManagerAggregateSnapshot,
  ): DrainControllerStatus {
    return Object.freeze({
      phase: this.phase,
      drainStartedMonotonicMs: this.drainStartedMonotonicMs,
      terminationStartedMonotonicMs: this.terminationStartedMonotonicMs,
      aggregate,
    });
  }

  private resumeAdmissionWithoutReevaluation(): ResumeAdmission {
    switch (this.phase) {
      case "accepting":
        return "normal";
      case "draining":
        return "bounded";
      case "drained":
      case "terminating":
        return "blocked";
    }
  }

  private now(): number {
    const sampled = this.monotonicNow();
    if (!Number.isFinite(sampled) || sampled < 0) {
      throw new RangeError(
        "monotonic clock must return a finite non-negative value",
      );
    }
    this.lastMonotonicNow = Math.max(this.lastMonotonicNow, sampled);
    return this.lastMonotonicNow;
  }
}
