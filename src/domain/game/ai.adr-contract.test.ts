import { describe, expect, it } from "vitest";
import { chooseDiscard, shanten, ukeire } from "@/domain/game/ai";
import { parseTiles } from "@/domain/hand/notation";
import { tileKey } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";

/**
 * ADR-0002(AI 方策の SSOT)の記述を実行可能な形で裏付ける(issue #393)。
 *
 * CLAUDE.md は ADR-0002 を AI 方策の SSOT と定めており、ADR だけを読んで実装を
 * 再現できることが要件になる。#393 では ADR に以下2点の記述漏れがあった:
 *
 * 1. 打牌の比較キーの列挙が第5キー(外側度)で終わっており、実装にある
 *    **第6キー(`tileKey` の辞書順による最終安定化)** が書かれていなかった。
 *    この節の目的は「seed 再現性の担保」なので、最終安定化キーこそが要である。
 * 2. 「受け入れは標準形・七対子・国士の全てを対象に数える」と**無条件に**書かれて
 *    いたが、実装は**副露手(`meldCount > 0`)では標準形のみ**を評価する。
 *
 * ADR の文言そのものは静的テキストなので、ここでは ADR が主張する**挙動**を固定する。
 * 記述と実装が再び食い違っても、少なくとも挙動側の契約は動かない。
 */

/** 入力の並びだけを変える(内容は同じ多重集合)。 */
function rotate(tiles: readonly Tile[], by: number): Tile[] {
  return [...tiles.slice(by), ...tiles.slice(0, by)];
}

describe("ADR-0002 契約: 打牌の最終安定化キー(#393)", () => {
  /**
   * 3面子 + 両面 + 孤立字牌2枚(東・南)。
   *
   * 東と南は上位5キーがすべて同点になる: 打牌後の向聴(標準形・国士とも対称)・
   * 受け入れ・温存価値(素牌)・現物(河を渡さない)・外側度(ともに字牌)。
   * 手牌に他の字牌は無いので、**選ばれる字牌を決めるのは第6キーだけ**である。
   *
   * 表記は意図的に**南を先に**置く。最終安定化キーが無いと `Array.prototype.sort`
   * の安定性により入力順の先頭(南)が選ばれてしまうため、キーの**向き**まで固定できる。
   */
  const HONOR_TIEBREAK_13 = "123p 456p 789p 45s 2z 1z";

  it("上位5キーが同点なら tileKey の辞書順で最小の牌を切る", () => {
    const tiles = parseTiles(HONOR_TIEBREAK_13);
    // 前提: 候補は東と南の2枚だけ(他に字牌が無い)。
    const honors = tiles.filter((t) => t.suit === "honor");
    expect(honors.map((t) => tileKey(t))).toEqual(["honor-2", "honor-1"]);

    // "honor-1"(東) < "honor-2"(南)。入力順は南が先だが東が選ばれる。
    expect(tileKey(chooseDiscard({ tiles }))).toBe("honor-1");
  });

  it("入力の並び順を変えても打牌は変わらない(seed 再現性の要)", () => {
    // 最終安定化キーが無いと `Array.prototype.sort` の安定性を通じて入力順が
    // 結果に漏れる。ADR が比較キーを列挙する目的はこの再現性の担保にある。
    const tiles = parseTiles(HONOR_TIEBREAK_13);
    const expected = tileKey(chooseDiscard({ tiles }));
    for (let by = 1; by < tiles.length; by++) {
      expect(tileKey(chooseDiscard({ tiles: rotate(tiles, by) }))).toBe(
        expected,
      );
    }
  });
});

describe("ADR-0002 契約: 向聴・受け入れの対象役種は副露で変わる(#393)", () => {
  /** 国士無双13面待ち(門前13枚)。 */
  const KOKUSHI_13 = "1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z";
  /** 1副露手の門前10枚。么九牌10種が孤立している(国士に有利な形)。 */
  const MELDED_TERMINALS_10 = "1m 9m 1p 9p 1s 9s 1z 2z 3z 4z";
  /** 七対子テンパイ(門前13枚)。標準形では和了形にならない。 */
  const CHIITOITSU_TENPAI = "11p 33p 55p 77p 99p 11s 3s";

  it("門前では七対子を対象に数える(標準形だけならテンパイにならない形)", () => {
    expect(shanten(parseTiles(CHIITOITSU_TENPAI), 0)).toBe(0);
  });

  it("門前では国士を対象に数える(13面待ちの受け入れが13種)", () => {
    // 標準形だけなら国士13面待ちの受け入れは 0 種になる(#368 の再現例)。
    expect(ukeire(parseTiles(KOKUSHI_13), 0).kinds).toBe(13);
  });

  it("副露手では国士を対象に数えない(成立し得ないため)", () => {
    const tiles = parseTiles(MELDED_TERMINALS_10);
    // 国士の向聴は「13 − 所持種類数 − (么九の対子があれば1)」= 13 − 10 − 0 = 3。
    // 副露手でも国士を数えていれば向聴は 3 以下になるが、実際は標準形のみを見る。
    const kokushiShantenIfCounted = 13 - 10;
    expect(shanten(tiles, 1)).toBeGreaterThan(kokushiShantenIfCounted);
  });
});
