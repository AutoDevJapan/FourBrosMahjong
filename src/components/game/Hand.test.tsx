import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
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

  it("タッチ操作では選択と打牌確定を分け、確定前に取り消せる", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Hand tiles={tiles} onSelect={onSelect} confirmTouchSelection />);
    const first = () => screen.getAllByRole("option")[0];

    fireEvent.touchStart(first());
    fireEvent.touchEnd(first());
    fireEvent.click(first());

    expect(onSelect).not.toHaveBeenCalled();
    expect(first()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "一萬を選択中です。打牌を確定するにはボタンを押してください。",
    );
    const confirm = screen.getByRole("button", {
      name: "一萬で打牌を確定",
    });
    expect(confirm).toBeInTheDocument();
    expect(confirm).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "選択を解除" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(first()).toHaveAttribute("aria-selected", "false");
    expect(first()).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "一萬で打牌を確定" }),
    ).not.toBeInTheDocument();

    fireEvent.touchStart(first());
    fireEvent.touchEnd(first());
    fireEvent.click(first());
    await user.click(screen.getByRole("button", { name: "一萬で打牌を確定" }));
    expect(onSelect).toHaveBeenCalledWith(0, tiles[0]);
  });

  it("リーチ宣言中のタッチ確認は打牌と混同しない文言を表示する", async () => {
    const user = userEvent.setup();
    render(
      <Hand
        tiles={tiles}
        confirmTouchSelection
        confirmTouchSelectionMode="riichi"
      />,
    );
    const first = screen.getAllByRole("option")[0];

    fireEvent.touchStart(first);
    fireEvent.touchEnd(first);
    fireEvent.click(first);

    expect(screen.getByRole("status")).toHaveTextContent(
      "一萬を選択中です。リーチ宣言を確定するにはボタンを押してください。",
    );
    expect(
      screen.getByRole("button", { name: "一萬でリーチ宣言を確定" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "選択を解除" }));
  });

  it("タッチ確定モードでもキーボードEnterは従来どおり即時に打牌する", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Hand tiles={tiles} onSelect={onSelect} confirmTouchSelection />);
    const first = screen.getAllByRole("option")[0];
    first.focus();

    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith(0, tiles[0]);
    expect(
      screen.queryByRole("button", { name: "一萬で打牌を確定" }),
    ).not.toBeInTheDocument();
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

    // 更新前に手牌内にあった実フォーカスも、クランプ後の末尾牌へ維持する(#248)。
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

  it("ツモ/補充で追加された牌だけを一度だけ入場表示する", () => {
    const beforeDraw = [tiles[0], tiles[2]];
    const afterDraw = [tiles[0], tiles[1], tiles[2]];
    const { rerender } = render(<Hand tiles={beforeDraw} />);

    rerender(<Hand tiles={afterDraw} />);

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("data-hand-animation", "draw");
    expect(options[0]).not.toHaveAttribute("data-hand-animation");
    expect(options[2]).not.toHaveAttribute("data-hand-animation");
    expect(options[1]).toHaveClass(
      "transition-opacity",
      "motion-reduce:transition-none",
      "motion-reduce:opacity-100",
    );

    // 同じ牌面の再レンダーは新しいツモイベントではないため再演出しない。
    rerender(<Hand tiles={[...afterDraw]} />);
    expect(
      screen.queryByRole("option", { name: "五筒(赤ドラ)" }),
    ).not.toHaveAttribute("data-hand-animation");
  });

  it("初回の配牌は牌順に決まった遅延で一度だけ入場表示する", () => {
    render(<Hand tiles={tiles} />);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(tiles.length);
    for (const option of options) {
      expect(option).toHaveAttribute("data-hand-animation", "deal");
    }
    expect(options[0]).toHaveClass("opacity-0", "translate-y-1");
    expect(options[2]).toHaveStyle({ transitionDelay: "60ms" });
  });

  it("差替牌だけを replacement として表示し、既存牌を再演出しない", () => {
    const before = [tiles[0], tiles[1], tiles[2]];
    const replacement = { suit: "honor" as const, rank: 1 };
    const { rerender } = render(<Hand tiles={before} />);

    rerender(<Hand tiles={[tiles[0], replacement, tiles[2]]} />);

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("data-hand-animation", "replacement");
    expect(options[0]).not.toHaveAttribute("data-hand-animation");
    expect(options[2]).not.toHaveAttribute("data-hand-animation");
    expect(options[1]).toHaveClass("opacity-0", "motion-reduce:opacity-100");
  });

  it("鳴きで手牌が縮むと残った牌を meld reflow として表示する", () => {
    const before = [
      tiles[0],
      tiles[1],
      tiles[2],
      { suit: "honor" as const, rank: 1 },
    ];
    const { rerender } = render(<Hand tiles={before} />);

    rerender(<Hand tiles={[tiles[0], tiles[2]]} />);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option).toHaveAttribute("data-hand-animation", "meld");
      expect(option).toHaveClass("opacity-80", "translate-x-1");
    }
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("局境界の新しい配牌は一度だけ表示し、同じスナップショットでは再演出しない", () => {
    const previous = [
      ...Array.from({ length: 9 }, (_, index) => ({
        suit: "man" as const,
        rank: index + 1,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        suit: "pin" as const,
        rank: index + 1,
      })),
    ];
    const next = [
      ...Array.from({ length: 9 }, (_, index) => ({
        suit: "sou" as const,
        rank: index + 1,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        suit: "honor" as const,
        rank: index + 1,
      })),
    ];
    const { rerender } = render(<Hand tiles={previous} />);

    rerender(<Hand tiles={next} />);
    expect(
      screen
        .getAllByRole("option")
        .every(
          (option) => option.getAttribute("data-hand-animation") === "deal",
        ),
    ).toBe(true);

    rerender(<Hand tiles={[...next]} />);
    expect(screen.queryAllByRole("option")).toHaveLength(next.length);
    expect(
      screen
        .queryAllByRole("option")
        .some((option) => option.hasAttribute("data-hand-animation")),
    ).toBe(false);
  });

  it("閲覧専用の手牌も list semantics を保ったまま補充遷移を表示する", () => {
    const before = [tiles[0], tiles[2]];
    const after = [tiles[0], tiles[1], tiles[2]];
    const { rerender } = render(<Hand tiles={before} readOnly />);

    rerender(<Hand tiles={after} readOnly />);

    const list = screen.getByRole("list", { name: "自家の手牌" });
    expect(list).toHaveAttribute("role", "list");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute(
      "data-hand-animation",
      "draw",
    );
  });

  it("キーボード打牌で手牌が更新されてもactive optionへ実フォーカスを戻す(#248)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Hand tiles={tiles} />);

    screen.getAllByRole("option")[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getAllByRole("option")[1]).toHaveFocus();

    // index 1 の打牌により focused node と、それ以降の key/index が変わる。
    rerender(<Hand tiles={[tiles[0], tiles[2]]} />);

    const updatedOptions = screen.getAllByRole("option");
    expect(updatedOptions[1]).toHaveFocus();
    expect(updatedOptions[1]).toHaveAttribute("tabindex", "0");
  });

  it("手牌外にフォーカスがある更新ではフォーカスを奪わない(#248)", () => {
    const { rerender } = render(
      <>
        <button type="button">手牌外</button>
        <Hand tiles={tiles} />
      </>,
    );
    const outside = screen.getByRole("button", { name: "手牌外" });
    outside.focus();

    rerender(
      <>
        <button type="button">手牌外</button>
        <Hand tiles={[tiles[0], tiles[2]]} />
      </>,
    );

    expect(outside).toHaveFocus();
  });

  it("対話中の手牌が閲覧専用へ切り替わると盤面の着地点へフォーカスを移す(#966)", () => {
    const fallbackRef = createRef<HTMLDivElement>();
    const { rerender } = render(
      <>
        <div
          ref={fallbackRef}
          role="group"
          aria-label="対局盤面"
          tabIndex={-1}
        />
        <Hand tiles={tiles} readOnlyFocusRef={fallbackRef} />
      </>,
    );

    screen.getAllByRole("option")[1].focus();
    rerender(
      <>
        <div
          ref={fallbackRef}
          role="group"
          aria-label="対局盤面"
          tabIndex={-1}
        />
        <Hand tiles={tiles} readOnly readOnlyFocusRef={fallbackRef} />
      </>,
    );

    expect(fallbackRef.current).toHaveFocus();
  });

  it("タッチ確認ボタンにフォーカス中でも閲覧専用化の着地点へ移す", () => {
    const fallbackRef = createRef<HTMLDivElement>();
    const { rerender } = render(
      <>
        <div
          ref={fallbackRef}
          role="group"
          aria-label="対局盤面"
          tabIndex={-1}
        />
        <Hand
          tiles={tiles}
          confirmTouchSelection
          readOnlyFocusRef={fallbackRef}
        />
      </>,
    );

    const first = screen.getAllByRole("option")[0];
    fireEvent.touchStart(first);
    fireEvent.touchEnd(first);
    fireEvent.click(first);
    expect(
      screen.getByRole("button", { name: "一萬で打牌を確定" }),
    ).toHaveFocus();

    rerender(
      <>
        <div
          ref={fallbackRef}
          role="group"
          aria-label="対局盤面"
          tabIndex={-1}
        />
        <Hand
          tiles={tiles}
          confirmTouchSelection
          readOnly
          readOnlyFocusRef={fallbackRef}
        />
      </>,
    );

    expect(fallbackRef.current).toHaveFocus();
  });

  it("打牌で手牌が更新されたら、旧indexの選択状態を別の牌へ引き継がない(#214)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Hand tiles={tiles} />);

    await user.click(screen.getAllByRole("option")[1]);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // index 1 を打牌すると、旧 index 2 の牌が index 1 へ繰り上がる。
    rerender(<Hand tiles={[tiles[0], tiles[2]]} />);

    expect(screen.queryAllByRole("option", { selected: true })).toHaveLength(0);
    expect(screen.getAllByRole("option")[1]).not.toHaveClass("-translate-y-1");
  });

  it("接続待ちで閲覧専用へ切り替わった選択状態を再接続後へ持ち越さない", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Hand tiles={tiles} />);

    await user.click(screen.getAllByRole("option")[0]);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );

    rerender(<Hand tiles={tiles} readOnly />);
    rerender(<Hand tiles={tiles} />);

    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("閲覧専用では静的listとして表示し、選択・フォーカス操作を公開しない", () => {
    render(<Hand tiles={tiles} readOnly />);

    const list = screen.getByRole("list", { name: "自家の手牌" });
    expect(list).toBeInTheDocument();
    // role クエリは暗黙ロールでも通るため、Safari/VoiceOver 対策の明示ロールは
    // 属性で回帰検証する(スペック5 5.2.5 / #270)。
    expect(list).toHaveAttribute("role", "list");
    expect(screen.getAllByRole("listitem")).toHaveLength(tiles.length);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).not.toHaveAttribute("tabindex");
      expect(item).not.toHaveAttribute("aria-selected");
    }
  });
});
