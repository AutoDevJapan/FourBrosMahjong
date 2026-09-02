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

  it("二次politeも同じ文言の別イベントでは子ノードを交換する", () => {
    const { rerender } = render(
      <LiveRegion
        politeMessage="禁止理由"
        politeMessageKey={1}
        secondaryPoliteMessage="北を抜きました。"
        secondaryPoliteMessageKey={1}
        assertiveMessage="流局です。"
      />,
    );
    const secondaryRegion = document.querySelectorAll(
      '[aria-live="polite"]',
    )[1];
    const firstMessageNode = secondaryRegion?.firstElementChild;

    rerender(
      <LiveRegion
        politeMessage="禁止理由"
        politeMessageKey={2}
        secondaryPoliteMessage="北を抜きました。"
        secondaryPoliteMessageKey={2}
        assertiveMessage="流局です。"
      />,
    );

    expect(secondaryRegion).toHaveTextContent("北を抜きました。");
    expect(secondaryRegion?.firstElementChild).not.toBe(firstMessageNode);
    expect(screen.getAllByText("流局です。")).toHaveLength(1);
  });

  it("同一eventの再描画と空文言では通知を重複させない", () => {
    const { rerender } = render(
      <LiveRegion
        secondaryPoliteMessage="北を抜きました。"
        secondaryPoliteMessageKey={1}
      />,
    );
    const secondaryRegion = document.querySelectorAll(
      '[aria-live="polite"]',
    )[1];
    const firstMessageNode = secondaryRegion?.firstElementChild;

    rerender(
      <LiveRegion
        secondaryPoliteMessage="北を抜きました。"
        secondaryPoliteMessageKey={1}
      />,
    );
    expect(secondaryRegion?.firstElementChild).toBe(firstMessageNode);
    expect(screen.getAllByText("北を抜きました。")).toHaveLength(1);

    rerender(<LiveRegion secondaryPoliteMessageKey={2} />);
    expect(secondaryRegion).toHaveTextContent("");
    expect(screen.queryByText("北を抜きました。")).not.toBeInTheDocument();
  });
});
