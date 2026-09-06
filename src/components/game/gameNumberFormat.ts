/**
 * ゲーム画面で使う整数の表示整形。
 *
 * `Number.prototype.toLocaleString` は通常のブラウザ機能だが、埋め込み環境や
 * プライバシー制限されたWebViewではメソッドが無い、または呼び出し時に例外を投げる
 * ことがある。ローカライズは表示上の補助機能なので、対局の描画を壊さないように
 * 決定的な3桁区切りへフォールバックする。
 */

function fallbackFormatGameInteger(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const truncated = Math.trunc(value);
  const sign = truncated < 0 ? "-" : "";
  const digits = Math.abs(truncated).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** ゲーム内の点数・供託など整数値を、能力失敗時も読める形で整形する。 */
export function formatGameInteger(value: number): string {
  try {
    return value.toLocaleString("ja-JP");
  } catch {
    return fallbackFormatGameInteger(value);
  }
}
