/**
 * 和了判定のトップレベル・オーケストレーション(issue #65)。
 *
 * 手牌+文脈から和了形を全列挙し、各形の役を判定して**最良の解釈**を返す。
 * 和了形が無い、または役が1つも無い(ナシナシ後付け含む)場合は `null`(和了不可)。
 *
 * **#66(点数計算)との責務境界**: 本関数は役と役翻合計({@link WinAnalysis.han})
 * および役満倍数までを返す。ドラ翻の加算・翻→点変換・ソシー精算は #66 が担う。
 *
 * 純関数・決定的・React/DOM 非依存。
 */

import type { Tile } from "../tiles/tile";
import { decomposeAll, type MeldInput, type WinForm } from "./decompose";
import { isConcealedHand, type Meld } from "./meld";
import { detectYaku, type PaoYaku, type Yaku, type YakuInput } from "./yaku";

/** 和了判定の入力(手牌+文脈)。席割り当て(Q9)・ドラ(#64)には依存しない。 */
export interface WinContext {
  /** 門前手牌(副露を除く)。和了牌を含む(= 13 − 3×副露 + 1 枚)。 */
  readonly concealedTiles: readonly Tile[];
  /** 副露(ポン・カン)。省略時は副露なし。 */
  readonly melds?: readonly Meld[];
  readonly winningTile: Tile;
  readonly winType: "tsumo" | "ron";
  readonly seatWind?: number;
  readonly roundWind?: number;
  readonly riichi?: boolean;
  readonly doubleRiichi?: boolean;
  readonly ippatsu?: boolean;
  readonly haitei?: boolean;
  readonly rinshan?: boolean;
  readonly chankan?: boolean;
  readonly blessing?: "heaven" | "earth";
}

/** 和了判定の結果。 */
export interface WinAnalysis {
  /** 成立した役(採用した最良解釈)。 */
  readonly yaku: readonly Yaku[];
  /** 役翻の合計(ドラ含まず)。役満時は 0。 */
  readonly han: number;
  /** 役満倍数の合計(0=非役満)。 */
  readonly yakuman: number;
  /** 役満か。 */
  readonly isYakuman: boolean;
  /** 採用した和了形。 */
  readonly form: WinForm;
  /** 含まれるパオ対象役満(責任者確定は別レイヤ=精算/#66)。 */
  readonly pao: readonly PaoYaku[];
}

const PAO_YAKU_IDS: Record<string, PaoYaku> = {
  daisangen: "daisangen",
  daisuushii: "daisuushii",
  suukantsu: "suukantsu",
};

function toMeldInputs(melds: readonly Meld[]): MeldInput[] {
  return melds.map((m) => ({
    tiles: m.tiles,
    isKan: m.type === "kan",
    concealed: m.concealed,
  }));
}

function summarize(form: WinForm, yaku: readonly Yaku[]): WinAnalysis {
  const yakuman = yaku.reduce((sum, y) => sum + y.yakuman, 0);
  const han = yakuman > 0 ? 0 : yaku.reduce((sum, y) => sum + y.han, 0);
  const pao = yaku
    .map((y) => PAO_YAKU_IDS[y.id])
    .filter((p): p is PaoYaku => p !== undefined);
  return { yaku, han, yakuman, isYakuman: yakuman > 0, form, pao };
}

/**
 * 和了を判定する。和了形が成立し役が1つ以上あれば {@link WinAnalysis}、
 * さもなくば `null`(和了形なし or 役なし or ナシナシ後付けで無効)。
 */
export function analyzeWin(context: WinContext): WinAnalysis | null {
  const melds = context.melds ?? [];
  const meldInputs = toMeldInputs(melds);
  const forms = decomposeAll(context.concealedTiles, meldInputs);
  if (forms.length === 0) return null;

  const menzen = isConcealedHand(melds);
  const allTiles: Tile[] = [
    ...context.concealedTiles,
    ...melds.flatMap((m) => m.tiles),
  ];
  const yakuInput: YakuInput = {
    allTiles,
    menzen,
    winType: context.winType,
    winningTile: context.winningTile,
    seatWind: context.seatWind,
    roundWind: context.roundWind,
    riichi: context.riichi,
    doubleRiichi: context.doubleRiichi,
    ippatsu: context.ippatsu,
    haitei: context.haitei,
    rinshan: context.rinshan,
    chankan: context.chankan,
    blessing: context.blessing,
  };

  let best: WinAnalysis | null = null;
  for (const form of forms) {
    const yaku = detectYaku(form, yakuInput);
    if (yaku.length === 0) continue; // 役なし → この解釈は和了不可
    const candidate = summarize(form, yaku);
    if (
      best === null ||
      candidate.yakuman > best.yakuman ||
      (candidate.yakuman === best.yakuman && candidate.han > best.han)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** 和了(役あり)が成立するか。 */
export function isWinningHand(context: WinContext): boolean {
  return analyzeWin(context) !== null;
}
