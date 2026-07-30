import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import type { Tile } from "@/domain/tiles/tile";
import {
  createGame,
  declareAnkan,
  declareKakan,
  declareKan,
  discard,
  type EngineState,
  type Pending,
} from "./engine";

const kan = (notation: string, concealed = true): Meld => ({
  type: "kan",
  tiles: parseTiles(notation),
  concealed,
});

const pon = (tile: Tile): Meld => ({
  type: "pon",
  tiles: [tile, tile, tile],
  concealed: false,
});

const JUNK = "2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 1s";

function discardPending(overrides: Partial<Pending & object> = {}): Pending {
  return {
    kind: "humanDiscard",
    canTsumo: false,
    canRiichi: false,
    riichiTiles: [],
    ankanTiles: [],
    kakanTiles: [],
    forbiddenDiscards: [],
    locked: false,
    ...overrides,
  } as Pending;
}

function expectFourKanDraw(
  before: EngineState,
  after: EngineState,
  liveTilesBefore: number,
): void {
  expect(after.phase).toBe("roundEnd");
  expect(after.lastRound).toEqual({
    kind: "draw",
    label: "四槓散了",
    deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
  });
  expect(after.points).toEqual(before.points);
  expect(after.riichiSticks).toBe(before.riichiSticks);
  expect(after.nextRoundState).toMatchObject({
    wind: before.round.wind,
    roundNumber: before.round.roundNumber,
    honba: before.round.honba + 1,
  });
  expect(after.hand?.wall.remainingLiveTiles).toBe(liveTilesBefore);
}

function baseWithThreeKans(seed = 1): EngineState {
  const state = createGame({ seed });
  const hand = state.hand;
  if (!hand) throw new Error("hand required");
  hand.melds.east = [kan("2p 2p 2p 2p"), kan("3p 3p 3p 3p")];
  hand.melds.south = [];
  hand.melds.west = [kan("4p 4p 4p 4p", false)];
  hand.hands.south = parseTiles(JUNK);
  hand.hands.west = parseTiles(JUNK);
  return { ...state, riichiSticks: 2 };
}

describe("engine: 四槓散了(#183)", () => {
  it("人間の暗槓: 複数家の4組目は嶺上補充前に途中流局する", () => {
    const state = baseWithThreeKans();
    const hand = state.hand;
    if (!hand) throw new Error("hand required");
    hand.hands.east = parseTiles("1m 1m 1m 2s 3s 4s");
    hand.drawn = parseTile("1m");
    hand.turn = "east";
    const armed = {
      ...state,
      pending: discardPending({ ankanTiles: [parseTile("1m")] }),
    };
    const live = hand.wall.remainingLiveTiles;

    expectFourKanDraw(armed, declareAnkan(armed, parseTile("1m")), live);
  });

  it("人間の加槓: 複数家の4組目は途中流局する", () => {
    const state = baseWithThreeKans(2);
    const hand = state.hand;
    if (!hand) throw new Error("hand required");
    const tile = parseTile("5s");
    hand.melds.east = [hand.melds.east[0], hand.melds.east[1], pon(tile)];
    hand.melds.west = [kan("4p 4p 4p 4p")];
    hand.hands.east = parseTiles("5s 1m 9m 1s 9s");
    hand.drawn = parseTile("9m");
    hand.turn = "east";
    const armed = {
      ...state,
      pending: discardPending({ kakanTiles: [tile] }),
    };
    const live = hand.wall.remainingLiveTiles;

    expectFourKanDraw(armed, declareKakan(armed, tile), live);
  });

  it("人間の大明槓: 複数家の4組目は途中流局する", () => {
    const state = baseWithThreeKans(3);
    const hand = state.hand;
    if (!hand) throw new Error("hand required");
    const tile = parseTile("6s");
    hand.hands.east = parseTiles("6s 6s 6s 1m 9m");
    hand.pendingDiscard = { seat: "south", tile };
    hand.turn = "south";
    const armed = {
      ...state,
      pending: {
        kind: "humanReact" as const,
        tile,
        from: "south" as const,
        canRon: false,
        canPon: true,
        canKan: true,
      },
    };
    const live = hand.wall.remainingLiveTiles;

    expectFourKanDraw(armed, declareKan(armed), live);
  });

  it("1人だけの4槓は四槓子の和了機会を残して継続する", () => {
    const state = createGame({ seed: 4 });
    const hand = state.hand;
    if (!hand) throw new Error("hand required");
    hand.melds.east = [
      kan("2p 2p 2p 2p"),
      kan("3p 3p 3p 3p"),
      kan("4p 4p 4p 4p"),
    ];
    hand.melds.south = [];
    hand.melds.west = [];
    hand.hands.east = parseTiles("1m 1m 1m");
    hand.drawn = parseTile("1m");
    hand.turn = "east";
    hand.hands.south = parseTiles(JUNK);
    hand.hands.west = parseTiles(JUNK);
    const armed = {
      ...state,
      pending: discardPending({ ankanTiles: [parseTile("1m")] }),
    };
    const live = hand.wall.remainingLiveTiles;

    const after = declareAnkan(armed, parseTile("1m"));
    expect(after.phase).toBe("playing");
    expect(after.hand?.melds.east).toHaveLength(4);
    expect(after.hand?.wall.remainingLiveTiles).toBe(live - 1);
  });

  it("4組目の加槓でも槍槓ロンを四槓散了より優先する", () => {
    const state = baseWithThreeKans(8);
    const hand = state.hand;
    if (!hand) throw new Error("hand required");
    const tile = parseTile("3p");
    hand.melds.east = [hand.melds.east[0], hand.melds.east[1], pon(tile)];
    hand.hands.east = parseTiles("3p 1m 9m 1s 9s");
    hand.drawn = parseTile("9m");
    hand.turn = "east";
    hand.hands.south = parseTiles("2p 4p 123s 789s 678p 99p");
    hand.melds.south = [];
    const armed = {
      ...state,
      pending: discardPending({ kakanTiles: [tile] }),
    };

    const after = declareKakan(armed, tile);
    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winnerId).toBe("p1");
    expect(after.lastRound?.label).not.toBe("四槓散了");
    expect(after.hand?.melds.east.at(-1)?.type).toBe("pon");
  });

  it("嶺上牌での連続カンが四槓散了になっても drawSource は既定へ戻る(#415)", () => {
    // カンの嶺上牌でさらにカンした場合、`drawn` は消えるのに `drawSource` が
    // `"kanReplacement"` のまま残ると「ツモ牌が無いのに嶺上由来」という不整合な
    // 局状態が残る。四槓散了は嶺上補充の**前**に打ち切るため、`drawKanReplacement`
    // による上書きが起きない唯一の経路になっている。
    const state = baseWithThreeKans(9);
    const hand = state.hand;
    if (!hand) throw new Error("hand required");
    hand.hands.east = parseTiles("1m 1m 1m 2s 3s 4s");
    hand.drawn = parseTile("1m");
    hand.drawSource = "kanReplacement"; // 直前のカンの嶺上牌を持っている状態。
    hand.turn = "east";
    const armed = {
      ...state,
      pending: discardPending({ ankanTiles: [parseTile("1m")] }),
    };

    const after = declareAnkan(armed, parseTile("1m"));

    expect(after.lastRound?.label).toBe("四槓散了");
    expect(after.hand?.drawn).toBeNull();
    expect(after.hand?.drawSource).toBe("live");
  });

  it("AIの大明槓経路も共通判定で途中流局する", () => {
    const state = baseWithThreeKans(5);
    const hand = state.hand;
    if (!hand) throw new Error("hand required");
    // AI の戦略ゲート(#210)を通る役牌(白)の大明槓にする。
    const tile = parseTile("5z");
    hand.hands.east = parseTiles("5z 1m 9m 1s 9s");
    hand.drawn = tile;
    hand.turn = "east";
    hand.hands.south = parseTiles("5z 5z 5z 2m 4m 6m 8m 2s 4s 2p 4p 6p 8p");
    const armed = { ...state, pending: discardPending() };
    const live = hand.wall.remainingLiveTiles;

    expectFourKanDraw(armed, discard(armed, tile), live);
  });

  it.each(["ankan", "kakan"] as const)(
    "AIの%s経路も共通判定で途中流局する",
    (kind) => {
      const state = baseWithThreeKans(kind === "ankan" ? 6 : 7);
      const hand = state.hand;
      if (!hand) throw new Error("hand required");
      const next = hand.wall.liveWall[0];
      const humanDiscard = parseTile("9m");
      hand.hands.east = parseTiles("1m 2m 3m 1s 2s 3s");
      hand.drawn = humanDiscard;
      hand.turn = "east";
      hand.hands.west = parseTiles(JUNK);
      if (kind === "ankan") {
        hand.hands.south = [
          next,
          next,
          next,
          ...parseTiles("2m 4m 6m 8m 2s 4s 6s 2p 4p 6p"),
        ];
      } else {
        hand.melds.south = [pon(next)];
        hand.hands.south = parseTiles("2m 4m 6m 8m 2s 4s 6s 2p 4p 6p");
      }
      const armed = { ...state, pending: discardPending() };
      const live = hand.wall.remainingLiveTiles;

      expectFourKanDraw(armed, discard(armed, humanDiscard), live - 1);
    },
  );
});
