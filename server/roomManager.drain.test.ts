import { describe, expect, it } from "vitest";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import { createGame, removeHumanPlayerIds } from "../src/domain/game/engine";
import {
  type ConnectionAggregateCounts,
  ONLINE_DRAIN_RECONNECT_GRACE_MS,
  RoomManager,
  type RoomSession,
} from "./roomManager";

const GRACE_MS = ONLINE_DRAIN_RECONNECT_GRACE_MS.default;

function fakeClock(initial = 1_000_000) {
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

const CONNECTIONS: ConnectionAggregateCounts = {
  webSocketConnections: 4,
  attachedSessionConnections: 3,
  pendingUpgrades: 2,
};

function reachRoundEnd(manager: RoomManager, host: RoomSession): void {
  const { journal } = walkToGameEnd(2024);
  const firstNextRound = journal.actions.findIndex(
    (action) => action.type === "nextRound",
  );
  if (firstNextRound < 0) throw new Error("fixture should reach roundEnd");
  host.room.state = createGame({ seed: journal.seed });
  for (const action of journal.actions.slice(0, firstNextRound)) {
    const result = manager.apply(
      host.room,
      host.player,
      action,
      host.room.version,
    );
    if (!result.ok) throw new Error(result.error);
  }
}

function disconnectAtDeterministicRoundEnd(
  manager: RoomManager,
  session: RoomSession,
): void {
  session.room.state = createGame({
    seed: 0,
    humanPlayerIds: ["p0"],
    explicitKitaPlayerIds: [],
  });
  manager.disconnect(session.room, session.player);
  expect(session.room.state.phase).toBe("roundEnd");
}

describe("RoomManager drain aggregates", () => {
  it("returns numeric privacy-safe aggregates without confusing socket and seat counts", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("秘密のホスト名");
    const guest = manager.join(host.room.code, "秘密のゲスト名");
    if (!guest) throw new Error("guest should join");

    const snapshot = manager.aggregateSnapshot(GRACE_MS, CONNECTIONS);

    expect(snapshot).toEqual({
      retainedRooms: 1,
      connectedRooms: 1,
      blockingDrainRooms: 1,
      reconnectGraceRooms: 0,
      completedConnectedRooms: 0,
      abandonedDuringDrainRooms: 0,
      webSocketConnections: 4,
      attachedSessionConnections: 3,
      uniqueConnectedSeats: 2,
      pendingUpgrades: 2,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(host.room.code);
    expect(serialized).not.toContain(host.player.token);
    expect(serialized).not.toContain(guest.player.token);
    expect(serialized).not.toContain("秘密のホスト名");
    expect(serialized).not.toContain("秘密のゲスト名");
    expect(serialized).not.toContain("drainFrozenPlayerIds");
    expect(Object.values(snapshot).every(Number.isSafeInteger)).toBe(true);
  });

  it("rejects invalid grace and external connection counts without widening status", () => {
    const manager = new RoomManager();

    expect(() => manager.aggregateSnapshot(14_999)).toThrow(RangeError);
    expect(() => manager.aggregateSnapshot(300_001)).toThrow(RangeError);
    expect(() =>
      manager.aggregateSnapshot(GRACE_MS, {
        ...CONNECTIONS,
        pendingUpgrades: -1,
      }),
    ).toThrow(RangeError);
  });

  it("freezes the last connected playing seat and resumes the same pending input within grace", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    const pendingBefore = host.room.state.pending;
    const versionBefore = host.room.version;

    manager.disconnectDuringDrain(host.room, host.player);

    expect(host.room.state.phase).toBe("playing");
    expect(host.room.state.pending).toEqual(pendingBefore);
    expect(host.room.state.humanPlayerIds).toContain("p0");
    expect(host.room.version).toBe(versionBefore);
    const observer = manager.createDrainAggregateObserver(GRACE_MS);
    expect(observer.snapshot()).toMatchObject({
      connectedRooms: 0,
      blockingDrainRooms: 1,
      reconnectGraceRooms: 1,
    });

    clock.advance(GRACE_MS - 1);
    const resumed = manager.resumeDuringDrain(
      host.room.code,
      host.player.token,
      GRACE_MS,
    );
    expect(resumed?.player.id).toBe("p0");
    expect(host.room.state.pending).toEqual(pendingBefore);
    expect(host.room.state.humanPlayerIds).toContain("p0");
    expect(observer.snapshot()).toMatchObject({
      connectedRooms: 1,
      blockingDrainRooms: 1,
      reconnectGraceRooms: 0,
      abandonedDuringDrainRooms: 0,
    });
  });

  it("keeps ordinary disconnect identical to the pre-drain AI handoff", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    host.room.state = createGame({
      seed: 0,
      humanPlayerIds: ["p0"],
      explicitKitaPlayerIds: [],
    });
    const expected = removeHumanPlayerIds(
      createGame({
        seed: 0,
        humanPlayerIds: ["p0"],
        explicitKitaPlayerIds: [],
      }),
      ["p0"],
    );

    manager.disconnect(host.room, host.player);

    expect(host.room.state.phase).toBe(expected.phase);
    expect(host.room.state.pending).toEqual(expected.pending);
    expect(host.room.state.humanPlayerIds).toEqual(expected.humanPlayerIds);
    expect(host.room.state.lastRound).toEqual(expected.lastRound);
    expect(host.room.version).toBe(1);
    expect(host.room.drainFrozenPlayerIds.size).toBe(0);
  });

  it("keeps the existing AI handoff when a connected guest remains", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");
    host.room.state = createGame({
      seed: 0,
      names: ["ホスト", "ゲスト", "ゲスト3", "ゲスト4"],
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: [],
    });

    manager.disconnectDuringDrain(host.room, host.player);

    expect(host.room.state.humanPlayerIds).toEqual(["p1"]);
    expect(host.room.hostId).toBe("p1");
    expect(host.room.state.pending?.playerId).toBe("p1");
    expect(manager.aggregateSnapshot()).toMatchObject({
      connectedRooms: 1,
      blockingDrainRooms: 1,
      reconnectGraceRooms: 0,
      uniqueConnectedSeats: 1,
    });
  });

  it("does not bump version by re-removing a historical disconnected seat on join", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "旧ゲスト");
    if (!guest) throw new Error("guest should join");
    host.room.state = createGame({
      seed: 0,
      names: ["ホスト", "旧ゲスト", "新ゲスト", "ゲスト4"],
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: [],
    });
    manager.disconnect(guest.room, guest.player);
    const versionBeforeJoin = host.room.version;

    const nextGuest = manager.join(host.room.code, "新ゲスト");

    expect(nextGuest?.player.id).toBe("p2");
    expect(host.room.version).toBe(versionBeforeJoin);
    expect(host.room.state.humanPlayerIds).toEqual(["p0", "p2"]);
    expect(host.room.drainFrozenPlayerIds.size).toBe(0);
  });

  it("releases a frozen disconnected host when a different guest joins", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    manager.disconnectDuringDrain(host.room, host.player);
    expect(host.room.state.pending?.playerId ?? "p0").toBe("p0");

    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");

    expect(host.room.state.humanPlayerIds).toEqual(["p1"]);
    expect(host.room.state.pending?.playerId).toBe("p1");
    expect(manager.snapshot(guest.room, guest.player).pending?.playerId).toBe(
      "p1",
    );
    expect(host.room.hostId).toBe("p1");

    const resumedHost = manager.resume(host.room.code, host.player.token);
    expect(resumedHost?.player.id).toBe("p0");
    expect(host.player.connected).toBe(true);
    expect(host.room.state.humanPlayerIds).toEqual(["p0", "p1"]);
    expect(host.room.hostId).toBe("p1");
    expect(host.room.state.pending?.playerId).toBe("p1");
  });

  it("lets a new guest host advance a frozen roundEnd without deadlock", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("旧ホスト");
    reachRoundEnd(manager, host);
    manager.disconnectDuringDrain(host.room, host.player);

    const guest = manager.join(host.room.code, "新ホスト");
    if (!guest) throw new Error("guest should join");
    expect(host.room.state.phase).toBe("roundEnd");
    expect(host.room.state.humanPlayerIds).toEqual(["p1"]);
    expect(host.room.hostId).toBe("p1");

    expect(
      manager.apply(
        guest.room,
        guest.player,
        { type: "nextRound" },
        guest.room.version,
      ),
    ).toMatchObject({ ok: true });
    expect(host.room.state.phase).toBe("playing");
    expect(host.room.state.pending?.playerId).toBe("p1");
  });

  it("does not treat a connected or disconnected gameEnd room as a blocker", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    host.room.state = walkToGameEnd(2024).state;

    expect(manager.aggregateSnapshot()).toMatchObject({
      connectedRooms: 1,
      completedConnectedRooms: 1,
      blockingDrainRooms: 0,
    });

    manager.disconnectDuringDrain(host.room, host.player);
    expect(manager.aggregateSnapshot()).toMatchObject({
      connectedRooms: 0,
      completedConnectedRooms: 0,
      blockingDrainRooms: 0,
      reconnectGraceRooms: 0,
    });
    expect(host.room.drainFrozenPlayerIds.size).toBe(0);
  });

  it("keeps a fully disconnected roundEnd room resumable inside grace", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    reachRoundEnd(manager, host);
    expect(host.room.state.phase).toBe("roundEnd");

    manager.disconnect(host.room, host.player);
    const observer = manager.createDrainAggregateObserver(GRACE_MS);
    expect(host.room.state.phase).toBe("roundEnd");
    expect(observer.snapshot()).toMatchObject({
      blockingDrainRooms: 1,
      reconnectGraceRooms: 1,
    });
    expect(
      manager.resumeDuringDrain(host.room.code, host.player.token, GRACE_MS),
    ).not.toBeNull();
    expect(host.room.state.phase).toBe("roundEnd");
  });

  it("removes an explicit last-seat leave immediately without counting abandonment", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    const observer = manager.createDrainAggregateObserver(GRACE_MS);
    expect(observer.snapshot().blockingDrainRooms).toBe(1);

    manager.leave(host.room, host.player);

    expect(observer.snapshot()).toMatchObject({
      retainedRooms: 1,
      connectedRooms: 0,
      blockingDrainRooms: 0,
      reconnectGraceRooms: 0,
      abandonedDuringDrainRooms: 0,
    });
    expect(manager.resume(host.room.code, host.player.token)).toBeNull();
  });

  it("uses only the remaining grace for a room disconnected before drain", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    disconnectAtDeterministicRoundEnd(manager, host);
    clock.advance(45_000);
    const observer = manager.createDrainAggregateObserver(GRACE_MS);

    expect(observer.snapshot()).toMatchObject({
      blockingDrainRooms: 1,
      reconnectGraceRooms: 1,
    });
    clock.advance(14_999);
    expect(observer.snapshot().blockingDrainRooms).toBe(1);
    clock.advance(1);
    expect(observer.snapshot()).toMatchObject({
      blockingDrainRooms: 0,
      reconnectGraceRooms: 0,
      abandonedDuringDrainRooms: 1,
    });
  });

  it("does not add a fresh grace or abandonment count to an already-expired room", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    disconnectAtDeterministicRoundEnd(manager, host);
    clock.advance(GRACE_MS);

    const observer = manager.createDrainAggregateObserver(GRACE_MS);
    expect(observer.snapshot()).toMatchObject({
      retainedRooms: 1,
      blockingDrainRooms: 0,
      reconnectGraceRooms: 0,
      abandonedDuringDrainRooms: 0,
    });
    expect(
      manager.resumeDuringDrain(host.room.code, host.player.token, GRACE_MS),
    ).toBeNull();
    expect(host.player.connected).toBe(false);

    // Outside drain, the existing resume contract remains unchanged. Use a
    // separate room so this TTL assertion continues observing the expired one.
    const normal = manager.create("通常復帰");
    manager.disconnect(normal.room, normal.player);
    clock.advance(GRACE_MS);
    expect(
      manager.resume(normal.room.code, normal.player.token),
    ).not.toBeNull();

    // Reconnect grace changes blocker classification, not the existing 1-hour
    // room retention contract.
    clock.set(1_000_000 + 60 * 60 * 1_000 - 1);
    manager.sweep();
    expect(observer.snapshot().retainedRooms).toBe(2);
    clock.advance(1);
    manager.sweep();
    expect(observer.snapshot().retainedRooms).toBe(2);
    clock.advance(1);
    manager.sweep();
    expect(observer.snapshot().retainedRooms).toBe(1);
  });

  it("counts each room abandoned during one drain epoch at most once", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const first = manager.create("一卓目");
    disconnectAtDeterministicRoundEnd(manager, first);
    const observer = manager.createDrainAggregateObserver(GRACE_MS);

    clock.advance(GRACE_MS / 2);
    const second = manager.create("二卓目");
    manager.disconnectDuringDrain(second.room, second.player);
    expect(observer.snapshot()).toMatchObject({
      blockingDrainRooms: 2,
      reconnectGraceRooms: 2,
      abandonedDuringDrainRooms: 0,
    });
    clock.advance(GRACE_MS / 2);
    expect(observer.snapshot()).toMatchObject({
      blockingDrainRooms: 1,
      reconnectGraceRooms: 1,
      abandonedDuringDrainRooms: 1,
    });
    expect(observer.snapshot().abandonedDuringDrainRooms).toBe(1);
    clock.advance(GRACE_MS / 2);
    expect(observer.snapshot()).toMatchObject({
      blockingDrainRooms: 0,
      reconnectGraceRooms: 0,
      abandonedDuringDrainRooms: 2,
    });
  });

  it("accounts for an expired grace candidate even when sweep removes it first", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    disconnectAtDeterministicRoundEnd(manager, host);
    const observer = manager.createDrainAggregateObserver(GRACE_MS);

    clock.advance(60 * 60 * 1_000 + 1);
    manager.sweep();

    expect(observer.snapshot()).toMatchObject({
      retainedRooms: 0,
      blockingDrainRooms: 0,
      reconnectGraceRooms: 0,
      abandonedDuringDrainRooms: 1,
    });
    expect(observer.snapshot().abandonedDuringDrainRooms).toBe(1);
  });

  it("clamps a regressing injected clock so grace cannot be extended", () => {
    const clock = fakeClock();
    const manager = new RoomManager({ monotonicNow: clock.now });
    const host = manager.create("ホスト");
    disconnectAtDeterministicRoundEnd(manager, host);
    const observer = manager.createDrainAggregateObserver(GRACE_MS);

    clock.advance(GRACE_MS);
    expect(observer.snapshot().blockingDrainRooms).toBe(0);
    clock.set(0);
    expect(observer.snapshot().blockingDrainRooms).toBe(0);
  });

  it("samples time once before a mutation and never leaves a partial frozen seat", () => {
    const samples = [1_000, Number.NaN, 1_001];
    const manager = new RoomManager({
      monotonicNow: () => samples.shift() ?? 1_001,
    });
    const host = manager.create("ホスト");
    const stateBefore = host.room.state;
    const lastSeenBefore = host.player.lastSeenAt;
    const lastActivityBefore = host.room.lastActivityAt;

    expect(() => manager.disconnectDuringDrain(host.room, host.player)).toThrow(
      RangeError,
    );
    expect(host.player).toMatchObject({
      connected: true,
      lastSeenAt: lastSeenBefore,
    });
    expect(host.room.state).toBe(stateBefore);
    expect(host.room.lastActivityAt).toBe(lastActivityBefore);
    expect(host.room.drainFrozenPlayerIds.size).toBe(0);

    const guest = manager.join(host.room.code, "ゲスト");
    expect(guest?.player.id).toBe("p1");
    expect(host.room.state.humanPlayerIds).toEqual(["p0", "p1"]);
    expect(host.room.state.pending?.playerId ?? "p0").toBe("p0");
    expect(host.player.connected).toBe(true);
  });

  it("rejects invalid mutation timestamps before changing shared room state", () => {
    const joinClock = fakeClock();
    const joinManager = new RoomManager({ monotonicNow: joinClock.now });
    const joinHost = joinManager.create("ホスト");
    joinClock.set(Number.NaN);
    expect(() => joinManager.join(joinHost.room.code, "ゲスト")).toThrow(
      RangeError,
    );
    expect(joinHost.room.players.size).toBe(1);
    expect(joinHost.room.state.humanPlayerIds).toEqual(["p0"]);

    const resumeClock = fakeClock();
    const resumeManager = new RoomManager({ monotonicNow: resumeClock.now });
    const resumeHost = resumeManager.create("ホスト");
    resumeManager.disconnect(resumeHost.room, resumeHost.player);
    const resumeState = resumeHost.room.state;
    const resumeVersion = resumeHost.room.version;
    resumeClock.set(Number.NaN);
    expect(() =>
      resumeManager.resume(resumeHost.room.code, resumeHost.player.token),
    ).toThrow(RangeError);
    expect(resumeHost.player.connected).toBe(false);
    expect(resumeHost.room.state).toBe(resumeState);
    expect(resumeHost.room.version).toBe(resumeVersion);

    const touchClock = fakeClock();
    const touchManager = new RoomManager({ monotonicNow: touchClock.now });
    const touchHost = touchManager.create("ホスト");
    const touchSeenAt = touchHost.player.lastSeenAt;
    const touchActivityAt = touchHost.room.lastActivityAt;
    touchClock.set(Number.NaN);
    expect(() => touchManager.touch(touchHost.room, touchHost.player)).toThrow(
      RangeError,
    );
    expect(touchHost.player.lastSeenAt).toBe(touchSeenAt);
    expect(touchHost.room.lastActivityAt).toBe(touchActivityAt);

    const leaveClock = fakeClock();
    const leaveManager = new RoomManager({ monotonicNow: leaveClock.now });
    const leaveHost = leaveManager.create("ホスト");
    leaveClock.set(Number.NaN);
    expect(() => leaveManager.leave(leaveHost.room, leaveHost.player)).toThrow(
      RangeError,
    );
    expect(leaveHost.player).toMatchObject({
      connected: true,
      resumable: true,
    });
    expect(leaveHost.room.reusableSeatIds.size).toBe(0);
    expect(leaveHost.room.state.humanPlayerIds).toEqual(["p0"]);

    const newGameClock = fakeClock();
    const newGameManager = new RoomManager({ monotonicNow: newGameClock.now });
    const newGameHost = newGameManager.create("ホスト");
    newGameHost.room.state = walkToGameEnd(2024).state;
    const finishedState = newGameHost.room.state;
    const finishedVersion = newGameHost.room.version;
    newGameClock.set(Number.NaN);
    expect(() =>
      newGameManager.newGame(newGameHost.room, newGameHost.player),
    ).toThrow(RangeError);
    expect(newGameHost.room.state).toBe(finishedState);
    expect(newGameHost.room.version).toBe(finishedVersion);
    expect(newGameHost.room.humanPlayerIds).toEqual(new Set(["p0"]));
  });
});
