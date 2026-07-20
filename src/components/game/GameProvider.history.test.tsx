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
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walkToGameEnd } from "./finishedGameFixture";
import type { GameAction } from "./gamePersistence";
import { GameProvider, useGame } from "./GameProvider";
import {
  getHistorySnapshot,
  getServerHistorySnapshot,
  loadHistory,
  type MatchHistoryEntry,
  subscribeHistory,
} from "./matchHistory";

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

/**
 * 戦績ストアの購読者(`/history` の `MatchHistoryList` と同じ購読方式)。
 *
 * `GameProvider` と**同時にマウント**して、追記が購読者へ届くか(#310 の完了条件
 * 「通知経路が対称」)を検証するために使う。現状の画面構成では同居しないが、
 * 同居した瞬間に「保存したのに一覧が更新されない」無音のバグになるのを防ぐ。
 */
function HistorySubscriberProbe() {
  const entries = useSyncExternalStore<readonly MatchHistoryEntry[] | null>(
    subscribeHistory,
    getHistorySnapshot,
    getServerHistorySnapshot,
  );
  return (
    <output data-testid="subscribed-count">
      {entries === null ? "loading" : entries.length}
    </output>
  );
}

/**
 * 描画フェーズの戦績スナップショットを記録する観測子(#310)。
 *
 * `GameProvider` の**子**として置くことで、親の描画関数(= `useState` の遅延初期化)が
 * 終わった後・効果が走る前の保存状態を観測できる。描画フェーズで追記していると 1 に、
 * マウント効果へ寄せていれば 0 になる。描画中の記録は検証用のこの副作用に限る。
 */
function RenderPhaseWitness({ log }: { log: number[] }) {
  log.push(getHistorySnapshot().length);
  return null;
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

  it("終局操作での追記が同時マウント中の購読者へ届く(通知経路の対称性 / #310)", () => {
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
      <>
        <HistorySubscriberProbe />
        <GameProvider>
          <LastActionProbe action={lastAction} />
        </GameProvider>
      </>,
    );
    expect(screen.getByTestId("subscribed-count")).toHaveTextContent("0");

    fireEvent.click(screen.getByRole("button", { name: "最終操作" }));

    // 通知が無いと購読者は 0 のまま(= 「保存したのに一覧が更新されない」無音のバグ)。
    expect(screen.getByTestId("subscribed-count")).toHaveTextContent("1");
  });

  it("復元時の追記も購読者へ届き、描画フェーズでは戦績を書き換えない(#310)", () => {
    window.sessionStorage.setItem(
      GAME_SESSION_KEY,
      JSON.stringify(fixture.journal),
    );
    const observed: number[] = [];

    render(
      <>
        <HistorySubscriberProbe />
        <GameProvider>
          <output data-testid="probe" />
          <RenderPhaseWitness log={observed} />
        </GameProvider>
      </>,
    );

    // GameProvider の**描画直後**(効果が走る前)の観測値。ここが 1 になるのは
    // `useState` の遅延初期化から追記した場合 = 描画フェーズの副作用(#310 の回帰)。
    // 検証したいのは「描画フェーズの観測値がすべて 0」であって描画回数ではないため、
    // Strict Mode 等で描画が複数回になっても壊れない形で書く。
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((count) => count === 0)).toBe(true);
    // 復元経路の追記はマウント効果で行われ、購読者へも届く。
    expect(screen.getByTestId("subscribed-count")).toHaveTextContent("1");
    expect(loadHistory(window.localStorage)).toHaveLength(1);
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
