/**
 * 結果画面(`/game/result`)のソシー数値フォーマット(スペック5 5.2.1)。
 *
 * ここにあるのは**表示専用の整形**であり、精算ロジック(素点・ウマ割当 Q13・祝儀判定)ではない。
 * ソシーの増減は色だけでなく `+`/`−` の符号+スクリーンリーダー用テキストで伝える
 * (スペック5 5.2.1: 色のみでの増減表現は禁止)。
 */

/** 符号付きソシー値の表示・読み上げペア。 */
export interface SignedSoshii {
  /** 視覚表示用文字列。例: `"+10,000"` / `"−5,000"` / `"0"`。 */
  readonly display: string;
  /** スクリーンリーダー用ラベル。例: `"プラス10,000ソシー"`。 */
  readonly srLabel: string;
  /** 正の値か(0・負は false)。表示色の切り替えに使う(色は補助情報)。 */
  readonly isPositive: boolean;
}

/**
 * 素点・ウマ・祝儀・合計など、増減の向きが意味を持つ値を符号付きで整形する。
 * マイナス記号にはハイフンではなく U+2212(−)を用い、フォント上の視認性を確保する。
 */
export function formatSignedSoshii(value: number): SignedSoshii {
  const abs = Math.abs(value).toLocaleString("ja-JP");
  if (value === 0) {
    return { display: "0", srLabel: "0ソシー", isPositive: false };
  }
  const isPositive = value > 0;
  return {
    display: `${isPositive ? "+" : "−"}${abs}`,
    srLabel: `${isPositive ? "プラス" : "マイナス"}${abs}ソシー`,
    isPositive,
  };
}
