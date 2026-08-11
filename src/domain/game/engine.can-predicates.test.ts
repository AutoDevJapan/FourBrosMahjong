import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import type { Tile } from "@/domain/tiles/tile";
import {
  canCallMeldOnDiscard,
  canDeclareRiichi,
  canKanOnDrawTurn,
  createGame,
  declareKakan,
  type EngineState,
  isHaitei,
  isHaiteiTsumo,
  type Pending,
} from "./engine";

/**
 * アクション可否述語(can_*)の網羅監査(issue #139)。
 *
 * engine の各公開アクションの「宣言可否」を最小入力の純述語へ切り出したもの
 * ({@link isHaitei} / {@link canCallMeldOnDiscard} / {@link canKanOnDrawTurn} /
 * {@link canDeclareRiichi})の**境界**を、engine 全体を組まずに決定的に検証する。
 * OpenRiichi(GPL・設計思想のみ参照)の `RoundState.can_*` が「壁レベルのガード ×
 * プレイヤーレベルの可否」を分解している設計を参考にした網羅観点(コード非流用):
 *  - 海底(嶺上補充不可 → カン・鳴き不可)
 *  - リーチ中(鳴き不可)
 *  - 放銃者自身(自分の打牌は鳴けない)
 *  - 鳴き後 / 非門前(リーチ不可)
 *  - 供託点棒不足(1,000点未満はリーチ不可)
 *  - 必要枚数(ポン=2 / 大明槓=3)・赤フラグ無視(種別一致)
 *
 * リーチ後暗槓(送り槓ガード / Q18)は `engine.riichi-ankan.test.ts`、海底でのカン抑制の
 * 結線は `engine.haitei-kan.test.ts`、`isConcealedHand`(門前判定の源)は
 * `src/domain/hand/misc.test.ts` が別途網羅する。
 */

// ---------------------------------------------------------------------------
// isHaitei
// ---------------------------------------------------------------------------
describe("isHaitei(ライブ牌0 = 海底)", () => {
  it("ライブ牌0で true(海底)", () => {
    expect(isHaitei(0)).toBe(true);
  });

  it("ライブ牌が1枚以上なら false(海底手前・通常進行)", () => {
    expect(isHaitei(1)).toBe(false);
    expect(isHaitei(2)).toBe(false);
    expect(isHaitei(69)).toBe(false);
  });
});

describe("isHaiteiTsumo(海底摸月の文脈)", () => {
  it("通常ツモでライブ牌0なら海底摸月", () => {
    expect(isHaiteiTsumo(0, "live")).toBe(true);
  });

  it("嶺上補充でライブ牌0になっても海底摸月ではない(カン・北抜きのいずれも)", () => {
    expect(isHaiteiTsumo(0, "kanReplacement")).toBe(false);
    expect(isHaiteiTsumo(0, "kitaReplacement")).toBe(false);
  });

  it("ライブ牌が残っていれば通常ツモ・嶺上とも海底摸月ではない", () => {
    expect(isHaiteiTsumo(1, "live")).toBe(false);
    expect(isHaiteiTsumo(1, "kanReplacement")).toBe(false);
    expect(isHaiteiTsumo(1, "kitaReplacement")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canCallMeldOnDiscard(ポン=need2 / 大明槓=need3)
// ---------------------------------------------------------------------------
describe("canCallMeldOnDiscard(他家打牌へのポン/大明槓の可否)", () => {
  const base = {
    tile: parseTile("3m"),
    need: 2,
    inRiichi: false,
    haitei: false,
    isDiscarder: false,
  } as const;

  it("ポン: 同種2枚あれば可(need=2)", () => {
    expect(
      canCallMeldOnDiscard({ ...base, concealed: parseTiles("3m 3m 9p") }),
    ).toBe(true);
  });

  it("ポン: 同種1枚では不可(枚数不足)", () => {
    expect(
      canCallMeldOnDiscard({ ...base, concealed: parseTiles("3m 9p 1s") }),
    ).toBe(false);
  });

  it("ポン: 同種3枚(暗刻)でも可(need=2 を満たす)", () => {
    expect(
      canCallMeldOnDiscard({ ...base, concealed: parseTiles("3m 3m 3m") }),
    ).toBe(true);
  });

  it("大明槓: 同種3枚で可(need=3)", () => {
    expect(
      canCallMeldOnDiscard({
        ...base,
        need: 3,
        concealed: parseTiles("3m 3m 3m 9p"),
      }),
    ).toBe(true);
  });

  it("大明槓: 同種2枚では不可(need=3 に満たない)", () => {
    expect(
      canCallMeldOnDiscard({
        ...base,
        need: 3,
        concealed: parseTiles("3m 3m 9p"),
      }),
    ).toBe(false);
  });

  it("放銃者自身は鳴けない(isDiscarder=true)", () => {
    expect(
      canCallMeldOnDiscard({
        ...base,
        concealed: parseTiles("3m 3m 3m"),
        isDiscarder: true,
      }),
    ).toBe(false);
  });

  it("リーチ後は鳴けない(inRiichi=true)", () => {
    expect(
      canCallMeldOnDiscard({
        ...base,
        concealed: parseTiles("3m 3m 3m"),
        inRiichi: true,
      }),
    ).toBe(false);
  });

  it("海底では鳴けない(haitei=true・嶺上補充不可)", () => {
    expect(
      canCallMeldOnDiscard({
        ...base,
        concealed: parseTiles("3m 3m 3m"),
        haitei: true,
      }),
    ).toBe(false);
  });

  it("赤フラグは無視して種別一致で数える(赤5含みでもポン可)", () => {
    const redFive: Tile = { suit: "pin", rank: 5, isRed: true };
    const plainFive: Tile = { suit: "pin", rank: 5, isRed: false };
    // 手牌に赤5pと通常5pが1枚ずつ = 種別5pが2枚 → 5p(赤)の打牌にポン可。
    expect(
      canCallMeldOnDiscard({
        concealed: [redFive, plainFive, parseTile("9s")],
        tile: plainFive,
        need: 2,
        inRiichi: false,
        haitei: false,
        isDiscarder: false,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canKanOnDrawTurn(自ツモ番のカン局面ガード)
// ---------------------------------------------------------------------------
describe("canKanOnDrawTurn(暗槓・加槓の局面ガード)", () => {
  it("ツモ牌があり海底でなければ可", () => {
    expect(canKanOnDrawTurn(true, false)).toBe(true);
  });

  it("ツモ牌が無ければ不可(自ツモ番でない)", () => {
    expect(canKanOnDrawTurn(false, false)).toBe(false);
  });

  it("海底では不可(嶺上補充できない・#128)", () => {
    expect(canKanOnDrawTurn(true, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canDeclareRiichi(リーチ宣言の可否)
// ---------------------------------------------------------------------------
describe("canDeclareRiichi(リーチ宣言の可否)", () => {
  const ok = {
    hasDrawn: true,
    isMenzen: true,
    points: 1000,
    hasTenpaiKeepingDiscard: true,
  } as const;

  it("門前・自ツモ番・1,000点・テンパイ維持打ありで可", () => {
    expect(canDeclareRiichi(ok)).toBe(true);
  });

  it("自ツモ番でない(hasDrawn=false)なら不可", () => {
    expect(canDeclareRiichi({ ...ok, hasDrawn: false })).toBe(false);
  });

  it("非門前(鳴き後・isMenzen=false)なら不可", () => {
    expect(canDeclareRiichi({ ...ok, isMenzen: false })).toBe(false);
  });

  it("供託点棒に届かない(999点)なら不可 / 1,000点ちょうどは可(境界)", () => {
    expect(canDeclareRiichi({ ...ok, points: 999 })).toBe(false);
    expect(canDeclareRiichi({ ...ok, points: 1000 })).toBe(true);
  });

  it("テンパイを保つ打牌が無ければ不可(hasTenpaiKeepingDiscard=false)", () => {
    expect(canDeclareRiichi({ ...ok, hasTenpaiKeepingDiscard: false })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 結線監査: buildHumanPending が非門前でリーチを提示しない(加槓経由で確認)
// ---------------------------------------------------------------------------
describe("engine 結線: 明槓(加槓)成立後は非門前のためリーチを提示しない", () => {
  /** 東家(自家 p0)に「3p ポン + 手に4枚目 3p」の加槓待ち局面を組む(他家は非テンパイ)。 */
  function armKakan(seed: number): EngineState {
    const s = createGame({ seed });
    const hand = s.hand;
    if (hand === null)
      throw new Error("hand should exist right after createGame");

    const pon3p: Meld = {
      type: "pon",
      tiles: parseTiles("3p 3p 3p"),
      concealed: false,
    };
    hand.melds.east = [pon3p];
    hand.hands.east = parseTiles("3p 1m 9m 1s 9s 1p 2p");
    hand.drawn = { tile: parseTile("9m"), source: "live" };
    hand.turn = "east";
    // 他家は非テンパイに固定(3p の槍槓が発火しないよう)。
    hand.hands.south = parseTiles("2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 1s");
    hand.hands.west = parseTiles("2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 1s");

    const pending: Pending = {
      kind: "humanDiscard",
      canTsumo: false,
      canRiichi: false,
      riichiTiles: [],
      ankanTiles: [],
      kakanTiles: [parseTile("3p")],
      forbiddenDiscards: [],
      locked: false,
    };
    return { ...s, pending };
  }

  it("加槓(開かれた槓)後の打牌待ちで canRiichi=false・riichiTiles 空(非門前)", () => {
    const state = armKakan(7);
    const after = declareKakan(state, parseTile("3p"));

    // 加槓成立(嶺上ツモ済み)で自家の打牌待ちに戻る。
    expect(after.pending?.kind).toBe("humanDiscard");
    if (after.pending?.kind !== "humanDiscard") return;
    // 開かれた槓を持つため門前でない → リーチは提示されない(canDeclareRiichi の menzen ガード)。
    expect(after.pending.canRiichi).toBe(false);
    expect(after.pending.riichiTiles).toHaveLength(0);
    // 槓成立の確認(3p ポン → 槓へ昇格)。
    const kan = after.hand?.melds.east.find((m) => m.type === "kan");
    expect(kan?.concealed).toBe(false);
  });
});
