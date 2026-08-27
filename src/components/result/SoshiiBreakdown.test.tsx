import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResultPlayerView } from "@/components/game/types";
import SoshiiBreakdown from "./SoshiiBreakdown";

const player: ResultPlayerView = {
  name: "あなた",
  rank: 1,
  rawScore: 45000,
  uma: 10000,
  bonus: 1000,
  soshiiTotal: 56000,
};

describe("SoshiiBreakdown (spec 6.7 / 6.8)", () => {
  it("shows the three soshii line items (rawScore / uma / bonus) and the total", () => {
    render(<SoshiiBreakdown player={player} />);
    expect(
      screen.getByText("素点（最終持ち点−返し40,000）"),
    ).toBeInTheDocument();
    expect(screen.getByText("ウマ・オカ")).toBeInTheDocument();
    expect(screen.getByText("役満祝儀")).toBeInTheDocument();
    expect(screen.getByText("（1位はオカ20,000を含む）")).toBeInTheDocument();
    expect(screen.getByText("ソシー合計")).toBeInTheDocument();

    expect(screen.getByText("+45,000")).toBeInTheDocument();
    expect(screen.getByText("+10,000")).toBeInTheDocument();
    expect(screen.getByText("+56,000")).toBeInTheDocument();
  });

  it("conveys sign with text for screen readers, not color alone (spec 5)", () => {
    render(<SoshiiBreakdown player={{ ...player, uma: -5000 }} />);
    expect(screen.getByText("−5,000")).toBeInTheDocument();
    expect(screen.getByText("マイナス5,000ソシー")).toBeInTheDocument();
  });

  it("renders a negative rawScore with U+2212 and a soshii sr-label (issue #278)", () => {
    render(
      <SoshiiBreakdown
        player={{ ...player, rank: 4, rawScore: -65000, soshiiTotal: -75000 }}
      />,
    );
    // 素点行もウマ・合計と同じ U+2212(−)符号付き表示に統一される。
    const rawScoreDisplay = screen.getByText("−65,000");
    expect(rawScoreDisplay).toBeInTheDocument();
    expect(rawScoreDisplay.textContent?.charCodeAt(0)).toBe(0x2212);
    expect(screen.getByText("マイナス65,000ソシー")).toBeInTheDocument();
    expect(screen.getByText("−75,000")).toBeInTheDocument();
  });

  it("labels the section by the player name for assistive tech", () => {
    render(<SoshiiBreakdown player={player} />);
    expect(
      screen.getByRole("region", { name: "1位 あなたのソシー内訳" }),
    ).toBeInTheDocument();
  });

  it("重複名でも順位を含む一意なlandmark名を持つ", () => {
    const { rerender } = render(<SoshiiBreakdown player={player} />);
    expect(
      screen.getByRole("region", { name: "1位 あなたのソシー内訳" }),
    ).toBeInTheDocument();

    rerender(<SoshiiBreakdown player={{ ...player, rank: 2 }} />);
    expect(
      screen.getByRole("region", { name: "2位 あなたのソシー内訳" }),
    ).toBeInTheDocument();
  });
});
