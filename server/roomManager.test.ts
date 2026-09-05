import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import { createGame, discard, seatOfPlayer } from "../src/domain/game/engine";
import {
  ONLINE_RESUME_TOKEN_MAX_LENGTH,
  ONLINE_RESUME_TOKEN_MIN_LENGTH,
} from "../src/domain/online/types";
import {
  MAX_PLAYER_NAME_CODE_UNITS,
  MAX_PLAYER_NAME_LENGTH,
} from "../src/lib/playerName";
import {
  normalizePlayerName,
  parseGameAction,
  RoomManager,
  type RoomSession,
} from "./roomManager";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

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

function stayAtPlaying(): void {}
describe("online room manager", () => {
  it("normalizes names by grapheme and repairs malformed UTF-16 at the server boundary", () => {
    const withinLimit = `${"あ".repeat(MAX_PLAYER_NAME_LENGTH - 1)}😀`;

    expect(normalizePlayerName(withinLimit)).toBe(withinLimit);
    expect(normalizePlayerName("😀".repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBe(
      "😀".repeat(MAX_PLAYER_NAME_LENGTH),
    );
    expect(normalizePlayerName("名前\uD83D")).toBe("名前�");
    expect(normalizePlayerName("   ")).toBe("ゲスト");
    expect(normalizePlayerName("\u200B\u2060\uFEFF")).toBe("ゲスト");
    expect(normalizePlayerName("A\u202EB")).toBe("AB");
    expect(normalizePlayerName("A\u001bB\u0000C\u009bD")).toBe("ABCD");
    expect(normalizePlayerName("עברית")).toBe("עברית");
  });

  it("falls back when bounded sanitization would otherwise produce an empty name", () => {
    const visibleAfterBoundedPrefix =
      "\u0301".repeat(MAX_PLAYER_NAME_CODE_UNITS) + "A";
    const invisibleAfterGraphemeLimit =
      "\u0301 ".repeat(MAX_PLAYER_NAME_LENGTH - 1) + "A";

    expect(normalizePlayerName(visibleAfterBoundedPrefix)).toBe("ゲスト");
    expect(normalizePlayerName(visibleAfterBoundedPrefix, "ホスト")).toBe(
      "ホスト",
    );
    expect(normalizePlayerName(invisibleAfterGraphemeLimit)).toBe("ゲスト");
    expect(normalizePlayerName(invisibleAfterGraphemeLimit, "ホスト")).toBe(
      "ホスト",
    );
  });

  it("create/joinの直接入力でも不可視名をroom stateへ保存しない", () => {
    const manager = new RoomManager();
    const host = manager.create("\u200B");
    expect(host.player.name).toBe("ホスト");
    expect(host.room.state.players[0]?.name).toBe("ホスト");

    const guest = manager.join(host.room.code, "\u202Eא");
    if (!guest) throw new Error("guest should join");
    expect(guest.player.name).toBe("א");
    expect(guest.room.state.players[1]?.name).toBe("א");

    const controlRoom = manager.create("A\u001bB\u0000C\u009bD");
    expect(controlRoom.player.name).toBe("ABCD");
    expect(controlRoom.room.state.players[0]?.name).toBe("ABCD");

    const boundedInvisible = "\u0301 ".repeat(MAX_PLAYER_NAME_LENGTH - 1) + "A";
    const boundedHost = manager.create(boundedInvisible);
    expect(boundedHost.player.name).toBe("ホスト");
    const boundedGuest = manager.join(boundedHost.room.code, boundedInvisible);
    if (!boundedGuest) throw new Error("bounded invisible guest should join");
    expect(boundedGuest.player.name).toBe("ゲスト");
    expect(boundedGuest.room.state.players[1]?.name).toBe("ゲスト");
  });

  it("creates a room, assigns the next human seat, and rejects stale actions", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");

    // Room creation uses a crypto seed in production. Pin only this test's
    // game state so the first discard deterministically hands control to p1;
    // some valid seeds let an AI call and return control to p0 instead.
    host.room.state = createGame({
      seed: 0,
      names: ["ホスト", "ゲスト", "ゲスト3", "ゲスト4"],
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: [],
    });

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

  it("releases an explicitly departed guest before its pending turn can block the room", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");

    // `RoomManager.create` uses a crypto seed. Pin this fixture so the first
    // discard deterministically hands control to p1 before the guest leaves.
    host.room.state = createGame({
      seed: 0,
      names: ["ホスト", "ゲスト", "ゲスト3", "ゲスト4"],
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: [],
    });

    const drawn = host.room.state.hand?.drawn?.tile;
    if (!drawn) throw new Error("host should start on a draw decision");
    expect(
      manager.apply(
        host.room,
        host.player,
        { type: "discard", tile: drawn },
        host.room.version,
      ),
    ).toMatchObject({ ok: true });
    expect(manager.snapshot(host.room, guest.player).pending?.playerId).toBe(
      "p1",
    );

    manager.leave(guest.room, guest.player);

    const snapshot = manager.snapshot(host.room, host.player);
    expect(host.room.state.humanPlayerIds).toEqual(["p0"]);
    expect(snapshot.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p1", connected: false, isHost: false }),
      ]),
    );
    expect(snapshot.pending?.playerId).not.toBe("p1");
    expect(snapshot.departureNotice).toMatchObject({
      playerId: "p1",
      playerName: "ゲスト",
      nextAction: "表示された現在の手番に従って操作してください。",
    });
    expect(manager.resume(host.room.code, guest.player.token)).toBeNull();
    expect(manager.snapshot(host.room, host.player).hostId).toBe("p0");

    const rejoined = manager.join(host.room.code, "再参加");
    expect(rejoined?.player.id).toBe("p1");
    expect(manager.resume(host.room.code, guest.player.token)).toBeNull();
    expect(manager.snapshot(host.room, host.player).hostId).toBe("p0");
    expect(
      manager.apply(
        host.room,
        guest.player,
        { type: "passRon" },
        host.room.version,
      ),
    ).toMatchObject({ ok: false, error: "ルーム接続が無効です。" });

    // A repeated explicit leave/join cycle reuses the released seat instead
    // of consuming p2 and p3 until the room becomes falsely full.
    if (!rejoined) throw new Error("guest should rejoin");
    manager.leave(rejoined.room, rejoined.player);
    const rejoinedAgain = manager.join(host.room.code, "再参加2");
    expect(rejoinedAgain?.player.id).toBe("p1");
    expect(manager.join(host.room.code, "別ゲスト")?.player.id).toBe("p2");
  });

  it("hands playing host authority to a connected guest and releases the disconnected host turn", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");

    // `RoomManager.create` uses a crypto seed. Pin this fixture so the
    // promoted guest starts at a discard decision instead of occasionally
    // stopping at a random ron/call response with no drawn tile.
    host.room.state = createGame({
      seed: 0,
      names: ["ホスト", "ゲスト", "ゲスト3", "ゲスト4"],
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: [],
    });

    manager.disconnect(host.room, host.player);

    const snapshot = manager.snapshot(guest.room, guest.player);
    expect(snapshot.hostId).toBe("p1");
    expect(snapshot.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p0", connected: false, isHost: false }),
        expect.objectContaining({ id: "p1", connected: true, isHost: true }),
      ]),
    );
    expect(snapshot.hostNotice).toMatchObject({ reason: "disconnected" });
    expect(snapshot.hostNotice?.nextAction).toContain("手番");
    expect(snapshot.pending?.playerId).toBe("p1");

    const drawn = guest.room.state.hand?.drawn?.tile;
    if (!drawn) throw new Error("guest should receive a drawn tile");
    expect(
      manager.apply(
        guest.room,
        guest.player,
        { type: "discard", tile: drawn },
        snapshot.version,
      ),
    ).toMatchObject({ ok: true, stateChanged: true });
  });

  it("keeps an unexpected host disconnect resumable without restoring transferred authority", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");

    manager.disconnect(host.room, host.player);
    const resumed = manager.resume(host.room.code, host.player.token);

    expect(resumed?.player.id).toBe("p0");
    expect(manager.snapshot(guest.room, guest.player).hostId).toBe("p1");
    expect(manager.snapshot(resumed!.room, resumed!.player).players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p0", connected: true, isHost: false }),
        expect.objectContaining({ id: "p1", connected: true, isHost: true }),
      ]),
    );
  });

  it.each([
    ["playing", stayAtPlaying],
    ["roundEnd", reachRoundEnd],
    ["gameEnd", reachGameEnd],
  ] as const)(
    "transfers host authority after a host disconnect at %s",
    (_phase, prepare) => {
      const manager = new RoomManager();
      const host = manager.create("ホスト");
      prepare(manager, host);
      const guest = manager.join(host.room.code, "ゲスト");
      if (!guest) throw new Error("guest should join");

      manager.disconnect(host.room, host.player);

      const snapshot = manager.snapshot(guest.room, guest.player);
      expect(snapshot.hostId).toBe("p1");
      expect(
        snapshot.players.find((player) => player.id === "p1")?.isHost,
      ).toBe(true);
      if (_phase === "roundEnd") {
        expect(
          manager.apply(
            guest.room,
            guest.player,
            { type: "nextRound" },
            snapshot.version,
          ),
        ).toMatchObject({
          ok: true,
        });
      }
      if (_phase === "gameEnd") {
        expect(manager.newGame(guest.room, guest.player)).toMatchObject({
          ok: true,
          stateChanged: true,
        });
        expect(guest.room.state.humanPlayerIds).toEqual(["p1"]);
      }
    },
  );

  it("treats an explicit host exit as a handoff and rejects the old token while allowing a new join", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const guest = manager.join(host.room.code, "ゲスト");
    if (!guest) throw new Error("guest should join");

    manager.leave(host.room, host.player);

    const afterLeave = manager.snapshot(guest.room, guest.player);
    expect(afterLeave.hostId).toBe("p1");
    expect(afterLeave.hostNotice).toMatchObject({ reason: "left" });
    expect(manager.resume(host.room.code, host.player.token)).toBeNull();
    expect(manager.join(host.room.code, "再参加")?.player.id).toBe("p0");
    expect(manager.snapshot(guest.room, guest.player).hostId).toBe("p1");
  });

  it("reuses a promoted guest host seat after explicit leave without losing capacity", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const promoted = manager.join(host.room.code, "引継ぎゲスト");
    if (!promoted) throw new Error("promoted guest should join");

    manager.leave(host.room, host.player);
    expect(manager.snapshot(promoted.room, promoted.player).hostId).toBe("p1");

    // Reuse the original host seat so p1 remains the active promoted host
    // when the explicit-leave regression is exercised.
    const replacement = manager.join(host.room.code, "再参加ホスト席");
    expect(replacement?.player.id).toBe("p0");
    expect(manager.snapshot(promoted.room, promoted.player).hostId).toBe("p1");

    manager.leave(promoted.room, promoted.player);
    expect(manager.resume(host.room.code, promoted.player.token)).toBeNull();
    expect(
      manager.snapshot(replacement!.room, replacement!.player).hostId,
    ).toBe("p0");

    // The promoted host's p1 seat must be reusable, otherwise repeated joins
    // would consume p2/p3 and falsely report a full room.
    const rejoined = manager.join(host.room.code, "再参加ゲスト");
    expect(rejoined?.player.id).toBe("p1");
    expect(manager.join(host.room.code, "三人目")?.player.id).toBe("p2");
    expect(manager.join(host.room.code, "四人目")?.player.id).toBe("p3");
    expect(manager.join(host.room.code, "満席")).toBeNull();
  });

  it("keeps a released seat recoverable when replacement token generation fails", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    manager.leave(host.room, host.player);

    const playersBefore = new Map(host.room.players);
    const reusableSeatIdsBefore = new Set(host.room.reusableSeatIds);
    const stateBefore = host.room.state;
    const lastActivityBefore = host.room.lastActivityAt;
    vi.mocked(randomBytes).mockImplementationOnce(() => {
      throw new Error("random source unavailable");
    });

    expect(() => manager.join(host.room.code, "再参加")).toThrow(
      "random source unavailable",
    );
    expect(host.room.players).toEqual(playersBefore);
    expect(host.room.reusableSeatIds).toEqual(reusableSeatIdsBefore);
    expect(host.room.state).toBe(stateBefore);
    expect(host.room.lastActivityAt).toBe(lastActivityBefore);
    expect(manager.join(host.room.code, "再参加")?.player.id).toBe("p0");
  });

  it.each([
    ["roundEnd", reachRoundEnd],
    ["gameEnd", reachGameEnd],
  ] as const)(
    "allows the inherited host to continue after explicit exit at %s",
    (_phase, prepare) => {
      const manager = new RoomManager();
      const host = manager.create("ホスト");
      prepare(manager, host);
      const guest = manager.join(host.room.code, "ゲスト");
      if (!guest) throw new Error("guest should join");

      manager.leave(host.room, host.player);
      const snapshot = manager.snapshot(guest.room, guest.player);
      expect(snapshot.hostId).toBe("p1");
      expect(snapshot.hostNotice?.reason).toBe("left");
      expect(manager.resume(host.room.code, host.player.token)).toBeNull();

      if (_phase === "roundEnd") {
        expect(
          manager.apply(
            guest.room,
            guest.player,
            { type: "nextRound" },
            snapshot.version,
          ),
        ).toMatchObject({ ok: true });
      } else {
        expect(manager.newGame(guest.room, guest.player)).toMatchObject({
          ok: true,
          stateChanged: true,
        });
      }
    },
  );

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
    expect(
      manager.resume(
        host.room.code,
        "x".repeat(ONLINE_RESUME_TOKEN_MIN_LENGTH - 1),
      ),
    ).toBeNull();
    expect(
      manager.resume(
        host.room.code,
        "x".repeat(ONLINE_RESUME_TOKEN_MAX_LENGTH + 1),
      ),
    ).toBeNull();
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
    // `newGame` uses a crypto seed in production. Fix only that next seed so
    // this fixture always starts the host at a discard decision; the test
    // still exercises the real RoomManager path and never hides a bad state.
    const seed = Buffer.alloc(4);
    seed.writeUInt32BE(0);
    vi.mocked(randomBytes).mockImplementationOnce(() => seed);
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

  it("validates action tiles against sanma tile invariants", () => {
    expect(parseGameAction({ type: "kita" })).toEqual({ type: "kita" });

    const tileActionTypes = ["discard", "riichi", "ankan", "kakan"] as const;
    const suits = [
      ["man", [1, 9]],
      ["pin", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
      ["sou", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
      ["honor", [1, 2, 3, 4, 5, 6, 7]],
    ] as const;

    for (const type of tileActionTypes) {
      for (const [suit, ranks] of suits) {
        for (const rank of ranks) {
          const isRed = (suit === "pin" || suit === "sou") && rank === 5;
          const canonicalTile = { suit, rank, isRed };

          expect(parseGameAction({ type, tile: canonicalTile })).toEqual({
            type,
            tile: canonicalTile,
          });
          expect(
            parseGameAction({
              type,
              tile: { ...canonicalTile, isRed: !isRed },
            }),
          ).toBeNull();
        }
      }

      expect(
        parseGameAction({
          type,
          tile: { suit: "man", rank: 2, isRed: false },
        }),
      ).toBeNull();
      expect(
        parseGameAction({
          type,
          tile: { suit: "man", rank: 10, isRed: false },
        }),
      ).toBeNull();
    }
  });

  it("旧席は自動ガリ、新capability席だけ明示北抜きとして混在できる", () => {
    const manager = new RoomManager();
    const host = manager.create("旧ホスト");
    const guest = manager.join(host.room.code, "新ゲスト", true);
    if (!guest) throw new Error("guest should join");

    host.room.state = createGame({
      seed: 1,
      names: ["旧ホスト", "新ゲスト", "AI2", "AI3"],
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: ["p1"],
    });

    expect(manager.snapshot(host.room, host.player).explicitKita).toBe(false);
    expect(manager.snapshot(guest.room, guest.player).explicitKita).toBe(true);
    expect(host.room.state.hand?.kita.east).toBe(2);
    expect(host.room.state.pending).toMatchObject({ canKita: false });
    expect(
      manager.apply(
        guest.room,
        guest.player,
        { type: "kita" },
        host.room.version,
      ),
    ).toMatchObject({
      ok: false,
      error: "現在はあなたの操作順ではありません。",
    });
    expect(
      manager.apply(
        guest.room,
        guest.player,
        { type: "kita" },
        host.room.version + 1,
      ),
    ).toMatchObject({
      ok: false,
      error: "対局状態が更新されています。最新状態を受信しました。",
    });
    expect(
      manager.apply(
        host.room,
        host.player,
        { type: "kita" },
        host.room.version,
      ),
    ).toMatchObject({
      ok: false,
      error: "この接続では北抜きは自動処理されます。",
    });
  });

  it("新capability guestは混在roomで北抜きし、同じ手番を継続する", () => {
    const manager = new RoomManager();
    const host = manager.create("旧ホスト");
    const guest = manager.join(host.room.code, "新ゲスト", true);
    if (!guest) throw new Error("guest should join");

    // seed=4は旧p0の最初の打牌後、新p1が北を保持した打牌待ちになる決定的fixture。
    host.room.state = createGame({
      seed: 4,
      names: ["旧ホスト", "新ゲスト", "AI2", "AI3"],
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: ["p1"],
    });
    const hostDraw = host.room.state.hand?.drawn?.tile;
    if (hostDraw === undefined) throw new Error("host draw expected");
    expect(
      manager.apply(
        host.room,
        host.player,
        { type: "discard", tile: hostDraw },
        host.room.version,
      ),
    ).toMatchObject({ ok: true, stateChanged: true });

    const before = manager.snapshot(guest.room, guest.player);
    expect(before.explicitKita).toBe(true);
    expect(before.currentTurn).toBe("p1");
    expect(before.pending).toMatchObject({
      kind: "humanDiscard",
      playerId: "p1",
      canKita: true,
    });
    const hand = host.room.state.hand;
    const seat = hand ? seatOfPlayer(hand.seating, "p1") : null;
    if (hand === null || seat === null) throw new Error("guest seat expected");
    const kitaBefore = hand.kita[seat];

    expect(
      manager.apply(guest.room, guest.player, { type: "kita" }, before.version),
    ).toMatchObject({ ok: true, stateChanged: true });

    const after = manager.snapshot(guest.room, guest.player);
    expect(after.version).toBe(before.version + 1);
    expect(host.room.state.hand?.kita[seat]).toBe(kitaBefore + 1);
    expect(after.currentTurn).toBe("p1");
    expect(after.pending).toMatchObject({
      kind: "humanDiscard",
      playerId: "p1",
    });
  });

  it("明示北抜きguestの切断で保持北を即時にAIガリし、resume後もcapabilityを保持する", () => {
    let fixtureSeed = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const start = createGame({
        seed,
        humanPlayerIds: ["p0", "p1"],
        explicitKitaPlayerIds: ["p1"],
      });
      const drawn = start.hand?.drawn?.tile;
      if (drawn === undefined) continue;
      const afterHost = discard(start, drawn);
      if (
        afterHost.pending?.kind === "humanDiscard" &&
        afterHost.pending.playerId === "p1" &&
        afterHost.pending.canKita
      ) {
        fixtureSeed = seed;
        break;
      }
    }
    expect(fixtureSeed).toBeGreaterThan(0);

    const manager = new RoomManager();
    const host = manager.create("旧ホスト");
    const guest = manager.join(host.room.code, "新ゲスト", true);
    if (!guest) throw new Error("guest should join");
    host.room.state = createGame({
      seed: fixtureSeed,
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: ["p1"],
    });
    const hostDraw = host.room.state.hand?.drawn?.tile;
    if (hostDraw === undefined) throw new Error("host draw expected");
    expect(
      manager.apply(
        host.room,
        host.player,
        { type: "discard", tile: hostDraw },
        host.room.version,
      ),
    ).toMatchObject({ ok: true });
    const hand = host.room.state.hand;
    const seat = hand ? seatOfPlayer(hand.seating, "p1") : null;
    if (hand === null || seat === null) throw new Error("guest seat expected");
    const kitaBefore = hand.kita[seat];
    expect(host.room.state.pending).toMatchObject({
      playerId: "p1",
      canKita: true,
    });

    manager.disconnect(guest.room, guest.player);

    expect(host.room.state.hand?.kita[seat]).toBeGreaterThan(kitaBefore);
    expect(
      host.room.state.hand?.hands[seat].some(
        (tile) => tile.suit === "honor" && tile.rank === 4,
      ),
    ).toBe(false);
    const resumed = manager.resume(host.room.code, guest.player.token);
    expect(resumed?.player.id).toBe("p1");
    if (!resumed) throw new Error("resume expected");
    expect(manager.snapshot(resumed.room, resumed.player).explicitKita).toBe(
      true,
    );
    expect(host.room.state.explicitKitaPlayerIds).toContain("p1");
  });

  it("明示北抜きguestの退出でも保持北を即時にAIガリして手番を解放する", () => {
    let fixtureSeed = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const start = createGame({
        seed,
        humanPlayerIds: ["p0", "p1"],
        explicitKitaPlayerIds: ["p1"],
      });
      const drawn = start.hand?.drawn?.tile;
      if (drawn === undefined) continue;
      const afterHost = discard(start, drawn);
      if (
        afterHost.pending?.kind === "humanDiscard" &&
        afterHost.pending.playerId === "p1" &&
        afterHost.pending.canKita
      ) {
        fixtureSeed = seed;
        break;
      }
    }
    const manager = new RoomManager();
    const host = manager.create("旧ホスト");
    const guest = manager.join(host.room.code, "新ゲスト", true);
    if (!guest || fixtureSeed === 0) throw new Error("guest fixture expected");
    host.room.state = createGame({
      seed: fixtureSeed,
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: ["p1"],
    });
    const hostDraw = host.room.state.hand?.drawn?.tile;
    if (hostDraw === undefined) throw new Error("host draw expected");
    manager.apply(
      host.room,
      host.player,
      { type: "discard", tile: hostDraw },
      host.room.version,
    );
    const hand = host.room.state.hand;
    const seat = hand ? seatOfPlayer(hand.seating, "p1") : null;
    if (hand === null || seat === null) throw new Error("guest seat expected");
    const kitaBefore = hand.kita[seat];

    manager.leave(guest.room, guest.player);

    expect(host.room.state.hand?.kita[seat]).toBeGreaterThan(kitaBefore);
    expect(host.room.state.pending?.playerId).not.toBe("p1");
    expect(manager.resume(host.room.code, guest.player.token)).toBeNull();
  });

  it("退出席を明示北抜きなしのguestが再利用してもcapabilityを引き継がない", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト");
    const oldGuest = manager.join(host.room.code, "旧ゲスト", true);
    if (!oldGuest) throw new Error("old guest should join");

    // seed=4はp0の初回打牌後、p1が北をツモって明示北抜きを選べる局面。
    host.room.state = createGame({
      seed: 4,
      humanPlayerIds: ["p0", "p1"],
      explicitKitaPlayerIds: ["p1"],
    });
    manager.leave(host.room, oldGuest.player);

    const replacement = manager.join(host.room.code, "新ゲスト", false);
    if (!replacement) throw new Error("replacement guest should join");
    expect(replacement.player.id).toBe("p1");
    expect(
      manager.snapshot(replacement.room, replacement.player).explicitKita,
    ).toBe(false);
    expect(host.room.state.explicitKitaPlayerIds).not.toContain("p1");

    const hostDraw = host.room.state.hand?.drawn?.tile;
    if (!hostDraw) throw new Error("host draw expected");
    expect(
      manager.apply(
        host.room,
        host.player,
        { type: "discard", tile: hostDraw },
        host.room.version,
      ),
    ).toMatchObject({ ok: true, stateChanged: true });
    expect(
      manager.snapshot(replacement.room, replacement.player).pending,
    ).toMatchObject({
      kind: "humanDiscard",
      playerId: "p1",
      canKita: false,
    });
  });

  it("newGameは接続中席の北抜きcapability rosterを維持する", () => {
    const manager = new RoomManager();
    const host = manager.create("ホスト", true);
    const guest = manager.join(host.room.code, "ゲスト", true);
    if (!guest) throw new Error("guest should join");
    host.room.state = walkToGameEnd(2024).state;

    expect(manager.newGame(host.room, host.player)).toMatchObject({ ok: true });
    expect(host.room.state.humanPlayerIds).toEqual(["p0", "p1"]);
    expect(host.room.state.explicitKitaPlayerIds).toEqual(["p0", "p1"]);
  });
});
