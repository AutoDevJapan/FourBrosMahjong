/**
 * テンパイ判定・待ち牌列挙(issue #65 / spec 2.4)。
 *
 * 流局時テンパイ料・親連荘(スペック2 2.5)、リーチ可否、フリテン判定の基礎。
 * 「和了形が成立し得る不足1枚の集合(待ち)」を、実在牌種の追加試行で列挙する。
 * 役の有無は問わない(形式テンパイ)。純関数・決定的。
 */

import type { Suit, Tile } from "../tiles/tile";
import { type MeldInput, isCompleteHand } from "./decompose";
import { SANMA_TILE_KINDS, tileKey } from "./tile-identity";

const RED_FIVE_SUITS: ReadonlySet<Suit> = new Set(["pin", "sou"]);

/** 種別から `Tile` を生成(赤5筒/5索は不変条件どおり赤)。 */
function makeTile(suit: Suit, rank: number): Tile {
  return { suit, rank, isRed: rank === 5 && RED_FIVE_SUITS.has(suit) };
}

/** 牌種ごとの現在枚数(手牌+副露)。1牌種は最大4枚まで。 */
function usedCounts(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (t: Pick<Tile, "suit" | "rank">) => {
    const key = tileKey(t);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const tile of concealedTiles) bump(tile);
  for (const meld of melds) for (const tile of meld.tiles) bump(tile);
  return counts;
}

/**
 * 待ち牌(和了牌候補)を列挙する。テンパイでなければ空配列。
 * `concealedTiles` は和了牌を**含まない**手牌(13 − 3×副露 枚)。
 */
export function waitingTiles(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[] = [],
): Tile[] {
  const used = usedCounts(concealedTiles, melds);
  const waits: Tile[] = [];
  for (const kind of SANMA_TILE_KINDS) {
    const key = tileKey(kind);
    if ((used.get(key) ?? 0) >= 4) continue; // 4枚使用済みは待ちになり得ない
    const candidate = makeTile(kind.suit, kind.rank);
    if (isCompleteHand([...concealedTiles, candidate], melds)) {
      waits.push(candidate);
    }
  }
  return waits;
}

/** 形式テンパイか(待ちが1つ以上)。役の有無は問わない。 */
export function isTenpai(
  concealedTiles: readonly Tile[],
  melds: readonly MeldInput[] = [],
): boolean {
  return waitingTiles(concealedTiles, melds).length > 0;
}
