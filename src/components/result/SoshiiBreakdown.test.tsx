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
    expect(screen.getByText("素点")).toBeInTheDocument();
    expect(screen.getByText("ウマ")).toBeInTheDocument();
    expect(screen.getByText("祝儀")).toBeInTheDocument();
    expect(screen.getByText("ソシー合計")).toBeInTheDocument();

    expect(screen.getByText("45,000")).toBeInTheDocument();
    expect(screen.getByText("+10,000")).toBeInTheDocument();
    expect(screen.getByText("+56,000")).toBeInTheDocument();
  });

  it("conveys sign with text for screen readers, not color alone (spec 5)", () => {
    render(<SoshiiBreakdown player={{ ...player, uma: -5000 }} />);
    expect(screen.getByText("−5,000")).toBeInTheDocument();
    expect(screen.getByText("マイナス5,000ソシー")).toBeInTheDocument();
  });

  it("labels the section by the player name for assistive tech", () => {
    render(<SoshiiBreakdown player={player} />);
    expect(
      screen.getByRole("region", { name: "あなたのソシー内訳" }),
    ).toBeInTheDocument();
  });
});
