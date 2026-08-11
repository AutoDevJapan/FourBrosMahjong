import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TableInfo from "./TableInfo";
import type { TableInfoData } from "./types";

describe("TableInfo (spec 6.4.2)", () => {
  it("formats the round/hand and shows honba and riichi sticks from props only", () => {
    const info: TableInfoData = {
      roundWind: "east",
      handNumber: 1,
      honba: 2,
      riichiSticks: 1,
      remainingLiveTiles: 37,
      dice: [6, 6],
      doraCount: 3,
    };
    render(<TableInfo info={info} />);

    expect(screen.getByText("東1局")).toBeInTheDocument();
    expect(screen.getByText("本場")).toBeInTheDocument();
    expect(screen.getByText("供託")).toBeInTheDocument();
    expect(screen.getByText("残り山")).toBeInTheDocument();
    expect(screen.getByText("37枚")).toBeInTheDocument();
    // honba value
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(
      screen.getByText("サイコロ", { selector: "dt" }),
    ).toBeInTheDocument();
    expect(screen.getByText("6と6、ドラ3枚")).toBeInTheDocument();
  });

  it("labels a south round correctly", () => {
    const info: TableInfoData = {
      roundWind: "south",
      handNumber: 3,
      honba: 0,
      riichiSticks: 0,
      remainingLiveTiles: 12,
      dice: [2, 5],
      doraCount: 1,
    };
    render(<TableInfo info={info} />);
    expect(screen.getByText("南3局")).toBeInTheDocument();
  });

  it.each([
    { dice: [2, 5] as const, count: 1 },
    { dice: [3, 3] as const, count: 2 },
    { dice: [6, 6] as const, count: 3 },
  ])("サイコロ$diceからドラ$count枚の根拠を表示する", ({ dice, count }) => {
    render(
      <TableInfo
        info={{
          roundWind: "east",
          handNumber: 1,
          honba: 0,
          riichiSticks: 0,
          remainingLiveTiles: 52,
          dice,
          doraCount: count,
        }}
      />,
    );
    expect(
      screen.getByText(`${dice[0]}と${dice[1]}、ドラ${count}枚`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dice-info")).not.toHaveAttribute("aria-label");
  });

  it("generic 要素を aria-label で命名しない(#204)", () => {
    const { container } = render(
      <TableInfo
        info={{
          roundWind: "east",
          handNumber: 1,
          honba: 0,
          riichiSticks: 0,
          remainingLiveTiles: 52,
          dice: [2, 5],
          doraCount: 1,
        }}
      />,
    );
    expect(container.querySelector("div[aria-label]")).toBeNull();
  });
});
