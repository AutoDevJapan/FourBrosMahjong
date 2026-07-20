import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * 対局者名の設定(issue #291)のブラウザ動線検証。
 *
 * `/settings` で保存 → `/game` の盤面 → リロード復元まで、同じ名前が一貫して出ることを確認する。
 */

const NAMES = ["わたし", "龍さん", "下ちゃん", "翔生くん"] as const;
const DEFAULT_NAMES = ["あなた", "一郎", "二郎", "三郎"] as const;
const LABELS = ["あなた(自家)", "対局者2", "対局者3", "対局者4"] as const;

/**
 * `/settings` を開き、保存値が入力欄へ反映されるまで待つ。
 *
 * フォームは保存値を `useSyncExternalStore` で読むため、**サーバー描画時点では常に既定名**で、
 * ハイドレーション後に `localStorage` の値へ切り替わる。保存値が既定名と異なる場合、
 * その値の出現はハイドレーション完了の確実な signal になる。
 * 保存値が既定名と一致する場合は SSR と区別できないため、この関数だけでは足りない
 * (その場合は `fillNames` の再入力ループが競合を吸収する)。
 */
async function openSettings(
  page: Page,
  expectedInitial: readonly string[],
): Promise<void> {
  await page.goto("/settings");
  for (const [index, label] of LABELS.entries()) {
    await expect(page.getByLabel(label)).toHaveValue(expectedInitial[index]);
  }
}

/**
 * 4人の名前を入力する。入力値が残っていることを確認し、残らなければ再入力する。
 *
 * ハイドレーション前の `fill()` は React の state に載らず、直後の再描画で保存値へ
 * 巻き戻る(CI の遅い環境で顕在化)。値が定着するまで再入力することで、
 * ハイドレーション完了の待ち合わせと入力を同時に成立させる。
 */
async function fillNames(page: Page, names: readonly string[]): Promise<void> {
  await expect
    .poll(async () => {
      for (const [index, label] of LABELS.entries()) {
        await page.getByLabel(label).fill(names[index]);
      }
      return Promise.all(
        LABELS.map((label) => page.getByLabel(label).inputValue()),
      );
    })
    .toEqual([...names]);
}

/** `/settings` で4人の名前を入力して保存する。 */
async function saveNames(
  page: Page,
  names: readonly string[],
  expectedInitial: readonly string[],
): Promise<void> {
  await openSettings(page, expectedInitial);
  await fillNames(page, names);
  await page.getByRole("button", { name: "名前を保存" }).click();
  await expect(page.getByText(/保存しました/)).toBeVisible();
}

test.describe("対局者名の設定 (#291)", () => {
  test("設定した名前が盤面に反映され、リロード後も保持される", async ({
    page,
  }) => {
    await saveNames(page, NAMES, DEFAULT_NAMES);

    await page.goto("/game?seed=0");
    for (const name of NAMES) {
      await expect(
        page.getByText(name, { exact: false }).first(),
        `盤面に「${name}」が表示される`,
      ).toBeVisible();
    }

    await page.reload();
    for (const name of NAMES) {
      await expect(
        page.getByText(name, { exact: false }).first(),
      ).toBeVisible();
    }
  });

  test("名前未設定(初回)は既定名で対局を開始する(後方互換)", async ({
    page,
  }) => {
    await page.goto("/game?seed=0");

    for (const name of DEFAULT_NAMES) {
      await expect(
        page.getByText(name, { exact: false }).first(),
      ).toBeVisible();
    }
  });

  test("空欄のまま保存すると既定名へ戻る", async ({ page }) => {
    await saveNames(page, NAMES, DEFAULT_NAMES);

    await openSettings(page, NAMES);
    await page.getByLabel("対局者2").fill("");
    await page.getByRole("button", { name: "名前を保存" }).click();

    await expect(page.getByLabel("対局者2")).toHaveValue(DEFAULT_NAMES[1]);
  });

  test("「既定名に戻す」で全員が既定名へ戻る", async ({ page }) => {
    await saveNames(page, NAMES, DEFAULT_NAMES);

    await openSettings(page, NAMES);
    await page.getByRole("button", { name: "既定名に戻す" }).click();

    for (const [index, label] of LABELS.entries()) {
      await expect(page.getByLabel(label)).toHaveValue(DEFAULT_NAMES[index]);
    }
  });
});
