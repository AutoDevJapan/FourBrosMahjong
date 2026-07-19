// @vitest-environment jsdom

/**
 * 半荘終了時の戦績保存(issue #293)の `GameProvider` 統合テスト。
 *
 * 実エンジンをフィクスチャで終局まで進め、
 * - 終局操作の瞬間に `localStorage` へ確定結果が追記されること
 * - 終局済みジャーナルのリロード復元では二重保存されないこと
 * - `localStorage` が使えない環境でも対局が継続すること
 * を検証する。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walkToGameEnd } from "./finishedGameFixture";
import type { GameAction } from "./gamePersistence";
import { GameProvider, useGame } from "./GameProvider";
import { loadHistory } from "./matchHistory";

const GAME_SESSION_KEY = "four-bros-mahjong.game.v1";

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

function blockLocalStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("Storage is disabled", "SecurityError");
    },
  });
}

/** ジャーナル末尾の操作1つを UI 経由(controls)で実行するプローブ。 */
function LastActionProbe({ action }: { action: GameAction }) {
  const { controls, phase } = useGame();
  const run = () => {
    switch (action.type) {
      case "discard":
        return controls.discard(action.tile);
      case "riichi":
        return controls.riichi(action.tile);
      case "ankan":
        return controls.ankan(action.tile);
      case "kakan":
        return controls.kakan(action.tile);
      case "tsumogiri":
        return controls.tsumogiri();
      case "tsumo":
        return controls.tsumo();
      case "ron":
        return controls.ron();
      case "pon":
        return controls.pon();
      case "kan":
        return controls.kan();
      case "passRon":
        return controls.passRon();
      case "nextRound":
        return controls.nextRound();
    }
  };
  return (
    <>
      <button type="button" onClick={run}>
        最終操作
      </button>
      <output data-testid="phase">{phase}</output>
    </>
  );
}

const fixture = walkToGameEnd(1);
if (fixture.state.result === null) throw new Error("終局結果がない");
const expectedPlayers = fixture.state.result.map((r) => ({
  name: r.name,
  rank: r.rank,
  rawScore: r.rawScore,
  uma: r.uma,
  bonus: r.bonus,
  soshiiTotal: r.soshiiTotal,
}));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(
      window,
      "localStorage",
      originalLocalStorageDescriptor,
    );
  }
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("GameProvider match history recording (#293)", () => {
  it("終局する最終操作の瞬間に確定結果を戦績へ保存する", () => {
    const lastAction = fixture.journal.actions.at(-1);
    if (!lastAction) throw new Error("ジャーナルが空");
    window.sessionStorage.setItem(
      GAME_SESSION_KEY,
      JSON.stringify({
        ...fixture.journal,
        actions: fixture.journal.actions.slice(0, -1),
      }),
    );

    render(
      <GameProvider>
        <LastActionProbe action={lastAction} />
      </GameProvider>,
    );
    expect(loadHistory(window.localStorage)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "最終操作" }));

    expect(screen.getByTestId("phase")).toHaveTextContent("gameEnd");
    const entries = loadHistory(window.localStorage);
    expect(entries).toHaveLength(1);
    expect(entries[0].seed).toBe(fixture.journal.seed);
    expect(entries[0].players).toEqual(expectedPlayers);
    expect(Number.isSafeInteger(entries[0].finishedAt)).toBe(true);
  });

  it("終局済みジャーナルの復元で保存漏れを補完し、再復元でも二重保存しない", () => {
    window.sessionStorage.setItem(
      GAME_SESSION_KEY,
      JSON.stringify(fixture.journal),
    );

    const first = render(
      <GameProvider>
        <output data-testid="probe" />
      </GameProvider>,
    );
    expect(loadHistory(window.localStorage)).toHaveLength(1);

    // リロード相当(同一ジャーナルからの再マウント)でも同一半荘は追記されない。
    first.unmount();
    render(
      <GameProvider>
        <output data-testid="probe" />
      </GameProvider>,
    );

    const entries = loadHistory(window.localStorage);
    expect(entries).toHaveLength(1);
    expect(entries[0].players).toEqual(expectedPlayers);
  });

  it("localStorageが使えない環境でも終局ジャーナルの復元と対局継続に影響しない", () => {
    blockLocalStorage();
    window.sessionStorage.setItem(
      GAME_SESSION_KEY,
      JSON.stringify(fixture.journal),
    );

    expect(() =>
      render(
        <GameProvider>
          <output data-testid="probe" />
        </GameProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("probe")).toBeInTheDocument();
  });
});
