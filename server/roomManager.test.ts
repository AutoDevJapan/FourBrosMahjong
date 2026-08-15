import { describe, expect, it } from "vitest";
import { parseGameAction, RoomManager } from "./roomManager";

describe("online room manager", () => {
  it("creates a room, assigns the next human seat, and rejects stale actions", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");

    expect(manager.snapshot(host.room, host.player).you).toBe("p0");
    expect(manager.snapshot(guest.room, guest.player).you).toBe("p1");
    expect(manager.snapshot(guest.room, guest.player).pending).toBeNull();

    const drawn = host.room.state.hand?.drawn?.tile;
    if (!drawn) throw new Error("host should start on a draw decision");
    const result = manager.apply(
      host.room,
      host.player,
      { type: "discard", tile: drawn },
      0,
    );
    expect(result.ok).toBe(true);
    expect(manager.snapshot(guest.room, guest.player).pending?.playerId).toBe(
      "p1",
    );

    const stale = manager.apply(
      guest.room,
      guest.player,
      { type: "discard", tile: drawn },
      0,
    );
    expect(stale.ok).toBe(false);
  });

  it("keeps reconnect tokens private and limits a room to four seats", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const sessions = [
      manager.join(host.room.code, "二人目"),
      manager.join(host.room.code, "三人目"),
      manager.join(host.room.code, "四人目"),
    ];
    expect(sessions.every((session) => session !== null)).toBe(true);
    expect(manager.join(host.room.code, "満席")).toBeNull();
    expect(manager.resume(host.room.code, host.player.token)?.player.id).toBe(
      "p0",
    );
    expect(manager.resume(host.room.code, "not-a-token")).toBeNull();
  });

  it("validates action tiles before the engine sees them", () => {
    expect(
      parseGameAction({
        type: "discard",
        tile: { suit: "man", rank: 2, isRed: false },
      }),
    ).toBeNull();
    expect(
      parseGameAction({
        type: "discard",
        tile: { suit: "pin", rank: 5, isRed: true },
      }),
    ).toEqual({
      type: "discard",
      tile: { suit: "pin", rank: 5, isRed: true },
    });
  });
});
