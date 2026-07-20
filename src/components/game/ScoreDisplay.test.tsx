import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ScoreDisplay from "./ScoreDisplay";

/**
 * 点差表示は色(text-positive / text-danger)だけで増減を伝えてはならない
 * (スペック5 5.2.1)。符号記号 + sr-only テキストの2要素で成立しているため、
 * 双方を回帰検証する。負号は ASCII ハイフンではなく U+2212(#278)。
 */
describe("ScoreDisplay (スペック5 5.2.1 / #278)", () => {
  it("持ち点を3桁区切り+単位付きで表示する", () => {
    render(<ScoreDisplay points={35000} />);
    expect(screen.getByText("35,000")).toBeInTheDocument();
    expect(screen.getByText("点")).toBeInTheDocument();
  });

  it("delta 未指定では増減を表示しない", () => {
    render(<ScoreDisplay points={35000} />);
    expect(screen.queryByText(/プラス/)).not.toBeInTheDocument();
    expect(screen.queryByText(/マイナス/)).not.toBeInTheDocument();
  });

  it("delta = 0 でも増減を表示しない(増減なしを符号付き0で見せない)", () => {
    render(<ScoreDisplay points={35000} delta={0} />);
    expect(screen.queryByText(/プラス/)).not.toBeInTheDocument();
    expect(screen.queryByText(/マイナス/)).not.toBeInTheDocument();
  });

  it("プラス点差を + 記号と「プラス◯点」の読み上げで伝える", () => {
    render(<ScoreDisplay points={36200} delta={1200} />);
    expect(screen.getByText("+1,200")).toBeInTheDocument();
    expect(screen.getByText("プラス1,200点")).toBeInTheDocument();
  });

  it("マイナス点差を U+2212 と「マイナス◯点」の読み上げで伝える(#278)", () => {
    render(<ScoreDisplay points={33800} delta={-1200} />);
    // ASCII ハイフン(U+002D)ではなく U+2212(−)であることを明示比較する。
    const visual = screen.getByText("−1,200");
    expect(visual.textContent?.charCodeAt(0)).toBe(0x2212);
    expect(visual.textContent).not.toContain("-");
    expect(screen.getByText("マイナス1,200点")).toBeInTheDocument();
  });

  it("記号表記は aria-hidden、読み上げは sr-only が担う(二重読み上げの回避)", () => {
    render(<ScoreDisplay points={36200} delta={1200} />);
    expect(screen.getByText("+1,200")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("プラス1,200点")).toHaveClass("sr-only");
  });
});
