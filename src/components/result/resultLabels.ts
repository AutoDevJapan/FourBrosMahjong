import { OKA, RETURN_POINTS } from "@/domain/scoring/settlement";

/** 結果・オンライン・戦績で共有する、精算値の意味を誤解させない表示ラベル。 */
export const SOSHII_BREAKDOWN_HEADING =
  "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）";

const formatPoints = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export const RAW_SCORE_LABEL = `素点（最終持ち点−返し${formatPoints(RETURN_POINTS)}）`;
export const UMA_OKA_LABEL = "ウマ・オカ";
export const TOP_OKA_NOTE = `1位はオカ${formatPoints(OKA)}を含む`;
export const YAKUMAN_BONUS_LABEL = "役満祝儀";
