/**
 * 牌の簡易記法パーサ(テスト・デバッグ用の内部ユーティリティ / issue #65)。
 *
 * 天鳳ライクな記法で `Tile[]` を組み立てる。数牌は `m`(萬)/`p`(筒)/`s`(索)、
 * 字牌は `z`(1東 2南 3西 4北 5白 6發 7中)。例: `"123p 456s 77z"`。
 * 5筒・5索は不変条件どおり自動で赤(`isRed=true`)。
 *
 * ⚠️ 本番ロジックではなく、テストで手牌を簡潔に記述するための純ヘルパー。
 */

import type { Suit, Tile } from "../tiles/tile";

const SUIT_OF_LETTER: Record<string, Suit> = {
  m: "man",
  p: "pin",
  s: "sou",
  z: "honor",
};

const RED_FIVE_SUITS: ReadonlySet<Suit> = new Set(["pin", "sou"]);

/** 簡易記法から `Tile[]` を生成する。空白は無視。 */
export function parseTiles(notation: string): Tile[] {
  const tiles: Tile[] = [];
  let digits = "";
  for (const ch of notation.replace(/\s+/g, "")) {
    if (ch >= "0" && ch <= "9") {
      digits += ch;
      continue;
    }
    const suit = SUIT_OF_LETTER[ch];
    if (!suit) throw new Error(`Unknown suit letter: ${ch}`);
    for (const d of digits) {
      const rank = Number(d);
      tiles.push({ suit, rank, isRed: rank === 5 && RED_FIVE_SUITS.has(suit) });
    }
    digits = "";
  }
  if (digits.length > 0) throw new Error(`Dangling digits: ${digits}`);
  return tiles;
}

/** 1枚だけの簡易生成(和了牌の指定などに使う)。 */
export function parseTile(notation: string): Tile {
  const tiles = parseTiles(notation);
  if (tiles.length !== 1)
    throw new Error(`Expected exactly one tile: ${notation}`);
  return tiles[0];
}

const LETTER_OF_SUIT: Record<Suit, string> = {
  man: "m",
  pin: "p",
  sou: "s",
  honor: "z",
};

/**
 * 牌種(suit+rank)を簡易記法の1枚へ書き戻す(例: `{ suit: "pin", rank: 5 }` → `"5p"`)。
 * {@link parseTile} の逆写像。牌種から `Tile` を組み立てたい場合は
 * `parseTile(tileNotation(kind))` とすることで、赤5の不変条件を再実装せずに済む。
 * 失敗時のテストメッセージで手牌を人が読める形にするのにも使う。
 */
export function tileNotation(kind: Pick<Tile, "suit" | "rank">): string {
  return `${kind.rank}${LETTER_OF_SUIT[kind.suit]}`;
}
