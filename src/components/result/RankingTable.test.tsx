import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResultPlayerView } from "@/components/game/types";
import RankingTable from "./RankingTable";

/** rank 昇順でない固定ダミー(spec 6.8): 表示側で整列されることを確認する。 */
const players: readonly ResultPlayerView[] = [
  {
    name: "下家",
    rank: 4,
    rawScore: 15000,
    uma: -10000,
    bonus: 0,
    soshiiTotal: 5000,
  },
  {
    name: "あなた",
    rank: 1,
    rawScore: 45000,
    uma: 10000,
    bonus: 1000,
    soshiiTotal: 56000,
  },
  {
    name: "上家",
    rank: 3,
    rawScore: 28000,
    uma: -5000,
    bonus: 0,
    soshiiTotal: 23000,
  },
];

describe("RankingTable (spec 6.7)", () => {
  it("renders each player's rank as text (not color-only) and the soshii total", () => {
    render(<RankingTable players={players} />);
    expect(screen.getByText("1位")).toBeInTheDocument();
    expect(screen.queryByText("優勝")).not.toBeInTheDocument();
    expect(screen.getByText("3位")).toBeInTheDocument();
    expect(screen.getByText("4位")).toBeInTheDocument();
    // 首位のソシー合計(符号付き)。
    expect(screen.getByText("+56,000")).toBeInTheDocument();
  });

  it("result variantだけが優勝badgeと結果画面用classを追加する", () => {
    const { container } = render(
      <RankingTable players={players} variant="result" />,
    );
    expect(screen.getByText("優勝")).toBeInTheDocument();
    expect(container.querySelector(".result-ranking-table")).not.toBeNull();
    expect(container.querySelector(".result-rank-medal")).not.toBeNull();
  });

  it("orders rows by rank ascending regardless of input order", () => {
    render(<RankingTable players={players} />);
    const rows = screen.getAllByRole("row");
    // rows[0] はヘッダ行。データ行は 1 位 → 3 位 → 4 位 の順。
    const first = within(rows[1]);
    expect(first.getByText("1位")).toBeInTheDocument();
    expect(first.getByText("あなた")).toBeInTheDocument();
    expect(within(rows[2]).getByText("3位")).toBeInTheDocument();
    expect(within(rows[3]).getByText("4位")).toBeInTheDocument();
  });

  it("exposes a screen-reader label for a negative total", () => {
    render(<RankingTable players={players} />);
    // 下家 5,000 は正だが、内訳のマイナスは SoshiiBreakdown 側。ここは合計の読み上げを確認。
    expect(screen.getByText("プラス5,000ソシー")).toBeInTheDocument();
  });
});
