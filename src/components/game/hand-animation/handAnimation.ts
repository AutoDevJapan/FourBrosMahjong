import type { TileData } from "../types";

function tileIdentity(tile: TileData): string {
  return `${tile.suit}:${tile.rank}:${tile.isRed === true ? "red" : "normal"}`;
}

/**
 * Finds the one tile newly present in a hand snapshot.
 *
 * The game view intentionally sorts and flattens the concealed hand and the
 * drawn tile, so the UI cannot carry a domain-level draw marker. A one-tile
 * multiset change is enough to give the new display tile an entrance
 * presentation while leaving all tile data and ordering untouched. The
 * same-length case covers a replacement draw (for example after kita).
 */
export function findNewTileIndex(
  previousTiles: readonly TileData[],
  currentTiles: readonly TileData[],
): number | null {
  const lengthDelta = currentTiles.length - previousTiles.length;
  const expectedRemoved = lengthDelta === 1 ? 0 : lengthDelta === 0 ? 1 : null;
  if (expectedRemoved === null) return null;

  const remaining = new Map<string, number>();
  for (const tile of previousTiles) {
    const identity = tileIdentity(tile);
    remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
  }

  let newTileIndex: number | null = null;
  for (const [index, tile] of currentTiles.entries()) {
    const identity = tileIdentity(tile);
    const count = remaining.get(identity) ?? 0;
    if (count > 0) {
      remaining.set(identity, count - 1);
      continue;
    }
    if (newTileIndex !== null) return null;
    newTileIndex = index;
  }

  const removedCount = [...remaining.values()].reduce(
    (total, count) => total + count,
    0,
  );
  return removedCount === expectedRemoved ? newTileIndex : null;
}
