import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  installWebSocketStub,
  type OnlineTestWindow,
  onlineFinishedSnapshotFixture,
  onlineSnapshotFixture,
} from "./helpers/onlineTest";

test.describe("オンラインロビーの参加条件", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/online");
    await expect(
      page.getByRole("heading", { level: 1, name: "オンライン対戦" }),
    ).toBeVisible();
  });

  test("disabled理由が入力欄と参加ボタンからキーボード・支援技術へ伝わる", async ({
    page,
  }) => {
    const nameInput = page.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = page.getByRole("textbox", { name: "ルームコード" });
    const joinButton = page.getByRole("button", { name: "参加する" });

    await expect(joinButton).toBeDisabled();
    await expect(nameInput).toHaveAttribute(
      "aria-describedby",
      "online-lobby-name-requirement",
    );
    await expect(roomCodeInput).toHaveAttribute(
      "aria-describedby",
      "online-lobby-room-code-requirement",
    );
    await expect(joinButton).toHaveAccessibleDescription(
      /表示名を入力してください。.*6文字のルームコードが必要です/,
    );
    await expect(page.getByRole("status")).toContainText(
      "表示名を入力してください。",
    );
    await expect(page.getByRole("status")).toContainText(
      "参加には6文字のルームコードが必要です。",
    );

    await nameInput.focus();
    await page.keyboard.press("Tab");
    await expect(roomCodeInput).toBeFocused();
  });

  test("表示名と正しい6文字コードの入力で参加ボタンが有効になる", async ({
    page,
  }) => {
    const nameInput = page.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = page.getByRole("textbox", { name: "ルームコード" });
    const joinButton = page.getByRole("button", { name: "参加する" });

    await nameInput.fill("たろう");
    await roomCodeInput.fill("ABC!@#");
    await expect(joinButton).toBeDisabled();
    await expect(roomCodeInput).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください/,
    );

    await roomCodeInput.fill("ABC23");
    await expect(joinButton).toBeDisabled();
    await expect(roomCodeInput).toHaveAccessibleDescription(
      /あと1文字入力してください/,
    );

    await roomCodeInput.fill("ABC234");
    await expect(joinButton).toBeEnabled();
    await expect(joinButton).toHaveAccessibleDescription(
      /参加条件を満たしています。参加できます。/,
    );

    await roomCodeInput.focus();
    await page.keyboard.press("Tab");
    await expect(joinButton).toBeFocused();
  });

  test("初期ロビーの入力条件にaxe違反がない", async ({ page }) => {
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("オンラインロビーの接続失敗復帰", () => {
  test("接続失敗時に再試行でき、入力を保持したまま成功状態へ遷移する", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/online");
    await installWebSocketStub(page);

    await page.getByLabel("表示名").fill("たろう");
    await page.getByLabel("ルームコード").fill("abc234");
    await page.getByRole("button", { name: "参加する" }).click();

    await expect(
      page.locator('[data-connection-status="connecting"]'),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "参加する" })).toBeDisabled();

    await page.evaluate(() => {
      (
        window as unknown as OnlineTestWindow
      ).__fourBrosOnlineSockets[0]?.fail();
    });

    await expect(
      page.locator('[data-connection-status="failed"]'),
    ).toBeVisible();
    await expect(
      page.getByText(
        "オンラインサーバーへの接続に失敗しました。再試行してください。",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("オンラインサーバーへ接続しています…"),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "再試行" })).toBeEnabled();
    await expect(page.getByLabel("表示名")).toHaveValue("たろう");
    await expect(page.getByLabel("ルームコード")).toHaveValue("ABC234");

    await page.getByRole("button", { name: "再試行" }).click();
    await expect(
      page.locator('[data-connection-status="reconnecting"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-connection-status="reconnecting"]'),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    const request = await page.evaluate(() => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[1];
      socket?.open();
      return socket?.sent[0] ?? "";
    });
    expect(JSON.parse(request)).toEqual({
      type: "join",
      code: "ABC234",
      name: "たろう",
    });

    await page.evaluate((snapshot) => {
      (
        window as unknown as OnlineTestWindow
      ).__fourBrosOnlineSockets[1]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot,
      });
    }, onlineSnapshotFixture());

    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeVisible();
    await expect(
      page.getByText("オンラインサーバーに接続しました。"),
    ).toBeVisible();
    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeFocused();
  });

  test("終局snapshotの結果を見るで最終結果を表示し、オンライン対局へ戻れる", async ({
    page,
  }) => {
    await page.goto("/online");
    await installWebSocketStub(page);

    await page.getByLabel("表示名").fill("たろう");
    await page.getByRole("button", { name: "新しいルームを作る" }).click();
    await expect(
      page.locator('[data-connection-status="connecting"]'),
    ).toBeVisible();

    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      if (!socket) throw new Error("オンラインテスト用socketがありません");
      socket.open();
      socket.message({ type: "session", token: "t".repeat(24), snapshot });
    }, onlineFinishedSnapshotFixture());

    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "結果を見る" }).click();

    await expect(
      page.getByRole("heading", { level: 2, name: "対局結果" }),
    ).toBeFocused();
    await expect(
      page.getByRole("heading", { level: 3, name: "最終順位" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "ソシー内訳(素点+ウマ+祝儀)",
      }),
    ).toBeVisible();
    const resultA11y = await new AxeBuilder({ page }).include("main").analyze();
    expect(resultA11y.violations).toEqual([]);
    await expect(
      page.getByRole("button", { name: "対局画面へ戻る" }),
    ).toBeVisible();
    await expect(page.locator('[data-phase="gameEnd"]')).toHaveCount(0);

    await page.getByRole("button", { name: "対局画面へ戻る" }).click();
    await expect(page.locator('[data-phase="gameEnd"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "結果を見る" }),
    ).toBeVisible();
  });
});
