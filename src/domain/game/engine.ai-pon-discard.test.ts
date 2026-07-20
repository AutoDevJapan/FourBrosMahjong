import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscardContext } from "@/domain/game/ai";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";
import {
  canCallMeldOnDiscard,
  createGame,
  discard,
  type EngineState,
  type SeatKey,
} from "./engine";

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
 * ## 射程の限界(意図的)
 * 現行 engine で到達できるのは「同種**ちょうど2枚**でポン」だけ(3枚以上は必ずカンへ抜ける /
 * 下の前提固定テスト参照)。この場合ポンで2枚とも消費されて手牌に同種は残らないため、
 * **#303 修正前の実装(禁止牌を filter して渡す)でもここは緑になる**。実際に
 * 差が出るのは「3枚持ちでポン」= 現状到達不能な局面であり、それが #319 が
 * 「engine レイヤで固定できない」と述べていた理由そのものである。
 *
 * したがって本ファイルの価値は退行の再現ではなく、
 * 1. engine → `chooseDiscard` の境界契約(枚数・禁止牌の渡し方)を将来に向けて固定する
 * 2. 「3枚持ちポンは到達不能」という engine コメントの前提をコードで守る
 * の2点にある。前提が崩れた時(#304)に何を足すべきかは下の describe に記した。
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
  hand.drawn = parseTile(PON_TILE);
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
});

/**
 * `applyAiCall` の「3枚持ちならポンではなくカンへ抜ける」前提(engine.ts のコメント)を
 * コードで固定する(#319 の選択肢3)。
 *
 * `canPon`(need 2)と `canKan`(need 3)は `need` 以外まったく同じ引数で
 * `canCallMeldOnDiscard` を呼ぶため、同種3枚以上あれば必ず両方 true になり、
 * engine は `kan=true` でカン分岐へ早期 return する。つまり「3枚持ちのままポン打牌へ
 * 到達する」局面は現行 engine では発生しない。
 *
 * ⚠️ issue #304(向聴を悪化させるカンの見送り)が入ると**この前提は崩れうる**。
 * その時点で `applyAiCall` の `forbiddenDiscards` が防御的な指定から load-bearing に
 * 変わるため、上のスパイ検証を「3枚持ちでポン」の局面でも行うよう拡張すること。
 */
describe("engine: canPon && !canKan は同種3枚以上では成立しない(#319 前提の固定)", () => {
  const tile = parseTile("5z");

  it("ガードの全組み合わせで canPon と canKan が一致する", () => {
    const concealedByCount = [
      parseTiles("5z 5z 5z 123m 456m 1p"), // 3枚
      parseTiles("5z 5z 5z 5z 123m 456m"), // 4枚
    ];
    let sawBothTrue = false;

    for (const concealed of concealedByCount) {
      for (const inRiichi of [false, true]) {
        for (const haitei of [false, true]) {
          for (const isDiscarder of [false, true]) {
            const args = { concealed, tile, inRiichi, haitei, isDiscarder };
            const canPon = canCallMeldOnDiscard({ ...args, need: 2 });
            const canKan = canCallMeldOnDiscard({ ...args, need: 3 });
            expect(canPon).toBe(canKan);
            if (canPon && canKan) sawBothTrue = true;
          }
        }
      }
    }

    // 「常に false 同士で一致」ではないこと(= このテストが空振りしない)。
    expect(sawBothTrue).toBe(true);
  });

  it("同種ちょうど2枚なら canPon のみ true(ポン打牌分岐が到達可能である根拠)", () => {
    const concealed = parseTiles("5z 5z 123m 456m 1p 2p");
    const args = {
      concealed,
      tile,
      inRiichi: false,
      haitei: false,
      isDiscarder: false,
    };
    expect(canCallMeldOnDiscard({ ...args, need: 2 })).toBe(true);
    expect(canCallMeldOnDiscard({ ...args, need: 3 })).toBe(false);
  });
});
