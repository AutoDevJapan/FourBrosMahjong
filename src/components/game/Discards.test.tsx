import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Discards from "./Discards";
import type { TileData } from "./types";

const tile = (rank: number): TileData => ({ suit: "man", rank });

describe("Discards", () => {
  it("捨て牌を捨て順どおりにすべて表示する", () => {
    render(<Discards tiles={[tile(1), tile(2), tile(3)]} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list.querySelectorAll("li")).toHaveLength(3);
  });

  it("limit 指定時は直近の枚数だけを表示する", () => {
    const tiles = [1, 2, 3, 4, 5, 6, 7, 8].map(tile);
    render(<Discards tiles={tiles} limit={6} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list.querySelectorAll("li")).toHaveLength(6);
  });

  it("河の列幅は内容基準で、スロット幅に引き伸ばされない(#258 回帰)", () => {
    // grid-cols-6(1fr)だと全幅スロットで牌が散らばるため、
    // w-fit + max-content 列で牌幅+gap のみの密な段組みを保証する。
    render(<Discards tiles={[tile(1)]} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list).toHaveClass("w-fit", "grid-cols-[repeat(6,max-content)]");
    expect(list).not.toHaveClass("grid-cols-6");
  });
});
