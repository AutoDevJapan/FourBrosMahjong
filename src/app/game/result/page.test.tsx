import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { GameProvider } from "@/components/game/GameProvider";
import { createGame, type EngineState } from "@/domain/game/engine";
import ResultPage from "./page";

// App Router の useRouter を jsdom 用にスタブ。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** 実エンジンで1半荘を完走させ、確定結果を持つ状態を返す(決定的)。 */
function finishedGame(seed = 2024): EngineState {
  return walkToGameEnd(seed).state;
}

describe("/game/result page (spec 6.2 / 6.6)", () => {
  it("SSR/hydration 待ちは未確定と誤案内せず、読み込み状態を表明する(issue #235)", () => {
    const html = renderToString(
      <GameProvider initialGame={finishedGame()}>
        <ResultPage />
      </GameProvider>,
    );

    expect(html).toContain("対局結果を読み込んでいます…");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("まだ半荘の結果が確定していません");
    expect(html).not.toContain("最終順位");
  });

  it("GameProvider の確定結果(実精算)から順位表とソシー内訳を描画する", () => {
    render(
      <GameProvider initialGame={finishedGame()}>
        <ResultPage />
      </GameProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "対局結果" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "最終順位" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "対局結果を読み込みました。",
    );
    // 順位表とソシー内訳の双方に順位が現れる。
    expect(screen.getAllByText("1位").length).toBeGreaterThan(0);
    // ソシー内訳セクションは自家(あなた)のリージョンを持つ。
    expect(
      screen.getByRole("region", { name: "あなたのソシー内訳" }),
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
    expect(
      screen.getByRole("button", { name: "もう一半荘" }),
    ).toBeInTheDocument();
    const lobbyLinks = screen.getAllByRole("link", { name: "ロビーへ戻る" });
    expect(lobbyLinks.length).toBeGreaterThan(0);
    for (const link of lobbyLinks) {
      expect(link).toHaveAttribute("href", "/");
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
