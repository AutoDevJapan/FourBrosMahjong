/**
 * ドラ表示牌 → 実ドラ牌への写像(次牌ルール / スペック3 3.2 の前提)。
 *
 * 表/裏ドラは「表示牌の**次の牌**」が実ドラになる標準の次牌ルールに従う。
 * スペック2/3 は次牌の詳細(字牌の順序・萬子の扱い)を明文化していないため、
 * 標準麻雀(関西サンマ)の慣行を採用する:
 *
 * - 数牌 筒子/索子: 1→2→…→9→1(9 の次は 1 に巡回)。
 * - 数牌 萬子: 本変種の萬子は 1・9 のみ(2〜8 を抜く / スペック1 1.2)。
 *   標準サンマ慣行に従い **1萬↔9萬 で巡回**する(1→9、9→1)。
 *   ※ スペックに明記が無いため設計判断(→ PR/issue で共有)。
 * - 字牌 風牌: 東→南→西→北→東(rank 1→2→3→4→1 で巡回)。
 * - 字牌 三元牌: 白→發→中→白(rank 5→6→7→5 で巡回)。
 *
 * 実ドラ牌は牌種(`suit`/`rank`)の同定にのみ用いるため、`isRed` は牌集合の
 * 規約(5筒/5索は常に赤)に合わせて算出する。翻集計での照合は牌種で行う
 * (→ {@link "./han".countDoraHan})。
 *
 * 純ロジック・副作用なし。React/DOM 非依存。
 */

import type { Tile } from "../tiles/tile";
import { HONOR } from "../tiles/tile";

const NUMBER_MIN = 1;
const NUMBER_MAX = 9;

/** 風牌(東南西北)の rank 範囲。 */
const WIND_MIN = HONOR.EAST; // 1
const WIND_MAX = HONOR.NORTH; // 4
/** 三元牌(白發中)の rank 範囲。 */
const DRAGON_MIN = HONOR.WHITE; // 5
const DRAGON_MAX = HONOR.RED; // 7

/** 5筒・5索は常に赤(スペック4 4.4)。実ドラ牌の isRed を規約通りに補う。 */
function isRedFive(suit: Tile["suit"], rank: number): boolean {
  return rank === 5 && (suit === "pin" || suit === "sou");
}

/** [min, max] の閉区間で「次の値」を返す(max の次は min に巡回)。 */
function cycle(value: number, min: number, max: number): number {
  return value >= max ? min : value + 1;
}

/**
 * ドラ表示牌から実ドラ牌(次牌)を返す。
 *
 * @param indicator ドラ表示牌(王牌からめくられた1枚)。
 * @throws RangeError 表示牌の `suit`/`rank` が牌集合の規約外のとき。
 */
export function nextTile(indicator: Tile): Tile {
  const { suit, rank } = indicator;

  if (suit === "honor") {
    let next: number;
    if (rank >= WIND_MIN && rank <= WIND_MAX) {
      next = cycle(rank, WIND_MIN, WIND_MAX); // 東南西北 で巡回
    } else if (rank >= DRAGON_MIN && rank <= DRAGON_MAX) {
      next = cycle(rank, DRAGON_MIN, DRAGON_MAX); // 白發中 で巡回
    } else {
      throw new RangeError(`Invalid honor rank for dora indicator: ${rank}.`);
    }
    return { suit, rank: next, isRed: false };
  }

  if (suit === "man") {
    // 本変種の萬子は 1・9 のみ。標準サンマ慣行で 1↔9 巡回。
    if (rank !== NUMBER_MIN && rank !== NUMBER_MAX) {
      throw new RangeError(
        `Invalid man rank for dora indicator: ${rank} (only 1 or 9 exist in this variant).`,
      );
    }
    const next = rank === NUMBER_MIN ? NUMBER_MAX : NUMBER_MIN;
    return { suit, rank: next, isRed: false };
  }

  // 筒子・索子: 1〜9、9 の次は 1。
  if (!Number.isInteger(rank) || rank < NUMBER_MIN || rank > NUMBER_MAX) {
    throw new RangeError(
      `Invalid ${suit} rank for dora indicator: ${rank} (must be 1..9).`,
    );
  }
  const next = cycle(rank, NUMBER_MIN, NUMBER_MAX);
  return { suit, rank: next, isRed: isRedFive(suit, next) };
}
