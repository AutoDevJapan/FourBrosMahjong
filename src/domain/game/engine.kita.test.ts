import { describe, expect, it } from "vitest";
import {
  createGame,
  declareKita,
  discard,
  passRon,
  proceedToNextRound,
  seatOfPlayer,
} from "./engine";

const isNorth = (tile: { suit: string; rank: number }): boolean =>
  tile.suit === "honor" && tile.rank === 4;

function visibleTileCount(state: ReturnType<typeof createGame>): number {
  const hand = state.hand;
  if (!hand) throw new Error("playing game must have a hand");
  const seats = ["east", "south", "west"] as const;
  return (
    seats.reduce(
      (total, seat) =>
        total +
        hand.hands[seat].length +
        hand.melds[seat].reduce((melds, meld) => melds + meld.tiles.length, 0) +
        hand.discardHistory[seat].length +
        hand.kita[seat],
      0,
    ) +
    (hand.drawn ? 1 : 0) +
    hand.wall.liveWall.length +
    hand.wall.deadWall.length
  );
}

describe("engine: 人間の明示北抜きとCPUの自動北抜き(#178 / #708)", () => {
  it("seed=1: 配牌北と第1ツモ北を任意に1枚ずつ抜き、補充後も同じ手番を続ける", () => {
    let state = createGame({ seed: 1 });
    expect(state.pending).toMatchObject({
      kind: "humanDiscard",
      playerId: "p0",
      canKita: true,
    });
    expect(state.hand?.kita.east).toBe(0);
    expect(state.hand?.hands.east.filter(isNorth)).toHaveLength(1);
    expect(state.hand?.drawn && isNorth(state.hand.drawn.tile)).toBe(true);
    expect(visibleTileCount(state)).toBe(108);

    state = declareKita(state);
    expect(state.pending).toMatchObject({
      kind: "humanDiscard",
      playerId: "p0",
      canKita: true,
    });
    expect(state.hand?.turn).toBe("east");
    expect(state.hand?.kita.east).toBe(1);
    expect(state.hand?.hands.east.filter(isNorth)).toHaveLength(1);
    expect(state.hand?.drawn?.source).toBe("kitaReplacement");
    expect(visibleTileCount(state)).toBe(108);

    state = declareKita(state);
    expect(state.pending).toMatchObject({
      kind: "humanDiscard",
      playerId: "p0",
      canKita: false,
    });
    expect(state.hand?.turn).toBe("east");
    expect(state.hand?.kita.east).toBe(2);
    expect(state.hand?.hands.east.some(isNorth)).toBe(false);
    expect(state.hand?.drawn && isNorth(state.hand.drawn.tile)).toBe(false);
    expect(visibleTileCount(state)).toBe(108);
  });

  it("人間は北抜きを選ばず、第1ツモの北を通常どおり打牌できる", () => {
    const state = createGame({ seed: 1 });
    const drawnNorth = state.hand?.drawn?.tile;
    expect(drawnNorth && isNorth(drawnNorth)).toBe(true);
    if (!drawnNorth) return;

    const after = discard(state, drawnNorth);
    expect(after.hand?.kita.east).toBe(0);
    expect(after.hand?.discardHistory.east.some(isNorth)).toBe(true);
  });

  it("北抜きの補充牌も北なら、同じ手番で再度北抜きを提示する", () => {
    const state = createGame({ seed: 64 });
    expect(state.pending).toMatchObject({
      kind: "humanDiscard",
      canKita: true,
    });
    expect(state.hand?.drawn && isNorth(state.hand.drawn.tile)).toBe(true);

    const after = declareKita(state);
    expect(after.hand?.kita.east).toBe(1);
    expect(after.hand?.turn).toBe("east");
    expect(after.hand?.drawn?.source).toBe("kitaReplacement");
    expect(after.hand?.drawn && isNorth(after.hand.drawn.tile)).toBe(true);
    expect(after.pending).toMatchObject({
      kind: "humanDiscard",
      canKita: true,
    });
  });

  it("CPU席の配牌北と連続する補充北は従来どおり自動で抜く", () => {
    const seats = ["east", "south", "west"] as const;
    const cpuSeatsObserved = new Set<string>();
    let consecutiveReplacementObserved = false;

    for (let seed = 1; seed <= 500; seed++) {
      const state = createGame({ seed });
      const hand = state.hand;
      if (!hand) throw new Error("playing game must have a hand");
      const humanSeat = seatOfPlayer(hand.seating, "p0");

      for (const seat of seats) {
        expect(hand.hands[seat]).toHaveLength(13);
        if (seat === humanSeat) continue;
        expect(hand.hands[seat].some(isNorth)).toBe(false);
        if (hand.kita[seat] > 0) cpuSeatsObserved.add(seat);
        if (hand.kita[seat] > 1) consecutiveReplacementObserved = true;
      }
      expect(visibleTileCount(state)).toBe(108);
    }

    // 初局の p0 は常に東なので、この初期配牌の走査で CPU になるのは南・西。
    expect(cpuSeatsObserved).toEqual(new Set(["south", "west"]));
    expect(consecutiveReplacementObserved).toBe(true);
  });

  it("抜け番ローテーション後も、人間だけ明示選択・CPUは自動を維持する", () => {
    let state = createGame({ seed: 2024 });
    const benchPlayers = new Set<string>();
    let observedRoundKey = "";

    for (let guard = 0; guard < 5000 && state.phase !== "gameEnd"; guard++) {
      if (state.hand) {
        const roundKey = `${state.round.wind}-${state.round.roundNumber}-${state.round.honba}`;
        if (roundKey !== observedRoundKey) {
          observedRoundKey = roundKey;
          benchPlayers.add(state.hand.seating.benchWarmer);
          const humanSeat = seatOfPlayer(state.hand.seating, "p0");
          for (const seat of ["east", "south", "west"] as const) {
            if (seat !== humanSeat) {
              expect(state.hand.hands[seat].some(isNorth)).toBe(false);
            }
          }
        }
      }

      if (state.phase === "roundEnd") {
        state = proceedToNextRound(state);
      } else if (state.pending?.kind === "humanDiscard") {
        if (state.pending.canKita) {
          state = declareKita(state);
        } else {
          const drawn = state.hand?.drawn?.tile;
          if (!drawn) throw new Error("human discard requires a drawn tile");
          state = discard(state, drawn);
        }
      } else if (state.pending?.kind === "humanReact") {
        state = passRon(state);
      }
    }

    expect(state.phase).toBe("gameEnd");
    expect(benchPlayers).toEqual(new Set(["p0", "p1", "p2", "p3"]));
  });
});
