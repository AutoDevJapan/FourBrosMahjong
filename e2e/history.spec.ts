import { expect, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";

const HISTORY_KEY = "four-bros-mahjong.history.v1";
/** `matchHistory.ts` の `MATCH_HISTORY_LOCK`(モジュール外へは公開しないため実値を持つ)。 */
const HISTORY_LOCK = "four-bros-mahjong.history.write.v1";

/** 保存済み戦績1件ぶんの `localStorage` 値(engine の確定結果と同形)。 */
const SAVED_HISTORY = JSON.stringify({
  version: 1,
  entries: [
    {
      seed: 1,
      finishedAt: 1_753_000_000_000,
      players: [
        {
          name: "一郎",
          rank: 1,
          rawScore: 23_000,
          uma: 10_000,
          bonus: 0,
          soshiiTotal: 33_000,
        },
        {
          name: "二郎",
          rank: 2,
          rawScore: 8_000,
          uma: 5_000,
          bonus: 0,
          soshiiTotal: 13_000,
        },
        {
          name: "三郎",
          rank: 3,
          rawScore: -11_000,
          uma: -5_000,
          bonus: 0,
          soshiiTotal: -16_000,
        },
        {
          name: "四郎",
          rank: 4,
          rawScore: -20_000,
          uma: -10_000,
          bonus: 0,
          soshiiTotal: -30_000,
        },
      ],
    },
  ],
});

test.describe("戦績のローカル保存・閲覧(#293)", () => {
  test("同一ブラウザの2タブが同時に終局復元しても両方の戦績を残す(#363)", async ({
    context,
  }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    const journals = [walkToGameEnd(1).journal, walkToGameEnd(2).journal];

    await Promise.all(
      [first, second].map((tab, index) =>
        tab.addInitScript(
          (raw) => sessionStorage.setItem("four-bros-mahjong.game.v1", raw),
          JSON.stringify(journals[index]),
        ),
      ),
    );

    // localStorage は同一 context で共有、sessionStorage はタブごとに独立する。
    // 2つの復元効果を同時に起動し、Web Locks が read-modify-write を直列化する。
    await Promise.all([first.goto("/game"), second.goto("/game")]);
    await expect
      .poll(() =>
        first.evaluate(
          (key) =>
            JSON.parse(localStorage.getItem(key) ?? "null")
              ?.entries?.map((entry: { seed: number }) => entry.seed)
              .sort((a: number, b: number) => a - b) ?? [],
          HISTORY_KEY,
        ),
      )
      .toEqual([1, 2]);

    await expect(
      first.getByText("この端末に今回の戦績を保存できませんでした。"),
    ).toHaveCount(0);
    await expect(
      second.getByText("この端末に今回の戦績を保存できませんでした。"),
    ).toHaveCount(0);
  });

  test("別タブが履歴lockを保持している間は全件削除を実行しない(#482)", async ({
    context,
  }) => {
    // 別タブ(終局保存中の /game 相当)が実ブラウザの Web Locks を保持し続ける状況を作る。
    // 単体テストは注入した lock manager で契約を固定するため、実 API 経由の直列化は
    // ここでしか確かめられない。
    const holder = await context.newPage();
    await holder.goto("/");
    await holder.evaluate(
      (lock) =>
        new Promise<void>((acquired) => {
          navigator.locks.request(
            lock,
            () =>
              new Promise<void>((release) => {
                (
                  window as unknown as { __releaseHistoryLock: () => void }
                ).__releaseHistoryLock = release;
                acquired();
              }),
          );
        }),
      HISTORY_LOCK,
    );

    const viewer = await context.newPage();
    await viewer.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: HISTORY_KEY, value: SAVED_HISTORY },
    );
    await viewer.goto("/history");
    const items = viewer
      .getByRole("list", { name: "保存された半荘結果" })
      .getByRole("listitem");
    await expect(items).toHaveCount(1);

    await viewer.getByRole("button", { name: "戦績をすべて削除" }).click();
    await viewer.getByRole("button", { name: "削除する" }).click();

    // 「起きないこと」の確認なので固定時間だけ待つ。lock 外で削除していた頃は
    // クリック直後(数ms)に消えるため、この待機で確実に赤くなる。
    await viewer.waitForTimeout(500);
    expect(
      await viewer.evaluate((key) => localStorage.getItem(key), HISTORY_KEY),
    ).not.toBeNull();
    await expect(items).toHaveCount(1);
    await expect(
      viewer.getByText("保存された戦績はまだありません", { exact: false }),
    ).toHaveCount(0);

    // 解放すると待っていた削除が実行され、空状態へ切り替わる。
    await holder.evaluate(() => {
      const release = (
        window as unknown as { __releaseHistoryLock?: () => void }
      ).__releaseHistoryLock;
      // 解放関数が消えているのは holder が再読み込みされ lock も一緒に落ちた場合。
      // その時は上の「削除されない」判定自体が無効なので、原因が判る形で落とす。
      if (!release) throw new Error("lock を保持していたページが失われました");
      release();
    });
    await expect(
      viewer.getByText("保存された戦績はまだありません", { exact: false }),
    ).toBeVisible();
    expect(
      await viewer.evaluate((key) => localStorage.getItem(key), HISTORY_KEY),
    ).toBeNull();
  });

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
