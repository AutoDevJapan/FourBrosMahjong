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
  };
  await page.evaluate((snapshot) => {
    const socket = (window as unknown as OnlineTestWindow)
      .__fourBrosOnlineSockets[0];
    if (!socket) throw new Error("test socket missing");
    socket.open();
    socket.message({ type: "session", token: "t".repeat(24), snapshot });
  }, first);
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
  } finally {
    await history.close();
  }
});
