import { describe, expect, it, vi } from "vitest";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import { DrainController } from "./drainController";
import {
  type ConnectionAggregateCounts,
  ONLINE_DRAIN_RECONNECT_GRACE_MS,
  RoomManager,
} from "./roomManager";

const GRACE_MS = ONLINE_DRAIN_RECONNECT_GRACE_MS.default;

function fakeClock(initial = 5_000) {
  let value = initial;
  return {
    now: () => value,
    advance: (milliseconds: number) => {
      value += milliseconds;
    },
    set: (next: number) => {
      value = next;
    },
  };
}

function controllerFor(
  manager: RoomManager,
  monotonicNow: () => number,
): DrainController {
  return new DrainController({
    monotonicNow,
    currentConnections: () => ({
      webSocketConnections: 0,
      attachedSessionConnections: 0,
      pendingUpgrades: 0,
    }),
    currentAggregate: (connections) =>
      manager.aggregateSnapshot(GRACE_MS, connections),
    beginDrainObservation: () => manager.createDrainAggregateObserver(GRACE_MS),
  });
}

describe("DrainController", () => {
  it("keeps live connection counts across accepting and draining aggregates", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    let connections: ConnectionAggregateCounts = {
      webSocketConnections: 3,
      attachedSessionConnections: 2,
      pendingUpgrades: 1,
    };
    const controller = new DrainController({
      monotonicNow: clock.now,
      currentConnections: () => connections,
      currentAggregate: (current) =>
        manager.aggregateSnapshot(GRACE_MS, current),
      beginDrainObservation: () =>
        manager.createDrainAggregateObserver(GRACE_MS),
    });
    manager.create("ホスト");

    expect(controller.status().aggregate).toMatchObject(connections);
    expect(controller.startDrain().status.aggregate).toMatchObject(connections);
    connections = {
      webSocketConnections: 5,
      attachedSessionConnections: 4,
      pendingUpgrades: 2,
    };
    expect(controller.status()).toMatchObject({
      phase: "draining",
      aggregate: connections,
    });
  });

  it("moves accepting to draining and seals atomically after grace expires", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const controller = controllerFor(manager, clock.now);
    const host = manager.create("ホスト");

    expect(controller.status()).toMatchObject({
      phase: "accepting",
      drainStartedMonotonicMs: null,
      terminationStartedMonotonicMs: null,
      aggregate: { blockingDrainRooms: 1 },
    });
    expect(controller.resumeAdmission()).toBe("normal");
    expect(controller.startDrain()).toMatchObject({
      changed: true,
      status: {
        phase: "draining",
        drainStartedMonotonicMs: 5_000,
        aggregate: { blockingDrainRooms: 1 },
      },
    });
    expect(controller.resumeAdmission()).toBe("bounded");

    manager.disconnectDuringDrain(host.room, host.player);
    expect(controller.afterRoomMutation()).toMatchObject({
      changed: false,
      status: {
        phase: "draining",
        aggregate: { blockingDrainRooms: 1, reconnectGraceRooms: 1 },
      },
    });
    clock.advance(GRACE_MS);

    const normalResume = vi.fn(() =>
      manager.resume(host.room.code, host.player.token),
    );
    const boundedResume = vi.fn(() =>
      manager.resumeDuringDrain(host.room.code, host.player.token, GRACE_MS),
    );
    expect(
      controller.attemptResume({
        normal: normalResume,
        bounded: boundedResume,
      }),
    ).toMatchObject({
      outcome: "blocked",
      session: null,
      transition: {
        changed: true,
        status: {
          phase: "drained",
          aggregate: {
            blockingDrainRooms: 0,
            reconnectGraceRooms: 0,
            abandonedDuringDrainRooms: 1,
          },
        },
      },
    });
    expect(normalResume).not.toHaveBeenCalled();
    expect(boundedResume).not.toHaveBeenCalled();
    expect(controller.resumeAdmission()).toBe("blocked");
    expect(host.player.connected).toBe(false);
    expect(controller.afterRoomMutation()).toMatchObject({
      changed: false,
      status: {
        phase: "drained",
        aggregate: { blockingDrainRooms: 0 },
      },
    });
  });

  it("seals immediately when only completed connected rooms remain", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const controller = controllerFor(manager, clock.now);
    const host = manager.create("ホスト");
    host.room.state = walkToGameEnd(2024).state;

    expect(controller.startDrain()).toMatchObject({
      changed: true,
      status: {
        phase: "drained",
        aggregate: {
          blockingDrainRooms: 0,
          completedConnectedRooms: 1,
        },
      },
    });
    expect(controller.beginTermination()).toMatchObject({
      changed: true,
      status: {
        phase: "terminating",
        drainStartedMonotonicMs: 5_000,
        terminationStartedMonotonicMs: 5_000,
      },
    });
  });

  it("allows manual release from draining or drained but never terminating", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const controller = controllerFor(manager, clock.now);
    manager.create("ホスト");

    expect(controller.startDrain().status.phase).toBe("draining");
    expect(controller.releaseDrain()).toMatchObject({
      changed: true,
      status: { phase: "accepting", drainStartedMonotonicMs: null },
    });
    expect(controller.startDrain().status.phase).toBe("draining");
    clock.advance(2_000);
    expect(controller.beginTermination()).toMatchObject({
      changed: true,
      status: {
        phase: "terminating",
        drainStartedMonotonicMs: 5_000,
        terminationStartedMonotonicMs: 7_000,
      },
    });
    expect(controller.releaseDrain()).toMatchObject({
      changed: false,
      status: { phase: "terminating" },
    });
    expect(controller.startDrain()).toMatchObject({
      changed: false,
      status: { phase: "terminating" },
    });
  });

  it("resets the abandonment epoch on release and starts a fresh drain", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const controller = controllerFor(manager, clock.now);
    const host = manager.create("ホスト");
    controller.startDrain();
    manager.disconnectDuringDrain(host.room, host.player);
    controller.afterRoomMutation();
    clock.advance(GRACE_MS);
    expect(
      controller.afterRoomMutation().status.aggregate.abandonedDuringDrainRooms,
    ).toBe(1);

    expect(controller.releaseDrain().status).toMatchObject({
      phase: "accepting",
      aggregate: { abandonedDuringDrainRooms: 0 },
    });
    const resumed = controller.attemptResume({
      normal: () => manager.resume(host.room.code, host.player.token),
      bounded: () =>
        manager.resumeDuringDrain(host.room.code, host.player.token, GRACE_MS),
    });
    if (!resumed.session)
      throw new Error("resume should work before server gates land");
    expect(controller.afterRoomMutation().status.phase).toBe("accepting");
    expect(controller.startDrain().status).toMatchObject({
      phase: "draining",
      aggregate: { blockingDrainRooms: 1, abandonedDuringDrainRooms: 0 },
    });
  });

  it("reevaluates synchronously after a rejected or throwing resume callback", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const controller = controllerFor(manager, clock.now);
    const expired = manager.create("期限切れ卓");
    const active = manager.create("継続卓");
    controller.startDrain();
    manager.disconnectDuringDrain(expired.room, expired.player);
    controller.afterRoomMutation();
    clock.advance(GRACE_MS);

    const rejected = controller.attemptResume({
      normal: () => manager.resume(expired.room.code, expired.player.token),
      bounded: () =>
        manager.resumeDuringDrain(
          expired.room.code,
          expired.player.token,
          GRACE_MS,
        ),
    });
    expect(rejected).toMatchObject({
      outcome: "completed",
      session: null,
      transition: { changed: false, status: { phase: "draining" } },
    });
    expect(expired.player.connected).toBe(false);
    expect(controller.status()).toMatchObject({
      phase: "draining",
      aggregate: {
        blockingDrainRooms: 1,
        abandonedDuringDrainRooms: 1,
      },
    });

    const failed = controller.attemptResume({
      normal: () => null,
      bounded: () => {
        manager.disconnectDuringDrain(active.room, active.player);
        throw new Error("transport failed after mutation");
      },
    });
    expect(failed).toMatchObject({
      outcome: "failed",
      session: null,
      error: new Error("transport failed after mutation"),
      transition: {
        changed: false,
        status: {
          phase: "draining",
          aggregate: { blockingDrainRooms: 1, reconnectGraceRooms: 1 },
        },
      },
    });
    if (failed.outcome !== "failed") {
      throw new Error("throwing callback must return failed outcome");
    }
    expect(failed.error).toEqual(new Error("transport failed after mutation"));
    expect(JSON.stringify(failed)).not.toContain("transport failed");
    expect(JSON.stringify(failed)).not.toContain('"error"');
    expect(controller.status()).toMatchObject({
      phase: "draining",
      aggregate: { blockingDrainRooms: 1, reconnectGraceRooms: 1 },
    });
  });

  it("uses a non-regressing process-local drain start time", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const controller = controllerFor(manager, clock.now);
    manager.create("ホスト");

    expect(controller.startDrain().status.drainStartedMonotonicMs).toBe(5_000);
    controller.releaseDrain();
    clock.set(1_000);
    expect(controller.startDrain().status.drainStartedMonotonicMs).toBe(5_000);
    expect(Object.isFrozen(controller.status())).toBe(true);
  });

  it("seals through status when time alone expires the last blocker", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const controller = controllerFor(manager, clock.now);
    const host = manager.create("ホスト");
    controller.startDrain();
    manager.disconnectDuringDrain(host.room, host.player);
    controller.afterRoomMutation();
    clock.advance(GRACE_MS);

    expect(controller.status()).toMatchObject({
      phase: "drained",
      aggregate: { blockingDrainRooms: 0, abandonedDuringDrainRooms: 1 },
    });
  });
});
