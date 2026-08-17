import { describe, expect, it } from "vitest";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import { createGame } from "../src/domain/game/engine";
import { MAX_PLAYER_NAME_LENGTH } from "../src/lib/playerName";
import {
  normalizePlayerName,
  parseGameAction,
  RoomManager,
  type RoomSession,
} from "./roomManager";

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

function reachRoundEnd(manager: RoomManager, host: RoomSession): void {
  const { journal } = walkToGameEnd(2024);
  const firstNextRound = journal.actions.findIndex(
    (action) => action.type === "nextRound",
  );
  if (firstNextRound === -1) throw new Error("fixture should reach roundEnd");
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
  if (host.room.state.phase !== "roundEnd") {
    throw new Error("fixture should stop at roundEnd");
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

  it("keeps nextRound host-only at roundEnd", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    reachRoundEnd(manager, host);
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join at roundEnd");

    const before = manager.snapshot(guest.room, guest.player);
    expect(before.phase).toBe("roundEnd");
    const result = manager.apply(
      guest.room,
      guest.player,
      { type: "nextRound" },
      before.version,
    );

    expect(result).toMatchObject({
      ok: false,
      error: "次の局へ進められるのはホストだけです。",
    });
    expect(manager.snapshot(guest.room, guest.player)).toEqual(before);
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

  it("keeps a disconnected seat out of the new game after resume", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");
    reachGameEnd(manager, host);

    manager.disconnect(guest.room, guest.player);
    const started = manager.newGame(host.room, host.player);
    expect(started.ok).toBe(true);
    expect(host.room.state.humanPlayerIds).toEqual(["p0"]);

    const firstDraw = host.room.state.hand?.drawn?.tile;
    if (!firstDraw) throw new Error("host should start on a draw decision");
    const afterHost = manager.apply(
      host.room,
      host.player,
      { type: "discard", tile: firstDraw },
      host.room.version,
    );
    expect(afterHost.ok).toBe(true);
    expect(manager.snapshot(host.room, host.player).pending?.playerId).toBe(
      "p0",
    );

    const resumed = manager.resume(host.room.code, guest.player.token);
    expect(resumed?.player.id).toBe("p1");
    expect(host.room.state.humanPlayerIds).toEqual(["p0"]);

    // The resumed socket can disappear again before the host advances. It
    // must not make p1 a blocking pending player in this fresh half-game.
    if (!resumed) throw new Error("guest should resume");
    manager.disconnect(resumed.room, resumed.player);
    const resumedGameDraw = host.room.state.hand?.drawn?.tile;
    if (!resumedGameDraw) throw new Error("host should have a drawn tile");
    const afterResume = manager.apply(
      host.room,
      host.player,
      { type: "discard", tile: resumedGameDraw },
      host.room.version,
    );
    expect(afterResume.ok).toBe(true);
    expect(manager.snapshot(host.room, host.player).pending?.playerId).toBe(
      "p0",
    );
  });

  it("does not reintroduce a disconnected seat when another player joins after newGame", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");
    reachGameEnd(manager, host);

    manager.disconnect(guest.room, guest.player);
    const started = manager.newGame(host.room, host.player);
    expect(started.ok).toBe(true);

    const lateGuest = manager.join(host.room.code, "後参加");
    expect(lateGuest?.player.id).toBe("p2");
    expect(host.room.state.humanPlayerIds).toEqual(["p0", "p2"]);

    const firstDraw = host.room.state.hand?.drawn?.tile;
    if (!firstDraw) throw new Error("host should start on a draw decision");
    const afterHost = manager.apply(
      host.room,
      host.player,
      { type: "discard", tile: firstDraw },
      host.room.version,
    );
    expect(afterHost.ok).toBe(true);
    // p2 is the newly joined human seat; p1 must not be resurrected merely
    // because it is still retained in room.players for resume.
    expect(manager.snapshot(host.room, host.player).pending?.playerId).not.toBe(
      "p1",
    );
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
