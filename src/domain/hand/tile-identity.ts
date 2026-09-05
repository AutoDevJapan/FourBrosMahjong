/**
 * 和了判定のための牌アイデンティティ・ヘルパー(スペック4 4.2 / issue #65)。
 *
 * ドメイン `Tile`({@link "../tiles/tile".Tile})を、面子分解・役判定で扱いやすい
 * 「種別(suit+rank)」単位に射影するための純関数群。`isRed`(赤5)は**構造判定には
 * 使わない**(赤はドラであり役ではない → スペック3 3.2、加点は #64/#66 の責務)。
 *
 * React/DOM 非依存・副作用なし・決定的。
 */

import type { Suit, Tile } from "../tiles/tile";
import { HONOR } from "../tiles/tile";

/** 三元牌(白5・發6・中7)の rank 集合(モジュール内部用)。 */
const DRAGON_RANKS: ReadonlySet<number> = new Set([
  HONOR.WHITE,
  HONOR.GREEN,
  HONOR.RED,
]);

/** 風牌(東1・南2・西3・北4)の rank 集合(モジュール内部用)。 */
const WIND_RANKS: ReadonlySet<number> = new Set([
  HONOR.EAST,
  HONOR.SOUTH,
  HONOR.WEST,
  HONOR.NORTH,
]);

/** 役牌候補になり得る実在 rank（東・南・西・白・發・中。北はガリのため除外）。 */
const YAKUHAI_CANDIDATE_RANKS: ReadonlySet<number> = new Set([
  HONOR.EAST,
  HONOR.SOUTH,
  HONOR.WEST,
  HONOR.WHITE,
  HONOR.GREEN,
  HONOR.RED,
]);

/**
 * 牌の「種別キー」。赤フラグを無視し suit+rank で同一視する
 * (赤5筒と黒5筒は面子・役の上では同一牌)。
 */
export function tileKey(tile: Pick<Tile, "suit" | "rank">): string {
  return `${tile.suit}-${tile.rank}`;
}

/** suit+rank が一致するか(赤は無視)。 */
export function sameKind(
  a: Pick<Tile, "suit" | "rank">,
  b: Pick<Tile, "suit" | "rank">,
): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * 牌種がこの変種の牌カタログに存在するか。
 *
 * `Tile` は実行時検証を持たない値オブジェクトなので、JSONやテストfixtureから
 * 型アサーションを経由した値がここへ届くことがある。特に字牌は `suit` だけを
 * 見ると存在しない rank まで「么九牌」として扱ってしまい、国士無双の形判定を
 * すり抜ける。牌種に依存する述語はこの有限集合を境界として使う。
 */
export function isValidTileKind(tile: Pick<Tile, "suit" | "rank">): boolean {
  if (!Number.isInteger(tile.rank)) return false;
  if (tile.suit === "honor") return tile.rank >= 1 && tile.rank <= 7;
  if (tile.suit === "man") return tile.rank === 1 || tile.rank === 9;
  return (
    (tile.suit === "pin" || tile.suit === "sou") &&
    tile.rank >= 1 &&
    tile.rank <= 9
  );
}

/** 数牌か(man/pin/sou)。 */
export function isNumberSuit(suit: Suit): boolean {
  return suit !== "honor";
}

/** 字牌か。 */
export function isHonor(tile: Pick<Tile, "suit">): boolean {
  return tile.suit === "honor";
}

/** 老頭牌(数牌の 1・9)か。 */
export function isTerminalNumber(tile: Pick<Tile, "suit" | "rank">): boolean {
  return (
    isValidTileKind(tile) &&
    isNumberSuit(tile.suit) &&
    (tile.rank === 1 || tile.rank === 9)
  );
}

/** 么九牌(老頭牌 + 字牌)か。 */
export function isYaochu(tile: Pick<Tile, "suit" | "rank">): boolean {
  return isValidTileKind(tile) && (isHonor(tile) || isTerminalNumber(tile));
}

/** 三元牌か。 */
export function isDragon(tile: Pick<Tile, "suit" | "rank">): boolean {
  return tile.suit === "honor" && DRAGON_RANKS.has(tile.rank);
}

/** 風牌か。 */
export function isWind(tile: Pick<Tile, "suit" | "rank">): boolean {
  return tile.suit === "honor" && WIND_RANKS.has(tile.rank);
}

/**
 * 役牌(三元牌・場風・自風)になり得る字牌か。
 *
 * 北(ガリ)は抜きドラ専用の字牌であり、手牌に残しても役牌としては扱わない
 * (スペック3 3.0 #83-3)。**役判定における「北は役牌にならない」契約の唯一の置き場所**
 * であり、刻子側・雀頭側はどちらもこの述語を経由する — 片側にだけガードを置くと、
 * 風(`roundWind`/`seatWind`)の値域が変わった瞬間に非対称が無音で破れるため(#400)。
 * AI 方策側(`../game/ai.ts` の `isValueHonor`)もこの述語を経由する(#438)。
 *
 * TypeScript 上は自風・場風を東・南・西に制限しているが、`Tile.rank` 自体は number で
 * `createTile` も実在性を検証しない。JSON・永続化データ・型アサーションなど型境界を
 * 越える入力に備え、北だけでなくカタログ外 rank も有限集合で拒否する。
 *
 * 「役牌にならない」だけであり、北が**風牌である**こと自体は否定しない
 * (小四喜・大四喜の風牌、字一色・混老頭の構成要素にはなり得る → {@link isWind})。
 */
export function isYakuhaiCandidate(tile: Pick<Tile, "suit" | "rank">): boolean {
  return tile.suit === "honor" && YAKUHAI_CANDIDATE_RANKS.has(tile.rank);
}

/**
 * 緑一色を構成する「緑の牌」か(索子 2・3・4・6・8 と發)。
 * スペックに緑一色の明示列挙はないが、標準役満定義に準拠(→ PR で出典明記)。
 */
export function isGreenTile(tile: Pick<Tile, "suit" | "rank">): boolean {
  if (tile.suit === "sou") {
    return [2, 3, 4, 6, 8].includes(tile.rank);
  }
  return tile.suit === "honor" && tile.rank === HONOR.GREEN;
}

/**
 * サンマで実在する全牌種(和了牌候補・待ち列挙の母集合)。
 * 萬子は 1・9 のみ / 筒子・索子 1〜9 / 字牌 東南西北白發中(スペック1 1.2)。
 */
export const SANMA_TILE_KINDS: readonly { suit: Suit; rank: number }[] = [
  { suit: "man", rank: 1 },
  { suit: "man", rank: 9 },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((rank) => ({ suit: "pin" as Suit, rank })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((rank) => ({ suit: "sou" as Suit, rank })),
  ...Object.values(HONOR).map((rank) => ({ suit: "honor" as Suit, rank })),
];
