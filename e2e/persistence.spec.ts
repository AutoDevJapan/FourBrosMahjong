import { expect, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { advanceUntil, declareRiichi, visibleHand } from "./helpers/gameDriver";

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
    const hand = visibleHand(page);

    // 標準戦略で進めてリーチ可能手番に到達し、「リーチ可」の牌で宣言する。
    await declareRiichi(page);

    const badge = page
      .getByRole("region", { name: /^粗悪品/ })
      .getByTestId("status-badge-riichi");
    await expect(badge).toBeVisible();
    const declaredHand = await hand.getByRole("option").allTextContents();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(
            sessionStorage.getItem("four-bros-mahjong.game.v3") ?? "null",
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
    // 先にロビーを踏んでおき、終局後の「戻る」到達先を検証可能にする。
    await page.goto("/");
    await page.goto("/game?seed=1");
    // 半荘終了まで合法牌のみで完走する(seed=1 は約113手・9局で決定的に終局)。
    // gameEnd では最終局の決着表示で停止し(#277: 自動遷移は無い)、ドライバが
    // 「結果を見る」(push)で結果画面へ進む。
    await advanceUntil(
      page,
      () => new URL(page.url()).pathname === "/game/result",
      { maxSteps: 2000, legalOnly: true },
    );
    await expect(page).toHaveURL(/\/game\/result$/);
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();

    // 「結果を見る」は push 遷移のため /game のエントリが残る。「戻る」で /game
    // (最終局の決着表示・自動リダイレクトなし)→ もう一度「戻る」でロビーへ脱出できる
    // (#206 の戻るトラップは再発しない: /game は gameEnd で自動遷移しないため)。
    await page.goBack();
    await expect(page).toHaveURL(/\/game(\?.*)?$/);
    await expect(
      page.getByRole("button", { name: "結果を見る" }).first(),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("終局後の /game の出口(#206 / #207)", () => {
  test("「もう一半荘」後の戻る操作で復元不能な結果画面へ戻らない(issue #353)", async ({
    page,
  }) => {
    await page.addInitScript(
      (raw) => {
        sessionStorage.setItem("four-bros-mahjong.game.v3", raw);
      },
      JSON.stringify(walkToGameEnd(1).journal),
    );

    // ロビーを履歴の起点にし、終局画面から結果画面へ進む。
    await page.goto("/");
    await page.getByRole("link", { name: /対局を始める/ }).click();
    await page.getByRole("button", { name: "結果を見る" }).first().click();
    await expect(page).toHaveURL(/\/game\/result$/);
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();

    // 新規半荘は確定結果を上書きするため、結果URLを履歴に残さず /game へ replace する。
    await page.getByRole("button", { name: "もう一半荘" }).click();
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.locator("[data-phase]").first()).toHaveAttribute(
      "data-phase",
      "playing",
    );

    // 戻っても、既に復元不能な /game/result の未確定フォールバックへは入らない。
    await page.goBack();
    await expect(page).toHaveURL(/\/game$/);
    await expect(
      page.getByText("まだ半荘の結果が確定していません"),
    ).toHaveCount(0);
    await expect(page.locator("[data-phase]").first()).toHaveAttribute(
      "data-phase",
      "playing",
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
  });

  test("終局journal残存時もロビー「対局を始める」で /game に留まり、戻る・新規半荘開始が機能する", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // 実エンジン(Node側)で決定的に生成した終局済み journal を注入し、半荘終了後の
    // タブ状態(終局 journal が sessionStorage に残存)を UI 打ち切りなしに再現する(#207)。
    await page.addInitScript(
      (raw) => {
        sessionStorage.setItem("four-bros-mahjong.game.v3", raw);
      },
      JSON.stringify(walkToGameEnd(1).journal),
    );

    // ロビー →「対局を始める」: /game/result へ強制リダイレクトされず /game に留まる(#207)。
    await page.goto("/");
    await page.getByRole("link", { name: /対局を始める/ }).click();
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
    await page.getByRole("link", { name: /対局を始める/ }).click();
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
