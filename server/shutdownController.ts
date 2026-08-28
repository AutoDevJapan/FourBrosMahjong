export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface ShutdownTimer {
  cancel(): void;
}

export interface ShutdownScheduler {
  schedule(callback: () => void, delayMs: number): ShutdownTimer;
}

interface ShutdownStartStatus {
  readonly blockingDrainRooms: number;
}

export interface GracefulShutdownDependencies {
  readonly shutdownGraceMs: number;
  readonly socketCloseGraceMs: number;
  readonly pollIntervalMs?: number;
  readonly monotonicNow?: () => number;
  readonly wallNow?: () => number;
  readonly scheduler?: ShutdownScheduler;
  /** Irreversibly enters the server's terminating admission state. */
  readonly beginTermination: () => ShutdownStartStatus;
  /** Reads the current blocker count after room mutations. */
  readonly blockingDrainRooms: () => number;
  /** Queues the optional additive notice before any socket close frame. */
  readonly announceTermination: (deadline: Date | null) => void;
  /** Rejects and releases every in-flight HTTP upgrade reservation. */
  readonly rejectPendingUpgrades: () => void;
  /** Stops heartbeat, sweep, handshake, and drain-tick timers. */
  readonly stopRuntimeTimers: () => void;
  /** Starts the RFC 6455 1012 / service restart close handshake. */
  readonly requestSocketClose: () => void;
  readonly openSocketCount: () => number;
  readonly terminateSockets: () => void;
  /** Closes WebSocket and HTTP listeners and resolves after both callbacks. */
  readonly closeServers: () => Promise<void>;
  /** Accelerates an already-started listener close (for example keep-alives). */
  readonly forceCloseServers: () => Promise<void>;
  /** Fixed lifecycle events only; never include credentials or room identity. */
  readonly onEvent?: (event: ShutdownEvent) => void;
}

export type ShutdownEvent =
  | "shutdown-started"
  | "shutdown-close-started"
  | "shutdown-second-signal"
  | "shutdown-force-closed"
  | "shutdown-completed";

export interface ShutdownState {
  readonly started: boolean;
  readonly closing: boolean;
  readonly completed: boolean;
  readonly firstSignal: ShutdownSignal | null;
  readonly startedMonotonicMs: number | null;
  readonly closeCutoffMonotonicMs: number | null;
  readonly deadlineMonotonicMs: number | null;
}

const DEFAULT_POLL_INTERVAL_MS = 250;

const defaultScheduler: ShutdownScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return { cancel: () => clearTimeout(timer) };
  },
};

function validatedDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * Coordinates one bounded shutdown epoch without owning process signals.
 *
 * All budget decisions use the first monotonic sample. Wall time is used only
 * to generate the client-facing ISO deadline. A second signal never creates a
 * second cleanup chain; it advances the same promise directly to force-close.
 */
export class GracefulShutdownController {
  private readonly dependencies: GracefulShutdownDependencies;
  private readonly scheduler: ShutdownScheduler;
  private readonly pollIntervalMs: number;
  private firstSignal: ShutdownSignal | null = null;
  private startedMonotonicMs: number | null = null;
  private closeCutoffMonotonicMs: number | null = null;
  private deadlineMonotonicMs: number | null = null;
  private lastMonotonicNow = Number.NEGATIVE_INFINITY;
  private pollTimer: ShutdownTimer | null = null;
  private socketCloseTimer: ShutdownTimer | null = null;
  private absoluteDeadlineTimer: ShutdownTimer | null = null;
  private closing = false;
  private completed = false;
  private secondSignalSeen = false;
  private socketsForced = false;
  private closeServersPromise: Promise<void> | null = null;
  private forceCloseServersPromise: Promise<void> | null = null;
  private completionPromise: Promise<void> | null = null;
  private resolveCompletion: (() => void) | null = null;
  private rejectCompletion: ((error: unknown) => void) | null = null;

  constructor(dependencies: GracefulShutdownDependencies) {
    const shutdownGraceMs = validatedDuration(
      dependencies.shutdownGraceMs,
      "shutdownGraceMs",
    );
    const socketCloseGraceMs = validatedDuration(
      dependencies.socketCloseGraceMs,
      "socketCloseGraceMs",
    );
    if (socketCloseGraceMs >= shutdownGraceMs) {
      throw new RangeError(
        "socketCloseGraceMs must be less than shutdownGraceMs",
      );
    }
    this.pollIntervalMs = validatedDuration(
      dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      "pollIntervalMs",
    );
    this.dependencies = dependencies;
    this.scheduler = dependencies.scheduler ?? defaultScheduler;
  }

  state(): ShutdownState {
    return Object.freeze({
      started: this.firstSignal !== null,
      closing: this.closing,
      completed: this.completed,
      firstSignal: this.firstSignal,
      startedMonotonicMs: this.startedMonotonicMs,
      closeCutoffMonotonicMs: this.closeCutoffMonotonicMs,
      deadlineMonotonicMs: this.deadlineMonotonicMs,
    });
  }

  /** Starts shutdown or force-advances the existing epoch on a second signal. */
  handleSignal(signal: ShutdownSignal): Promise<void> {
    if (this.completionPromise !== null) {
      if (!this.secondSignalSeen) {
        this.secondSignalSeen = true;
        this.emit("shutdown-second-signal");
      }
      this.beginClosing(true);
      return this.completionPromise;
    }

    let startedMonotonicMs: number;
    try {
      startedMonotonicMs = this.now();
    } catch {
      this.firstSignal = signal;
      this.completionPromise = new Promise<void>((resolve, reject) => {
        this.resolveCompletion = resolve;
        this.rejectCompletion = reject;
      });
      this.emit("shutdown-started");
      try {
        this.dependencies.beginTermination();
      } catch {
        // Listener force-close remains the fail-safe boundary.
      }
      try {
        this.dependencies.announceTermination(null);
      } catch {
        // Optional wire observability cannot control shutdown safety.
      }
      try {
        this.dependencies.rejectPendingUpgrades();
      } catch {
        // Listener force-close remains the fail-safe boundary.
      }
      this.beginClosing(true);
      return this.completionPromise;
    }
    const shutdownGraceMs = this.dependencies.shutdownGraceMs;
    const socketCloseGraceMs = this.dependencies.socketCloseGraceMs;

    this.firstSignal = signal;
    this.startedMonotonicMs = startedMonotonicMs;
    this.closeCutoffMonotonicMs =
      startedMonotonicMs + shutdownGraceMs - socketCloseGraceMs;
    this.deadlineMonotonicMs = startedMonotonicMs + shutdownGraceMs;
    this.completionPromise = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    let deadlineTimerFailed = false;
    try {
      this.absoluteDeadlineTimer = this.scheduler.schedule(() => {
        this.absoluteDeadlineTimer = null;
        this.beginClosing(true);
      }, shutdownGraceMs);
    } catch {
      deadlineTimerFailed = true;
    }
    this.emit("shutdown-started");

    let wallDeadline: Date | null = null;
    try {
      const wallNow = this.dependencies.wallNow?.() ?? Date.now();
      if (!Number.isFinite(wallNow) || wallNow < 0) {
        throw new RangeError("wallNow must return a finite non-negative value");
      }
      const candidate = new Date(wallNow + shutdownGraceMs);
      if (!Number.isFinite(candidate.getTime())) {
        throw new RangeError(
          "shutdown wall deadline is outside the Date range",
        );
      }
      const year = candidate.getUTCFullYear();
      if (year < 0 || year > 9_999) {
        throw new RangeError(
          "shutdown wall deadline must use a client-compatible four-digit year",
        );
      }
      wallDeadline = candidate;
    } catch {
      // Wall time is display-only. Monotonic shutdown remains authoritative.
    }

    let status: ShutdownStartStatus;
    try {
      status = this.dependencies.beginTermination();
    } catch {
      // Once a process signal is accepted, fail closed. A provider or notice
      // fault must not leave the process alive beyond its bounded deadline.
      try {
        this.dependencies.rejectPendingUpgrades();
      } catch {
        // Listener shutdown below is the remaining fail-safe boundary.
      }
      this.beginClosing(true);
      return this.completionPromise;
    }
    try {
      this.dependencies.announceTermination(wallDeadline);
    } catch {
      // Optional wire observability cannot control shutdown safety.
    }
    try {
      this.dependencies.rejectPendingUpgrades();
    } catch {
      this.beginClosing(true);
      return this.completionPromise;
    }
    if (deadlineTimerFailed) {
      this.beginClosing(true);
      return this.completionPromise;
    }
    if (this.closing || this.completed) return this.completionPromise;
    try {
      if (status.blockingDrainRooms === 0) this.beginClosing(false);
      else this.schedulePoll();
    } catch {
      this.beginClosing(true);
    }
    return this.completionPromise;
  }

  /** Same-turn room/socket hook; safe before shutdown and after completion. */
  reevaluate(): void {
    if (this.completionPromise === null || this.closing || this.completed)
      return;
    try {
      if (
        this.dependencies.blockingDrainRooms() === 0 ||
        this.now() >= this.requireCloseCutoff()
      ) {
        this.beginClosing(false);
      }
    } catch {
      this.beginClosing(true);
    }
  }

  /** Socket close callback hook so listeners may close before the subdeadline. */
  socketClosed(): void {
    if (!this.closing || this.completed) return;
    try {
      if (this.dependencies.openSocketCount() === 0) {
        this.finishSocketClose(false);
      }
    } catch {
      this.finishSocketClose(true);
    }
  }

  private schedulePoll(): void {
    this.cancelPoll();
    const remaining = Math.max(0, this.requireCloseCutoff() - this.now());
    if (remaining === 0) {
      this.beginClosing(false);
      return;
    }
    this.pollTimer = this.scheduler.schedule(
      () => {
        this.pollTimer = null;
        try {
          this.reevaluate();
          if (!this.closing && !this.completed) this.schedulePoll();
        } catch {
          this.beginClosing(true);
        }
      },
      Math.min(this.pollIntervalMs, remaining),
    );
  }

  private beginClosing(force: boolean): void {
    if (this.completed) return;
    if (this.closing) {
      if (force) this.finishSocketClose(true);
      return;
    }
    this.closing = true;
    this.cancelPoll();
    this.emit("shutdown-close-started");
    try {
      this.dependencies.stopRuntimeTimers();
      if (!force) this.dependencies.requestSocketClose();
    } catch {
      force = true;
    }
    if (force) {
      this.finishSocketClose(true);
      return;
    }
    let openSockets: number;
    let remaining: number;
    try {
      openSockets = this.dependencies.openSocketCount();
      remaining = Math.max(
        0,
        Math.min(
          this.dependencies.socketCloseGraceMs,
          this.requireDeadline() - this.now(),
        ),
      );
    } catch {
      this.finishSocketClose(true);
      return;
    }
    if (openSockets === 0) {
      this.finishSocketClose(false);
      return;
    }
    if (remaining === 0) {
      this.finishSocketClose(true);
      return;
    }
    this.socketCloseTimer = this.scheduler.schedule(() => {
      this.socketCloseTimer = null;
      this.finishSocketClose(true);
    }, remaining);
  }

  private finishSocketClose(force: boolean): void {
    this.cancelSocketCloseTimer();
    if (force && !this.socketsForced) {
      this.socketsForced = true;
      try {
        this.dependencies.terminateSockets();
      } catch {
        // Listener force-close remains the final bounded cleanup boundary.
      } finally {
        this.emit("shutdown-force-closed");
      }
    }
    if (this.closeServersPromise === null) {
      try {
        this.closeServersPromise = this.dependencies.closeServers();
      } catch {
        this.closeServersPromise = Promise.reject(
          new Error("server close could not start"),
        );
      }
      void this.closeServersPromise.then(
        () => {
          if (this.forceCloseServersPromise === null) this.complete();
        },
        () => this.finishSocketClose(true),
      );
    }
    if (!force) return;
    if (this.forceCloseServersPromise === null) {
      try {
        this.forceCloseServersPromise = this.dependencies.forceCloseServers();
      } catch (error) {
        this.fail(error);
        return;
      }
    }
    void this.forceCloseServersPromise.then(
      () => this.complete(),
      (error) => this.fail(error),
    );
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.cancelPoll();
    this.cancelSocketCloseTimer();
    this.cancelAbsoluteDeadlineTimer();
    this.emit("shutdown-completed");
    this.resolveCompletion?.();
    this.resolveCompletion = null;
    this.rejectCompletion = null;
  }

  private fail(error: unknown): void {
    if (this.completed) return;
    this.completed = true;
    this.cancelPoll();
    this.cancelSocketCloseTimer();
    this.cancelAbsoluteDeadlineTimer();
    this.rejectCompletion?.(error);
    this.resolveCompletion = null;
    this.rejectCompletion = null;
  }

  private cancelPoll(): void {
    const timer = this.pollTimer;
    this.pollTimer = null;
    try {
      timer?.cancel();
    } catch {
      // A scheduler cleanup fault cannot prevent bounded resource cleanup.
    }
  }

  private cancelSocketCloseTimer(): void {
    const timer = this.socketCloseTimer;
    this.socketCloseTimer = null;
    try {
      timer?.cancel();
    } catch {
      // A scheduler cleanup fault cannot prevent bounded resource cleanup.
    }
  }

  private cancelAbsoluteDeadlineTimer(): void {
    const timer = this.absoluteDeadlineTimer;
    this.absoluteDeadlineTimer = null;
    try {
      timer?.cancel();
    } catch {
      // Completion must still settle after resources are closed.
    }
  }

  private requireCloseCutoff(): number {
    if (this.closeCutoffMonotonicMs === null) {
      throw new Error("shutdown close cutoff is unavailable");
    }
    return this.closeCutoffMonotonicMs;
  }

  private requireDeadline(): number {
    if (this.deadlineMonotonicMs === null) {
      throw new Error("shutdown deadline is unavailable");
    }
    return this.deadlineMonotonicMs;
  }

  private now(): number {
    const sampled = this.dependencies.monotonicNow?.() ?? performance.now();
    if (!Number.isFinite(sampled) || sampled < 0) {
      throw new RangeError(
        "monotonicNow must return a finite non-negative value",
      );
    }
    this.lastMonotonicNow = Math.max(this.lastMonotonicNow, sampled);
    return this.lastMonotonicNow;
  }

  private emit(event: ShutdownEvent): void {
    try {
      this.dependencies.onEvent?.(event);
    } catch {
      // Observability must never control shutdown safety.
    }
  }
}
