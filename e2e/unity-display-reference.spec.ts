import { expect, test } from "@playwright/test";

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
    for (const [title, kind] of [
      ["打牌", "discard"],
      ["リーチ", "riichi"],
      ["ポン", "pon"],
      ["カン", "kan"],
      ["ツモ", "tsumo"],
      ["ロン", "ron"],
      ["流局", "draw"],
      ["局終了", "roundEnd"],
    ] as const) {
      await effectGroup.getByRole("button", { name: title }).click();
      await expect(page.getByTestId("effect-overlay")).toHaveAttribute(
        "data-effect-type",
        kind,
      );
    }
  });
});
