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
    // role クエリは暗黙ロールでも通るため、Safari/VoiceOver 対策の明示ロールは
    // 属性で回帰検証する(スペック5 5.2.5 / #270)。
    expect(list).toHaveAttribute("role", "list");
  });

  it("limit 指定時は直近の枚数だけを表示する", () => {
    const tiles = [1, 2, 3, 4, 5, 6, 7, 8].map(tile);
    render(<Discards tiles={tiles} limit={6} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list.querySelectorAll("li")).toHaveLength(6);
  });

  it("河のグリッドは .river-grid に一本化する(#258 / #387 回帰)", () => {
    // grid-cols-6(1fr)だと全幅スロットで牌が散らばり(#258)、6 列固定だと狭いスロットで
    // ページが横スクロールする(#387)。両方の不変条件は `.river-grid`(globals.css)が
    // 牌1枚幅の固定トラック × auto-fill × 6 列上限として持つ。
    // トラック定義そのものの回帰は globals.river-grid.test.ts が固定する。
    render(<Discards tiles={[tile(1)]} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list).toHaveClass("river-grid");
  });
});
