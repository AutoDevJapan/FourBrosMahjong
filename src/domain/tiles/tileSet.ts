/**
 * 山(牌の全集合)生成(スペック1 1.2 / スペック4 4.4)。
 *
 * サンマ標準の牌構成(計108枚)を決定的に生成する。乱数は含まない
 * (シャッフルは別モジュール {@link "../random/shuffle".shuffle} の責務)。
 */

import { createTile, HONOR, type Suit, type Tile } from "./tile";

/**
 * 使用牌の総数(スペック1 1.2 / スペック4 4.4 不変条件)。
 * 山・手牌・捨牌・晒し・王牌・抜き北 の合計は常にこの枚数。
 */
export const TOTAL_TILE_COUNT = 108;

/**
 * 各牌の重複枚数(すべての種別で4枚)。
 * 受け入れの残り枚数(`4 − 手牌内枚数`)など、山の構成に依存する計算はこの定数を参照する。
 */
export const COPIES_PER_TILE = 4;

/** 同一牌種を {@link COPIES_PER_TILE} 枚ぶん生成する(赤5は {@link createTile} に委譲)。 */
function makeCopies(suit: Suit, rank: number): Tile[] {
  return Array.from({ length: COPIES_PER_TILE }, () => createTile(suit, rank));
}

/**
 * 山の全108枚を**決定的な順序**で生成する(未シャッフル)。
 *
 * 構成(スペック1 1.2):
 * - 萬子: 一萬・九萬 各4枚 = 8枚(2〜8 を抜く)
 * - 筒子: 1〜9筒 各4枚 = 36枚(5筒は赤)
 * - 索子: 1〜9索 各4枚 = 36枚(5索は赤)
 * - 字牌: 東南西北白發中 各4枚 = 28枚
 *
 * 実対局に使う際は呼び出し側でシャッフルすること(→ {@link "../wall/wall".buildWall})。
 */
export function buildTileSet(): Tile[] {
  const tiles: Tile[] = [];

  // 萬子: 一・九 のみ。
  for (const rank of [1, 9]) {
    tiles.push(...makeCopies("man", rank));
  }
  // 筒子・索子: 1〜9(5 は赤)。
  for (const suit of ["pin", "sou"] as const) {
    for (let rank = 1; rank <= 9; rank++) {
      tiles.push(...makeCopies(suit, rank));
    }
  }
  // 字牌: 東南西北白發中(HONOR の rank 1〜7)。
  for (const rank of Object.values(HONOR)) {
    tiles.push(...makeCopies("honor", rank));
  }

  return tiles;
}
