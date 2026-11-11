import { expect, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { replayJournal } from "@/components/game/gamePersistence";
import { advanceUntil } from "./helpers/gameDriver";

test("ローカル保存失敗後に次半荘から戦績へ移り、元の結果を再保存できる(#1244)", async ({
  page,
}) => {
  const fixture = walkToGameEnd(1);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(
    (raw) => {
      // Journal fixture only; final history is produced by the actual last UI action.
      sessionStorage.setItem("four-bros-mahjong.game.v3", raw);
      const storage = localStorage;
      const original = Storage.prototype.setItem;
      let blocked = true;
      Storage.prototype.setItem = function (key, value) {
        if (
          this === storage &&
          key === "four-bros-mahjong.history.v1" &&
          blocked
        )
          throw new DOMException("temporary quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
      Object.assign(window, {
        restoreHistoryWrites: () => {
          blocked = false;
          Storage.prototype.setItem = original;
        },
      });
    },
    JSON.stringify({
      ...fixture.journal,
      actions: fixture.journal.actions.slice(0, -1),
    }),
  );

  await page.goto("/game");
  await advanceUntil(
    page,
    async () => (await page.locator('[data-phase="gameEnd"]').count()) > 0,
    { legalOnly: true, maxSteps: 10, onGameEnd: "stop" },
  );
  await page.getByRole("button", { name: "結果を見る" }).first().click();
  await expect(page).toHaveURL(/\/game\/result$/);
  await expect(page.locator('[data-save-status="failed"]')).toBeVisible();
  const retained = await page.evaluate(
    () =>
      JSON.parse(
        sessionStorage.getItem("four-bros-mahjong.history-pending.v1") ??
          "null",
      ).entries[0],
  );
  expect(retained.seed).toBe(fixture.journal.seed);
  const completedJournal = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("four-bros-mahjong.game.v3") ?? "null"),
  );
  expect(retained.players).toEqual(
    replayJournal(completedJournal).result?.map(
      ({ name, rank, rawScore, uma, bonus, soshiiTotal }) => ({
        name,
        rank,
        rawScore,
        uma,
        bonus,
        soshiiTotal,
      }),
    ),
  );
  await page.getByRole("button", { name: "もう一半荘" }).click();
  await expect(page.locator('[data-phase="playing"]').first()).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { restoreHistoryWrites: () => void }
    ).restoreHistoryWrites(),
  );
  // A real Link transition disposes the game Provider; no reload/newGame retry.
  await page.getByRole("link", { name: "ロビーへ戻る" }).click();
  await page
    .getByRole("navigation", { name: "メインメニュー" })
    .getByRole("link", { name: /^戦績/ })
    .click();
  const navigation = page.getByRole("navigation", { name: "画面メニュー" });
  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page
      .getByRole("list", { name: "保存された半荘結果" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("four-bros-mahjong.history.v1") ?? "null",
          )?.entries,
      ),
    )
    .toEqual([retained]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("four-bros-mahjong.history-pending.v1"),
    ),
  ).toBeNull();
  await navigation.locator("summary").click();
  await navigation.getByRole("link", { name: /^設定/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(navigation).toHaveAttribute("data-navigation-hydrated", "true");
  const historyLink = navigation.getByRole("link", { name: /^戦績/ });
  // Client transitions can retain the existing details element's open state.
  if (!(await historyLink.isVisible())) {
    await navigation.locator("summary").click();
  }
  await historyLink.click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page
      .getByRole("list", { name: "保存された半荘結果" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("four-bros-mahjong.history.v1") ?? "null",
          )?.entries,
      ),
    )
    .toEqual([retained]);
  expect(errors).toEqual([]);
});
