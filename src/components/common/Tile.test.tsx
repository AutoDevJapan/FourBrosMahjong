import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TileData } from "../game/types";
import Tile from "./Tile";

describe("Tile", () => {
  it("prints the tile face and exposes a suit+number aria-label (spec 5.2.1)", () => {
    const tile: TileData = { suit: "pin", rank: 5 };
    render(<Tile tile={tile} />);
    const el = screen.getByRole("img", { name: "五筒" });
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("五筒");
  });

  it("marks red dora with a shape difference and (赤ドラ) in the label", () => {
    const tile: TileData = { suit: "pin", rank: 5, isRed: true };
    render(<Tile tile={tile} />);
    const el = screen.getByRole("img", { name: "五筒(赤ドラ)" });
    expect(el).toBeInTheDocument();
    // The "赤" badge is a non-color shape cue.
    expect(el).toHaveTextContent("赤");
  });

  it("renders a face-down tile labelled 伏せ牌", () => {
    render(<Tile tile={null} />);
    expect(screen.getByRole("img", { name: "伏せ牌" })).toBeInTheDocument();
  });

  it("is decorative (aria-hidden, no role) when used inside a labelled control", () => {
    const tile: TileData = { suit: "man", rank: 1 };
    const { container } = render(<Tile tile={tile} decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
