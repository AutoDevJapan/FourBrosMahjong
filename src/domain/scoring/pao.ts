/**
 * パオ(責任払い)の責任者判定 — スペック3 3.3「パオ(責任払い)の責任者判定と
 * 点棒移動」/ issue #99。
 *
 * 対象役満は **大三元・大四喜・四槓子**(スペック3 3.0 の「パオ対象」)。責任者は
 * **パオ確定牌を鳴かせた打牌者** = 副露でパオ役満が「確定」に至った、その打牌を
 * 出した者とする。
 *
 * - 大三元: 三元牌2種の刻子が既に副露で確定した状態で、3種目の三元牌をポン/大明槓
 *   させた打牌者。
 * - 大四喜: 風牌3種の刻子が確定した状態で、4種目の風牌をポン/大明槓させた打牌者。
 * - 四槓子: 3つ目までの槓が確定した状態で、4つ目の大明槓を成立させた(槓材を打った)者。
 * - **門前(暗刻・暗槓)・自摸・加槓のみで完成した役満にはパオが付かない**(責任者なし)。
 *
 * 本モジュールは**鳴き(副露)が成立した瞬間**に評価する純判定
 * {@link isPaoTriggeringCall} を提供する。鳴きそのものの受理(ポン/大明槓)は #97 の
 * 責務であり、#97 が本判定で真を得たとき、その打牌者を責任者として記録し、和了精算
 * (engine `settleWin` → {@link "./win-payment".resolveWinPayment} の `paoResponsibleId`)
 * へ渡す。点棒移動そのもの(ロン折半・ツモ全額・本場)は `win-payment.ts` が確定済み。
 *
 * 純関数・決定的・React/DOM 非依存。
 */

import type { Meld } from "../hand/meld";
import { isDragon, isWind } from "../hand/tile-identity";
import type { Tile } from "../tiles/tile";

/** 三元牌の種類数(白・發・中)= 大三元の完成条件。 */
const DRAGON_KINDS = 3;
/** 風牌の種類数(東・南・西・北)= 大四喜の完成条件。 */
const WIND_KINDS = 4;

/** 副露の代表牌(ポン/カンは同一牌なので先頭牌)。空副露は undefined。 */
function meldTile(meld: Meld): Tile | undefined {
  return meld.tiles[0];
}

/**
 * 既存副露 + 新副露に含まれる、条件に合致する字牌の**種類(rank)集合**を返す。
 * 大三元/大四喜の「何種の役牌が確定したか」を数えるのに使う。
 */
function honorKinds(
  existingMelds: readonly Meld[],
  newRank: number,
  matches: (tile: Tile) => boolean,
): Set<number> {
  const kinds = new Set<number>([newRank]);
  for (const meld of existingMelds) {
    const tile = meldTile(meld);
    if (tile !== undefined && matches(tile)) kinds.add(tile.rank);
  }
  return kinds;
}

/** {@link isPaoTriggeringCall} の入力(1回の鳴きの文脈)。 */
export interface PaoCallContext {
  /**
   * 和了者が**この鳴きの直前まで**に確定させている副露(ポン・カン)。
   * 暗槓を含み得るが、パオ判定では「既に確定した面子」として扱う
   * (大三元/大四喜の「2種/3種が確定」・四槓子の「3つ目までの槓」の母数)。
   */
  readonly existingMelds: readonly Meld[];
  /** 今まさに成立した副露(この鳴きでパオ役満が確定するかを判定する対象)。 */
  readonly newMeld: Meld;
  /**
   * この副露が**相手の打牌を鳴いて**成立したか。
   * ポン・大明槓は `true`、暗槓・加槓・自摸完成は `false`。
   * `false` の副露はパオを発生させない(門前/自力完成 → 責任者なし)。
   */
  readonly fromOpponentDiscard: boolean;
}

/**
 * この鳴きがパオ役満(大三元・大四喜・四槓子)を**確定**させ、パオ責任を発生
 * させるかを判定する(スペック3 3.3 / issue #99)。
 *
 * 真のとき、`newMeld` を鳴かせた打牌者がパオ責任者となる。呼び出し側(#97 の
 * 鳴き実装)がその打牌者IDを記録し、和了時に `resolveWinPayment` の
 * `paoResponsibleId` へ渡す。
 *
 * 相手の打牌を鳴いた副露(ポン・大明槓)のみが対象で、暗槓・加槓・自摸完成
 * (`fromOpponentDiscard === false`)はパオを発生させない。
 */
export function isPaoTriggeringCall(ctx: PaoCallContext): boolean {
  if (!ctx.fromOpponentDiscard) return false;

  const { existingMelds, newMeld } = ctx;
  const newTile = meldTile(newMeld);
  if (newTile === undefined) return false;

  // 大三元: この鳴きで三元牌が3種すべて揃う(=直前は2種確定)。
  if (isDragon(newTile)) {
    const kinds = honorKinds(existingMelds, newTile.rank, isDragon);
    if (kinds.size === DRAGON_KINDS) return true;
  }

  // 大四喜: この鳴きで風牌が4種すべて揃う(=直前は3種確定)。
  if (isWind(newTile)) {
    const kinds = honorKinds(existingMelds, newTile.rank, isWind);
    if (kinds.size === WIND_KINDS) return true;
  }

  // 四槓子: 既に3つの槓が確定 + 4つ目の大明槓をこの鳴きで成立。
  if (newMeld.type === "kan") {
    const existingKans = existingMelds.filter((m) => m.type === "kan").length;
    if (existingKans === 3) return true;
  }

  return false;
}
