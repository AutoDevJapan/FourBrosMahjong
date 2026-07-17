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

  it("riichi は felt 上でも読めるよう明色地+濃色文字にする(#154)", () => {
    const { container } = render(
      <StatusBadge icon="宣" label="リーチ" variant="riichi" />,
    );
    const badge = container.querySelector("span");
    // 明色地(bg-tile-face)を敷き、その上に 4.5:1 を満たす濃色赤トークンで描く。
    expect(badge).toHaveClass("bg-tile-face");
    expect(badge).toHaveClass("text-tile-badge-red");
  });

  it("highlight は felt 上でも読めるよう明色地+濃色文字にする(#154)", () => {
    const { container } = render(
      <StatusBadge icon="▶" label="手番" variant="highlight" />,
    );
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-tile-face");
    expect(badge).toHaveClass("text-turn-highlight-ink");
  });

  it("variant 未指定は default(felt 上の foreground 系配色)", () => {
    const { container } = render(<StatusBadge icon="◆" label="親" />);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("text-foreground/80");
  });
});
