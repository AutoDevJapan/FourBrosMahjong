import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameProvider } from "@/components/game/GameProvider";
import { sampleGameState } from "@/components/game/sampleGame";
import ResultPage from "./page";

describe("/game/result page (spec 6.2 / 6.6)", () => {
  it("reads the confirmed result from GameProvider and renders ranking + soshii breakdown", () => {
    render(
      <GameProvider initialState={sampleGameState}>
        <ResultPage />
      </GameProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "対局結果" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "最終順位" }),
    ).toBeInTheDocument();
    // 順位表とソシー内訳の双方に順位が現れる(最終順位が表示されている)。
    expect(screen.getAllByText("1位").length).toBeGreaterThan(0);
    // ソシー内訳セクションは各プレイヤー分のリージョンを持つ。
    expect(
      screen.getByRole("region", { name: "あなたのソシー内訳" }),
    ).toBeInTheDocument();
  });

  it("provides both post-game navigation links (spec 6.3)", () => {
    render(
      <GameProvider initialState={sampleGameState}>
        <ResultPage />
      </GameProvider>,
    );

    // 「もう一半荘」は /game、「ロビーへ戻る」は /(複数箇所にあり得るため getAll)。
    expect(screen.getByRole("link", { name: "もう一半荘" })).toHaveAttribute(
      "href",
      "/game",
    );
    const lobbyLinks = screen.getAllByRole("link", { name: "ロビーへ戻る" });
    expect(lobbyLinks.length).toBeGreaterThan(0);
    for (const link of lobbyLinks) {
      expect(link).toHaveAttribute("href", "/");
    }
  });

  it("falls back gracefully when the result is not yet confirmed (null)", () => {
    render(
      <GameProvider initialState={{ ...sampleGameState, result: null }}>
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
