/**
 * 喰い替え禁止の判定(issue #65 / spec 1.4)。
 *
 * スペック1 1.4「喰い替えなし」。サンマはチーが無くポンのみのため、喰い替えは
 * **現物喰い替え**(ポンした牌と同種の牌を、その打牌で切ること)に限られる。
 *
 * これは本来「打牌の合法性」= 局進行(別レイヤ)のルールだが、ナシナシ制約の一部として
 * 純粋述語で提供する。判定は「直前にポンした牌」と「これから切る牌」の種別一致のみ。
 * 純関数・決定的。
 */

import type { Tile } from "../tiles/tile";
import { sameKind } from "./tile-identity";

/**
 * 喰い替えで禁止される打牌か。
 * @param ponnedTile 直前のポンで用いた(鳴いた)牌。
 * @param discardTile これから切ろうとする牌。
 * @returns 同種を切ろうとしている(現物喰い替え)なら true。
 */
export function isKuikaeForbidden(
  ponnedTile: Tile,
  discardTile: Tile,
): boolean {
  return sameKind(ponnedTile, discardTile);
}
