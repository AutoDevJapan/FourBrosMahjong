// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameProvider, useGame } from "./GameProvider";
import { loadJournal, replayJournal } from "./gamePersistence";
import { selectView } from "./gameView";
import Hand from "./Hand";
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
    vi.restoreAllMocks();
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
    // 1回目のaccepted transitionからcommitまで、Providerが追加操作を拒否する。
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

  it("実Handへの別clickイベントから届くdouble clickでも次巡へ進めない", async () => {
    const user = userEvent.setup();
    function HandProbe() {
      const { controls, view } = useGame();
      const self = view.slots.self;
      if (self.kind !== "seated" || !self.player.hand) return null;
      return (
        <Hand
          tiles={self.player.hand}
          onSelect={(_index, tile) => controls.discard(tile)}
        />
      );
    }
    render(
      <GameProvider>
        <HandProbe />
      </GameProvider>,
    );
    const options = screen.getAllByRole("option");
    const labels = options.map((option) => option.getAttribute("aria-label"));
    const duplicateIndex = labels.findIndex(
      (label, index) => labels.indexOf(label) !== index,
    );
    expect(duplicateIndex).toBeGreaterThanOrEqual(0);

    await user.dblClick(options[duplicateIndex]);

    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
  });

  it("commit後は異なる正規操作を直ちに受け付ける", async () => {
    const user = userEvent.setup();
    function Probe() {
      const { controls, pending, view } = useGame();
      const self = view.slots.self;
      if (self.kind !== "seated" || !self.player.hand?.[0]) return null;
      return (
        <button
          type="button"
          onClick={() => {
            if (pending?.kind === "humanReact") controls.passRon();
            else controls.discard(self.player.hand![0]);
          }}
        >
          正規操作
        </button>
      );
    }
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    await user.click(screen.getByRole("button", { name: "正規操作" }));
    await user.click(screen.getByRole("button", { name: "正規操作" }));
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(2);
  });

  it("no-opはgateせず同じ描画中のvalid操作を受け付ける", () => {
    function Probe() {
      const { controls, view } = useGame();
      const self = view.slots.self;
      if (self.kind !== "seated" || !self.player.hand?.[0]) return null;
      const tile = self.player.hand[0];
      return (
        <button
          type="button"
          onClick={() => {
            controls.ron();
            controls.discard(tile);
          }}
        >
          no-op後
        </button>
      );
    }
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "no-op後" }));
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
  });

  it("newGameの別click二重実行とaccepted action直後のstale newGameを共通gateで拒否する", async () => {
    const user = userEvent.setup();
    const random = vi.spyOn(globalThis.crypto, "getRandomValues");
    function Probe() {
      const { controls, view } = useGame();
      const self = view.slots.self;
      if (self.kind !== "seated" || !self.player.hand?.[0]) return null;
      const tile = self.player.hand[0];
      return (
        <>
          <button type="button" onClick={() => controls.newGame()}>
            二重新規
          </button>
          <button
            type="button"
            onClick={() => {
              controls.discard(tile);
              controls.newGame();
            }}
          >
            混在
          </button>
        </>
      );
    }
    const first = render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    await user.dblClick(screen.getByRole("button", { name: "二重新規" }));
    expect(random).toHaveBeenCalledTimes(1);
    first.unmount();
    window.sessionStorage.clear();
    random.mockClear();
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "混在" }));
    expect(random).not.toHaveBeenCalled();
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(1);
  });
});
