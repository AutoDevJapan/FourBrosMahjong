import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Hand from "./Hand";
import type { TileData } from "./types";

const tiles: TileData[] = [
  { suit: "man", rank: 1 },
  { suit: "pin", rank: 5, isRed: true },
  { suit: "sou", rank: 9 },
];

describe("Hand (roving tabindex listbox, spec 5.2.2)", () => {
  it("renders a listbox whose options carry per-tile aria-labels", () => {
    render(<Hand tiles={tiles} />);
    expect(
      screen.getByRole("listbox", { name: "自家の手牌" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "五筒(赤ドラ)" }),
    ).toBeInTheDocument();
  });

  it("keeps exactly one option in the tab order (roving tabindex)", () => {
    render(<Hand tiles={tiles} />);
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("tabindex", "0");
    expect(options[1]).toHaveAttribute("tabindex", "-1");
    expect(options[2]).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus with the arrow keys and wraps around", async () => {
    const user = userEvent.setup();
    render(<Hand tiles={tiles} />);
    const options = screen.getAllByRole("option");

    options[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute("tabindex", "0");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(options[2]).toHaveFocus();
  });

  it("selects a tile with Enter and reports it (UI event only, no domain logic)", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Hand tiles={tiles} onSelect={onSelect} />);
    const options = screen.getAllByRole("option");

    options[0].focus();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith(0, tiles[0]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("操作不可牌はマウス・キーボードで選択せず、理由を通知する", async () => {
    const onSelect = vi.fn();
    const onBlockedSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Hand
        tiles={tiles}
        onSelect={onSelect}
        onBlockedSelect={onBlockedSelect}
        tileStates={[
          {
            disabled: true,
            reason: "喰い替え禁止のため、この牌は打牌できません。",
            indicator: "禁止",
          },
        ]}
      />,
    );
    const forbidden = screen.getByRole("option", {
      name: /一萬、喰い替え禁止/,
    });
    expect(forbidden).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("禁止")).toBeInTheDocument();

    await user.click(forbidden);
    forbidden.focus();
    await user.keyboard("{Enter}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(onBlockedSelect).toHaveBeenCalledTimes(2);
    expect(onBlockedSelect).toHaveBeenLastCalledWith(
      "喰い替え禁止のため、この牌は打牌できません。",
    );
  });

  it("リーチ宣言可能牌をDOM名・見た目の両方で強調する", () => {
    render(
      <Hand
        tiles={tiles}
        tileStates={[{ indicator: "リーチ可", highlighted: true }]}
      />,
    );
    const eligible = screen.getByRole("option", { name: "一萬、リーチ可" });
    expect(eligible).not.toHaveAttribute("aria-disabled");
    expect(eligible).toHaveClass("ring-2");
    expect(screen.getByText("リーチ可")).toBeInTheDocument();
  });

  it("閲覧専用では静的listとして表示し、選択・フォーカス操作を公開しない", () => {
    render(<Hand tiles={tiles} readOnly />);

    const list = screen.getByRole("list", { name: "自家の手牌" });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(tiles.length);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).not.toHaveAttribute("tabindex");
      expect(item).not.toHaveAttribute("aria-selected");
    }
  });
});
