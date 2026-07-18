// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameViewState } from "./types";
import { selectView } from "./gameView";
import { loadJournal, replayJournal } from "./gamePersistence";
import { GameProvider, useGame } from "./GameProvider";

function DoubleActionProbe() {
  const { controls, view } = useGame();
  const self = view.slots.self;
  if (self.kind !== "seated" || !self.player.hand?.[0]) {
    throw new Error("human discard tile is missing");
  }
  const tile = self.player.hand[0];
  return (
    <>
      <button
        type="button"
        onClick={() => {
          controls.discard(tile);
          controls.discard(tile);
        }}
      >
        連続操作
      </button>
      <output data-testid="live-view">{JSON.stringify(view)}</output>
    </>
  );
}

describe("GameProvider concurrent controls (#230)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/game?seed=1");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("同一レンダー中の連続操作を直列化し、ライブ状態とjournal再生を一致させる", () => {
    render(
      <GameProvider>
        <DoubleActionProbe />
      </GameProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "連続操作" }));

    const journal = loadJournal(window.sessionStorage);
    const liveView = JSON.parse(
      screen.getByTestId("live-view").textContent ?? "null",
    ) as GameViewState;
    expect(journal).not.toBeNull();
    // 1回目の打牌後、同じ牌をもう一度指定する操作は engine が拒否するため
    // 再生不能な no-op を journal へ記録しない。
    expect(journal?.actions).toHaveLength(1);
    expect(liveView).toEqual(selectView(replayJournal(journal!)));
  });
});
