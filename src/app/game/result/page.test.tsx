import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import {
  GameContext,
  type GameContextValue,
  GameProvider,
} from "@/components/game/GameProvider";
import { selectView } from "@/components/game/gameView";
import { createGame, type EngineState } from "@/domain/game/engine";
import ResultPage from "./page";
import ResultPageClient from "./ResultPageClient";

const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));

// App Router の useRouter を jsdom 用にスタブ。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
}));

/** 実エンジンで1半荘を完走させ、確定結果を持つ状態を返す(決定的)。 */
function finishedGame(seed = 2024): EngineState {
  return walkToGameEnd(seed).state;
}

function resultContext(
  historySaveStatus: GameContextValue["historySaveStatus"],
  overrides: Partial<GameContextValue> = {},
): GameContextValue {
  const state = finishedGame();
  const noop = vi.fn();
  return {
    playerId: "p0",
    isHost: true,
    view: selectView(state),
    phase: state.phase,
    pending: state.pending,
    roundSummary: state.lastRound,
    sessionSaveStatus: "idle",
    historySaveStatus,
    seedGenerationError: false,
    controls: {
      discard: noop,
      tsumogiri: noop,
      riichi: noop,
      tsumo: noop,
      ron: noop,
      pon: noop,
      kan: noop,
      kita: noop,
      ankan: noop,
      kakan: noop,
      passRon: noop,
      nextRound: noop,
      newGame: noop,
    },
    ...overrides,
  };
}

describe("/game/result page (spec 6.2 / 6.6)", () => {
  beforeEach(() => routerReplace.mockClear());

  it("SSR/hydration 待ちは未確定と誤案内せず、読み込み状態を表明する(issue #235)", () => {
    const html = renderToString(
      <GameProvider initialGame={finishedGame()}>
        <ResultPage />
      </GameProvider>,
    );

    expect(html).toContain("対局結果を読み込んでいます…");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("まだ半荘の結果が確定していません");
    expect(html).not.toContain('id="ranking-heading"');
  });

  it("GameProvider の確定結果(実精算)から順位表とソシー内訳を描画する", () => {
    render(
      <GameProvider initialGame={finishedGame()}>
        <ResultPage />
      </GameProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "半荘終了" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "最終順位" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "対局結果を読み込みました。",
    );
    // 順位表とソシー内訳の双方に順位が現れる。
    expect(screen.getAllByText("1位").length).toBeGreaterThan(0);
    // ソシー内訳セクションは自家(粗悪品)のリージョンを持つ。
    expect(
      screen.getByRole("region", { name: /粗悪品のソシー内訳$/ }),
    ).toBeInTheDocument();
  });

  it("ソシー内訳カードを順位(rank)昇順で並べ、最終順位テーブルと視線移動を一致させる(issue #150)", () => {
    render(
      <GameProvider initialGame={finishedGame()}>
        <ResultPage />
      </GameProvider>,
    );

    // ソシー内訳カード(各プレイヤーのリージョン)を DOM 順で取得し、見出しの「N位」を読む。
    const cards = screen.getAllByRole("region", { name: /のソシー内訳$/ });
    expect(cards.length).toBe(4);
    const ranks = cards.map((card) => {
      const rankText = within(card).getByText(/^\d+位$/).textContent ?? "";
      return Number.parseInt(rankText, 10);
    });
    // 昇順(1位→最下位)で並ぶこと。
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBe(1);
  });

  it("対局後の導線を提供する(spec 6.3): もう一半荘 / ロビーへ戻る", () => {
    render(
      <GameProvider initialGame={finishedGame()}>
        <ResultPage />
      </GameProvider>,
    );

    // 「もう一半荘」は新規半荘を生成するボタン。
    const actions = screen.getByRole("navigation", { name: "対局後の導線" });
    expect(
      within(actions).getByRole("button", { name: "もう一半荘" }),
    ).toHaveAttribute("type", "button");
    expect(
      within(actions).getByRole("link", { name: "戦績を見る" }),
    ).toHaveAttribute("href", "/history");
    expect(
      within(actions).getByRole("link", { name: "ロビーへ戻る" }),
    ).toHaveAttribute("href", "/");
  });

  it.each([
    ["pending", "戦績を保存しています…"],
    ["saved", "戦績を保存しました。"],
    ["failed", "この端末に今回の戦績を保存できませんでした。"],
  ] as const)(
    "戦績の保存状態 %s を可視かつstatusとして表示する",
    (status, message) => {
      render(
        <GameContext.Provider value={resultContext(status)}>
          <ResultPageClient fontVariableClassName="test-font" />
        </GameContext.Provider>,
      );

      const notice = screen.getByText(message).closest('[role="status"]');
      expect(notice).toHaveAttribute("data-save-status", status);
    },
  );

  it("もう一半荘は新規対局を作って履歴をreplaceする(#353)", () => {
    const newGame = vi.fn();
    const context = resultContext("saved");
    render(
      <GameContext.Provider
        value={{
          ...context,
          controls: { ...context.controls, newGame },
        }}
      >
        <ResultPageClient fontVariableClassName="test-font" />
      </GameContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "もう一半荘" }));
    expect(newGame).toHaveBeenCalledOnce();
    expect(routerReplace).toHaveBeenCalledWith("/game");
  });

  it("長い重複名でも4人の順位・ID対応を保持する", () => {
    const context = resultContext("saved");
    const duplicateName = "同名の長いプレイヤー名";
    const players = context.view.result?.players.map((player) => ({
      ...player,
      name: duplicateName,
    }));
    if (players === undefined) throw new Error("確定結果がない");

    render(
      <GameContext.Provider
        value={{
          ...context,
          view: { ...context.view, result: { players } },
        }}
      >
        <ResultPageClient fontVariableClassName="test-font" />
      </GameContext.Provider>,
    );

    expect(screen.getAllByText(duplicateName)).toHaveLength(8);
    expect(document.querySelectorAll("[data-character-id]")).not.toHaveLength(
      0,
    );
    expect(document.querySelectorAll("tr[data-rank]")).toHaveLength(4);
  });

  /**
   * spec 5.2.6: 本文は単一の `<main>` に収める。`ResultPageClient` は読み込み中 / 未確定 /
   * 確定の 3 分岐を持ち、分岐ごとに `<main>` を書くと**どれか 1 つへの付け忘れが無音で残る**
   * (静的 a11y 監査が踏むのは未確定分岐だけ)。3 分岐すべてをここで数秒で固定する
   * — E2E 側は `e2e/a11y.spec.ts`(未確定)と `e2e/game.spec.ts`(確定・半荘完走)が担う。
   */
  it("読み込み中・未確定・確定のどの分岐でも <main> はちょうど 1 つ(spec 5.2.6 / #409)", () => {
    const loadingHtml = renderToString(
      <GameProvider initialGame={finishedGame()}>
        <ResultPage />
      </GameProvider>,
    );
    // SSR 出力(= 読み込み中分岐)。開始タグの数で数える。
    expect(loadingHtml).toContain("対局結果を読み込んでいます…");
    expect(loadingHtml.match(/<main[\s>]/g) ?? []).toHaveLength(1);
    expect(loadingHtml).not.toContain('role="main"');
    // ページヘッダーは `<main>` の内側(spec 5.2.6 / #431)。SSR 出力は文字列だが、
    // このファイルは jsdom プロジェクトで走るので切り離した要素へ流し込めば DOM 照会できる。
    // 開始タグの出現順で見る方式は「`</main>` より後の `<h1>`」を通してしまう。
    const loadingDom = document.createElement("div");
    loadingDom.innerHTML = loadingHtml;
    expect(
      loadingDom.querySelectorAll("h1"),
      "読み込み中分岐の <h1> がちょうど 1 つでない",
    ).toHaveLength(1);
    expect(
      loadingDom.querySelectorAll("main h1"),
      "読み込み中分岐の <h1> が <main> の内側にちょうど 1 つ無い",
    ).toHaveLength(1);

    // 分岐を**一意に**指す文言。`最終順位` は未確定分岐の案内文にも出る
    //(「…ここに最終順位とソシー内訳が表示されます」)ので目印に使えない。
    const CONFIRMED_ONLY = "もう一半荘";
    const PENDING_ONLY = "まだ半荘の結果が確定していません";

    for (const [branch, game, own, other] of [
      ["確定", finishedGame(), CONFIRMED_ONLY, PENDING_ONLY],
      ["未確定", createGame({ seed: 1 }), PENDING_ONLY, CONFIRMED_ONLY],
    ] as const) {
      const { container, unmount } = render(
        <GameProvider initialGame={game}>
          <ResultPage />
        </GameProvider>,
      );
      // 狙った分岐が実際に描かれたことを先に確かめる。これが無いと、例えば `finishedGame()`
      // が確定結果を作らなくなったとき、未確定分岐を 2 回数えているのに失敗メッセージだけ
      // 「確定分岐の…」と名乗る(<main> の数え方は通るので無音になる)。
      // 「他方が出ていない」まで見て、目印が両分岐に共通の文言へ育つ事故も防ぐ。
      const text = container.textContent ?? "";
      expect(text, `${branch}分岐が描画されていない`).toContain(own);
      expect(
        text,
        `${branch}分岐のはずが別の分岐が描画されている`,
      ).not.toContain(other);
      expect(
        container.querySelectorAll("main"),
        `${branch}分岐の <main> がちょうど 1 つでない`,
      ).toHaveLength(1);
      // ページヘッダーは `<main>` の内側(spec 5.2.6 / #431)。`<header>` は現状 3 分岐の
      // 外側に 1 つだけ置いてあるが、分岐ごとに書き直された場合に付け忘れを無音にしない。
      // 総数も見る。`main h1` だけだと `<main>` の外に 2 つ目の `<h1>` を足す形が通る
      // (ルート単位のゲートは未確定分岐しか描かないので、確定分岐はここでしか見ない)。
      expect(
        container.querySelectorAll("h1"),
        `${branch}分岐の <h1> がちょうど 1 つでない`,
      ).toHaveLength(1);
      expect(
        container.querySelectorAll("main h1"),
        `${branch}分岐の <h1> が <main> の内側にちょうど 1 つ無い`,
      ).toHaveLength(1);
      // 別要素の `role="main"` を足す形も禁止する。`<main>` の数は 1 のままなので上の
      // 数え方では通ってしまうが、main ランドマークとしては重複する(`role` で
      // **置き換え**た場合は上が 0 件になって落ちる)。
      expect(container.querySelectorAll('[role="main"]')).toHaveLength(0);
      unmount();
    }
  });

  it("結果未確定(対局中に直接アクセス)ではフォールバックを表示する", () => {
    render(
      <GameProvider initialGame={createGame({ seed: 1 })}>
        <ResultPage />
      </GameProvider>,
    );

    expect(
      screen.getByText(/まだ半荘の結果が確定していません/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "対局画面へ" })).toHaveAttribute(
      "href",
      "/game",
    );
    // 未確定時は順位表を出さない。
    expect(screen.queryByText("1位")).not.toBeInTheDocument();
  });
});
