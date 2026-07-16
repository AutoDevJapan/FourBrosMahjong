import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import GameBoard from "./GameBoard";
import { GameProvider } from "./GameProvider";
import type { GameViewState } from "./types";

/**
 * A minimal fixed view state (spec 6.8: fixed dummy data, no domain computation)
 * so the board test is independent of the shipped sample.
 */
const fixture: GameViewState = {
  slots: {
    self: {
      kind: "seated",
      player: {
        name: "あなた",
        points: 30000,
        seatWind: "east",
        status: { isDealer: true, isCurrentTurn: true },
        hand: [
          { suit: "man", rank: 1 },
          { suit: "pin", rank: 5, isRed: true },
        ],
        discards: [{ suit: "sou", rank: 1 }],
      },
    },
    left: {
      kind: "seated",
      player: {
        name: "上家",
        points: 30000,
        seatWind: "south",
        handCount: 13,
        discards: [],
      },
    },
    across: { kind: "bench", player: { name: "対面", points: 30000 } },
    right: {
      kind: "seated",
      player: {
        name: "下家",
        points: 30000,
        seatWind: "west",
        handCount: 13,
        discards: [],
      },
    },
  },
  tableInfo: { roundWind: "east", handNumber: 1, honba: 0, riichiSticks: 1 },
  dora: { indicators: [{ suit: "pin", rank: 4 }], uraIndicatorCount: 1 },
};

function renderBoard() {
  return render(
    <GameProvider initialState={fixture}>
      <GameBoard />
    </GameProvider>,
  );
}

describe("GameBoard (spec 6.6 client island)", () => {
  it("renders the table info, self hand, bench slot and action panel from context", () => {
    renderBoard();
    // Responsive layout renders both md/base trees in jsdom (CSS hides one in a
    // real viewport), so table info appears in each — assert on getAll.
    expect(screen.getAllByText("東1局").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("listbox", { name: "自家の手牌" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("region", { name: "対面(抜け番)" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "リーチ" }).length,
    ).toBeGreaterThan(0);
  });

  it("announces a chosen action via the polite live region (UI-only)", async () => {
    const user = userEvent.setup();
    const { container } = renderBoard();

    await user.click(
      screen.getAllByRole("button", { name: "北抜き(ガリ)" })[0],
    );

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent("北抜きを選択しました");
  });
});
