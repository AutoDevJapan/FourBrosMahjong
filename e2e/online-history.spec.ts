import { expect, test } from "@playwright/test";
import {
  installWebSocketStub,
  type OnlineTestWindow,
  onlineFinishedSnapshotFixture,
  onlineSnapshotFixture,
} from "./helpers/onlineTest";

test("オンライン終局を旧戦績と保存し、再接続・次の半荘・別タブ・再読込・全件削除を区別する", async ({
  page,
}) => {
  await page.goto("/online");
  await installWebSocketStub(page);
  const legacy = JSON.stringify({
    version: 1,
    entries: [
      {
        seed: 123,
        finishedAt: 100,
        players: [1, 2, 3, 4].map((rank) => ({
          name: `旧対局者${rank}`,
          rank,
          rawScore: 0,
          uma: 0,
          bonus: 0,
          soshiiTotal: 0,
        })),
      },
    ],
  });
  await page.evaluate(
    (raw) => localStorage.setItem("four-bros-mahjong.history.v1", raw),
    legacy,
  );
  await page.getByLabel("表示名").fill("保存テスト");
  await page.getByRole("button", { name: "新しいルームを作る" }).click();
  const first = {
    ...onlineFinishedSnapshotFixture(),
    matchId: `${"a".repeat(32)}:1`,
    // A final engine snapshot can retain the last turn owner.
    currentTurn: "p0" as const,
  };
  await page.evaluate((snapshot) => {
    const host = window as unknown as OnlineTestWindow & {
      __restoreHistoryStorage?: () => void;
    };
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    host.__restoreHistoryStorage = () => {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
      else Reflect.deleteProperty(window, "localStorage");
      delete host.__restoreHistoryStorage;
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("temporarily unavailable", "SecurityError");
      },
    });
    const socket = host.__fourBrosOnlineSockets[0];
    if (!socket) throw new Error("test socket missing");
    socket.open();
    socket.message({ type: "session", token: "t".repeat(24), snapshot });
  }, first);
  const warning = page.getByText(/この端末に今回の戦績を保存できませんでした/);
  await expect(warning).toBeVisible();
  const progress = page
    .getByRole("group", { name: "参加者", exact: true })
    .locator("..");
  await expect(progress).toContainText("対局終了");
  await expect(progress).not.toContainText("の手番");
  await page.evaluate(() => {
    (
      window as unknown as { __restoreHistoryStorage?: () => void }
    ).__restoreHistoryStorage?.();
    window.dispatchEvent(new Event("focus"));
  });
  const records = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("four-bros-mahjong.history.v2");
      return raw === null
        ? []
        : (JSON.parse(raw).entries as {
            onlineMatchId?: string;
            finishedAt: number;
          }[]);
    });
  await expect.poll(async () => (await records()).length).toBe(2);
  await expect(warning).not.toBeVisible();
  const firstDate = (await records())[0].finishedAt;
  const history = await page.context().newPage();
  try {
    await history.goto("/history");
    const rows = history
      .getByRole("list", { name: "保存された半荘結果" })
      .locator(":scope > li");
    await expect(rows).toHaveCount(2);
    await page.evaluate(
      (snapshot) => {
        (
          window as unknown as OnlineTestWindow
        ).__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      { ...first, version: 2 },
    );
    await page.getByRole("button", { name: "結果を見る" }).click();
    await expect(warning).not.toBeVisible();
    await page.getByRole("button", { name: "新しい半荘を開始" }).click();
    await page.evaluate(
      (snapshot) => {
        (
          window as unknown as OnlineTestWindow
        ).__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      {
        ...onlineSnapshotFixture(),
        matchId: `${"a".repeat(32)}:2`,
        version: 3,
      },
    );
    await expect(page.locator('[data-phase="playing"]')).toBeVisible();
    await page.evaluate(
      (snapshot) => {
        (
          window as unknown as OnlineTestWindow
        ).__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      { ...first, matchId: `${"a".repeat(32)}:2`, version: 4 },
    );
    await expect(page.locator('[data-phase="gameEnd"]')).toBeVisible();
    await expect.poll(async () => (await records()).length).toBe(3);
    // The second browser tab updates via the real storage event without reload.
    await expect(rows).toHaveCount(3);
    const entries = await records();
    expect(
      entries.filter((entry) => entry.onlineMatchId === first.matchId),
    ).toEqual([{ ...entries[1], finishedAt: firstDate }]);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("four-bros-mahjong.history.v1"),
      ),
    ).toBe(legacy);
    await history.reload();
    await expect(rows).toHaveCount(3);
    await history.getByRole("button", { name: "戦績をすべて削除" }).click();
    await history.getByRole("button", { name: "削除する" }).click();
    await expect(
      history.getByText("保存されていた戦績をすべて削除しました。"),
    ).toBeVisible();
    await page.evaluate(
      (snapshot) => {
        (
          window as unknown as OnlineTestWindow
        ).__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      {
        ...first,
        matchId: `${"a".repeat(32)}:2`,
        version: 5,
        hostNotice: {
          reason: "disconnected" as const,
          message: "保存確認用の再接続通知",
          nextAction: "この半荘の結果を確認できます。",
        },
      },
    );
    await expect(page.getByText("保存確認用の再接続通知")).toBeVisible();
    await page.evaluate(
      (snapshot) => {
        (
          window as unknown as OnlineTestWindow
        ).__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      {
        ...onlineSnapshotFixture(),
        matchId: `${"a".repeat(32)}:3`,
        version: 6,
      },
    );
    await expect(page.locator('[data-phase="playing"]')).toBeVisible();
    await page.evaluate(
      (snapshot) => {
        (
          window as unknown as OnlineTestWindow
        ).__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      { ...first, matchId: `${"a".repeat(32)}:3`, version: 7 },
    );
    await expect
      .poll(async () => (await records()).map((entry) => entry.onlineMatchId))
      .toEqual([`${"a".repeat(32)}:3`]);
    await expect(rows).toHaveCount(1);
    await history.getByRole("button", { name: "戦績をすべて削除" }).click();
    await history.getByRole("button", { name: "削除する" }).click();
    await expect(
      history.getByText("保存されていた戦績をすべて削除しました。"),
    ).toBeVisible();
    await history.reload();
    await expect(
      history.getByText(/保存された戦績はまだありません/),
    ).toBeVisible();
    expect(
      await history.evaluate(() => [
        localStorage.getItem("four-bros-mahjong.history.v1"),
        localStorage.getItem("four-bros-mahjong.history.v2"),
      ]),
    ).toEqual([null, null]);
    await page.evaluate(
      (snapshot) => {
        const host = window as unknown as OnlineTestWindow & {
          __restoreHistoryStorage?: () => void;
        };
        const descriptor = Object.getOwnPropertyDescriptor(
          window,
          "localStorage",
        );
        host.__restoreHistoryStorage = () => {
          if (descriptor)
            Object.defineProperty(window, "localStorage", descriptor);
          else Reflect.deleteProperty(window, "localStorage");
        };
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new DOMException("temporarily unavailable", "SecurityError");
          },
        });
        host.__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      {
        ...onlineSnapshotFixture(),
        matchId: `${"a".repeat(32)}:4`,
        version: 8,
      },
    );
    await expect(page.locator('[data-phase="playing"]')).toBeVisible();
    await page.evaluate(
      (snapshot) => {
        (
          window as unknown as OnlineTestWindow
        ).__fourBrosOnlineSockets[0].message({ type: "snapshot", snapshot });
      },
      { ...first, matchId: `${"a".repeat(32)}:4`, version: 9 },
    );
    await expect(
      page.getByText(/この端末に今回の戦績を保存できませんでした/),
    ).toBeVisible();
    const pendingBefore = await page.evaluate(() =>
      JSON.parse(
        sessionStorage.getItem("four-bros-mahjong.history-online-pending.v2") ??
          "null",
      ),
    );
    expect(pendingBefore.entries).toHaveLength(1);
    expect(pendingBefore.entries[0].historyEpoch).toBeNull();
    await page.evaluate(async () => {
      (
        window as unknown as { __restoreHistoryStorage?: () => void }
      ).__restoreHistoryStorage?.();
      window.dispatchEvent(new Event("focus"));
      await navigator.locks.request(
        "four-bros-mahjong.history.write.v1",
        () => undefined,
      );
    });
    expect(await records()).toEqual([]);
    expect(
      await page.evaluate(() =>
        JSON.parse(
          sessionStorage.getItem(
            "four-bros-mahjong.history-online-pending.v2",
          ) ?? "null",
        ),
      ),
    ).toEqual(pendingBefore);
  } finally {
    await page.evaluate(() => {
      (
        window as unknown as { __restoreHistoryStorage?: () => void }
      ).__restoreHistoryStorage?.();
    });
    await history.close();
  }
});
