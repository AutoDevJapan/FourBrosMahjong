import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscardContext } from "@/domain/game/ai";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";
import { createGame, discard, type EngineState, type SeatKey } from "./engine";

/**
 * ポン直後打牌で `chooseDiscard` に渡る手牌の不変条件(issue #319 / #303 の回帰ネット)。
 *
 * #303 は「喰い替え禁止牌を手牌から削除して `chooseDiscard` に渡していた」不具合で、
 * 削ると `14 − 3×副露数` 枚に満たない手牌で向聴・受け入れが評価される。PR #317 は
 * `ai.ts` 側(`chooseDiscard` の契約)で修正・検証したが、**engine 側の呼び出しが
 * 実際に何を渡しているか**は固定されていなかった(#319)。
 *
 * ここでは `chooseDiscard` をスパイして `applyAiCall` からの実引数を直接検証する。
 *
 * #322 の向聴悪化ガードにより、同種3枚を持っていても大明槓せず
 * ポンする経路が到達可能になった。その経路でも禁止牌を `tiles` から削らず、
 * engine → `chooseDiscard` の境界契約を守ることを固定する(#325)。
 */

const { chooseDiscardSpy } = vi.hoisted(() => ({
  chooseDiscardSpy: vi.fn<(ctx: DiscardContext) => Tile>(),
}));

vi.mock("@/domain/game/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/game/ai")>();
  chooseDiscardSpy.mockImplementation(actual.chooseDiscard);
  return { ...actual, chooseDiscard: chooseDiscardSpy };
});

/** 白(三元牌)= AI の `shouldCallMeld` がポンする牌種。 */
const PON_TILE = "5z";

/**
 * 自家(東)が白を打ち、南(AI)が白2枚持ちでポンする局面を組む。
 *
 * 南の門前手牌は13枚 → ポンで2枚消費して11枚(= 14 − 3×1)になる。
 */
function armAiPon(seed: number): EngineState {
  const base = createGame({ seed });
  const hand = base.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");

  for (const seat of ["east", "south", "west"] as SeatKey[]) {
    hand.melds[seat] = [];
    hand.discards[seat] = [];
    hand.riichi[seat] = false;
    hand.riichiMiss[seat] = false;
    hand.tempMiss[seat] = false;
  }
  // 東(自家)は白を1枚ツモっており、それを打つ。
  hand.hands.east = parseTiles("123m 456m 789m 111s 9s");
  // 南は白ちょうど2枚 + 残り11枚(計13枚)。ポン後の門前は 13 − 2 = 11 枚。
  const south = parseTiles("5z 5z 13567p 3456s 4m 9m");
  if (south.length !== 13) throw new Error(`south fixture must be 13 tiles`);
  hand.hands.south = south;
  // 西は白を持たず、ポン競合しない。
  hand.hands.west = parseTiles("1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 2s 3s");
  hand.drawn = { tile: parseTile(PON_TILE), source: "live" };
  hand.turn = "east";

  return {
    ...base,
    pending: {
      kind: "humanDiscard",
      canTsumo: false,
      canRiichi: false,
      riichiTiles: [],
      ankanTiles: [],
      kakanTiles: [],
      forbiddenDiscards: [],
      locked: false,
    },
  };
}

/**
 * 白ポン済みの南が 5s を3枚持ち、4枚目の捨て5sをポンする局面。
 * 大明槓では向聴が悪化するため、#322 のガードでポンへ落ちる。
 */
function armAiThreeTilePon(seed: number): EngineState {
  const state = armAiPon(seed);
  const hand = state.hand;
  if (hand === null) throw new Error("hand should exist");
  const whitePon: Meld = {
    type: "pon",
    tiles: parseTiles("5z 5z 5z"),
    concealed: false,
  };
  hand.hands.south = parseTiles("5s 5s 5s 4s 6s 1p 2p 3p 9m 1z");
  hand.melds.south = [whitePon];
  hand.drawn = { tile: parseTile("5s"), source: "live" };
  return state;
}

/** ポン直後打牌にあたる最初の `chooseDiscard` 呼び出しの引数。 */
function firstCallContext(): DiscardContext {
  const ctx = chooseDiscardSpy.mock.calls[0]?.[0];
  if (ctx === undefined) {
    throw new Error("chooseDiscard が一度も呼ばれていない(局面の組み立て不備)");
  }
  return ctx;
}

describe("engine: ポン直後打牌の手牌枚数(#319 / #303)", () => {
  beforeEach(() => {
    chooseDiscardSpy.mockClear();
  });

  it("フィクスチャの前提: 南は白をポンする(スパイ検証が空振りしない)", () => {
    const after = discard(armAiPon(3190), parseTile(PON_TILE));
    const melds = after.hand?.melds.south;
    if (melds === undefined) throw new Error("ポン後も hand は存在するはず");
    expect(melds).toHaveLength(1);
    expect(melds[0].type).toBe("pon");
    expect(sameKind(melds[0].tiles[0], parseTile(PON_TILE))).toBe(true);
  });

  it("ポン直後打牌の chooseDiscard は 14 − 3×副露数 枚を受け取る", () => {
    discard(armAiPon(3191), parseTile(PON_TILE));

    // 最初の呼び出しがポン直後打牌(以降は後続 AI の通常打牌)。
    const ctx = firstCallContext();
    expect(ctx.meldCount).toBe(1);
    // 14 − 3×1 = 11 枚。禁止牌を手牌から削っていたら 10 枚になる(#303 の退行)。
    // 期待値は検証対象(`ctx.meldCount`)から計算せずリテラルで置く。
    expect(ctx.tiles).toHaveLength(11);
  });

  it("ポン牌種は forbiddenDiscards で渡され、手牌からは削られない(喰い替え禁止 / #105)", () => {
    discard(armAiPon(3192), parseTile(PON_TILE));

    const ponTile = parseTile(PON_TILE);
    const forbidden = firstCallContext().forbiddenDiscards;
    expect(forbidden).toBeDefined();
    expect(forbidden?.some((t) => sameKind(t, ponTile))).toBe(true);
    // 禁止牌は手牌側にも残っている必要はない(ポンで2枚とも消費済み)が、
    // 「候補から除くだけで tiles から削らない」契約は枚数テストで固定している。
  });

  it("同種3枚持ちでポンしても chooseDiscard は 14 − 3×副露数 枚を受け取る", () => {
    const after = discard(armAiThreeTilePon(3250), parseTile("5s"));

    const ctx = firstCallContext();
    expect(ctx.meldCount).toBe(2);
    // 14 − 3×2 = 8枚。4枚目の5sを禁止牌として tiles から削ると7枚になる。
    expect(ctx.tiles).toHaveLength(8);
    expect(ctx.tiles.filter((t) => sameKind(t, parseTile("5s")))).toHaveLength(
      1,
    );
    expect(
      ctx.forbiddenDiscards?.some((t) => sameKind(t, parseTile("5s"))),
    ).toBe(true);

    const melds = after.hand?.melds.south;
    if (melds === undefined) throw new Error("ポン後も hand は存在するはず");
    expect(melds).toHaveLength(2);
    expect(melds[1].type).toBe("pon");
  });
});
