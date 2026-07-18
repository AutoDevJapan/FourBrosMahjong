import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LiveRegion from "./LiveRegion";

describe("LiveRegion", () => {
  it("同じ文言の別イベントでも常駐領域内の子ノードを交換する(#250)", () => {
    const { rerender } = render(
      <LiveRegion politeMessage="この牌は選べません。" politeMessageKey={1} />,
    );
    const region = screen.getByText("この牌は選べません。").parentElement;
    const firstMessageNode = region?.firstElementChild;

    rerender(
      <LiveRegion politeMessage="この牌は選べません。" politeMessageKey={2} />,
    );

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("この牌は選べません。");
    expect(region?.firstElementChild).not.toBe(firstMessageNode);
  });

  it("イベントキーを変えても secondary / assertive 通知を重複させない", () => {
    const { rerender } = render(
      <LiveRegion
        politeMessage="禁止理由"
        politeMessageKey={1}
        secondaryPoliteMessage="北を抜きました。"
        assertiveMessage="流局です。"
      />,
    );
    rerender(
      <LiveRegion
        politeMessage="禁止理由"
        politeMessageKey={2}
        secondaryPoliteMessage="北を抜きました。"
        assertiveMessage="流局です。"
      />,
    );

    expect(screen.getAllByText("北を抜きました。")).toHaveLength(1);
    expect(screen.getAllByText("流局です。")).toHaveLength(1);
  });
});
