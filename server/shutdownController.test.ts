import { describe, expect, it, vi } from "vitest";
import {
  GracefulShutdownController,
  type ShutdownScheduler,
  type ShutdownTimer,
} from "./shutdownController";

interface ScheduledTask {
  readonly callback: () => void;
  readonly dueAt: number;
  cancelled: boolean;
}

function fakeScheduler(now: () => number) {
  const tasks: ScheduledTask[] = [];
  const scheduler: ShutdownScheduler = {
    schedule(callback, delayMs): ShutdownTimer {
      const task = { callback, dueAt: now() + delayMs, cancelled: false };
      tasks.push(task);
      return { cancel: () => (task.cancelled = true) };
    },
  };
  const runDue = () => {
    for (;;) {
      const task = tasks
        .filter((candidate) => !candidate.cancelled && candidate.dueAt <= now())
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (task === undefined) return;
      task.cancelled = true;
      task.callback();
    }
  };
  return { scheduler, runDue, tasks };
}

function fixture(options: { blockers?: number; sockets?: number } = {}) {
  let now = 1_000;
  let blockers = options.blockers ?? 1;
  let sockets = options.sockets ?? 1;
  const scheduled = fakeScheduler(() => now);
  const closeServers = vi.fn<() => Promise<void>>(async () => undefined);
  const forceCloseServers = vi.fn<() => Promise<void>>(async () => undefined);
  const events: string[] = [];
  const dependencies = {
    shutdownGraceMs: 10_000,
    socketCloseGraceMs: 2_000,
    pollIntervalMs: 250,
    monotonicNow: () => now,
    wallNow: () => 1_800_000_000_000,
    scheduler: scheduled.scheduler,
    beginTermination: vi.fn(() => ({ blockingDrainRooms: blockers })),
    blockingDrainRooms: vi.fn(() => blockers),
    announceTermination: vi.fn(),
    rejectPendingUpgrades: vi.fn(),
    stopRuntimeTimers: vi.fn(),
    requestSocketClose: vi.fn(),
    openSocketCount: vi.fn(() => sockets),
    terminateSockets: vi.fn(() => {
      sockets = 0;
    }),
    closeServers,
    forceCloseServers,
    onEvent: vi.fn((event: string) => events.push(event)),
  };
  const controller = new GracefulShutdownController(dependencies);
  const advance = (milliseconds: number) => {
    now += milliseconds;
    scheduled.runDue();
  };
  return {
    controller,
    dependencies,
    events,
    advance,
    setNow: (value: number) => (now = value),
    setBlockers: (value: number) => (blockers = value),
    setSockets: (value: number) => (sockets = value),
  };
}

describe("GracefulShutdownController", () => {
  it("anchors the first monotonic deadline and force-closes at both subdeadlines", async () => {
    const test = fixture();
    const completion = test.controller.handleSignal("SIGTERM");

    expect(test.controller.state()).toMatchObject({
      firstSignal: "SIGTERM",
      startedMonotonicMs: 1_000,
      closeCutoffMonotonicMs: 9_000,
      deadlineMonotonicMs: 11_000,
      closing: false,
    });
    expect(test.dependencies.announceTermination).toHaveBeenCalledWith(
      new Date(1_800_000_010_000),
    );
    expect(test.dependencies.rejectPendingUpgrades).toHaveBeenCalledOnce();

    // A regressing clock cannot extend the fixed first-signal cutoff.
    test.setNow(500);
    test.controller.reevaluate();
    expect(test.controller.state().closing).toBe(false);
    test.setNow(9_000);
    test.controller.reevaluate();
    expect(test.dependencies.stopRuntimeTimers).toHaveBeenCalledOnce();
    expect(test.dependencies.requestSocketClose).toHaveBeenCalledOnce();

    test.advance(1_999);
    expect(test.dependencies.terminateSockets).not.toHaveBeenCalled();
    test.advance(1);
    await completion;
    expect(test.dependencies.terminateSockets).toHaveBeenCalledOnce();
    expect(test.dependencies.forceCloseServers).toHaveBeenCalledOnce();
    expect(test.dependencies.closeServers).toHaveBeenCalledOnce();
    expect(test.controller.state().completed).toBe(true);
  });

  it("starts close in the same turn when blockers reach zero", async () => {
    const test = fixture({ blockers: 1, sockets: 0 });
    const completion = test.controller.handleSignal("SIGINT");
    test.setBlockers(0);
    test.controller.reevaluate();

    expect(test.dependencies.requestSocketClose).toHaveBeenCalledOnce();
    await completion;
    expect(test.dependencies.terminateSockets).not.toHaveBeenCalled();
    expect(test.events).toEqual([
      "shutdown-started",
      "shutdown-close-started",
      "shutdown-completed",
    ]);
  });

  it("reuses one promise and force-closes immediately on a second signal", async () => {
    const test = fixture();
    const first = test.controller.handleSignal("SIGTERM");
    const second = test.controller.handleSignal("SIGINT");
    const third = test.controller.handleSignal("SIGTERM");

    expect(second).toBe(first);
    expect(third).toBe(first);
    await first;
    expect(test.dependencies.beginTermination).toHaveBeenCalledOnce();
    expect(test.dependencies.announceTermination).toHaveBeenCalledOnce();
    expect(test.dependencies.rejectPendingUpgrades).toHaveBeenCalledOnce();
    expect(test.dependencies.stopRuntimeTimers).toHaveBeenCalledOnce();
    expect(test.dependencies.terminateSockets).toHaveBeenCalledOnce();
    expect(test.dependencies.forceCloseServers).toHaveBeenCalledOnce();
    expect(test.dependencies.closeServers).toHaveBeenCalledOnce();
    expect(
      test.events.filter((event) => event === "shutdown-second-signal"),
    ).toHaveLength(1);
  });

  it("finishes before the close grace when the last socket acknowledges", async () => {
    const test = fixture({ blockers: 0, sockets: 1 });
    const completion = test.controller.handleSignal("SIGTERM");
    test.setSockets(0);
    test.controller.socketClosed();
    await completion;

    expect(test.dependencies.terminateSockets).not.toHaveBeenCalled();
    expect(test.dependencies.closeServers).toHaveBeenCalledOnce();
  });

  it("isolates optional notice faults but fails closed on termination or pending faults", async () => {
    const notice = fixture({ blockers: 0, sockets: 0 });
    notice.dependencies.announceTermination.mockImplementation(() => {
      throw new Error("transport detail");
    });
    await notice.controller.handleSignal("SIGTERM");
    expect(notice.dependencies.rejectPendingUpgrades).toHaveBeenCalledOnce();
    expect(notice.dependencies.requestSocketClose).toHaveBeenCalledOnce();

    const termination = fixture();
    termination.dependencies.beginTermination.mockImplementation(() => {
      throw new Error("provider detail");
    });
    await termination.controller.handleSignal("SIGTERM");
    expect(
      termination.dependencies.rejectPendingUpgrades,
    ).toHaveBeenCalledOnce();
    expect(termination.dependencies.terminateSockets).toHaveBeenCalledOnce();
    expect(termination.dependencies.closeServers).toHaveBeenCalledOnce();

    const pending = fixture();
    pending.dependencies.rejectPendingUpgrades.mockImplementation(() => {
      throw new Error("reservation detail");
    });
    await pending.controller.handleSignal("SIGTERM");
    expect(pending.dependencies.terminateSockets).toHaveBeenCalledOnce();
  });

  it("validates budgets but never lets display-only wall time block shutdown", async () => {
    expect(
      () =>
        new GracefulShutdownController({
          ...fixture().dependencies,
          socketCloseGraceMs: 10_000,
        }),
    ).toThrow(/less than/);

    const test = fixture({ blockers: 0, sockets: 0 });
    test.dependencies.wallNow = (() => Number.NaN) as never;
    await test.controller.handleSignal("SIGTERM");
    expect(test.controller.state()).toMatchObject({
      started: true,
      closing: true,
      completed: true,
    });
    expect(test.dependencies.beginTermination).toHaveBeenCalledOnce();
    expect(test.dependencies.announceTermination).toHaveBeenCalledWith(null);

    const monotonic = fixture();
    monotonic.dependencies.monotonicNow = (() => Number.NaN) as never;
    await monotonic.controller.handleSignal("SIGINT");
    expect(monotonic.controller.state()).toMatchObject({
      started: true,
      completed: true,
      startedMonotonicMs: null,
      deadlineMonotonicMs: null,
    });
    expect(monotonic.dependencies.beginTermination).toHaveBeenCalledOnce();
    expect(monotonic.dependencies.rejectPendingUpgrades).toHaveBeenCalledOnce();
    expect(monotonic.dependencies.terminateSockets).toHaveBeenCalledOnce();

    const extended = fixture({ blockers: 0, sockets: 0 });
    extended.dependencies.wallNow = (() =>
      Date.UTC(10_000, 0, 1) - 5_000) as never;
    await extended.controller.handleSignal("SIGTERM");
    expect(extended.dependencies.announceTermination).toHaveBeenCalledWith(
      null,
    );
  });

  it("contains socket/count faults and accelerates a hung listener close", async () => {
    const test = fixture({ blockers: 0, sockets: 1 });
    let resolveNormal: (() => void) | undefined;
    test.dependencies.closeServers.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveNormal = resolve;
        }),
    );
    test.dependencies.openSocketCount.mockImplementationOnce(() => 1);
    const completion = test.controller.handleSignal("SIGTERM");
    expect(test.dependencies.closeServers).not.toHaveBeenCalled();

    test.dependencies.openSocketCount.mockImplementation(() => {
      throw new Error("count provider detail");
    });
    test.controller.socketClosed();
    await completion;
    expect(test.dependencies.terminateSockets).toHaveBeenCalledOnce();
    expect(test.dependencies.forceCloseServers).toHaveBeenCalledOnce();
    resolveNormal?.();
  });

  it("uses forceCloseServers when a second signal arrives during listener close", async () => {
    const test = fixture({ blockers: 0, sockets: 0 });
    test.dependencies.closeServers.mockImplementation(
      () => new Promise(() => {}),
    );
    const completion = test.controller.handleSignal("SIGTERM");
    expect(test.dependencies.closeServers).toHaveBeenCalledOnce();
    const repeated = test.controller.handleSignal("SIGINT");
    expect(repeated).toBe(completion);
    await completion;
    expect(test.dependencies.forceCloseServers).toHaveBeenCalledOnce();
  });

  it("waits for force cleanup once a second signal supersedes normal close", async () => {
    const test = fixture({ blockers: 0, sockets: 0 });
    let resolveNormal: (() => void) | undefined;
    let resolveForce: (() => void) | undefined;
    test.dependencies.closeServers.mockImplementation(
      () => new Promise<void>((resolve) => (resolveNormal = resolve)),
    );
    test.dependencies.forceCloseServers.mockImplementation(
      () => new Promise<void>((resolve) => (resolveForce = resolve)),
    );
    const completion = test.controller.handleSignal("SIGTERM");
    test.controller.handleSignal("SIGINT");
    resolveNormal?.();
    await Promise.resolve();
    expect(test.controller.state().completed).toBe(false);
    resolveForce?.();
    await completion;
    expect(test.controller.state().completed).toBe(true);
  });

  it("fails closed when initial or repeated scheduling throws", async () => {
    const initial = fixture();
    const initialController = new GracefulShutdownController({
      ...initial.dependencies,
      scheduler: {
        schedule() {
          throw new Error("scheduler detail");
        },
      },
    });
    await expect(
      initialController.handleSignal("SIGTERM"),
    ).resolves.toBeUndefined();
    expect(initial.dependencies.beginTermination).toHaveBeenCalledOnce();
    expect(initial.dependencies.terminateSockets).toHaveBeenCalledOnce();

    const repeated = fixture();
    let scheduleCalls = 0;
    let poll: (() => void) | null = null;
    const repeatedController = new GracefulShutdownController({
      ...repeated.dependencies,
      scheduler: {
        schedule(callback) {
          scheduleCalls += 1;
          if (scheduleCalls === 1) return { cancel() {} };
          if (scheduleCalls === 2) {
            poll = callback;
            return { cancel() {} };
          }
          throw new Error("reschedule detail");
        },
      },
    });
    const completion = repeatedController.handleSignal("SIGTERM");
    expect(poll).not.toBeNull();
    (poll as unknown as () => void)();
    await completion;
    expect(repeated.dependencies.terminateSockets).toHaveBeenCalledOnce();
    expect(repeated.dependencies.forceCloseServers).toHaveBeenCalledOnce();
  });

  it("contains scheduler cancel faults while settling cleanup", async () => {
    const test = fixture({ blockers: 0, sockets: 0 });
    const controller = new GracefulShutdownController({
      ...test.dependencies,
      scheduler: {
        schedule() {
          return {
            cancel() {
              throw new Error("cancel detail");
            },
          };
        },
      },
    });
    await expect(controller.handleSignal("SIGTERM")).resolves.toBeUndefined();
    expect(controller.state().completed).toBe(true);
  });
});
