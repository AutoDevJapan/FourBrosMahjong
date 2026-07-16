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
    };
    render(<TableInfo info={info} />);

    expect(screen.getByText("東1局")).toBeInTheDocument();
    expect(screen.getByText("本場")).toBeInTheDocument();
    expect(screen.getByText("供託")).toBeInTheDocument();
    // honba value
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("labels a south round correctly", () => {
    const info: TableInfoData = {
      roundWind: "south",
      handNumber: 3,
      honba: 0,
      riichiSticks: 0,
    };
    render(<TableInfo info={info} />);
    expect(screen.getByText("南3局")).toBeInTheDocument();
  });
});
