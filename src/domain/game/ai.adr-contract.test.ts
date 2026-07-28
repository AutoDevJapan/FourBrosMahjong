import { describe, expect, it } from "vitest";
import { chooseDiscard, shanten, ukeire } from "@/domain/game/ai";
import { parseTiles } from "@/domain/hand/notation";
import { tileKey } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";

/**
 * ADR-0002(AI 方策の SSOT)が列挙する打牌比較キーを、**挙動として**固定する(#393)。
 *
 * CLAUDE.md は ADR-0002 を AI 方策の SSOT と定めており、ADR だけを読んで実装を
 * 再現できることが要件になる。#393 では「実装にあるのに ADR に無い」記述漏れが
 * 2件見つかったが、ADR の文言は静的テキストなので同じ乖離が再発する。そこで
 * ADR が主張する挙動をここで固定する。
 *
 * ## フィクスチャの作り方(重要)
 *
 * 各テストは「**検証対象のキーだけが答えを変える**」局面を使う。具体的には、
 * そのキーを実装から取り除くと**別の牌が選ばれる**ように組んである(各テストの
 * コメントに、キーを外したときに選ばれる牌を書いた)。上位キーで既に決着する
 * 局面を使うと、テストは通るのに何も守らない。
 *
 * `DiscardContext.tiles` の契約は `14 − 3×副露数` 枚(`ai.ts` / ADR のフィクスチャ注記)。
 * 枚数を破ると向聴評価が静かに壊れる(#303 / #320 で2度事故になっている)ため、
 * 全フィクスチャに枚数ガードを置く。
 *
 * ## ここで扱わないもの
 *
 * - 副露手で七対子・国士を評価しないこと → 既存 `ai.test.ts` が exact assert で固定済み。
 * - 受け入れの全27牌種走査との同値性(#368) → `src/domain/hand/cross-validation.test.ts`。
 */

/** 門前手の打牌フィクスチャは常に 14 枚(`14 − 3×0`)。 */
const MENZEN_HAND_SIZE = 14;

function menzenHand(notation: string): Tile[] {
  const tiles = parseTiles(notation);
  expect(tiles).toHaveLength(MENZEN_HAND_SIZE);
  return tiles;
}

/** 入力の並びだけを変える(内容は同じ多重集合)。 */
function rotate(tiles: readonly Tile[], by: number): Tile[] {
  return [...tiles.slice(by), ...tiles.slice(0, by)];
}

describe("ADR-0002 契約: 第6キー = 牌種キーの辞書順(最終安定化 / #393)", () => {
  /**
   * 3面子 + 456s + 孤立字牌2枚(南・東)。
   *
   * 東と南は上位5キーがすべて同点になる(実測: ともに打牌後 向聴0・受け入れ 3枚1種・
   * 温存価値0・現物0・外側度3)。手牌に他の字牌は無いので、**選ばれる字牌を決めるのは
   * 第6キーだけ**である。
   *
   * 表記は意図的に**南を先に**置く。第6キーが無いと `Array.prototype.sort` の安定性に
   * より入力順の先頭(南)が選ばれるため、キーの**向き**まで固定できる。
   */
  const HONOR_TIEBREAK = "123p 456p 789p 456s 2z 1z";

  it("上位5キーが同点なら tileKey の辞書順で最小の牌を切る", () => {
    const tiles = menzenHand(HONOR_TIEBREAK);
    // 前提: 候補は南と東の2枚だけで、入力順は南が先(空振り防止)。
    expect(tiles.filter((t) => t.suit === "honor").map(tileKey)).toEqual([
      "honor-2",
      "honor-1",
    ]);

    // "honor-1"(東) < "honor-2"(南)。第6キーを外すと入力順先頭の南が選ばれる。
    expect(tileKey(chooseDiscard({ tiles }))).toBe("honor-1");
  });

  it("入力の並び順を変えても打牌は変わらない(seed 再現性の要)", () => {
    // 第6キーが無いと `Array.prototype.sort` の安定性を通じて入力順が結果に漏れる。
    // ADR が比較キーを列挙する目的はこの再現性の担保にある。
    const tiles = menzenHand(HONOR_TIEBREAK);
    const expected = tileKey(chooseDiscard({ tiles }));
    for (let by = 1; by < tiles.length; by++) {
      expect(tileKey(chooseDiscard({ tiles: rotate(tiles, by) }))).toBe(
        expected,
      );
    }
  });
});

describe("ADR-0002 契約: 第4キー = 危険牌回避(現物優先 / #393)", () => {
  /** 第6キーのフィクスチャと同型で、字牌を東・西にしたもの。 */
  const HONOR_PAIR = "123p 456p 789p 456s 1z 3z";

  it("上位3キーが同点なら現物(他家が打っている牌)を優先して切る", () => {
    const tiles = menzenHand(HONOR_PAIR);
    // 西(honor-3)だけが現物。東(honor-1)は誰も打っていない。
    const chosen = chooseDiscard({
      tiles,
      opponentDiscards: [parseTiles("3z")],
    });

    // "honor-1" < "honor-3" なので、第4キーが無ければ第6キーで東が選ばれる。
    // 現物である西が優先されることで、第4キーの存在と向きが固定される。
    expect(tileKey(chosen)).toBe("honor-3");
  });

  it("対照: 現物が無ければ第6キーどおり東を切る", () => {
    const tiles = menzenHand(HONOR_PAIR);
    expect(tileKey(chooseDiscard({ tiles }))).toBe("honor-1");
  });
});

describe("ADR-0002 契約: 第5キー = 外側度(#393)", () => {
  /**
   * 2向聴の散らばり手。打牌後の向聴が最小になる候補が複数あり、向聴が
   * `UKEIRE_SHANTEN_GATE`(=1)を超えるので受け入れは算出されない。
   * よって温存価値・現物も同点で、**外側度だけが答えを変える**。
   */
  const SCATTERED_2_SHANTEN = "4s 1m 7p 1s 6p 2p 6s 1m 9s 9p 7s 5s 2p 9s";

  it("上位4キーが同点なら外側(端寄り)の牌を切る", () => {
    const tiles = menzenHand(SCATTERED_2_SHANTEN);
    // 9筒(外側度2)が選ばれる。外側度を外すと第6キーで 6筒("pin-6" < "pin-9")になる。
    expect(tileKey(chooseDiscard({ tiles }))).toBe("pin-9");
  });
});

describe("ADR-0002 契約: 受け入れは UKEIRE_SHANTEN_GATE 以下でのみ算出する(#393)", () => {
  /**
   * 2向聴の手。受け入れを算出するなら白(`honor-5`)の方が広い(実測 14枚 > 12枚)が、
   * ゲート(1向聴以下)により算出されないので、南(`honor-2`)が第6キーで選ばれる。
   */
  const GATED_2_SHANTEN = "3s 9m 7p 6s 5z 4p 9m 5p 2z 3s 7s 5s 2p 2z";

  it("2向聴では受け入れを見ないので、受け入れの広い牌が選ばれるとは限らない", () => {
    const tiles = menzenHand(GATED_2_SHANTEN);
    // 前提: ゲートを外して受け入れを見るなら白が勝つ(空振り防止)。
    const withoutSouth = tiles.filter((t) => tileKey(t) !== "honor-2");
    const withoutWhite = tiles.filter((t) => tileKey(t) !== "honor-5");
    expect(shanten(withoutSouth, 0)).toBe(shanten(withoutWhite, 0));
    expect(ukeire(withoutWhite, 0).copies).toBeGreaterThan(
      ukeire(withoutSouth, 0).copies,
    );

    // ゲートが効いているので、受け入れではなく第6キーで南が選ばれる。
    expect(tileKey(chooseDiscard({ tiles }))).toBe("honor-2");
  });
});

describe("ADR-0002 契約: 門前では七対子・国士も向聴・受け入れの対象(#368 / #393)", () => {
  it("門前では七対子を対象に数える(6対子 + 浮き牌は七対子テンパイ)", () => {
    // 標準形では 4面子1雀頭にほど遠いが、七対子として見ればテンパイ(3s 単騎)。
    // 七対子を評価対象から外すと向聴が跳ね上がる。
    expect(shanten(parseTiles("11p 33p 55p 77p 99p 11s 3s"), 0)).toBe(0);
  });

  it("門前では国士を対象に数える(#368 の再現例)", () => {
    // ADR が挙げる再現例。国士12種 + 1m の対子で 7z 待ちのテンパイ。未所持の 7z は
    // 標準形の ±2 枝刈りでは候補に入らないため、国士を評価対象から外すと
    // 受け入れが変わる(実測: 1種4枚 → 11種33枚)。
    const kokushiTenpai = parseTiles("11m 9m 19p 19s 123456z");
    expect(shanten(kokushiTenpai, 0)).toBe(0);
    expect(ukeire(kokushiTenpai, 0)).toEqual({ kinds: 1, copies: 4 });
  });
});
