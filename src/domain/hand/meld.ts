/**
 * 副露(鳴き)モデル(スペック4 4.2 `MeldType`/`Meld` / issue #65)。
 *
 * サンマは**チーなし**(スペック1 1.4)。よって副露はポン・カンのみ。
 * カンは明槓・暗槓を `concealed` で区別する(三暗刻/四暗刻・門前判定に必要)。
 *
 * 面子分解の内部表現(順子/刻子/対子/槓子)は {@link "./decompose".Mentsu} を参照。
 * `Meld` は「場に晒した/暗槓した確定面子」= 分解の入力ではなく所与のグループ。
 */

import type { Tile } from "../tiles/tile";

/** 副露種別。チーは存在しない(スペック1 1.4 / スペック4 4.2)。 */
export type MeldType = "pon" | "kan";

/**
 * 確定した副露1組。
 * - `pon` … 同一牌3枚(常に明刻: `concealed=false`)。
 * - `kan` … 同一牌4枚。明槓は `concealed=false`、暗槓は `concealed=true`。
 *
 * `tiles` は赤5を含み得る(赤の加点は #64/#66 の責務。ここでは構造のみ)。
 */
export interface Meld {
  readonly type: MeldType;
  readonly tiles: readonly Tile[];
  /** 暗槓なら true。ポン・明槓は false。門前判定・三暗刻/四暗刻に使う。 */
  readonly concealed: boolean;
}

/**
 * 門前(メンゼン)か。**暗槓のみ**を持つ(または副露ゼロの)手は門前。
 * ポン・明槓が1つでもあれば非門前。スペック2 2.4「リーチは門前テンパイ」の基礎。
 */
export function isConcealedHand(melds: readonly Meld[]): boolean {
  return melds.every((meld) => meld.type === "kan" && meld.concealed);
}
