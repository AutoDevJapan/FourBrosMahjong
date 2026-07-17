/**
 * 和了手に対するドラ翻の集計(スペック3 3.2)。
 *
 * 和了時、次の4種をすべて **1枚1翻** で合算する:
 * - 表ドラ … その局の枚数分めくった実ドラ牌に一致する牌の枚数。
 * - 裏ドラ … リーチ和了時のみ、表と同数分の実ドラ牌に一致する牌の枚数。
 * - 赤5(オール赤5) … 手牌中の赤5筒・赤5索の枚数。
 * - ガリ(北抜き) … 抜いた北の枚数。
 *
 * **抜いた北 × 実ドラ北の二重取り(Q16 = 二重取りする / 天鳳サンマ流)**:
 * 抜いた北(ガリ)は上記ガリ枠で 1枚1翻 を得るのに加え、その局のドラ表示牌が
 * 西(→ 次牌写像で実ドラ=北)のときは、**抜いた北も表/裏ドラの照合対象**に含めて
 * 重ねて数える。すなわち抜き北 n 枚は ガリ n翻 + 表ドラ n翻(リーチ時はさらに
 * 裏ドラ n翻)として二重計上する(spec 3.2 / Q16)。
 *
 * 本モジュールは**ドラ由来の翻数のみ**を算出する。役の翻・点数計算・席/親・
 * ツモ配分・ウマ(Q9〜Q13)は範囲外(後続 #66 が本結果を受け取る)。
 *
 * 純ロジック・副作用なし。React/DOM 非依存。
 */

import { HONOR, type Tile } from "../tiles/tile";
import type { DoraSet } from "./doraSet";
import { resolveDora } from "./doraSet";

/** 抜いた北(ガリ)牌の値。赤フラグは常に false(北は赤5ではない)。 */
const NORTH_TILE: Tile = { suit: "honor", rank: HONOR.NORTH, isRed: false };

/** 翻集計の入力。 */
export interface DoraHanInput {
  /**
   * 和了手を構成する実牌(手牌 + 晒し)。**抜いた北は含めない**
   * (ガリは {@link DoraHanInput.kitaCount} で別枠加算)。
   *
   * 抜いた北の表/裏ドラ照合(Q16 二重取り)は本フィールドではなく
   * {@link DoraHanInput.kitaCount} を通じて {@link countDoraHan} が内部で行う。
   * ここに抜き北を混ぜると赤5集計等に影響するため、含めてはならない。
   */
  readonly hand: readonly Tile[];
  /** その局の `DoraSet`(表/裏ドラ表示牌)。 */
  readonly doraSet: DoraSet;
  /** リーチ和了かどうか。裏ドラは真のときのみ加算。 */
  readonly riichi: boolean;
  /** 抜いた北(ガリ)の枚数。0 以上の整数。 */
  readonly kitaCount: number;
}

/** ドラ翻の内訳(合計は {@link DoraHanBreakdown.total})。 */
export interface DoraHanBreakdown {
  /** 表ドラ由来の翻。 */
  readonly omote: number;
  /** 裏ドラ由来の翻(非リーチ時は常に 0)。 */
  readonly ura: number;
  /** 赤5由来の翻。 */
  readonly aka: number;
  /** ガリ(北抜き)由来の翻。 */
  readonly gari: number;
  /** ドラ由来の合計翻。 */
  readonly total: number;
}

/** 手牌のうち、指定した実ドラ牌(牌種)に一致する枚数を数える。 */
function countMatches(
  hand: readonly Tile[],
  doraTiles: readonly Tile[],
): number {
  let total = 0;
  for (const dora of doraTiles) {
    for (const tile of hand) {
      // 照合は牌種(suit + rank)のみ。isRed(赤)は別枠(aka)で数える。
      if (tile.suit === dora.suit && tile.rank === dora.rank) {
        total++;
      }
    }
  }
  return total;
}

/**
 * 和了手のドラ翻を集計する(スペック3 3.2)。
 *
 * @throws RangeError `kitaCount` が 0 以上の整数でないとき。
 */
export function countDoraHan(input: DoraHanInput): DoraHanBreakdown {
  const { hand, doraSet, riichi, kitaCount } = input;

  if (!Number.isInteger(kitaCount) || kitaCount < 0) {
    throw new RangeError(
      `kitaCount must be a non-negative integer, received ${kitaCount}.`,
    );
  }

  const { omote: omoteDora, ura: uraDora } = resolveDora(doraSet);

  // Q16(二重取りする): 抜いた北 kitaCount 枚も表/裏ドラの照合対象に含める。
  // ドラ表示牌が西(実ドラ=北)なら、抜き北はガリ翻に加えて表(+裏)ドラ翻も得る。
  // 北は赤5になり得ないため aka には一切影響しない。
  const kitaTiles: readonly Tile[] =
    kitaCount > 0 ? Array.from({ length: kitaCount }, () => NORTH_TILE) : [];

  const omote =
    countMatches(hand, omoteDora) + countMatches(kitaTiles, omoteDora);
  const ura = riichi
    ? countMatches(hand, uraDora) + countMatches(kitaTiles, uraDora)
    : 0;
  const aka = hand.reduce((sum, tile) => sum + (tile.isRed ? 1 : 0), 0);
  const gari = kitaCount;

  return {
    omote,
    ura,
    aka,
    gari,
    total: omote + ura + aka + gari,
  };
}
