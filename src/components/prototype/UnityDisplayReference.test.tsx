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

    const benchCase = screen.getByTestId("unity-display-case-bench-warmers");
    expect(benchCase).toHaveTextContent("slotShape");
    expect(benchCase).toHaveTextContent("kind=seated");
    expect(benchCase).toHaveTextContent("playerId=p3");
    expect(benchCase).not.toHaveTextContent("[object Object]");
  });

  it("#818: 4回転と局替わりの全12状態を、崩れない4物理スロットとして描く", () => {
    render(<UnityDisplayReference />);

    const boards = screen.getByTestId("unity-display-rotation-boards");
    const states = boards.querySelectorAll("[data-rotation-case]");
    // 席回転4件 + 局替わり2件、それぞれ適用前/適用後。
    expect(states).toHaveLength(12);
    expect(
      boards.querySelectorAll('[data-rotation-phase="before"]'),
    ).toHaveLength(6);
    expect(
      boards.querySelectorAll('[data-rotation-phase="after"]'),
    ).toHaveLength(6);

    for (const state of states) {
      expect(state.querySelectorAll("[data-slot-position]")).toHaveLength(4);
      expect(
        state.querySelectorAll('[data-player-kind="seated"]'),
      ).toHaveLength(3);
      expect(state.querySelectorAll('[data-player-kind="bench"]')).toHaveLength(
        1,
      );
      // 抜け番には席風を出さない(表示契約の benchHasNoSeatWind)。
      const bench = state.querySelector('[data-player-kind="bench"]');
      expect(bench).not.toHaveAttribute("data-seat-wind");
      expect(
        [...state.querySelectorAll("[data-seat-wind]")]
          .map((slot) => slot.getAttribute("data-seat-wind"))
          .sort(),
      ).toEqual(["east", "south", "west"]);
      // 物理スロットは席が回っても動かない(自家=p0 / 上家=p3 / 対面=p2 / 下家=p1)。
      expect(
        state.querySelector(
          '[data-slot-position="self"] [data-player-kind][data-character-id]',
        ),
      ).toHaveAttribute("data-character-id", "p0");
      expect(
        state.querySelector(
          '[data-slot-position="left"] [data-player-kind][data-character-id]',
        ),
      ).toHaveAttribute("data-character-id", "p3");
    }

    // 4回転で全員が1度ずつ抜け番になる。
    const benchedAfterRotation = [...states]
      .filter(
        (state) =>
          state.getAttribute("data-rotation-phase") === "before" &&
          state.getAttribute("data-rotation-group") === "rotation",
      )
      .map((state) =>
        state
          .querySelector('[data-player-kind="bench"]')
          ?.getAttribute("data-character-id"),
      );
    expect([...new Set(benchedAfterRotation)].sort()).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("#818: 局替わりで持ち点がプレイヤーに残ることを表示で確認できる", () => {
    render(<UnityDisplayReference />);

    const before = screen.getByTestId(
      "unity-display-rotation-progression-east-4-to-south-1-before",
    );
    const after = screen.getByTestId(
      "unity-display-rotation-progression-east-4-to-south-1-after",
    );
    expect(before).toHaveTextContent("東4局 0本場");
    expect(after).toHaveTextContent("南1局 0本場");

    // `CharacterPortrait` も同じ属性を持つため、スロット本体だけに絞る。
    const pointsOf = (state: HTMLElement): [string, string][] =>
      [...state.querySelectorAll("[data-player-kind][data-character-id]")].map(
        (slot) => [
          slot.getAttribute("data-character-id") ?? "",
          slot.textContent?.replace(/\s+/g, "") ?? "",
        ],
      );
    // 席は回るが、各playerIdに紐づく持ち点表示は局替わりで変わらない。
    const beforeSlots = pointsOf(before);
    expect(beforeSlots).toHaveLength(4);
    for (const [playerId, text] of beforeSlots) {
      const afterSlot = after.querySelector(
        `[data-player-kind][data-character-id="${playerId}"]`,
      );
      const points = /(\d{2},\d{3})/.exec(text)?.[1];
      expect(points).toBeDefined();
      expect(afterSlot?.textContent?.replace(/\s+/g, "")).toContain(points);
    }
  });

  it("#818: Web側に演出実装が無い北抜きを、契約由来で明示する", () => {
    render(<UnityDisplayReference />);

    const effectGroup = screen.getByRole("group", {
      name: "演出プレビューの種類",
    });
    // ボタン列は契約fixtureの kinds から導く。見本の付け忘れはここで落ちる。
    expect(within(effectGroup).getAllByRole("button")).toHaveLength(8);

    const gap = screen.getByTestId("unity-display-unity-only-effects");
    expect(gap.querySelectorAll("[data-unity-only-effect]")).toHaveLength(1);
    expect(gap.querySelector('[data-unity-only-effect="kita"]')).not.toBeNull();
    expect(gap).toHaveTextContent("北抜き");
  });
});
