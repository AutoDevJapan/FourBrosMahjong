/**
 * テスト専用オラクルの共通表現: 34-index カウント配列(issue #138)。
 *
 * ⚠️ これは**テスト検証用の独立オラクル**であり、本番コードからは import しない
 * (`src/domain/game/ai.ts`・`src/domain/hand/{tenpai,decompose}.ts` の正しさを、
 * MIT ライブラリ **MahjongRepository/mahjong** のアルゴリズム構造を独自再実装した
 * 参照実装とのクロス検証で担保する。コードは流用せずアルゴリズムのみを再実装)。
 *
 * mahjong ライブラリと同じ 34 種インデックス(man 0-8 / pin 9-17 / sou 18-26 /
 * honor 27-33)を採用し、参照実装と 1:1 に突き合わせられるようにする。
 * サンマでは萬子 2-8(index 1..7)が実在しないため、常に 0 になる。
 *
 * 純関数・決定的・React/DOM 非依存。`isRed`(赤5)・北ガリは牌の「構造」に影響しない
 * ため、種別(suit+rank)のみで数える(赤5筒/5索も 5筒/5索として計上)。
 */

import type { Suit, Tile } from "../../tiles/tile";

/** 34-index カウント配列の長さ。 */
export const COUNT34_LEN = 34;

const SUIT_BASE: Record<Suit, number> = {
  man: 0,
  pin: 9,
  sou: 18,
  honor: 27,
};

/** 牌種(suit+rank)→ 34-index。 */
export function tileTo34Index(tile: Pick<Tile, "suit" | "rank">): number {
  return SUIT_BASE[tile.suit] + (tile.rank - 1);
}

/** 34-index → 牌種(suit+rank)。 */
export function index34ToKind(index: number): { suit: Suit; rank: number } {
  if (index < 9) return { suit: "man", rank: index + 1 };
  if (index < 18) return { suit: "pin", rank: index - 9 + 1 };
  if (index < 27) return { suit: "sou", rank: index - 18 + 1 };
  return { suit: "honor", rank: index - 27 + 1 };
}

/** `Tile[]` を 34-index カウント配列へ写す(赤は無視)。 */
export function tilesToCount34(tiles: readonly Tile[]): number[] {
  const counts = new Array<number>(COUNT34_LEN).fill(0);
  for (const tile of tiles) counts[tileTo34Index(tile)] += 1;
  return counts;
}

/**
 * サンマで実在する全 27 牌種の 34-index 一覧
 * (萬子 1・9 / 筒子 1-9 / 索子 1-9 / 字牌 東南西北白發中)。
 * オラクル側で独自に持つ(本番の {@link "../tile-identity".SANMA_TILE_KINDS} には依存しない)。
 */
export const SANMA_INDICES_34: readonly number[] = [
  0, // 1m
  8, // 9m
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17, // 1p-9p
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  26, // 1s-9s
  27,
  28,
  29,
  30,
  31,
  32,
  33, // 東南西北白發中
];

/** 么九牌(老頭 1・9 + 字牌)の 34-index。国士判定に使う。 */
export const TERMINAL_AND_HONOR_INDICES_34: readonly number[] = [
  0, // 1m
  8, // 9m
  9, // 1p
  17, // 9p
  18, // 1s
  26, // 9s
  27,
  28,
  29,
  30,
  31,
  32,
  33, // 字牌
];
