import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RoundSummary } from "@/domain/game/engine";
import WinDetails from "./WinDetails";

describe("WinDetails", () => {
  it("流局では和了内訳を描画しない", () => {
    const { container } = render(
      <WinDetails
        summary={{
          kind: "draw",
          label: "流局",
          deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("役・ドラ4区分・合計翻・本場供託・支払いを表示する", () => {
    const summary: RoundSummary = {
      kind: "win",
      label: "あなたのツモ 12,000点",
      deltas: { p0: 13000, p1: -7500, p2: -4500, p3: 0 },
      winDetails: {
        winType: "tsumo",
        dealer: false,
        yaku: [
          { name: "立直", han: 1, yakuman: 0 },
          { name: "門前清自摸和", han: 1, yakuman: 0 },
        ],
        yakuHan: 2,
        dora: { omote: 2, ura: 1, aka: 1, gari: 2, total: 6 },
        totalHan: 8,
        yakuman: 0,
        category: "baiman",
        honba: 1,
        riichiSticks: 1,
        payments: [
          { name: "一郎", amount: 7500 },
          { name: "二郎", amount: 4500 },
        ],
        stickPayout: 1000,
      },
    };
    render(<WinDetails summary={summary} />);
    expect(
      screen.getByRole("heading", { name: "和了内訳" }),
    ).toBeInTheDocument();
    expect(screen.getByText("立直")).toBeInTheDocument();
    expect(screen.getByText("表ドラ").nextElementSibling).toHaveTextContent(
      "2翻",
    );
    expect(screen.getByText("裏ドラ").nextElementSibling).toHaveTextContent(
      "1翻",
    );
    expect(screen.getByText("赤5").nextElementSibling).toHaveTextContent("1翻");
    expect(screen.getByText("ガリ").nextElementSibling).toHaveTextContent(
      "2翻",
    );
    expect(screen.getByText("合計").nextElementSibling).toHaveTextContent(
      "8翻",
    );
    expect(screen.getByText("一郎: 7,500点")).toBeInTheDocument();
  });
});
