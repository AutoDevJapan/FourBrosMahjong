import { OKA, RETURN_POINTS } from "@/domain/scoring/settlement";

/** 結果・オンライン・戦績で共有する、精算値の意味を誤解させない表示ラベル。 */
export const SOSHII_BREAKDOWN_HEADING =
  "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）";

function fallbackFormatPoints(value: number): string {
  const truncated = Math.trunc(value);
  const sign = truncated < 0 ? "-" : "";
  const digits = Math.abs(truncated).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Intl.NumberFormat is progressive enhancement for embedded browser hosts. */
export function formatPoints(value: number): string {
  try {
    const NumberFormat = globalThis.Intl?.NumberFormat;
    if (typeof NumberFormat !== "function") return fallbackFormatPoints(value);
    return new NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return fallbackFormatPoints(value);
  }
}

export const RAW_SCORE_LABEL = `素点（最終持ち点−返し${formatPoints(RETURN_POINTS)}）`;
export const UMA_OKA_LABEL = "ウマ・オカ";
export const TOP_OKA_NOTE = `1位はオカ${formatPoints(OKA)}を含む`;
export const YAKUMAN_BONUS_LABEL = "役満祝儀";
