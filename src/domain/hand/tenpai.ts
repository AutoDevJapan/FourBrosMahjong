/**
 * テンパイ判定・待ち牌列挙(issue #65 / spec 2.4)。
 *
 * 流局時テンパイ料・親連荘(スペック2 2.5)、リーチ可否、フリテン判定の基礎。
 * 「和了形が成立し得る不足1枚の集合(待ち)」を、実在牌種の追加試行で列挙する。
 * 役の有無は問わない(形式テンパイ)。純関数・決定的。
 */

import { createTile, type Tile } from "../tiles/tile";
import { isCompleteHand, type MeldInput } from "./decompose";
import { isValidTileKind, SANMA_TILE_KINDS, tileKey } from "./tile-identity";

/**
 * `Tile`/`MeldInput` は公開された構造型なので、JSON や型アサーション経由の
 * 値が実行時に届き得る。`usedCounts` は分解器の検証より先に走るため、ここでは
 * 牌キーを読む前に、少なくともその処理が安全に扱える形状を確認する。
 * 詳細な面子形状・枚数・牌種重複の検証は `isCompleteHand` 側へ委譲する。
 */
function isValidTileInput(value: unknown): value is Tile {
  if (value === null || typeof value !== "object") return false;
  const tile = value as Pick<Tile, "suit" | "rank">;
  return typeof tile.suit === "string" && isValidTileKind(tile);
}

function hasValidTileInputs(value: unknown): value is readonly Tile[] {
  if (!Array.isArray(value)) return false;
  for (const tile of value) {
    if (!isValidTileInput(tile)) return false;
  }
  return true;
}

function hasSafeMeldTileInputs(value: unknown): value is readonly MeldInput[] {
  if (!Array.isArray(value)) return false;
  for (const meld of value) {
    if (meld === null || typeof meld !== "object") return false;
    if (!hasValidTileInputs((meld as Partial<MeldInput>).tiles)) return false;
  }
  return true;
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
  if (!hasValidTileInputs(concealedTiles) || !hasSafeMeldTileInputs(melds)) {
    return [];
  }
  const used = usedCounts(concealedTiles, melds);
  const waits: Tile[] = [];
  for (const kind of SANMA_TILE_KINDS) {
    const key = tileKey(kind);
    if ((used.get(key) ?? 0) >= 4) continue; // 4枚使用済みは待ちになり得ない
    const candidate = createTile(kind.suit, kind.rank);
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
