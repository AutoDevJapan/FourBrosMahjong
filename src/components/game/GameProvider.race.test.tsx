// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameProvider, useGame } from "./GameProvider";
import { loadJournal, replayJournal } from "./gamePersistence";
import { selectView } from "./gameView";
import type { GameViewState } from "./types";

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

function DuplicateTileDoubleActionProbe() {
  const { controls, view } = useGame();
  const self = view.slots.self;
  if (self.kind !== "seated" || !self.player.hand) {
    throw new Error("human hand is missing");
  }
  const tile = self.player.hand.find((candidate, index, hand) =>
    hand.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.suit === candidate.suit &&
        other.rank === candidate.rank,
    ),
  );
  if (!tile) throw new Error("duplicate tile is missing for this seed");
  return (
    <button
      type="button"
      onClick={() => {
        controls.discard(tile);
        controls.discard(tile);
      }}
    >
      重複牌を連続操作
    </button>
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

  it("同種牌が次の手番にも残っていても画面更新前の連続操作を二巡目へ適用しない", () => {
    render(
      <GameProvider>
        <DuplicateTileDoubleActionProbe />
      </GameProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "重複牌を連続操作" }));

    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
  });
});
