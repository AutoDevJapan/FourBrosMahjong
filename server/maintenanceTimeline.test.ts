import { describe, expect, it, vi } from "vitest";
import type { DrainTransition } from "./drainController";
import { MaintenanceTimeline } from "./maintenanceTimeline";

function transition(
  phase: DrainTransition["status"]["phase"],
  changed = true,
): DrainTransition {
  return {
    changed,
    status: {
      phase,
      drainStartedMonotonicMs: null,
      terminationStartedMonotonicMs: null,
      aggregate: {
        webSocketConnections: 0,
        attachedSessionConnections: 0,
        pendingUpgrades: 0,
        retainedRooms: 0,
        connectedRooms: 0,
        blockingDrainRooms: 0,
        reconnectGraceRooms: 0,
        completedConnectedRooms: 0,
        abandonedDuringDrainRooms: 0,
        uniqueConnectedSeats: 0,
      },
    },
  };
}

describe("MaintenanceTimeline", () => {
  it("anchors manual drain once and clears only after a successful release", () => {
    let wallNow = Date.parse("2026-08-28T00:00:00.000Z");
    const timeline = new MaintenanceTimeline({
      wallNow: () => wallNow,
      shutdownGraceMs: 25_000,
    });
    expect(timeline.startDrain(() => transition("draining"))).toMatchObject({
      changed: true,
    });
    wallNow = Number.NaN;
    // A duplicate POST may itself seal draining -> drained (`changed: true`).
    // It must not create a new epoch or even sample a now-invalid wall clock.
    timeline.startDrain(() => transition("drained", true));
    expect(timeline.status()).toEqual({
      drainStartedAt: "2026-08-28T00:00:00.000Z",
      deadline: null,
    });

    timeline.releaseDrain(() => transition("terminating", false));
    expect(timeline.status().drainStartedAt).not.toBeNull();
    timeline.releaseDrain(() => transition("accepting"));
    expect(timeline.status()).toEqual({
      drainStartedAt: null,
      deadline: null,
    });
  });

  it("preserves manual start and never extends the first signal deadline", () => {
    const timeline = new MaintenanceTimeline({
      wallNow: () => Date.parse("2026-08-28T00:00:00.000Z"),
      shutdownGraceMs: 25_000,
    });
    timeline.startDrain(() => transition("draining"));
    timeline.beginTermination(new Date("2026-08-28T00:01:25.000Z"));
    timeline.beginTermination(new Date("2026-08-28T00:02:25.000Z"));
    expect(timeline.status()).toEqual({
      drainStartedAt: "2026-08-28T00:00:00.000Z",
      deadline: "2026-08-28T00:01:25.000Z",
    });
  });

  it("derives signal start when no manual drain exists and preflights bad wall time", () => {
    const transitionCallback = vi.fn(() => transition("draining"));
    const timeline = new MaintenanceTimeline({
      wallNow: () => Number.NaN,
      shutdownGraceMs: 25_000,
    });
    expect(() => timeline.startDrain(transitionCallback)).toThrow(/wall clock/);
    expect(transitionCallback).not.toHaveBeenCalled();

    const signalTimeline = new MaintenanceTimeline({ shutdownGraceMs: 25_000 });
    signalTimeline.beginTermination(new Date("2026-08-28T00:00:25.000Z"));
    expect(signalTimeline.status()).toEqual({
      drainStartedAt: "2026-08-28T00:00:00.000Z",
      deadline: "2026-08-28T00:00:25.000Z",
    });
    expect(() => new MaintenanceTimeline({ shutdownGraceMs: 0 })).toThrow(
      /positive safe integer/,
    );
    const extendedYear = new MaintenanceTimeline({
      wallNow: () => Date.UTC(10_000, 0, 1),
      shutdownGraceMs: 25_000,
    });
    expect(() => extendedYear.startDrain(() => transition("draining"))).toThrow(
      /four-digit year/,
    );
  });
});
