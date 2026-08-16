import { describe, expect, it } from "vitest";
import {
  type ConnectionState,
  hasOpenPeer,
  registerReplacementBeforeClose,
} from "./connectionState";
import { RoomManager } from "./roomManager";

function connection(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    key: {},
    room: {},
    playerId: "p0",
    readyState: 1,
    ...overrides,
  };
}

describe("hasOpenPeer", () => {
  it("同じ席のopenソケットが残っていれば旧ソケットを切断扱いにしない", () => {
    const client = connection();
    const peer = connection({ room: client.room, playerId: client.playerId });

    expect(hasOpenPeer(client, [client, peer])).toBe(true);
  });

  it("closing/closedや別席のソケットは生存中の同席とはみなさない", () => {
    const client = connection();

    expect(
      hasOpenPeer(client, [
        client,
        connection({
          room: client.room,
          playerId: client.playerId,
          readyState: 2,
        }),
        connection({
          room: client.room,
          playerId: client.playerId,
          readyState: 3,
        }),
        connection({ room: client.room, playerId: "p1" }),
        connection({ room: {}, playerId: client.playerId }),
      ]),
    ).toBe(false);
  });
});

describe("registerReplacementBeforeClose", () => {
  it("publishes the replacement state before the old socket close callback", () => {
    const session = new RoomManager().create("テスト");
    const client = {
      room: null as typeof session.room | null,
      player: null as typeof session.player | null,
    };
    const events: string[] = [];

    registerReplacementBeforeClose(
      client,
      session,
      () => events.push("touch"),
      () => {
        expect(client.room).toBe(session.room);
        expect(client.player).toBe(session.player);
        events.push("close");
      },
    );

    expect(events).toEqual(["touch", "close"]);
  });
});
