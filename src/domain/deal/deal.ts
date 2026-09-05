/**
 * 配牌(スペック1 1.3「配給原点」の前段 / スペック2 2.1「配牌」)。
 *
 * 着席3人へ初期手牌を配る**枚数・手順のメカニクスのみ**を担う。
 * 誰がどの席(東/南/西)に座るか・親は誰か(Q9〜Q11)は本 issue #63 の範囲外で、
 * ここでは一切決めない — 返す3つの手牌は「席未確定の3人分」という順序中立な集合。
 */

import type { Tile } from "../tiles/tile";
import { WallEmptyError } from "../wall/wall";
import type { Wall } from "../wall/wall";

/** 各家の初期手牌枚数(サンマ標準: 親も含め13枚。親の第1ツモは打牌フェーズで行う)。 */
export const STARTING_HAND_SIZE = 13;

/** 同時に着席して配牌を受ける人数(サンマ / スペック1 1.1)。 */
export const SEATED_PLAYER_COUNT = 3;

/**
 * `wall` から着席3人へ初期手牌を配る。`wall` を消費(ツモ)し、配った手牌を返す。
 *
 * 手順: 全員へ1枚ずつを {@link STARTING_HAND_SIZE} 巡ラウンドロビンで配る
 * (計 `SEATED_PLAYER_COUNT × STARTING_HAND_SIZE` = 39枚をライブ壁から取得)。
 *
 * 現実の 4-4-4-1 のブロック取りや、どの手牌が東家かといった席割り当ては
 * 席・親が未確定(Q9〜Q11)のため写像しない。席が確定したら呼び出し側が
 * 返り値の各手牌を席へ割り当てる想定。
 *
 * @returns 長さ {@link SEATED_PLAYER_COUNT} の配列。各要素が1人分の手牌(13枚)。
 * @throws WallEmptyError ライブ壁の枚数が足りないとき。
 */
export function dealStartingHands(wall: Wall): Tile[][] {
  const requiredTiles = SEATED_PLAYER_COUNT * STARTING_HAND_SIZE;
  // Draw only after confirming the complete deal fits, so failure is atomic.
  if (wall.remainingLiveTiles < requiredTiles) {
    throw new WallEmptyError("live");
  }

  const hands: Tile[][] = Array.from({ length: SEATED_PLAYER_COUNT }, () => []);
  for (let round = 0; round < STARTING_HAND_SIZE; round++) {
    for (const hand of hands) {
      hand.push(wall.draw());
    }
  }
  return hands;
}
