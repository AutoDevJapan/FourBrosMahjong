// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActionPanel from "./ActionPanel";
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

function KitaPersistenceProbe() {
  const { controls, view } = useGame();
  const self = view.slots.self;
  if (self.kind !== "seated") throw new Error("human seat is missing");
  return (
    <>
      <button type="button" onClick={controls.kita}>
        北抜
      </button>
      <output data-testid="kita-count">{self.player.kitaCount}</output>
    </>
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

  it("明示北抜きをjournalへ保存し、リロード相当の再描画で同じガリ枚数へ復元する", async () => {
    const user = userEvent.setup();
    const first = render(
      <GameProvider>
        <KitaPersistenceProbe />
      </GameProvider>,
    );

    await user.click(screen.getByRole("button", { name: "北抜" }));
    expect(loadJournal(window.sessionStorage)?.actions).toEqual([
      { type: "kita" },
    ]);
    expect(screen.getByTestId("kita-count")).toHaveTextContent("1");

    first.unmount();
    render(
      <GameProvider>
        <KitaPersistenceProbe />
      </GameProvider>,
    );
    expect(screen.getByTestId("kita-count")).toHaveTextContent("1");
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

  it("commit後の新renderから同じ種類の牌を即時打牌できる", async () => {
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
    const label = labels[duplicateIndex];
    expect(label).not.toBeNull();

    await user.click(options[duplicateIndex]);
    await user.click(screen.getByRole("option", { name: label! }));

    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(2);
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
          <ActionPanel
            actions={[
              { key: "new", label: "二重新規", onClick: controls.newGame },
            ]}
          />
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

  it("旧renderから保持されたcontrolsとwall-clock rollbackに影響されない", () => {
    let staleControls: ReturnType<typeof useGame>["controls"] | null = null;
    let currentControls: ReturnType<typeof useGame>["controls"] | null = null;
    function Probe() {
      const { controls, view } = useGame();
      useEffect(() => {
        currentControls = controls;
      }, [controls]);
      const self = view.slots.self;
      if (self.kind !== "seated" || !self.player.hand?.[0]) return null;
      return <span>{self.player.hand.length}</span>;
    }
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    staleControls = currentControls;
    const firstView = screen.getByText("14");
    expect(firstView).toBeInTheDocument();
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValue(0);
    act(() => currentControls!.tsumogiri());
    const afterFirst = loadJournal(window.sessionStorage)?.actions.length;
    expect(afterFirst).toBeDefined();
    act(() => staleControls!.newGame());
    expect(loadJournal(window.sessionStorage)?.actions).toHaveLength(
      afterFirst!,
    );
    expect(now).not.toHaveBeenCalled();
  });
});
