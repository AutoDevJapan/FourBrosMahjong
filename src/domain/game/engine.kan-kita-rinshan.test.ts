import { describe, expect, it } from "vitest";
import { sameKind } from "@/domain/hand/tile-identity";
import { createTile, HONOR, type Suit, type Tile } from "@/domain/tiles/tile";
import {
  createGame,
  declareAnkan,
  declareTsumo,
  type EngineState,
  type Pending,
  seatOfPlayer,
} from "./engine";

const isNorth = (tile: Tile): boolean =>
  tile.suit === "honor" && tile.rank === HONOR.NORTH;

const seq = (suit: Suit, rank: number): Tile[] => [
  createTile(suit, rank),
  createTile(suit, rank + 1),
  createTile(suit, rank + 2),
];

function discardPending(ankanTile: Tile): Pending {
  return {
    kind: "humanDiscard",
    canTsumo: false,
    canRiichi: false,
    riichiTiles: [],
    ankanTiles: [ankanTile],
    kakanTiles: [],
    forbiddenDiscards: [],
    locked: false,
  };
}

/**
 * 暗槓 → 北の嶺上牌を自動で抜く → その次の嶺上牌で単騎和了、を組む。
 * `Wall.drawReplacement` は王牌末尾から引くため末尾が北、その1枚前が和了牌の seed を使う。
 */
function setupKanKitaRinshan(): {
  state: EngineState;
  ankanTile: Tile;
  winningTile: Tile;
  seat: "east" | "south" | "west";
} {
  for (let seed = 1; seed <= 2_000; seed++) {
    const state = createGame({ seed });
    const hand = state.hand;
    if (hand === null) continue;
    const seat = seatOfPlayer(hand.seating, "p0");
    if (seat === null) continue;

    const dead = hand.wall.deadWall;
    const firstReplacement = dead.at(-1);
    const winningTile = dead.at(-2);
    if (
      firstReplacement === undefined ||
      winningTile === undefined ||
      !isNorth(firstReplacement) ||
      isNorth(winningTile)
    ) {
      continue;
    }

    const ankanRank =
      winningTile.suit === "honor" && winningTile.rank === HONOR.EAST
        ? HONOR.SOUTH
        : HONOR.EAST;
    const ankanTile = createTile("honor", ankanRank);
    const filler =
      winningTile.suit === "pin"
        ? [...seq("sou", 1), ...seq("sou", 4), ...seq("sou", 7)]
        : winningTile.suit === "sou"
          ? [...seq("pin", 1), ...seq("pin", 4), ...seq("pin", 7)]
          : [...seq("pin", 1), ...seq("pin", 5), ...seq("sou", 1)];

    hand.hands[seat] = [
      ankanTile,
      ankanTile,
      ankanTile,
      ...filler,
      winningTile,
    ];
    hand.melds[seat] = [];
    hand.turn = seat;
    hand.drawn = { tile: ankanTile, source: "live" };

    return {
      state: { ...state, pending: discardPending(ankanTile) },
      ankanTile,
      winningTile,
      seat,
    };
  }
  throw new Error("no seed produces 北→非北 in the replacement wall");
}

describe("engine: カン→ガリ→再嶺上の役判定(#437 / Q36)", () => {
  it("Q36 の裁定まではカン起点として嶺上開花を付ける(現行挙動を固定)", () => {
    const { state, ankanTile, winningTile, seat } = setupKanKitaRinshan();
    const kitaBefore = state.hand?.kita[seat] ?? 0;

    const afterKan = declareAnkan(state, ankanTile);
    expect(afterKan.hand?.kita[seat]).toBe(kitaBefore + 1);
    expect(afterKan.hand?.drawn?.source).toBe("kanReplacement");
    expect(
      afterKan.hand?.drawn && sameKind(afterKan.hand.drawn.tile, winningTile),
    ).toBe(true);
    expect(afterKan.pending).toMatchObject({
      kind: "humanDiscard",
      canTsumo: true,
    });

    const won = declareTsumo(afterKan);
    const yaku = won.lastRound?.winDetails?.yaku.map((item) => item.name) ?? [];
    expect(yaku).toContain("嶺上開花");
    expect(yaku).not.toContain("海底摸月");
  });
});
