import { expect, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";

const HISTORY_KEY = "four-bros-mahjong.history.v1";

test.describe("戦績のローカル保存・閲覧(#293)", () => {
  for (const failure of ["SecurityError", "QuotaExceededError"] as const) {
    test(`戦績保存が${failure}でも結果を表示し、保存失敗を通知する(issue #358)`, async ({
      page,
    }) => {
      await page.addInitScript(
        ({ raw, failure }) => {
          sessionStorage.setItem("four-bros-mahjong.game.v1", raw);
          if (failure === "SecurityError") {
            Object.defineProperty(window, "localStorage", {
              configurable: true,
              get() {
                throw new DOMException("Storage is disabled", "SecurityError");
              },
            });
            return;
          }
          const storage = window.localStorage;
          Object.defineProperty(window, "localStorage", {
            configurable: true,
            value: {
              get length() {
                return storage.length;
              },
              clear: () => storage.clear(),
              getItem: (key: string) => storage.getItem(key),
              key: (index: number) => storage.key(index),
              removeItem: (key: string) => storage.removeItem(key),
              setItem() {
                throw new DOMException(
                  "Storage quota exceeded",
                  "QuotaExceededError",
                );
              },
            },
          });
        },
        { raw: JSON.stringify(walkToGameEnd(1).journal), failure },
      );

      await page.goto("/game");
      await page.getByRole("button", { name: "結果を見る" }).first().click();

      await expect(page).toHaveURL(/\/game\/result$/);
      await expect(
        page.getByRole("heading", { name: "最終順位" }),
      ).toBeVisible();
      await expect(
        page.getByRole("status").filter({
          hasText: "この端末に今回の戦績を保存できませんでした。",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "もう一半荘" }),
      ).toBeVisible();

      await page.getByRole("link", { name: "戦績を見る" }).click();
      await expect(
        page.getByText(/この端末のストレージが利用できる場合/),
      ).toBeVisible();
      await expect(page.getByText(/自動で記録されます/)).toBeVisible();
    });
  }

  test("終局した半荘が戦績へ保存され、/history で閲覧・削除できる", async ({
    page,
  }) => {
    // 実エンジンで決定的に生成した終局済みジャーナルを注入し、終局直後のタブを再現する。
    await page.addInitScript(
      (raw) => {
        sessionStorage.setItem("four-bros-mahjong.game.v1", raw);
      },
      JSON.stringify(walkToGameEnd(1).journal),
    );

    // /game 訪問(終局ジャーナルの復元)で戦績1件が localStorage へ保存される。
    await page.goto("/game");
    await expect(
      page.getByRole("button", { name: "結果を見る" }).first(),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) =>
            JSON.parse(localStorage.getItem(key) ?? "null")?.entries.length ??
            0,
          HISTORY_KEY,
        ),
      )
      .toBe(1);

    // 結果画面 → 「戦績を見る」導線で /history へ。
    await page.getByRole("button", { name: "結果を見る" }).first().click();
    await expect(page).toHaveURL(/\/game\/result$/);
    await expect(
      page.getByText("この端末に今回の戦績を保存できませんでした。"),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "戦績を見る" }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "戦績" }),
    ).toBeVisible();

    // 一覧に1件。展開すると結果画面と同じ最終順位・ソシー内訳を閲覧できる。
    const list = page.getByRole("list", { name: "保存された半荘結果" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await list.locator("summary").first().click();
    await expect(list.getByRole("table")).toBeVisible();
    await expect(
      list.getByRole("heading", { name: "ソシー内訳(素点+ウマ+祝儀)" }),
    ).toBeVisible();

    // リロードしても戦績は残る(localStorage 永続)。
    await page.reload();
    await expect(
      page
        .getByRole("list", { name: "保存された半荘結果" })
        .getByRole("listitem"),
    ).toHaveCount(1);

    // 全件削除は2段階確認。キャンセルでは消えない。
    await page.getByRole("button", { name: "戦績をすべて削除" }).click();
    await page.getByRole("button", { name: "キャンセル" }).click();
    await expect(
      page
        .getByRole("list", { name: "保存された半荘結果" })
        .getByRole("listitem"),
    ).toHaveCount(1);

    // 実行すると空状態へ戻り、保存キーも消える。
    await page.getByRole("button", { name: "戦績をすべて削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(
      page.getByText("保存された戦績はまだありません", { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), HISTORY_KEY),
    ).toBeNull();
  });

  test("ロビー・設定から戦績ページへ到達でき、未保存時は空状態を表示する", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /戦績/ }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(
      page.getByText("保存された戦績はまだありません", { exact: false }),
    ).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("link", { name: /戦績を見る/ }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "戦績" }),
    ).toBeVisible();
  });
});
