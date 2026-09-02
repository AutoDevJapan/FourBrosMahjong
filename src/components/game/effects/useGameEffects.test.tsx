import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import type { GameViewState } from "../types";
import { useGameEffects } from "./useGameEffects";

const tile = { suit: "pin", rank: 5, isRed: false } as const;

function view(
  roundNumber = 1,
  discards: readonly (typeof tile)[] = [],
): GameViewState {
  const player = {
    playerId: "p0" as const,
    name: "粗悪品",
    points: 35_000,
    seatWind: "east" as const,
    status: { hasDeclaredRiichi: false },
    kitaCount: 0,
    discards,
  };
  const opponent = (playerId: "p1" | "p2", name: string) => ({
    kind: "seated" as const,
    player: {
      playerId,
      name,
      points: 35_000,
      seatWind: playerId === "p1" ? ("south" as const) : ("west" as const),
      status: { hasDeclaredRiichi: false },
      handCount: 13,
      kitaCount: 0,
      discards: [],
    },
  });
  return {
    slots: {
      self: { kind: "seated", player },
      left: opponent("p1", "一郎"),
      across: opponent("p2", "竜二"),
      right: {
        kind: "bench",
        player: { playerId: "p3", name: "糸瓜", points: 35_000 },
      },
    },
    tableInfo: {
      roundWind: "east",
      handNumber: roundNumber,
      honba: 0,
      riichiSticks: 0,
      remainingLiveTiles: 50,
      dice: [1, 2],
      doraCount: 1,
    },
    dora: { indicators: [tile], uraIndicatorCount: 1 },
    result: null,
  };
}

function EffectHarness({ gameView }: { gameView: GameViewState }) {
  const effect = useGameEffects(gameView, "playing", null);
  return (
    <output
      data-effect-id={effect?.eventId}
      data-effect-key={effect?.eventKey}
      data-testid="effect"
    >
      {effect?.kind ?? "none"}
    </output>
  );
}

describe("useGameEffects", () => {
  it("StrictModeの同一状態再描画では一度だけ発火し、局替わりでcueを隠す", () => {
    const { rerender } = render(
      <StrictMode>
        <EffectHarness gameView={view()} />
      </StrictMode>,
    );

    expect(screen.getByTestId("effect")).toHaveTextContent("none");

    rerender(
      <StrictMode>
        <EffectHarness gameView={view(1, [tile])} />
      </StrictMode>,
    );
    const effect = screen.getByTestId("effect");
    const eventId = effect.getAttribute("data-effect-id");
    const eventKey = effect.getAttribute("data-effect-key");
    expect(effect).toHaveTextContent("discard");

    rerender(
      <StrictMode>
        <EffectHarness gameView={view(1, [tile])} />
      </StrictMode>,
    );
    expect(screen.getByTestId("effect")).toHaveAttribute(
      "data-effect-id",
      eventId,
    );
    expect(screen.getByTestId("effect")).toHaveAttribute(
      "data-effect-key",
      eventKey,
    );

    rerender(
      <StrictMode>
        <EffectHarness gameView={view(2)} />
      </StrictMode>,
    );
    expect(screen.getByTestId("effect")).toHaveTextContent("none");
    expect(screen.getByTestId("effect")).not.toHaveAttribute("data-effect-id");
  });
});
