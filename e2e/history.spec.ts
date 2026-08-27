import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { expectCharacterPortraits } from "./helpers/characters";

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

const CHARACTER_NAMES = ["粗悪品", "竜二", "マサキ", "糸瓜"] as const;
const RANK_ORDERS = [
  [1, 2, 3, 4],
  [3, 1, 2, 4],
  [2, 4, 1, 3],
  [4, 3, 2, 1],
  [1, 3, 4, 2],
] as const;
const RANK_VALUES = [
  { rawScore: 31_700, uma: 30_000, soshiiTotal: 61_700 },
  { rawScore: 15_600, uma: 5_000, soshiiTotal: 20_600 },
  { rawScore: -16_000, uma: -5_000, soshiiTotal: -21_000 },
  { rawScore: -51_300, uma: -10_000, soshiiTotal: -61_300 },
] as const;

function designHistory(names: readonly string[] = CHARACTER_NAMES): string {
  return JSON.stringify({
    version: 1,
    entries: RANK_ORDERS.map((ranks, entryIndex) => ({
      seed: entryIndex + 10,
      finishedAt: Date.UTC(2026, 7, 25, 14 - entryIndex, 42 - entryIndex * 3),
      players: ranks.map((rank, playerIndex) => ({
        name: names[playerIndex],
        rank,
        ...RANK_VALUES[rank - 1],
        bonus: 0,
      })),
    })),
  });
}

async function openSavedHistory(
  page: Page,
  options: { raw?: string; theme?: "light" | "dark" } = {},
): Promise<void> {
  await page.addInitScript(
    ({ raw, theme }) => {
      localStorage.setItem("four-bros-mahjong.history.v1", raw);
      if (theme) localStorage.setItem("theme", theme);
    },
    { raw: options.raw ?? designHistory(), theme: options.theme },
  );
  await page.goto("/history");
  await expect(
    page.getByRole("heading", { level: 1, name: "戦績" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "保存された半荘結果" }),
  ).toBeVisible();
}

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
          (raw) => sessionStorage.setItem("four-bros-mahjong.game.v3", raw),
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
    // クリックから解放までは上限時間(`HISTORY_LOCK_TIMEOUT_MS` = 3,000ms / #488)以内に
    // 収める必要がある ─ 超えると解放を待たずに削除が失敗し、この後の「解放すると
    // 実行される」検証が壊れる。待機を短くし、往復の多い evaluate は解放後へ回す。
    await viewer.waitForTimeout(300);
    // 待機中であることが利用者に伝わる(押しっぱなしの無反応画面にしない / #488)。
    await expect(
      viewer.getByRole("button", { name: "削除しています…" }),
    ).toHaveAttribute("aria-disabled", "true");
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
    // 上限時間で打ち切られていた場合の失敗案内が出ていないこと(= 待って実行された)。
    await expect(viewer.getByText(/削除できませんでした/)).toHaveCount(0);
  });

  test("別タブがlockを解放しなければ上限時間で削除失敗を案内する(#488)", async ({
    context,
  }) => {
    // 実ブラウザの Web Locks を保持したまま解放しない = #482 の E2E から解放だけを
    // 省いた状況。上限時間(3,000ms)が無かった頃は永久に待ち続けた。
    const holder = await context.newPage();
    await holder.goto("/");
    await holder.evaluate(
      (lock) =>
        new Promise<void>((acquired) => {
          navigator.locks.request(lock, () => {
            acquired();
            // 解放しない(このページが閉じられるまで保持し続ける)。
            return new Promise<void>(() => {});
          });
        }),
      HISTORY_LOCK,
    );

    const viewer = await context.newPage();
    await viewer.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: HISTORY_KEY, value: SAVED_HISTORY },
    );
    await viewer.goto("/history");
    await viewer.getByRole("button", { name: "戦績をすべて削除" }).click();
    await viewer.getByRole("button", { name: "削除する" }).click();

    // 上限時間経過後、原因(他タブ)を案内して操作可能な状態へ戻る。
    await expect(
      viewer.getByRole("status").filter({ hasText: "他のタブが戦績を更新中" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      viewer.getByRole("button", { name: "削除する" }),
    ).toBeVisible();
    // 排他できていないので履歴は残したまま(#482 の fail-closed)。
    expect(
      await viewer.evaluate((key) => localStorage.getItem(key), HISTORY_KEY),
    ).not.toBeNull();
  });

  test("Web Locksが使えない環境でも保存済み戦績を削除できる(#489)", async ({
    page,
  }) => {
    // 非セキュアコンテキスト(平文 http)では `navigator.locks` が存在しない。
    // 同じオリジンでは追記も必ず失敗するため、削除だけ lock 無しで実行する(ADR-0004)。
    await page.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        Reflect.deleteProperty(Navigator.prototype, "locks");
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          get: () => undefined,
        });
      },
      { key: HISTORY_KEY, value: SAVED_HISTORY },
    );
    await page.goto("/history");
    expect(await page.evaluate(() => navigator.locks)).toBeFalsy();

    await page.getByRole("button", { name: "戦績をすべて削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();

    await expect(
      page.getByText("保存された戦績はまだありません", { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), HISTORY_KEY),
    ).toBeNull();
    // 「ブラウザの設定を確認してください」という誤案内(#489)を出さない。
    await expect(page.getByText(/削除できませんでした/)).toHaveCount(0);
  });

  for (const failure of ["SecurityError", "QuotaExceededError"] as const) {
    test(`戦績保存が${failure}でも結果を表示し、保存失敗を通知する(issue #358)`, async ({
      page,
    }) => {
      await page.addInitScript(
        ({ raw, failure }) => {
          sessionStorage.setItem("four-bros-mahjong.game.v3", raw);
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
      if (failure === "SecurityError") {
        await expect(
          page.getByRole("alert", { name: /戦績を読み込めません/ }),
        ).toBeVisible();
        await expect(
          page.getByText(/保存データは削除していません/),
        ).toBeVisible();
      } else {
        await expect(
          page.getByText(/この端末のストレージが利用できる場合/),
        ).toBeVisible();
        await expect(page.getByText(/自動で記録されます/)).toBeVisible();
      }
    });
  }

  test("終局した半荘が戦績へ保存され、/history で閲覧・削除できる", async ({
    page,
  }) => {
    // 実エンジンで決定的に生成した終局済みジャーナルを注入し、終局直後のタブを再現する。
    await page.addInitScript(
      (raw) => {
        sessionStorage.setItem("four-bros-mahjong.game.v3", raw);
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
      list.getByRole("heading", {
        name: "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）",
      }),
    ).toBeVisible();
    // v1保存JSONにplayerIdを追加せず、既存のp0→p3配列順から肖像を復元する。
    await expectCharacterPortraits(list, 2);

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

  test("空状態からローカル/オンラインを選べ、狭幅でも折り返す(#611, #618)", async ({
    page,
  }) => {
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/history");
      await expect(page).toHaveURL(/\/history$/);
      await expect(
        page.getByText("保存された戦績はまだありません", { exact: false }),
      ).toBeVisible();

      // 320/360pxでもページ全体が横スクロールせず、2つの選択肢が表示される。
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await expect(
        page.getByRole("heading", { name: "ローカル対局" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "オンライン対戦" }),
      ).toBeVisible();

      const startGameLink = page.getByRole("link", { name: "対局を開始" });
      await expect(startGameLink).toHaveAttribute("href", "/game");
      await expect(startGameLink).toHaveAccessibleDescription(
        "ローカル対局をすぐに開始できます。",
      );
      await expect(
        await startGameLink.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBeGreaterThanOrEqual(44);

      const onlineLink = page.getByRole("link", { name: "オンライン対戦へ" });
      await expect(onlineLink).toHaveAttribute("href", "/online");
      await expect(onlineLink).toHaveAccessibleDescription(
        "表示名が必要です。参加する場合は6文字のルームコードも必要です。",
      );
      await expect(
        await onlineLink.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBeGreaterThanOrEqual(44);

      // 既存のローカルCTAはキーボードでそのまま開始できる(#611)。
      await startGameLink.focus();
      await expect(startGameLink).toBeFocused();
      await startGameLink.press("Enter");
      await expect(page).toHaveURL(/\/game$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "対局画面" }),
      ).toBeVisible();

      // オンラインCTAもキーボードで到達でき、接続処理はオンライン画面側へ委ねる(#618)。
      await page.goto("/history");
      await onlineLink.focus();
      await expect(onlineLink).toBeFocused();
      await onlineLink.press("Enter");
      await expect(page).toHaveURL(/\/online$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "オンライン対戦" }),
      ).toBeVisible();
    }
  });
});

test.describe("Issue #712 Phase B6 戦績デザイン", () => {
  test("320px・長い重複名でも新しい順・詳細・44px・削除focusを保つ", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await openSavedHistory(page, {
      raw: designHistory(Array(4).fill("同名の長いプレイヤー名")),
      theme: "dark",
    });

    const list = page.getByRole("list", { name: "保存された半荘結果" });
    const items = list.getByRole("listitem");
    await expect(items).toHaveCount(5);
    await expect(items.first()).toContainText("2026/08/25");
    await expect(items.first()).toContainText("同名の長いプレイヤー名");
    await expect(
      items.first().getByRole("group", { name: "四兄弟の最終順位" }),
    ).toBeVisible();

    const firstSummary = items.first().locator("summary");
    const summaryBox = await firstSummary.boundingBox();
    expect(summaryBox?.height).toBeGreaterThanOrEqual(44);
    await firstSummary.focus();
    await expect(firstSummary).toHaveCSS("outline-style", "solid");
    await expect(firstSummary).toHaveCSS("outline-width", "3px");
    await expect(firstSummary).toHaveCSS("outline-offset", "3px");
    await expect(items.first().locator("details")).toHaveCSS(
      "overflow",
      "visible",
    );
    await firstSummary.press("Enter");
    await expect(items.first().locator("details")).toHaveAttribute("open", "");
    await expect(
      items.first().getByRole("heading", {
        name: "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）",
      }),
    ).toBeVisible();
    await expect(
      items.first().getByText("素点（最終持ち点−返し40,000）"),
    ).toHaveCount(4);
    await expect(
      items.first().getByRole("region", {
        name: /1位 同名の長いプレイヤー名のソシー内訳/,
      }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("phone-320-dark-history-expanded.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.005,
      stylePath: "e2e/visual-screenshot.css",
    });

    const clearTrigger = page.getByRole("button", {
      name: "戦績をすべて削除",
    });
    await expect(clearTrigger).toBeVisible();
    expect((await clearTrigger.boundingBox())?.height).toBeGreaterThanOrEqual(
      44,
    );
    await clearTrigger.click();
    const cancel = page.getByRole("button", { name: "キャンセル" });
    await expect(cancel).toBeFocused();
    await cancel.press("Enter");
    await expect(clearTrigger).toBeFocused();

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  });

  test("forced-colorsとreduced-motionでも順位・展開・削除操作を装飾だけに依存しない", async ({
    page,
  }) => {
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await openSavedHistory(page);

    const first = page
      .getByRole("list", { name: "保存された半荘結果" })
      .getByRole("listitem")
      .first();
    await expect(
      first.getByText("1位", { exact: false }).first(),
    ).toBeVisible();
    await expect(first.locator(".history-placement-chip")).toHaveCount(4);
    await expect(first.locator(".history-entry-arrow")).toHaveCSS(
      "transition-duration",
      "0s",
    );
    expect(
      await page
        .locator(".history-panel")
        .evaluate((element) => getComputedStyle(element, "::before").display),
    ).toBe("none");
    await first.locator("summary").click();
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  });

  test("破損cleanupと読取失敗をemptyと区別し、再読込・外部保存で復帰する", async ({
    page,
  }) => {
    await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
      key: HISTORY_KEY,
      raw: '{"version":1,"entries":[{}]}',
    });
    await page.goto("/history");
    await expect(
      page.getByRole("alert", {
        name: "保存された戦績データが壊れていました",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), HISTORY_KEY),
    ).toBeNull();
    await page.getByRole("button", { name: "もう一度読み込む" }).click();
    await expect(
      page.getByText("保存された戦績はまだありません", {
        exact: false,
      }),
    ).toBeVisible();

    await page.addInitScript((key) => {
      const originalGetItem = Storage.prototype.getItem;
      (
        window as typeof window & { __historyReadBlocked?: boolean }
      ).__historyReadBlocked = true;
      Storage.prototype.getItem = function (this: Storage, storageKey: string) {
        if (
          storageKey === key &&
          (window as typeof window & { __historyReadBlocked?: boolean })
            .__historyReadBlocked
        ) {
          throw new DOMException("Storage is disabled", "SecurityError");
        }
        return originalGetItem.call(this, storageKey);
      };
    }, HISTORY_KEY);
    await page.reload();
    await expect(
      page.getByRole("alert", { name: /戦績を読み込めません/ }),
    ).toBeVisible();
    await expect(
      page.getByText("保存された戦績はまだありません", {
        exact: false,
      }),
    ).toHaveCount(0);

    await page.evaluate(
      ({ key, raw }) => {
        localStorage.setItem(key, raw);
        (
          window as typeof window & { __historyReadBlocked?: boolean }
        ).__historyReadBlocked = false;
        window.dispatchEvent(new StorageEvent("storage", { key }));
      },
      { key: HISTORY_KEY, raw: designHistory() },
    );
    await expect(
      page.getByRole("list", { name: "保存された半荘結果" }),
    ).toBeVisible();
  });

  test("展開詳細のvisual baselineを固定する", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openSavedHistory(page, { theme: "light" });
    const summary = page
      .getByRole("list", { name: "保存された半荘結果" })
      .getByRole("listitem")
      .first()
      .locator("summary");
    await summary.focus();
    await summary.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page).toHaveScreenshot(
      "tablet-768-light-history-expanded.png",
      {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        stylePath: "e2e/visual-screenshot.css",
      },
    );
  });

  test("インライン削除確認のvisual baselineを固定する", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 });
    await openSavedHistory(page, { theme: "dark" });
    const clearTrigger = page.getByRole("button", {
      name: "戦績をすべて削除",
    });
    // プログラムfocusではChromiumの`:focus-visible` heuristicがOS間で異なる。
    // 実際のTab移動でtriggerへ到達し、Enter起点のCancel ringを固定する。
    for (let step = 0; step < 20; step += 1) {
      if (
        await clearTrigger.evaluate(
          (element) => element === document.activeElement,
        )
      ) {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(clearTrigger).toBeFocused();
    await clearTrigger.press("Enter");
    const cancel = page.getByRole("button", { name: "キャンセル" });
    await expect(cancel).toBeFocused();
    await expect(cancel).toHaveCSS("outline-style", "solid");
    await expect(cancel).toHaveCSS("outline-width", "3px");
    await expect(cancel).toHaveCSS("outline-offset", "3px");
    await expect(cancel).toHaveCSS(
      "box-shadow",
      "rgb(96, 165, 250) 0px 0px 0px 3px",
    );
    // Darwin headlessのfull-page合成は`:focus`装飾を画像へ出さないため、
    // 計算済みstyleは上で固定し、実ピクセルはLinux VRTの青い3px ringで固定する。
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page).toHaveScreenshot(
      "phone-375-dark-history-clear-confirm.png",
      {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        stylePath: "e2e/visual-screenshot.css",
      },
    );
  });

  test("読取失敗のvisual baselineをlightで固定する", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript((key) => {
      localStorage.setItem("theme", "light");
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (this: Storage, storageKey: string) {
        if (storageKey === key) {
          throw new DOMException("Storage is disabled", "SecurityError");
        }
        return originalGetItem.call(this, storageKey);
      };
    }, HISTORY_KEY);
    await page.goto("/history");
    await expect(
      page.getByRole("alert", { name: /戦績を読み込めません/ }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page).toHaveScreenshot("phone-320-light-history-error.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.005,
      stylePath: "e2e/visual-screenshot.css",
    });
  });

  test("phone/tablet/desktopとlight/darkのvisual baselineを固定する", async ({
    page,
  }) => {
    const cases = [
      {
        name: "phone-320-dark-history.png",
        width: 320,
        height: 844,
        theme: "dark",
      },
      {
        name: "tablet-768-light-history.png",
        width: 768,
        height: 1024,
        theme: "light",
      },
      {
        name: "desktop-1280-dark-history.png",
        width: 1280,
        height: 900,
        theme: "dark",
      },
    ] as const;

    for (const visualCase of cases) {
      await page.setViewportSize(visualCase);
      await openSavedHistory(page, { theme: visualCase.theme });
      await page.evaluate(async () => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        visualCase.theme,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await expect(page).toHaveScreenshot(visualCase.name, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
        stylePath: "e2e/visual-screenshot.css",
      });
    }
  });
});
