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

import { createTile, type Tile } from "../tiles/tile";
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

/** ドラ確定時の牌を、入力側と共有しない実行時不変の値へ写像する。 */
function freezeTile(tile: Tile): Tile {
  return Object.freeze(createTile(tile.suit, tile.rank));
}

/**
 * 王牌からドラ表示牌を選定して `DoraSet` を構築する(スペック2 2.2)。
 *
 * 選定方針: 王牌先頭から表ドラ表示牌を `count` 枚、続けて裏ドラ表示牌を `count` 枚
 * 取る(最大 3+3=6 枚 ≤ 王牌14枚)。
 *
 * `Wall.deadWall` を渡した場合、この先頭 `2 × 上限枚数 = 6` 枚は `Wall` 側で
 * **嶺上供給から除外**されている(`DORA_INDICATOR_RESERVE` / #386)。`DoraSet` が
 * 構築時に牌をスナップショットすることに加えて、**表示牌の実体そのものが嶺上牌として
 * 配られない**ことまで保証される。本関数は任意の `Tile[]` を受け取れるため、この保証が
 * 効くのは `Wall` 由来の王牌を渡した場合に限られる。
 * 表示牌は `createTile` で値コピーしたうえで牌・配列・`DoraSet` 自体を実行時にも凍結し、
 * `readonly` の型消去後もスナップショットを保護する。
 * 以前は嶺上供給(王牌末尾から `pop`)と補填(先頭へ `unshift`)が表示牌を末尾へ
 * 押し出す構造で、9回目の補充で表示牌が手に配られ得た。
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

  const indicators = Object.freeze(deadWall.slice(0, count).map(freezeTile));
  const uraIndicators = Object.freeze(
    deadWall.slice(count, required).map(freezeTile),
  );

  return Object.freeze({ count, indicators, uraIndicators });
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
