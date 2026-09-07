import { expect, test } from "@playwright/test";
import contract from "../documents/fixtures/unity-display-contract.json";

/** 契約fixtureが宣言するWeb演出。ボタン列とプレビューはここから導く。 */
const majorEffects = contract.visualCases.find(
  (visualCase) => visualCase.id === "major-effects",
)?.assertions as
  | { kinds?: readonly string[]; unityOnlyKinds?: readonly string[] }
  | undefined;

const EFFECT_TITLE: Record<string, string> = {
  discard: "打牌",
  riichi: "リーチ",
  pon: "ポン",
  kan: "カン",
  tsumo: "ツモ",
  ron: "ロン",
  draw: "流局",
  roundEnd: "局終了",
};

test.describe("#828 Unity表示リファレンス", () => {
  test("Vercel/Previewで固定fixtureと実盤面を確認できる", async ({ page }) => {
    await page.goto("/prototype/unity-display");

    await expect(
      page.getByRole("heading", { level: 1, name: "Unity表示リファレンス" }),
    ).toBeVisible();
    await expect(page.getByTestId("unity-reference-boundary")).toContainText(
      "Unity Runtimeではなく",
    );
    await expect(
      page.getByTestId("unity-display-case-river-wrap-and-riichi"),
    ).toBeVisible();
    await expect(
      page.getByTestId("unity-display-case-hand-deal-draw-replacement-meld"),
    ).toBeVisible();
    await expect(
      page.getByTestId("unity-display-case-major-effects"),
    ).toBeVisible();
    await expect(
      page.getByTestId("unity-display-case-bench-warmers"),
    ).toBeVisible();

    const board = page.getByRole("group", { name: "対局盤面" });
    await expect(
      board.locator('[data-board-layout="cross"] [data-slot-position]'),
    ).toHaveCount(4);
    await expect(
      board.locator('[data-board-layout="cross"] [data-player-kind="seated"]'),
    ).toHaveCount(3);
    await expect(
      board.locator('[data-board-layout="cross"] [data-player-kind="bench"]'),
    ).toHaveCount(1);
    await expect(
      page.getByRole("table", { name: "親流れの席回転" }),
    ).toBeVisible();

    const effectGroup = page.getByRole("group", {
      name: "演出プレビューの種類",
    });
    const webKinds = majorEffects?.kinds ?? [];
    expect(webKinds.length).toBeGreaterThan(0);
    await expect(effectGroup.getByRole("button")).toHaveCount(webKinds.length);
    for (const kind of webKinds) {
      const title = EFFECT_TITLE[kind];
      expect(title, `未対応の演出種別: ${kind}`).toBeDefined();
      await effectGroup.getByRole("button", { name: title }).click();
      await expect(page.getByTestId("effect-overlay")).toHaveAttribute(
        "data-effect-type",
        kind,
      );
    }

    // #818: Web側に演出実装が無い演出(北抜き)は、見本ではなく明示的な欠落として出す。
    const unityOnly = majorEffects?.unityOnlyKinds ?? [];
    expect(unityOnly).toContain("kita");
    const gap = page.getByTestId("unity-display-unity-only-effects");
    await expect(gap).toBeVisible();
    for (const kind of unityOnly) {
      await expect(
        gap.locator(`[data-unity-only-effect="${kind}"]`),
      ).toHaveCount(1);
    }
  });

  test("#818 席ローテーションと局替わりの全12状態が4スロットのまま崩れない", async ({
    page,
  }, testInfo) => {
    await page.goto("/prototype/unity-display");

    const boards = page.getByTestId("unity-display-rotation-boards");
    await expect(boards).toBeVisible();
    const states = boards.locator("[data-rotation-case]");
    const expectedStates =
      (contract.rotationCases.length + contract.progressionCases.length) * 2;
    await expect(states).toHaveCount(expectedStates);

    for (let index = 0; index < expectedStates; index += 1) {
      const state = states.nth(index);
      await expect(state.locator("[data-slot-position]")).toHaveCount(4);
      await expect(state.locator('[data-player-kind="seated"]')).toHaveCount(3);
      await expect(state.locator('[data-player-kind="bench"]')).toHaveCount(1);
      // 抜け番に席風を出さない(表示契約 benchHasNoSeatWind)。
      await expect(state.locator("[data-seat-wind]")).toHaveCount(3);
    }

    // 横スクロールを起こさずに12状態が収まることを、実ブラウザのレイアウトで確認する。
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Unity Editorなしの画面証跡。test-results配下に出力し、リポジトリへは同梱しない。
    await boards.scrollIntoViewIfNeeded();
    await boards.screenshot({
      path: testInfo.outputPath("unity-818-rotation-boards.png"),
    });
    // `east-4-to-south-1` は席回転と局替わりの双方にあるため、群も指定して一意にする。
    for (const [group, caseName] of [
      ["rotation", "east-1"],
      ["progression", "east-4-to-south-1"],
    ] as const) {
      for (const phase of ["before", "after"] as const) {
        await boards
          .locator(
            `[data-rotation-group="${group}"][data-rotation-case="${caseName}"][data-rotation-phase="${phase}"]`,
          )
          .screenshot({
            path: testInfo.outputPath(
              `unity-818-${group}-${caseName}-${phase}.png`,
            ),
          });
      }
    }
    await page.screenshot({
      path: testInfo.outputPath("unity-818-reference-page.png"),
      fullPage: true,
    });
  });
});
