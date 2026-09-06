import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Discards, {
  getRiverTileLayout,
  riverCueForTransition,
  riverStateKey,
  riverTileKey,
} from "./Discards";
import type { RiverTileData } from "./types";

const tile = (rank: number, isRiichi = false): RiverTileData => ({
  suit: "man",
  rank,
  ...(isRiichi ? { isRiichi: true } : {}),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Discards", () => {
  it("CSSOMが無い環境でも河を描画し、未計測レイアウトへフォールバックする", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      "getComputedStyle",
    );
    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      expect(() =>
        render(<Discards tiles={[tile(1), tile(2)]} />),
      ).not.toThrow();
      const list = document.querySelector("[data-river-state-key]");
      expect(list).not.toBeNull();
      expect(list).toHaveAttribute("data-river-state-key", expect.any(String));
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "getComputedStyle", descriptor);
      }
    }
  });

  it("CSSOMの呼び出しがthrowしても河の描画を中断しない", () => {
    const getComputedStyle = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(() => {
        throw new Error("CSSOM is unavailable");
      });

    try {
      expect(() => render(<Discards tiles={[tile(1)]} />)).not.toThrow();
      expect(document.querySelector("[data-river-state-key]")).not.toBeNull();
    } finally {
      getComputedStyle.mockRestore();
    }
  });

  it("ResizeObserverのconstructorがthrowしてもwindowのresize fallbackで描画する", () => {
    class ThrowingResizeObserver {
      constructor() {
        throw new Error("ResizeObserver is unavailable");
      }
    }
    vi.stubGlobal("ResizeObserver", ThrowingResizeObserver);
    const addEventListener = vi.spyOn(window, "addEventListener");

    expect(() => render(<Discards tiles={[tile(1)]} />)).not.toThrow();
    expect(document.querySelector("[data-river-state-key]")).not.toBeNull();
    expect(addEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );

    addEventListener.mockRestore();
  });

  it("ResizeObserverのobserveがthrowしてもriverを描画する", () => {
    const disconnect = vi.fn();
    class ThrowingObserveResizeObserver {
      observe(): void {
        throw new Error("ResizeObserver.observe is unavailable");
      }

      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", ThrowingObserveResizeObserver);

    expect(() => render(<Discards tiles={[tile(1)]} />)).not.toThrow();
    expect(document.querySelector("[data-river-state-key]")).not.toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("ResizeObserverのdisconnectがthrowしてもunmountを中断しない", () => {
    const disconnect = vi.fn(() => {
      throw new Error("ResizeObserver.disconnect is unavailable");
    });
    class ThrowingDisconnectResizeObserver {
      observe(): void {}

      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", ThrowingDisconnectResizeObserver);

    const { unmount } = render(<Discards tiles={[tile(1)]} />);
    expect(() => unmount()).not.toThrow();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("捨て牌を捨て順どおりにすべて表示する", () => {
    render(<Discards tiles={[tile(1), tile(2), tile(3)]} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list.querySelectorAll("li")).toHaveLength(3);
    // role クエリは暗黙ロールでも通るため、Safari/VoiceOver 対策の明示ロールは
    // 属性で回帰検証する(スペック5 5.2.5 / #270)。
    expect(list).toHaveAttribute("role", "list");
  });

  it("limit 指定時は直近の枚数だけを表示する", () => {
    const tiles = [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => tile(rank));
    render(<Discards tiles={tiles} limit={6} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list.querySelectorAll("li")).toHaveLength(6);
  });

  it("limit=0では捨て牌を表示しない", () => {
    render(<Discards tiles={[tile(1), tile(2), tile(3)]} limit={0} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list.querySelectorAll("li")).toHaveLength(0);
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

  it("リーチ宣言牌を読み上げ可能な横置き対象として表示する", () => {
    render(<Discards tiles={[tile(1), tile(2, true), tile(3), tile(4)]} />);
    const list = screen.getByRole("list", { name: "捨て牌" });
    const riichi = list.querySelector('[data-riichi="true"]');

    expect(list).toHaveAttribute("data-has-riichi", "true");
    expect(riichi).not.toBeNull();
    expect(riichi).toHaveAttribute("data-river-index", "1");
    expect(riichi).toHaveTextContent("リーチ宣言牌");
  });

  it("横詰めはリーチ宣言牌と同じ段の後続牌だけに適用する", () => {
    const layout = getRiverTileLayout(
      [tile(1), tile(2, true), tile(3), tile(4), tile(5), tile(6)],
      4,
    );

    expect(layout.map((item) => item.shiftsAfterRiichi)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  it("表示上限で宣言牌が隠れる場合は河をリーチ扱いにしない", () => {
    render(
      <Discards
        tiles={[
          tile(1, true),
          tile(2),
          tile(3),
          tile(4),
          tile(5),
          tile(6),
          tile(7),
        ]}
        limit={6}
      />,
    );

    expect(screen.getByRole("list", { name: "捨て牌" })).not.toHaveAttribute(
      "data-has-riichi",
    );
  });

  it("初回描画/復元では静かにし、1枚追加のコミットだけを河入場cueにする", () => {
    const { rerender } = render(<Discards tiles={[tile(1)]} />);
    const list = screen.getByRole("list", { name: "捨て牌" });

    expect(list).not.toHaveAttribute("data-river-event-key");
    expect(list.querySelector('[data-river-animation="discard"]')).toBeNull();

    const current = [tile(1), tile(2)];
    rerender(<Discards tiles={current} />);

    expect(list).toHaveAttribute(
      "data-river-event-key",
      `discard:1:${riverTileKey(tile(2))}:${riverStateKey(current)}`,
    );
    expect(list.querySelector('[data-river-index="1"]')).toHaveAttribute(
      "data-river-animation",
      "discard",
    );
  });

  it("狭幅の直近表示でも全河の追加イベントを表示上の末尾へ写像する", () => {
    const initial = [1, 2, 3, 4, 5, 6].map((rank) => tile(rank));
    const { rerender } = render(<Discards tiles={initial} limit={3} />);

    rerender(<Discards tiles={[...initial, tile(7)]} limit={3} />);

    const list = screen.getByRole("list", { name: "捨て牌" });
    const entering = list.querySelector('[data-river-animation="discard"]');
    expect(entering).toHaveAttribute("data-river-index", "2");
    expect(entering).toHaveTextContent("七萬");
  });

  it("河のリセットでは前局のcueを残さず、次の局の追加から再び基準化する", () => {
    const { rerender } = render(<Discards tiles={[tile(1)]} />);
    rerender(<Discards tiles={[tile(1), tile(2)]} />);
    rerender(<Discards tiles={[]} />);

    const list = screen.getByRole("list", { name: "捨て牌" });
    expect(list).not.toHaveAttribute("data-river-event-key");
    expect(list.querySelector('[data-river-animation="discard"]')).toBeNull();

    rerender(<Discards tiles={[tile(3)]} />);
    expect(
      list.querySelector('[data-river-animation="discard"]'),
    ).not.toBeNull();
  });

  it("河cueは初回、複数枚の飛び越し、並べ替えをイベントとして扱わない", () => {
    const first = [tile(1)];
    const second = [tile(1), tile(2)];

    expect(riverCueForTransition(null, first)).toBeNull();
    expect(riverCueForTransition(first, second)).toMatchObject({
      tileIndex: 1,
      stateKey: riverStateKey(second),
    });
    expect(
      riverCueForTransition(first, [tile(1), tile(2), tile(3)]),
    ).toBeNull();
    expect(
      riverCueForTransition(second, [tile(2), tile(1), tile(3)]),
    ).toBeNull();
  });
});
