import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import {
  createGame,
  declareAnkan,
  declareKakan,
  declareKan,
  declareKita,
  declarePon,
  declareRiichi,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  type Pending,
  type SeatKey,
} from "./engine";
import { capturePresentationEvents } from "./presentationEvents";

const pending = (
  overrides: Partial<Extract<Pending, { kind: "humanDiscard" }>> = {},
): Extract<Pending, { kind: "humanDiscard" }> => ({
  kind: "humanDiscard",
  canTsumo: false,
  canRiichi: false,
  riichiTiles: [],
  ankanTiles: [],
  kakanTiles: [],
  forbiddenDiscards: [],
  locked: false,
  ...overrides,
});
function armed(): EngineState {
  let state = createGame({ seed: 1 });
  const hand = state.hand!;
  for (const seat of ["east", "south", "west"] as SeatKey[]) {
    hand.hands[seat] = parseTiles("19m 13579p 13579s 1z");
    hand.melds[seat] = [];
    hand.discards[seat] = [];
    hand.discardHistory[seat] = [];
    hand.riichi[seat] = false;
    hand.riichiMiss[seat] = false;
    hand.tempMiss[seat] = false;
  }
  hand.turn = "east";
  state = { ...state, pending: pending() };
  return state;
}

describe("engine presentation acceptance sites", () => {
  it.each(["pon", "kan"] as const)(
    "emits %s only after the human call is adopted",
    (kind) => {
      const state = armed();
      const hand = state.hand!;
      const tile = parseTile("5z");
      hand.hands.east = parseTiles("555z 13579p 13579s");
      hand.drawn = null;
      hand.pendingDiscard = { seat: "south", tile, haitei: false };
      hand.discards.south = [tile];
      hand.discardHistory.south = [tile];
      const s = {
        ...state,
        pending: {
          kind: "humanReact" as const,
          playerId: "p0" as const,
          from: "south" as const,
          tile,
          canRon: false,
          canPon: true,
          canKan: true,
        },
      };
      const result = capturePresentationEvents(s, () =>
        kind === "pon" ? declarePon(s) : declareKan(s),
      );
      expect(result.events[0]).toMatchObject({ kind, actorId: "p0" });
      expect(result.events.map((e) => e.kind)).toEqual(
        kind === "pon" ? ["pon"] : ["kan", "draw"],
      );
      expect(result.state.hand!.melds.east[0].type).toBe(kind);
    },
  );

  it.each(["ankan", "kakan"] as const)(
    "emits completed %s followed by the replacement draw",
    (kind) => {
      const s = armed();
      const tile = parseTile("3p");
      s.hand!.hands.east = parseTiles(
        kind === "ankan" ? "3333p 19m 13579s 15z" : "3p 19m 13579s 15z",
      );
      s.hand!.drawn = { tile: parseTile("9p"), source: "live" };
      if (kind === "kakan")
        s.hand!.melds.east = [
          { type: "pon", tiles: parseTiles("333p"), concealed: false },
        ];
      const state = {
        ...s,
        pending: pending({ ankanTiles: [tile], kakanTiles: [tile] }),
      };
      const result = capturePresentationEvents(state, () =>
        kind === "ankan"
          ? declareAnkan(state, tile)
          : declareKakan(state, tile),
      );
      expect(result.events.map((e) => [e.kind, e.actorId])).toEqual([
        ["kan", "p0"],
        ["draw", "p0"],
      ]);
    },
  );

  it("keeps discard before the CPU pon and immediate no-draw discard", () => {
    const state = armed();
    state.hand!.drawn = { tile: parseTile("5z"), source: "live" };
    state.hand!.hands.south = parseTiles("55z 13567p 3456s 1m 9m");
    const result = capturePresentationEvents(state, () =>
      discard(state, parseTile("5z")),
    );
    expect(result.events.slice(0, 3).map((e) => [e.kind, e.actorId])).toEqual([
      ["discard", "p0"],
      ["pon", "p1"],
      ["discard", "p1"],
    ]);
  });

  it("does not report an uncompleted kan when a CPU robs it for ron", () => {
    const state = armed();
    const tile = parseTile("3p");
    state.hand!.hands.east = parseTiles("3p 19m 19s");
    state.hand!.drawn = { tile: parseTile("9m"), source: "live" };
    state.hand!.melds.east = [
      { type: "pon", tiles: parseTiles("333p"), concealed: false },
    ];
    state.hand!.hands.south = parseTiles("2p 4p 123s 789s 678p 99p");
    const s = { ...state, pending: pending({ kakanTiles: [tile] }) };
    const result = capturePresentationEvents(s, () => declareKakan(s, tile));
    expect(result.state.lastRound?.winnerId).toBe("p1");
    expect(result.events.map((e) => [e.kind, e.actorId])).toEqual([
      ["ron", "p1"],
      ["round-end", "p0"],
      ["round-end", "p1"],
      ["round-end", "p2"],
    ]);
  });

  it("reports human tsumo and explicit round-end actors, including a game-ending win", () => {
    const state = armed();
    state.hand!.hands.east = parseTiles("19m 19p 19s 1234567z");
    state.hand!.drawn = { tile: parseTile("1m"), source: "live" };
    const s = { ...state, pending: pending({ canTsumo: true }) };
    const result = capturePresentationEvents(s, () => declareTsumo(s));
    expect(result.state.phase).toBe("gameEnd");
    expect(result.events.map((e) => [e.kind, e.actorId])).toEqual([
      ["tsumo", "p0"],
      ["round-end", "p0"],
      ["round-end", "p1"],
      ["round-end", "p2"],
    ]);
  });

  it("omits riichi if the declaration tile is won by ron", () => {
    const state = armed();
    const tile = parseTile("2z");
    state.hand!.hands.south = parseTiles("22z 111m 222p 333s 55s");
    state.hand!.drawn = { tile, source: "live" };
    const s = {
      ...state,
      pending: pending({ canRiichi: true, riichiTiles: [tile] }),
    };
    const result = capturePresentationEvents(s, () => declareRiichi(s, tile));
    expect(result.state.lastRound?.winnerId).toBe("p1");
    expect(result.events.map((e) => e.kind)).toEqual([
      "discard",
      "ron",
      "round-end",
      "round-end",
      "round-end",
    ]);
  });

  it("reports a human ron by its explicit player ID after a reaction wait", () => {
    const state = armed();
    const tile = parseTile("5s");
    state.hand!.hands.east = parseTiles("123p 456p 789p 123s 5s");
    state.hand!.drawn = null;
    state.hand!.pendingDiscard = { seat: "south", tile, haitei: false };
    state.hand!.discards.south = [tile];
    const s = {
      ...state,
      pending: {
        kind: "humanReact" as const,
        playerId: "p0" as const,
        from: "south" as const,
        tile,
        canRon: true,
        canPon: false,
        canKan: false,
      },
    };
    const result = capturePresentationEvents(s, () => declareRon(s));
    expect(result.state.lastRound?.winnerId).toBe("p0");
    expect(result.events[0]).toMatchObject({ kind: "ron", actorId: "p0" });
  });

  it("uses the seated player's stable ID when an online human other than p0 extracts North", () => {
    const base = createGame({ seed: 1, humanPlayerIds: ["p0", "p1"] });
    const hand = base.hand!;
    hand.turn = "south";
    hand.drawn = { tile: parseTile("4z"), source: "live" };
    const state = {
      ...base,
      pending: { ...pending({ canKita: true }), playerId: "p1" as const },
    };
    // Import is shared with the local path: the recorder is actor-neutral.
    const result = capturePresentationEvents(state, () =>
      declareKita(state, "p1"),
    );
    expect(result.events.map((e) => [e.kind, e.actorId])).toEqual([
      ["kita", "p1"],
      ["draw", "p1"],
    ]);
  });
});
