/**
 * 翻数 → 点数の変換(スペック3 3.1 / issue #66・#86 Q12)。
 *
 * **符計算は行わない**。翻合計から標準テーブルで基本点を決め、ロン/ツモの
 * 支払い額を算出する。ツモ配分は西日本サンマ主流の「ツモ損なし・北家折半」
 * (Q12)方式:不在の北家が負担するはずの分を親子で折半し、ツモ和了者は
 * ロンと同額を受け取る。
 *
 * **役翻+ドラ翻の結線**: 役翻(#65 {@link "../hand/win".WinAnalysis.han}、ドラ含まず)と
 * ドラ翻(#64 {@link "../dora/han".DoraHanBreakdown.total})の合算は
 * {@link handValueFromHan} で行い、その合計翻を本モジュールの標準テーブルへ渡す。
 * 合計 13 翻以上は**数え役満**(点数は役満だが祝儀は付かない → {@link "./settlement"})。
 *
 * 純ロジック・決定的・React/DOM 非依存。
 */

/** 点数区分(スペック3 3.1)。 */
export type ScoreCategory =
  | "normal"
  | "mangan"
  | "haneman"
  | "baiman"
  | "sanbaiman"
  | "yakuman";

/** 翻→点の入力。役満は {@link yakumanMultiplier} で表現(その場合 {@link han} は無視)。 */
export interface HandValueInput {
  /**
   * 役翻+ドラ翻の合計(役満構成でないとき)。1 以上の整数。
   * 役満構成(`yakumanMultiplier > 0`)のときは参照されない。
   */
  readonly han: number;
  /**
   * 役満倍数(0=非役満構成、1=シングル役満、2=ダブル役満…)。
   * `> 0` のとき構成役満として扱い、{@link han} を無視する。
   */
  readonly yakumanMultiplier: number;
}

/** ツモ和了時の支払い配分(サンマ・ツモ損なし・北家折半 / Q12)。 */
export interface TsumoPayments {
  /** 子ツモ時に親が払う額。親ツモ時は 0。 */
  readonly fromDealer: number;
  /** 各子が払う額(子ツモ時は在席の子1人、親ツモ時は在席の子2人が各々)。 */
  readonly fromNonDealer: number;
  /** 支払い総額(= 和了者の受取点。ロンと同額 = ツモ損なし)。 */
  readonly total: number;
}

/** 翻→点の算出結果。 */
export interface ScoreResult {
  readonly category: ScoreCategory;
  /** 基本点 `a`(子ロン = 4a、親ロン = 6a の基礎)。 */
  readonly basePoints: number;
  /** 構成役満か(大三元等の役満役による)。 */
  readonly isTrueYakuman: boolean;
  /** 数え役満か(合計 13 翻以上の非構成役満。**祝儀対象外**)。 */
  readonly isCountedYakuman: boolean;
  /** ロン和了時に放銃者が払う総額(= 和了者の受取点)。 */
  readonly ronTotal: number;
  /** ツモ和了時の支払い配分。 */
  readonly tsumo: TsumoPayments;
}

/** 符なし変種の基準符(スペック3は符計算を省略するため一律 30 符相当とみなす)。 */
const FIXED_FU = 30;
/** 満貫の基本点上限。 */
const MANGAN_BASE = 2000;
/** 数え役満のしきい値(合計翻)。 */
const COUNTED_YAKUMAN_HAN = 13;

/** 100 点単位への切り上げ(標準麻雀の端数処理)。 */
function ceil100(value: number): number {
  return Math.ceil(value / 100) * 100;
}

/** 合計翻から区分と基本点 `a` を求める(構成役満は別扱い)。 */
function categorize(han: number): {
  category: ScoreCategory;
  basePoints: number;
} {
  if (han >= COUNTED_YAKUMAN_HAN) {
    return { category: "yakuman", basePoints: 8000 };
  }
  if (han >= 11) return { category: "sanbaiman", basePoints: 6000 };
  if (han >= 8) return { category: "baiman", basePoints: 4000 };
  if (han >= 6) return { category: "haneman", basePoints: 3000 };
  if (han === 5) return { category: "mangan", basePoints: MANGAN_BASE };
  // 1〜4 翻: 一律 30 符とみなして基本点 a = fu × 2^(2+han)。満貫上限で頭打ち。
  const raw = FIXED_FU * 2 ** (2 + han);
  const basePoints = Math.min(raw, MANGAN_BASE);
  return {
    category: basePoints >= MANGAN_BASE ? "mangan" : "normal",
    basePoints,
  };
}

/**
 * ツモの支払い配分を算出(サンマ・ツモ損なし・北家折半 / Q12)。
 *
 * 4人麻雀の標準配分を基準に、不在の北家分を在席の親子で折半する:
 * - 子ツモ: 親 = 2.5a、在席の子 = 1.5a(北家の 1a を親子で 0.5a ずつ折半)。
 * - 親ツモ: 在席の子 = 各 3a(北家の 2a を子2人で 1a ずつ折半)。
 *
 * 各支払いは 100 点単位に切り上げる。満貫以上では総額がロンと厳密に一致する。
 */
function computeTsumo(basePoints: number, isDealerWin: boolean): TsumoPayments {
  if (isDealerWin) {
    const fromNonDealer = ceil100(basePoints * 3);
    return { fromDealer: 0, fromNonDealer, total: fromNonDealer * 2 };
  }
  const fromDealer = ceil100(basePoints * 2.5);
  const fromNonDealer = ceil100(basePoints * 1.5);
  return { fromDealer, fromNonDealer, total: fromDealer + fromNonDealer };
}

/**
 * 翻(または役満倍数)と親/子から点数を算出する(スペック3 3.1 / Q12)。
 *
 * @param value 役翻+ドラ翻の合計、または構成役満倍数({@link HandValueInput})。
 * @param isDealerWin 和了者が親か。
 * @throws RangeError 非役満で `han` が 1 未満、または整数でないとき。
 */
export function computeScore(
  value: HandValueInput,
  isDealerWin: boolean,
): ScoreResult {
  const isTrueYakuman = value.yakumanMultiplier > 0;

  let category: ScoreCategory;
  let basePoints: number;
  let isCountedYakuman = false;

  if (isTrueYakuman) {
    category = "yakuman";
    basePoints = 8000 * value.yakumanMultiplier;
  } else {
    if (!Number.isInteger(value.han) || value.han < 1) {
      throw new RangeError(
        `han must be a positive integer for a non-yakuman hand, received ${value.han}.`,
      );
    }
    const c = categorize(value.han);
    category = c.category;
    basePoints = c.basePoints;
    isCountedYakuman = value.han >= COUNTED_YAKUMAN_HAN;
  }

  const dealerMultiplier = isDealerWin ? 6 : 4;
  const ronTotal = ceil100(basePoints * dealerMultiplier);
  const tsumo = computeTsumo(basePoints, isDealerWin);

  return {
    category,
    basePoints,
    isTrueYakuman,
    isCountedYakuman,
    ronTotal,
    tsumo,
  };
}

/**
 * 役翻(#65)とドラ翻(#64)を合算して {@link HandValueInput} を作る(結線点)。
 *
 * 構成役満(`yakumanMultiplier > 0`)ではドラは打点に影響しないため合算しない。
 * 非役満では役翻+ドラ翻を合計し、13 翻以上は数え役満として扱われる。
 *
 * @param yakuHan 役翻の合計(ドラ含まず)。役満時は 0。
 * @param doraHan ドラ翻の合計(表/裏/赤/ガリ)。
 * @param yakumanMultiplier 構成役満倍数(0=非役満)。
 */
export function handValueFromHan(
  yakuHan: number,
  doraHan: number,
  yakumanMultiplier: number,
): HandValueInput {
  if (yakumanMultiplier > 0) {
    return { han: 0, yakumanMultiplier };
  }
  return { han: yakuHan + doraHan, yakumanMultiplier: 0 };
}
