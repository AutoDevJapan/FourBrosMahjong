import { describe, expect, it } from "vitest";
import { MAX_PLAYER_NAME_LENGTH } from "../src/lib/playerName";
import {
  normalizePlayerName,
  parseGameAction,
  RoomManager,
  type RoomSession,
} from "./roomManager";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import { createGame } from "../src/domain/game/engine";

function reachGameEnd(manager: RoomManager, host: RoomSession): void {
  const { journal } = walkToGameEnd(2024);
  host.room.state = createGame({ seed: journal.seed });
  for (const action of journal.actions) {
    const result = manager.apply(
      host.room,
      host.player,
      action,
      host.room.version,
    );
    if (!result.ok) throw new Error(result.error);
  }
  if (host.room.state.phase !== "gameEnd") {
    throw new Error("fixture should finish at gameEnd");
  }
}

describe("online room manager", () => {
  it("normalizes names by grapheme and repairs malformed UTF-16 at the server boundary", () => {
    const withinLimit = `${"あ".repeat(MAX_PLAYER_NAME_LENGTH - 1)}😀`;

    expect(normalizePlayerName(withinLimit)).toBe(withinLimit);
    expect(normalizePlayerName("😀".repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBe(
      "😀".repeat(MAX_PLAYER_NAME_LENGTH),
    );
    expect(normalizePlayerName("名前\uD83D")).toBe("名前�");
    expect(normalizePlayerName("   ")).toBe("ゲスト");
  });

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

  it("does not let the host reset an active room", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const before = manager.snapshot(host.room, host.player);

    const result = manager.newGame(host.room, host.player);

    expect(result).toMatchObject({
      ok: false,
      error: "新しい半荘を始められるのは対局終了後です。",
    });
    const after = manager.snapshot(host.room, host.player);
    expect(after.version).toBe(before.version);
    expect(after.phase).toBe(before.phase);
    expect(after.view).toEqual(before.view);
    expect(after.pending).toEqual(before.pending);
    expect(after.roundSummary).toEqual(before.roundSummary);
    expect(after.players).toEqual(before.players);
    expect(after.currentTurn).toBe(before.currentTurn);
  });

  it("rejects non-host newGame even after a real gameEnd", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    reachGameEnd(manager, host);
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join at gameEnd");

    const before = manager.snapshot(host.room, host.player);
    expect(before.phase).toBe("gameEnd");
    const result = manager.newGame(host.room, guest.player);

    expect(result).toMatchObject({
      ok: false,
      error: "新しい半荘を始められるのはホストだけです。",
    });
    expect(manager.snapshot(host.room, host.player)).toEqual(before);
  });

  it("lets the host start a new game after a real gameEnd", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    reachGameEnd(manager, host);
    const before = manager.snapshot(host.room, host.player);
    const beforeVersion = before.version;
    expect(before.phase).toBe("gameEnd");

    const result = manager.newGame(host.room, host.player);

    expect(result).toMatchObject({ ok: true, stateChanged: true });
    const after = manager.snapshot(host.room, host.player);
    expect(after.phase).toBe("playing");
    expect(after.version).toBe(beforeVersion + 1);
    expect(after.roundSummary).toBeNull();
    expect(after.view.result).toBeNull();
    expect(after.players).toEqual(before.players);
  });

  it("validates action tiles before the engine sees them", () => {
    for (const rank of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(
        parseGameAction({
          type: "discard",
          tile: { suit: "man", rank, isRed: false },
        }),
      ).toEqual({
        type: "discard",
        tile: { suit: "man", rank, isRed: false },
      });
    }
    expect(
      parseGameAction({
        type: "discard",
        tile: { suit: "man", rank: 10, isRed: false },
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
