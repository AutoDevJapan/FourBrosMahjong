import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatusBadge from "./StatusBadge";

describe("StatusBadge (spec5 5.2.1)", () => {
  it("色だけに頼らずアイコン記号+テキストラベルを併記する", () => {
    render(<StatusBadge icon="宣" label="リーチ" variant="riichi" />);
    // ラベルは読み上げ対象として可視テキストで存在する。
    expect(screen.getByText("リーチ")).toBeInTheDocument();
    // アイコンは装飾(aria-hidden)で、読み上げはラベルが担う。
    const icon = screen.getByText("宣");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("variant 別に安定したテスト用アンカー(data-testid)を付与する(#162)", () => {
    render(<StatusBadge icon="宣" label="リーチ" variant="riichi" />);
    expect(screen.getByTestId("status-badge-riichi")).toBeInTheDocument();
  });

  it("variant 省略時は default アンカーになる(#162)", () => {
    render(<StatusBadge icon="◆" label="親" />);
    expect(screen.getByTestId("status-badge-default")).toBeInTheDocument();
  });

  it("riichi は felt 上でも読めるよう明色地+濃色文字にする(#154)", () => {
    render(<StatusBadge icon="宣" label="リーチ" variant="riichi" />);
    const badge = screen.getByTestId("status-badge-riichi");
    // 明色地(bg-tile-face)を敷き、その上に 4.5:1 を満たす濃色赤トークンで描く。
    expect(badge).toHaveClass("bg-tile-face");
    expect(badge).toHaveClass("text-tile-badge-red");
  });

  it("highlight は felt 上でも読めるよう明色地+濃色文字にする(#154)", () => {
    render(<StatusBadge icon="▶" label="手番" variant="highlight" />);
    const badge = screen.getByTestId("status-badge-highlight");
    expect(badge).toHaveClass("bg-tile-face");
    expect(badge).toHaveClass("text-turn-highlight-ink");
  });

  it("default(◆親)も felt 上で読めるよう明色地+濃色文字にする(#157)", () => {
    render(<StatusBadge icon="◆" label="親" />);
    const badge = screen.getByTestId("status-badge-default");
    // 明色地(bg-tile-face)を敷き、その上に 4.5:1 を満たす濃色印字トークンで描く。
    expect(badge).toHaveClass("bg-tile-face");
    expect(badge).toHaveClass("text-tile-ink");
  });
});
