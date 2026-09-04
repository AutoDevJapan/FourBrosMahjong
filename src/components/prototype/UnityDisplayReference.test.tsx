import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnityDisplayReference from "./UnityDisplayReference";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

describe("UnityDisplayReference (#828)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    routerMock.push.mockClear();
    routerMock.replace.mockClear();
  });

  it("固定seedの実盤面と4つの表示契約ケースを同じ画面に出す", () => {
    const { container } = render(
      <UnityDisplayReference fontVariableClassName="test-yuji-variable" />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Unity表示リファレンス",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("unity-reference-boundary")).toHaveTextContent(
      "Unity Runtimeではなく",
    );
    expect(container.querySelector("main")).toHaveAttribute(
      "data-contract-schema",
      "com.autodevjapan.four-bros-mahjong/unity-display",
    );

    expect(screen.getAllByTestId(/unity-display-case-/)).toHaveLength(4);
    expect(
      screen.getByTestId("unity-display-case-river-wrap-and-riichi"),
    ).toHaveAttribute("data-source-component", "Discards");
    expect(
      screen.getByTestId("unity-display-case-hand-deal-draw-replacement-meld"),
    ).toHaveAttribute("data-source-component", "HandTileAnimation");

    const board = screen.getByRole("group", { name: "対局盤面" });
    const cross = board.querySelector('[data-board-layout="cross"]');
    expect(cross?.querySelectorAll("[data-slot-position]")).toHaveLength(4);
    expect(cross?.querySelectorAll('[data-player-kind="seated"]')).toHaveLength(
      3,
    );
    expect(cross?.querySelectorAll('[data-player-kind="bench"]')).toHaveLength(
      1,
    );
  });

  it("4局のローテーションと表示ケースの見本を確認できる", () => {
    render(<UnityDisplayReference />);

    const rotationTable = screen.getByRole("table", {
      name: "親流れの席回転",
    });
    expect(within(rotationTable).getAllByRole("row")).toHaveLength(5);
    expect(within(rotationTable).getByText("east-4-to-south-1")).toBeVisible();
    expect(screen.getAllByTestId(/unity-display-preview-/)).toHaveLength(4);
    expect(
      screen.getByRole("group", { name: "演出プレビューの種類" }),
    ).toBeVisible();
    expect(screen.getByTestId("unity-display-bench-preview")).toBeVisible();
  });
});
