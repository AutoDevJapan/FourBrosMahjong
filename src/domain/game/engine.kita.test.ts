import { describe, expect, it } from "vitest";
import { createGame, discard, passRon, proceedToNextRound } from "./engine";

const isNorth = (tile: { suit: string; rank: number }): boolean =>
  tile.suit === "honor" && tile.rank === 4;

describe("engine: 配牌時の自動北抜き(#178)", () => {
  it("seed=1: 配牌北と第1ツモ北をどちらも抜き、嶺上牌で手牌枚数を保つ", () => {
    const state = createGame({ seed: 1 });
    const hand = state.hand;
    expect(hand).not.toBeNull();
    if (!hand) return;

    expect(hand.kita.east).toBe(2);
    expect(hand.hands.east).toHaveLength(13);
    expect(hand.hands.east.some(isNorth)).toBe(false);
    expect(hand.drawn && isNorth(hand.drawn)).toBe(false);
  });

  it("全席の配牌北と連続する補充北を抜き、牌の総数を108枚に保つ", () => {
    const seats = ["east", "south", "west"] as const;
    const seatsObserved = new Set<string>();
    let consecutiveReplacementObserved = false;

    for (let seed = 1; seed <= 500; seed++) {
      const state = createGame({ seed });
      const hand = state.hand;
      if (!hand) throw new Error("playing game must have a hand");

      for (const seat of seats) {
        expect(hand.hands[seat]).toHaveLength(13);
        expect(hand.hands[seat].some(isNorth)).toBe(false);
        if (hand.kita[seat] > 0) seatsObserved.add(seat);
        if (hand.kita[seat] > 1) consecutiveReplacementObserved = true;
      }

      const concealed = seats.reduce(
        (total, seat) => total + hand.hands[seat].length,
        0,
      );
      const kita = seats.reduce((total, seat) => total + hand.kita[seat], 0);
      const drawn = hand.drawn ? 1 : 0;
      expect(
        concealed +
          kita +
          drawn +
          hand.wall.liveWall.length +
          hand.wall.deadWall.length,
      ).toBe(108);
    }

    expect(seatsObserved).toEqual(new Set(seats));
    expect(consecutiveReplacementObserved).toBe(true);
  });

  it("四兄弟の抜け番ローテーション後も、各局の全着席手牌から配牌北を抜く", () => {
    let state = createGame({ seed: 2024 });
    const benchPlayers = new Set<string>();
    let observedRoundKey = "";

    for (let guard = 0; guard < 5000 && state.phase !== "gameEnd"; guard++) {
      if (state.hand) {
        const roundKey = `${state.round.wind}-${state.round.roundNumber}-${state.round.honba}`;
        if (roundKey !== observedRoundKey) {
          observedRoundKey = roundKey;
          benchPlayers.add(state.hand.seating.benchWarmer);
          for (const seat of ["east", "south", "west"] as const) {
            expect(state.hand.hands[seat].some(isNorth)).toBe(false);
          }
        }
      }

      if (state.phase === "roundEnd") {
        state = proceedToNextRound(state);
      } else if (state.pending?.kind === "humanDiscard") {
        const drawn = state.hand?.drawn;
        if (!drawn) throw new Error("human discard requires a drawn tile");
        state = discard(state, drawn);
      } else if (state.pending?.kind === "humanReact") {
        state = passRon(state);
      }
    }

    expect(state.phase).toBe("gameEnd");
    expect(benchPlayers).toEqual(new Set(["p0", "p1", "p2", "p3"]));
  });
});
