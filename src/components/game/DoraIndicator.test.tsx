import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DoraIndicator from "./DoraIndicator";
import type { DoraData } from "./types";

/**
 * 表ドラ/裏ドラのグループ分けとアクセシブル名の検証(#261 / スペック5 5.2.1)。
 * 表と裏は並び順ではなく、グループ名(`表ドラ表示牌` / `裏ドラ表示牌`)で判別できること。
 */
describe("DoraIndicator", () => {
  const indicators = [
    { suit: "pin", rank: 5, isRed: true },
    { suit: "man", rank: 1 },
  ] as const satisfies DoraData["indicators"];

  it("対局中(裏未開示)は表グループに表示牌、裏グループに枚数分の伏せ牌を描く", () => {
    render(<DoraIndicator dora={{ indicators, uraIndicatorCount: 2 }} />);

    const omote = screen.getByRole("list", { name: "表ドラ表示牌" });
    // role クエリは暗黙ロールでも通るため、Safari/VoiceOver 対策の明示ロールは
    // 属性で回帰検証する(スペック5 5.2.5 / #270)。
    expect(omote).toHaveAttribute("role", "list");
    const omoteTiles = within(omote).getAllByRole("img");
    expect(omoteTiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      "五筒(赤ドラ)",
      "一萬",
    ]);

    const ura = screen.getByRole("list", { name: "裏ドラ表示牌" });
    expect(ura).toHaveAttribute("role", "list");
    const uraTiles = within(ura).getAllByRole("img", { name: "伏せ牌" });
    expect(uraTiles).toHaveLength(2);

    // 未開示のため開示注記は出ない。
    expect(screen.queryByText("裏ドラ開示")).not.toBeInTheDocument();
    // 視覚ラベル「表」「裏」はグループ名(aria-label)と重複するため装飾扱い。
    expect(screen.getByText("表")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("裏")).toHaveAttribute("aria-hidden", "true");
  });

  it("裏ドラ開示時は裏グループに開示牌を牌名付きで描き、開示注記を出す", () => {
    render(
      <DoraIndicator
        dora={{
          indicators,
          uraIndicatorCount: 2,
          uraIndicators: [
            { suit: "sou", rank: 9 },
            { suit: "honor", rank: 1 },
          ],
        }}
      />,
    );

    const ura = screen.getByRole("list", { name: "裏ドラ表示牌" });
    const uraTiles = within(ura).getAllByRole("img");
    expect(uraTiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      "九索",
      "東",
    ]);
    // 開示牌が表グループへ混ざらない(牌単位で表/裏が判別できる)。
    const omote = screen.getByRole("list", { name: "表ドラ表示牌" });
    expect(within(omote).getAllByRole("img")).toHaveLength(2);
    // 開示注記は表示され、aria-describedby で裏グループへ関連付く(SR にも開示状態が伝わる)。
    const note = screen.getByText("裏ドラ開示");
    expect(ura).toHaveAttribute("aria-describedby", note.id);
  });

  it("裏ドラ0枚では裏グループを、表示牌なし(局開始前など)では両グループを描かない", () => {
    const { rerender } = render(
      <DoraIndicator dora={{ indicators, uraIndicatorCount: 0 }} />,
    );
    expect(
      screen.getByRole("list", { name: "表ドラ表示牌" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "裏ドラ表示牌" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("裏")).not.toBeInTheDocument();

    // 局開始前(engine 未開始)は空の <ul> と「表」ラベルだけが残らないよう、グループごと描かない。
    rerender(<DoraIndicator dora={{ indicators: [], uraIndicatorCount: 0 }} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("表")).not.toBeInTheDocument();
  });
});
