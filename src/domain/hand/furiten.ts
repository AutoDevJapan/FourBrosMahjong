/**
 * フリテン判定(issue #65 / spec 2.4)。
 *
 * スペック2 2.4「フリテンリーチあり・ただしツモ和了のみ可(ロン不可)」に準拠。
 * フリテンは3種を扱う:
 * 1. **捨て牌フリテン**: 自分の待ち牌のいずれかを自分が打っている(恒久 / #395)。
 * 2. **同巡内フリテン**: 同巡中に当たり牌を見逃した(次のツモまで一時的)。文脈入力。
 * 3. **リーチ後フリテン**: リーチ後に一度でも当たり牌を見逃した(そのリーチ中は恒久)。文脈入力。
 *
 * フリテンは**ロンのみ**を禁じ、ツモ和了は常に可能(受け入れ基準)。
 * 同巡内・リーチ後の「見逃し履歴」は局進行(別レイヤ)が管理する情報のため文脈として受ける。
 * 純関数・決定的。
 */

import type { Tile } from "../tiles/tile";
import type { MeldInput } from "./decompose";
import { waitingTiles } from "./tenpai";
import { sameKind } from "./tile-identity";

/** フリテンの原因種別。 */
export type FuritenReason = "discard" | "temporary" | "riichi";

export interface FuritenContext {
  /** テンパイ手(和了牌を含まない 13 − 3×副露 枚)。 */
  readonly concealedTiles: readonly Tile[];
  readonly melds?: readonly MeldInput[];
  /**
   * 自分の**打牌履歴**。捨て牌フリテンの判定に使う。
   *
   * 他家に鳴かれて河(表示)から取り除かれた牌も**必ず含める**(#395)。
   * 捨て牌フリテンは恒久であり、鳴きという自分の意思と無関係な事象では解除されない。
   * 表示用の河をそのまま渡してはならない。
   */
  readonly ownDiscardHistory: readonly Tile[];
  /** 同巡内で当たり牌を見逃した(次のツモまで一時フリテン)。 */
  readonly temporaryMiss?: boolean;
  /** リーチ後に当たり牌を見逃した(そのリーチ中は恒久フリテン)。 */
  readonly riichiMiss?: boolean;
}

export interface FuritenResult {
  readonly furiten: boolean;
  /** フリテンの原因(複数該当時は discard > riichi > temporary の順で代表)。 */
  readonly reason: FuritenReason | null;
  /** 現在の待ち牌。 */
  readonly waits: readonly Tile[];
}

/** フリテン状態を判定する。 */
export function evaluateFuriten(ctx: FuritenContext): FuritenResult {
  const waits = waitingTiles(ctx.concealedTiles, ctx.melds ?? []);
  const discardFuriten = ctx.ownDiscardHistory.some((discard) =>
    waits.some((wait) => sameKind(wait, discard)),
  );

  let reason: FuritenReason | null = null;
  if (discardFuriten) reason = "discard";
  else if (ctx.riichiMiss) reason = "riichi";
  else if (ctx.temporaryMiss) reason = "temporary";

  return { furiten: reason !== null, reason, waits };
}

/** 与えられた牌でロン和了できるか(待ち牌 かつ 非フリテン)。 */
export function canRon(ctx: FuritenContext, winningTile: Tile): boolean {
  const { furiten, waits } = evaluateFuriten(ctx);
  if (furiten) return false;
  return waits.some((wait) => sameKind(wait, winningTile));
}

/** 与えられた牌でツモ和了できるか(待ち牌であればフリテンでも可)。 */
export function canTsumo(ctx: FuritenContext, winningTile: Tile): boolean {
  const { waits } = evaluateFuriten(ctx);
  return waits.some((wait) => sameKind(wait, winningTile));
}
