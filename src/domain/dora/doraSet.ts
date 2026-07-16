/**
 * 局のドラ確定 = `DoraSet`(スペック4 4.1 / スペック2 2.2)。
 *
 * 開門サイコロの出目から表ドラ枚数を決め、王牌(`Wall.deadWall`)から表/裏ドラ
 * 表示牌を**同数**選定して保持する。#63(牌・山の土台)が「ドラ表示牌の選定は
 * 未実装」と申し送った部分を、ここで確定させる。
 *
 * `DoraSet` は局開始時点のドラ表示牌の**スナップショット**(不変)。牌は値オブジェクト
 * なので、以後 `Wall` が北抜き等で消費されても影響を受けない。
 *
 * 純ロジック・副作用なし。React/DOM 非依存。
 */

import type { Tile } from "../tiles/tile";
import type { DiceRoll, DoraCount } from "./dice";
import { omoteDoraCount } from "./dice";
import { nextTile } from "./indicator";

/**
 * 1局分のドラ確定情報(スペック4 4.1)。
 *
 * 不変条件(スペック4 4.4):
 * - `count` は 1〜3 のいずれか。
 * - `indicators.length === uraIndicators.length === count`(裏は表と同数)。
 */
export interface DoraSet {
  /** 表ドラ枚数(= 裏ドラ枚数)。 */
  readonly count: DoraCount;
  /** 表ドラ表示牌(`count` 枚)。実ドラは {@link nextTile} で写像。 */
  readonly indicators: readonly Tile[];
  /** 裏ドラ表示牌(`count` 枚)。リーチ和了時のみ有効。 */
  readonly uraIndicators: readonly Tile[];
}

/**
 * 王牌からドラ表示牌を選定して `DoraSet` を構築する(スペック2 2.2)。
 *
 * 選定方針: 王牌先頭から表ドラ表示牌を `count` 枚、続けて裏ドラ表示牌を `count` 枚
 * 取る(最大 3+3=6 枚 ≤ 王牌14枚)。`Wall.drawReplacement()` は王牌末尾から嶺上を
 * 供給し先頭側に補填するが、`DoraSet` は構築時に牌をスナップショットするため、
 * 以後の消費と干渉しない。
 *
 * @param deadWall 王牌(`Wall.deadWall`)。最低 `2 × count` 枚が必要。
 * @param roll     開門サイコロの出目。
 * @throws RangeError 王牌の枚数が `2 × count` 未満のとき。
 */
export function createDoraSet(
  deadWall: readonly Tile[],
  roll: DiceRoll,
): DoraSet {
  const count = omoteDoraCount(roll);
  const required = count * 2;
  if (deadWall.length < required) {
    throw new RangeError(
      `Dead wall needs at least ${required} tiles for ${count} omote + ${count} ura indicators, received ${deadWall.length}.`,
    );
  }

  const indicators = deadWall.slice(0, count);
  const uraIndicators = deadWall.slice(count, required);

  return { count, indicators, uraIndicators };
}

/**
 * ドラ表示牌を実ドラ牌(次牌)へ写像した結果。翻集計の照合に用いる。
 */
export interface ResolvedDora {
  /** 表ドラの実牌(`count` 枚)。 */
  readonly omote: readonly Tile[];
  /** 裏ドラの実牌(`count` 枚)。リーチ和了時のみ加算対象。 */
  readonly ura: readonly Tile[];
}

/**
 * `DoraSet` の表示牌をすべて実ドラ牌(次牌)へ写像する(→ {@link nextTile})。
 */
export function resolveDora(doraSet: DoraSet): ResolvedDora {
  return {
    omote: doraSet.indicators.map(nextTile),
    ura: doraSet.uraIndicators.map(nextTile),
  };
}
