import { expect, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";

const visibleHand = (page: import("@playwright/test").Page) =>
  page.getByRole("listbox", { name: "自家の手牌" }).filter({ visible: true });

test.describe("対局状態のsession復元(#190)", () => {
  test("打牌後reloadで同じ局面を復元し、別seedは新規開始する", async ({
    page,
  }) => {
    await page.goto("/game?seed=0");
    const hand = visibleHand(page);
    const initial = await hand.getByRole("option").allTextContents();
    await hand
      .locator('[role="option"]:not([aria-disabled="true"])')
      .first()
      .click();
    await expect
      .poll(() => hand.getByRole("option").allTextContents())
      .not.toEqual(initial);
    const progressed = await hand.getByRole("option").allTextContents();

    await page.reload();
    await expect
      .poll(() => visibleHand(page).getByRole("option").allTextContents())
      .toEqual(progressed);

    await page.goto("/game?seed=1");
    await expect
      .poll(() => visibleHand(page).getByRole("option").allTextContents())
      .not.toEqual(progressed);
  });

  test("破損・旧version記録は例外なく新規対局へfallbackする", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "four-bros-mahjong.game.v1",
        JSON.stringify({ version: 0, seed: 0, actions: [{ type: "bad" }] }),
      );
    });
    await page.goto("/game?seed=0");
    await expect(visibleHand(page).getByRole("option")).toHaveCount(14);
  });

  test("リーチ宣言後reloadで宣言状態と手牌を復元する", async ({ page }) => {
    await page.goto("/game?seed=381");
    const board = page.locator("[data-phase]").first();
    const hand = visibleHand(page);

    for (let step = 0; step < 60; step++) {
      const riichi = page.getByRole("button", { name: "リーチ", exact: true });
      if (await riichi.count()) {
        await riichi.first().click();
        await hand
          .getByRole("option", { name: /リーチ可/ })
          .first()
          .click();
        break;
      }
      if ((await board.getAttribute("data-pending")) === "humanReact") {
        await page.getByRole("button", { name: "スルー" }).first().click();
      } else {
        await hand.getByRole("option").first().click();
      }
    }

    const badge = page
      .getByRole("region", { name: /^あなた/ })
      .getByTestId("status-badge-riichi");
    await expect(badge).toBeVisible();
    const declaredHand = await hand.getByRole("option").allTextContents();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(
            sessionStorage.getItem("four-bros-mahjong.game.v1") ?? "null",
          )?.actions.some(
            (action: { type: string }) => action.type === "riichi",
          ),
        ),
      )
      .toBe(true);

    await page.reload();
    await expect(badge).toBeVisible();
    await expect
      .poll(() => visibleHand(page).getByRole("option").allTextContents())
      .toEqual(declaredHand);
  });

  test("半荘結果をresult reload後も保持する", async ({ page }) => {
    test.setTimeout(120_000);
    // 先にロビーを踏んでおき、終局の自動遷移(replace)後の「戻る」到達先を検証可能にする。
    await page.goto("/");
    await page.goto("/game?seed=1");
    const board = page.locator("[data-phase]").first();
    for (let step = 0; step < 2000; step++) {
      const phase = await board.getAttribute("data-phase");
      const pending = await board.getAttribute("data-pending");
      if (phase === "gameEnd") break;
      if (phase === "roundEnd") {
        await page.getByRole("button", { name: "次の局へ" }).first().click();
      } else if (pending === "humanReact") {
        await page.getByRole("button", { name: "スルー" }).first().click();
      } else if (pending === "humanDiscard") {
        await visibleHand(page)
          .locator('[role="option"]:not([aria-disabled="true"])')
          .first()
          .click();
      }
    }
    await expect(page).toHaveURL(/\/game\/result$/);
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();

    // 終局の自動遷移は replace で履歴を汚さないため、/game のエントリは残らず
    // 「戻る」1回でロビーへ帰れる(#206: 戻るトラップの解消)。
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("終局後の /game の出口(#206 / #207)", () => {
  test("終局journal残存時もロビー「対局を開始」で /game に留まり、戻る・新規半荘開始が機能する", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // 実エンジン(Node側)で決定的に生成した終局済み journal を注入し、半荘終了後の
    // タブ状態(終局 journal が sessionStorage に残存)を UI 打ち切りなしに再現する(#207)。
    await page.addInitScript(
      (raw) => {
        sessionStorage.setItem("four-bros-mahjong.game.v1", raw);
      },
      JSON.stringify(walkToGameEnd(1).journal),
    );

    // ロビー →「対局を開始」: /game/result へ強制リダイレクトされず /game に留まる(#207)。
    await page.goto("/");
    await page.getByRole("link", { name: /対局を開始/ }).click();
    await expect(
      page.getByRole("button", { name: "新しい半荘を開始" }).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/game$/);

    // 「結果を見る」(ユーザー操作)で結果画面へ。
    await page.getByRole("button", { name: "結果を見る" }).first().click();
    await expect(page).toHaveURL(/\/game\/result$/);
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();

    // ブラウザ「戻る」: /game に留まり(再pushの増殖なし)、もう一度戻るとロビーへ脱出できる。
    await page.goBack();
    await expect(page).toHaveURL(/\/game$/);
    await expect(
      page.getByRole("button", { name: "新しい半荘を開始" }).first(),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);

    // 再訪して「新しい半荘を開始」→ 新規半荘の打牌待ちが始まる。
    await page.getByRole("link", { name: /対局を開始/ }).click();
    await page
      .getByRole("button", { name: "新しい半荘を開始" })
      .first()
      .click();
    await expect(page.locator("[data-phase]").first()).toHaveAttribute(
      "data-phase",
      "playing",
    );
    await expect(visibleHand(page).getByRole("option")).toHaveCount(14);
  });
});
