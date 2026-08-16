/**
 * 牌の「印字(牌面テキスト)」と「アクセシブルな名称(`aria-label`)」を導出する純関数。
 *
 * スペック5 5.2.1: 牌の種類は色ではなく**牌面の印字自体**で識別できるようにし、
 * `aria-label` にスート名+数字を含める(例: `五筒`)。赤ドラは形状差に加え
 * `aria-label` へ `(赤ドラ)` を付記する(例: `五筒(赤ドラ)`)。
 *
 * ここに含まれるのは表示のためのラベル整形のみで、ゲームロジックは一切含まない。
 */
import { isRedDora } from "@/domain/tiles/tile";
import type { TileData } from "../game/types";

/** 漢数字(1〜9)。牌面印字と `aria-label` の双方で用いる。 */
const KANJI_DIGITS = [
  "〇",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
] as const;

/** スート名(`aria-label` 用)。 */
const SUIT_NAME: Record<Exclude<TileData["suit"], "honor">, string> = {
  man: "萬",
  pin: "筒",
  sou: "索",
};

/** 字牌の名称。rank: 東1 南2 西3 北4 白5 發6 中7。 */
const HONOR_NAME = ["", "東", "南", "西", "北", "白", "發", "中"] as const;

function digit(rank: number): string {
  return KANJI_DIGITS[rank] ?? String(rank);
}

/**
 * 牌名の短いテキスト(例: `五筒`・`東`)。`aria-label` 生成の内部ヘルパ。
 *
 * 牌面の視覚表示は `Tile.tsx` が SVG 素材(`tileImage.ts`)で描くため、この文字列は
 * 画面には出さず、スクリーンリーダ向けの名称(`tileLabel`)を組み立てるためだけに使う。
 */
function tileFace(tile: TileData): string {
  if (tile.suit === "honor") {
    // rank 0 は HONOR_NAME[0]="" のため `??` では捕捉できない。空文字を含めて既定名へ倒す。
    return HONOR_NAME[tile.rank] || "字";
  }
  return `${digit(tile.rank)}${SUIT_NAME[tile.suit]}`;
}

/**
 * スクリーンリーダ向けの完全な名称(例: `五筒(赤ドラ)`)。
 *
 * `(赤ドラ)` は赤素材が実在する牌(5筒・5索)にのみ付す({@link isRedDora})。
 * `isRed` がそれ以外に付いていても牌面・バッジは通常牌のため、ラベルも赤扱いにしないことで
 * 三者(牌面・バッジ・ラベル)の整合を保つ(issue #146)。
 */
export function tileLabel(tile: TileData): string {
  return isRedDora(tile) ? `${tileFace(tile)}(赤ドラ)` : tileFace(tile);
}

/** 伏せ牌(内容非開示)の `aria-label`。 */
export const FACE_DOWN_LABEL = "伏せ牌";
