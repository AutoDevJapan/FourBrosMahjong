import { formatInteger } from "../common/numberFormat";

/** ゲーム内の点数・供託など整数値を、能力失敗時も読める形で整形する。 */
export function formatGameInteger(value: number): string {
  return formatInteger(value);
}
