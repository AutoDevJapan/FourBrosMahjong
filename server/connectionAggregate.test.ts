import { describe, expect, it } from "vitest";
import { connectionAggregateCounts } from "./connectionAggregate";
import { RoomManager } from "./roomManager";

describe("connectionAggregateCounts", () => {
  it("counts both physical replacement peers while seats remain unique", () => {
    const manager = new RoomManager({ monotonicNow: () => 1_000 });
    const session = manager.create("ホスト");
    const connections = connectionAggregateCounts(
      [
        { room: session.room, player: session.player, superseded: true },
        { room: session.room, player: session.player, superseded: false },
      ],
      0,
    );
    expect(connections).toEqual({
      webSocketConnections: 2,
      attachedSessionConnections: 2,
      pendingUpgrades: 0,
    });
    expect(manager.aggregateSnapshot(60_000, connections)).toMatchObject({
      webSocketConnections: 2,
      attachedSessionConnections: 2,
      pendingUpgrades: 0,
      uniqueConnectedSeats: 1,
    });
  });
});
