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

  it("手牌がactiveIndexより短く縮小しても、ちょうど1牌がタブ順に残り打牌できる(#199)", async () => {
    const fourteen: TileData[] = Array.from({ length: 14 }, (_, i) => ({
      suit: "pin",
      rank: (i % 9) + 1,
    }));
    const eleven = fourteen.slice(0, 11);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Hand tiles={fourteen} onSelect={onSelect} />);

    // End キーで末尾(index 13)へ移動してから、ポン/カン相当で 11 枚へ縮小する。
    screen.getAllByRole("option")[0].focus();
    await user.keyboard("{End}");
    rerender(<Hand tiles={eleven} onSelect={onSelect} />);

    // ロービングタブインデックスの不変条件: 常にちょうど1牌が tabIndex=0。
    const options = screen.getAllByRole("option");
    const tabbable = options.filter(
      (option) => option.getAttribute("tabindex") === "0",
    );
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(options[options.length - 1]);

    // Tab で手牌へ到達 → Enter で打牌、まで完結できること(スペック5 5.2.2)。
    await user.tab();
    expect(options[10]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(10, eleven[10]);
  });

  it("手牌が増えてもactiveIndexは維持される(ツモ後の位置保持)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Hand tiles={tiles} />);

    screen.getAllByRole("option")[0].focus();
    await user.keyboard("{ArrowRight}");
    rerender(<Hand tiles={[...tiles, { suit: "man", rank: 9 }]} />);

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("tabindex", "0");
    expect(
      options.filter((option) => option.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
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
