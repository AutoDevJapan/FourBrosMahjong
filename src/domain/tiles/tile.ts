/**
 * 牌モデル(ドメイン層 SSOT / スペック4 4.2)。
 *
 * このモジュールは「牌とは何か」を表す**唯一の正**(Single Source of Truth)。
 * UI 側の表示用ビューモデル(`src/components/game/types.ts` の `TileData`)は、
 * ここで定義する `Tile` を表示用に**写像した投影**にすぎない
 * (issue #63「型重複を避ける方針」: ドメイン `Tile` を SSOT とし、UI は写像する)。
 *
 * ドメイン `Tile` は表示より厳格で、`isRed` は必須(常に真偽が確定する)。
 * `Suit`/`rank` の値域は UI 型と構造的に互換なので、UI へはそのまま渡せる。
 *
 * ゲームロジックのみ。React/DOM 非依存・副作用なし。
 */

/**
 * 牌のスート(スペック4 `Suit`)。字牌は `honor`。
 * UI の `TileData["suit"]` と同じ文字列リテラルで、写像コストをゼロにする。
 */
export type Suit = "man" | "pin" | "sou" | "honor";

/**
 * 牌1枚。値オブジェクト(不変)。
 *
 * - `suit` … スート。
 * - `rank` … 数牌は 1〜9、字牌は下記 {@link HONOR} の 1〜7。
 *   萬子(`man`)はサンマ標準で rank ∈ {1, 9} のみ(2〜8 を抜く / スペック1 1.2)。
 * - `isRed` … オール赤5。5筒・5索は常に `true`、それ以外は常に `false`
 *   (スペック4 4.4 不変条件「赤5は5筒・5索に限る」)。
 */
export interface Tile {
  readonly suit: Suit;
  readonly rank: number;
  readonly isRed: boolean;
}

/**
 * 字牌の rank 割り当て。UI 側(`tileLabel.ts` / `types.ts`)の並びと一致させる:
 * 東1・南2・西3・北4・白5・發6・中7。
 *
 * 北(`NORTH`)は局中は通常の字牌だが、抜きドラ「ガリ」の対象
 * (操作・加点は → スペック2 2.3 / 別 issue)。ここでは識別子のみ提供する。
 */
export const HONOR = {
  EAST: 1,
  SOUTH: 2,
  WEST: 3,
  NORTH: 4,
  WHITE: 5,
  GREEN: 6,
  RED: 7,
} as const;
