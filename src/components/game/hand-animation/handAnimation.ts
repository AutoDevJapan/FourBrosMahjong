import type { TileData } from "../types";

export type HandAnimationKind = "deal" | "draw" | "replacement" | "meld";

export interface HandTransition {
  /** The visual transition that best explains the two hand snapshots. */
  readonly kind: HandAnimationKind;
  /** The one tile entering during a draw/replacement, if there is one. */
  readonly newTileIndex: number | null;
  /** All current indexes that should receive the transition presentation. */
  readonly affectedTileIndices: readonly number[];
}

function tileIdentity(tile: TileData): string {
  return `${tile.suit}:${tile.rank}:${tile.isRed === true ? "red" : "normal"}`;
}

interface TileDelta {
  readonly addedTileIndices: readonly number[];
  readonly removedTileCount: number;
}

function tileDelta(
  previousTiles: readonly TileData[],
  currentTiles: readonly TileData[],
): TileDelta {
  const remaining = new Map<string, number>();
  for (const tile of previousTiles) {
    const identity = tileIdentity(tile);
    remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
  }

  const addedTileIndices: number[] = [];
  let matchedTileCount = 0;
  for (const [index, tile] of currentTiles.entries()) {
    const identity = tileIdentity(tile);
    const count = remaining.get(identity) ?? 0;
    if (count > 0) {
      remaining.set(identity, count - 1);
      matchedTileCount += 1;
    } else {
      addedTileIndices.push(index);
    }
  }

  return {
    addedTileIndices,
    removedTileCount: previousTiles.length - matchedTileCount,
  };
}

function isInitialHandSize(length: number): boolean {
  // The view contains 13 dealt tiles, or 14 when the current player has
  // already received the first draw.
  return length === 13 || length === 14;
}

function transition(
  kind: HandAnimationKind,
  currentTiles: readonly TileData[],
  newTileIndex: number | null,
): HandTransition {
  return {
    kind,
    newTileIndex,
    affectedTileIndices:
      kind === "deal" || kind === "meld"
        ? currentTiles.map((_, index) => index)
        : newTileIndex === null
          ? []
          : [newTileIndex],
  };
}

/**
 * Classifies the smallest deterministic visual transition between two hand
 * snapshots. The hand view is sorted and does not expose the engine's draw
 * source, so this deliberately uses tile multisets rather than array indexes.
 *
 * `null` is used for the first snapshot only by the component to identify a
 * deal. A full-size replacement of a previously visible hand is also treated
 * as a deal, which covers a round boundary without needing domain metadata.
 */
export function classifyHandTransition(
  previousTiles: readonly TileData[] | null,
  currentTiles: readonly TileData[],
): HandTransition | null {
  if (currentTiles.length === 0) return null;

  if (previousTiles === null) {
    return transition("deal", currentTiles, null);
  }

  const { addedTileIndices, removedTileCount } = tileDelta(
    previousTiles,
    currentTiles,
  );

  // A normal draw adds one tile without removing any existing tile.
  if (
    addedTileIndices.length === 1 &&
    removedTileCount === 0 &&
    currentTiles.length === previousTiles.length + 1
  ) {
    return transition("draw", currentTiles, addedTileIndices[0]);
  }

  // Kita and kan replacement both appear as one removed + one added tile in
  // the display snapshot. Kakan has the same visible shape, so it receives
  // the same entrance treatment while the meld itself remains domain-owned.
  if (
    addedTileIndices.length === 1 &&
    removedTileCount === 1 &&
    currentTiles.length === previousTiles.length
  ) {
    return transition("replacement", currentTiles, addedTileIndices[0]);
  }

  // A new round normally starts with 13/14 visible tiles. Requiring at least
  // two multiset changes prevents an ordinary draw/replacement from being
  // relabeled as a deal, while avoiding replay on an unchanged rerender.
  if (
    isInitialHandSize(currentTiles.length) &&
    (addedTileIndices.length >= 2 || removedTileCount >= 2)
  ) {
    return transition("deal", currentTiles, null);
  }

  // Pon removes two concealed tiles; kan removes three or four and may add a
  // replacement tile in the same engine update. Animate the remaining hand's
  // settling movement, including that replacement when present.
  if (removedTileCount >= 2 && addedTileIndices.length <= 1) {
    return transition(
      "meld",
      currentTiles,
      addedTileIndices.length === 1 ? addedTileIndices[0] : null,
    );
  }

  return null;
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
  const classified = classifyHandTransition(previousTiles, currentTiles);
  return classified?.kind === "draw" || classified?.kind === "replacement"
    ? classified.newTileIndex
    : null;
}
