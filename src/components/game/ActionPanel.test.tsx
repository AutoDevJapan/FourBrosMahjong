import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ActionPanel, { type ActionItem } from "./ActionPanel";

function action(
  key: string,
  label: string,
  standardOrder?: ActionItem["standardOrder"],
): ActionItem {
  return { key, label, standardOrder, onClick: vi.fn() };
}

function buttonLabels(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

describe("ActionPanel 標準アクション順(#709)", () => {
  it("対象外の位置を保ち、チー→ポン→カン→リーチのDOM・Tab順にする", async () => {
    const user = userEvent.setup();
    render(
      <ActionPanel
        actions={[
          action("riichi", "リーチ", "riichi"),
          action("pass", "スルー"),
          action("kan", "カン", "kan"),
          action("kita", "北抜"),
          action("pon", "ポン", "pon"),
          action("chi", "チー", "chi"),
        ]}
      />,
    );

    const expected = ["チー", "スルー", "ポン", "北抜", "カン", "リーチ"];
    expect(buttonLabels()).toEqual(expected);
    for (const label of expected) {
      await user.tab();
      expect(screen.getByRole("button", { name: label })).toHaveFocus();
    }
  });

  it("一部だけでも相対順を保ち、複数のカンは元の内部順を維持する", () => {
    render(
      <ActionPanel
        actions={[
          action("riichi", "リーチ", "riichi"),
          action("ankan-1", "暗槓 一萬", "kan"),
          action("tsumo", "ツモ"),
          action("kakan-east", "加槓 東", "kan"),
        ]}
      />,
    );

    expect(buttonLabels()).toEqual(["暗槓 一萬", "加槓 東", "ツモ", "リーチ"]);
    expect(screen.queryByRole("button", { name: "チー" })).toBeNull();
  });
});
