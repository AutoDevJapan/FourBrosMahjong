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

  test("生成されないI/O/0/1を参加前に具体的に拒否する", async ({ page }) => {
    await installWebSocketStub(page);
    const nameInput = page.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = page.getByRole("textbox", { name: "ルームコード" });
    const joinButton = page.getByRole("button", { name: "参加する" });

    await nameInput.fill("たろう");
    await roomCodeInput.fill("abci01");
    await expect(roomCodeInput).toHaveValue("ABCI01");
    await expect(joinButton).toBeDisabled();
    await expect(roomCodeInput).toHaveAccessibleDescription(/I\/O\/0\/1/);
    await roomCodeInput.press("Enter");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as OnlineTestWindow).__fourBrosOnlineSockets
            .length,
      ),
    ).toBe(0);
  });

  test("初期ロビーの入力条件にaxe違反がない", async ({ page }) => {
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("オンラインロビーのfocus lifecycle (#682)", () => {
  test("session接続成功と退出で見出しへfocusし、狭幅でもaxe違反がない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/online");
    await installWebSocketStub(page);

    await page.getByLabel("表示名").fill("たろう");
    const createButton = page.getByRole("button", {
      name: "新しいルームを作る",
    });
    await createButton.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator('[data-connection-status="connecting"]'),
    ).toBeVisible();

    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      socket?.open();
      socket?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot,
      });
    }, onlineSnapshotFixture());

    const gameHeading = page.getByRole("heading", {
      level: 1,
      name: "オンライン対戦",
    });
    await expect(gameHeading).toBeFocused();
    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);

    const leaveButton = page.getByRole("button", { name: "退出" });
    await leaveButton.focus();
    await page.keyboard.press("Enter");

    const lobbyHeading = page.getByRole("heading", {
      level: 1,
      name: "オンライン対戦",
    });
    await expect(lobbyHeading).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("表示名")).toBeFocused();
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
  });

  test("自動再接続成功で接続状態へfocusし、axe違反を増やさない", async ({
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
      socket?.open();
      socket?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot,
      });
    }, onlineSnapshotFixture());
    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeVisible();

    await page.evaluate(() => {
      (
        window as unknown as OnlineTestWindow
      ).__fourBrosOnlineSockets[0]?.fail();
    });
    await expect(
      page.locator('[data-connection-status="reconnecting"]'),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as OnlineTestWindow).__fourBrosOnlineSockets
              .length,
        ),
      )
      .toBe(2);

    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[1];
      socket?.open();
      socket?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot,
      });
    }, onlineSnapshotFixture());

    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeFocused();
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
  });
});

test.describe("オンラインメンテナンス client-first (#726)", () => {
  test("320pxでも現在局を保持し、新規操作と再接続を止めてlive案内する", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/online");
    await page.clock.install();
    await installWebSocketStub(page);
    await page.getByLabel("表示名").fill("たろう");
    await page.getByRole("button", { name: "新しいルームを作る" }).click();

    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      socket?.open();
      socket?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot,
      });
      socket?.message({
        type: "maintenance",
        phase: "draining",
        deadline: "2026-08-28T06:00:00.000Z",
      });
    }, onlineSnapshotFixture());

    const banner = page.locator("#online-maintenance-notice");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "status");
    await expect(banner).toHaveAttribute("aria-live", "polite");
    await expect(banner).toHaveAttribute("aria-atomic", "true");
    await expect(banner).toContainText("現在の半荘はそのまま続けられます");
    const firstTile = page.getByRole("option").first();
    await expect(firstTile).toBeEnabled();
    await firstTile.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as OnlineTestWindow
          ).__fourBrosOnlineSockets[0]?.sent
            .map((value) => JSON.parse(value))
            .find((message) => message.type === "action"),
        ),
      )
      .toMatchObject({ type: "action", action: { type: "discard" } });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);

    await page.evaluate(() => {
      (
        window as unknown as OnlineTestWindow
      ).__fourBrosOnlineSockets[0]?.serverClose(1012, "service restart");
    });
    await page.clock.fastForward(60_000);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as OnlineTestWindow).__fourBrosOnlineSockets
            .length,
      ),
    ).toBe(1);
    await expect(page.getByRole("group", { name: "対局盤面" })).toBeVisible();
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
    const retryButton = page.getByRole("button", { name: "再試行" });
    await expect(retryButton).toBeEnabled();
    await expect(retryButton).toBeFocused();
    expect(
      await page.evaluate(() => ({
        tagName: document.activeElement?.tagName,
        text: document.activeElement?.textContent?.trim(),
      })),
    ).toEqual({ tagName: "BUTTON", text: "再試行" });
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
    await expect(page.getByLabel("表示名")).toHaveValue("たろう");
    await expect(page.getByLabel("ルームコード")).toHaveValue("ABC234");

    await page.keyboard.press("Enter");
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
      explicitKita: true,
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
    expect(
      await page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.dataset
            .connectionStatus,
      ),
    ).toBe("connected");
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
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
        name: "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）",
      }),
    ).toBeVisible();
    const resultA11y = await new AxeBuilder({ page }).include("main").analyze();
    expect(resultA11y.violations).toEqual([]);
    await expect(
      page.getByRole("button", { name: "新しい半荘を開始" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "対局画面へ戻る" }),
    ).toBeVisible();
    await expect(page.locator('[data-phase="gameEnd"]')).toHaveCount(0);

    await page.getByRole("button", { name: "対局画面へ戻る" }).click();
    await expect(page.locator('[data-phase="gameEnd"]')).toBeVisible();
    const resultButton = page.getByRole("button", { name: "結果を見る" });
    await expect(resultButton).toBeFocused();
    const boardA11y = await new AxeBuilder({ page }).include("main").analyze();
    expect(boardA11y.violations).toEqual([]);

    await resultButton.click();
    await page.getByRole("button", { name: "新しい半荘を開始" }).click();
    const newGameRequest = await page.evaluate(() => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      return JSON.parse(socket?.sent.at(-1) ?? "{}");
    });
    expect(newGameRequest).toEqual({ type: "newGame" });

    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      socket?.message({ type: "snapshot", snapshot });
    }, onlineSnapshotFixture());
    await expect(page.locator('[data-phase="playing"]')).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "対局結果" }),
    ).toHaveCount(0);
    await expect(
      page.locator('section[aria-label="オンライン対局"]'),
    ).toBeFocused();

    // 終局snapshotを受けても、結果ビューは「結果を見る」まで再表示しない。
    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      socket?.message({ type: "snapshot", snapshot });
    }, onlineFinishedSnapshotFixture());
    await expect(
      page.getByRole("heading", { level: 2, name: "対局結果" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "結果を見る" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "対局結果" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "対局画面へ戻る" }).click();
    await expect(resultButton).toBeFocused();
  });

  test("拒否後の最新snapshotと次の成功操作で古い操作エラーを再通知しない", async ({
    page,
  }) => {
    await page.goto("/online");
    await installWebSocketStub(page);

    await page.getByLabel("表示名").fill("たろう");
    await page.getByRole("button", { name: "新しいルームを作る" }).click();
    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      if (!socket) throw new Error("オンラインテスト用socketがありません");
      socket.open();
      socket.message({ type: "session", token: "t".repeat(24), snapshot });
    }, onlineSnapshotFixture());

    const firstTile = page.getByRole("option").first();
    await firstTile.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const socket = (window as unknown as OnlineTestWindow)
            .__fourBrosOnlineSockets[0];
          return JSON.parse(socket?.sent.at(-1) ?? "{}").type;
        }),
      )
      .toBe("action");

    const staleMessage = "対局状態が更新されています。最新状態を受信しました。";
    await page.evaluate((message) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      socket?.message({ type: "error", message });
    }, staleMessage);
    await expect(page.getByText(staleMessage)).toHaveCount(1);

    await page.evaluate((snapshot) => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      socket?.message({ type: "snapshot", snapshot });
    }, onlineSnapshotFixture());
    await expect(page.getByText(staleMessage)).toHaveCount(0);

    // The next correct operation delivers a newer authoritative snapshot;
    // the previous rejection must not be re-announced.
    await firstTile.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const socket = (window as unknown as OnlineTestWindow)
            .__fourBrosOnlineSockets[0];
          return JSON.parse(socket?.sent.at(-1) ?? "{}").type;
        }),
      )
      .toBe("action");
    await page.evaluate(
      ({ message, snapshot }) => {
        const socket = (window as unknown as OnlineTestWindow)
          .__fourBrosOnlineSockets[0];
        socket?.message({ type: "error", message });
        socket?.message({ type: "snapshot", snapshot });
      },
      {
        message: staleMessage,
        snapshot: { ...onlineSnapshotFixture(), version: 2 },
      },
    );
    await expect(page.getByText(staleMessage)).toHaveCount(0);
    await expect(
      page.locator('[data-connection-status="connected"] [aria-live="polite"]'),
    ).toHaveCount(1);
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
  });

  test("guestは結果ビューから戻っても新局CTAを有効表示/送信せず、結果導線のaxeも清潔", async ({
    page,
  }) => {
    await page.goto("/online");
    await installWebSocketStub(page);

    await page.getByLabel("表示名").fill("じろう");
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
    }, onlineFinishedSnapshotFixture("p1"));

    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "結果を見る" }).click();

    await expect(
      page.getByRole("heading", { level: 2, name: "対局結果" }),
    ).toBeFocused();
    const resultNewGameButton = page.getByRole("button", {
      name: "新しい半荘を開始",
    });
    await expect(resultNewGameButton).toBeDisabled();
    await expect(resultNewGameButton).toHaveAccessibleDescription(
      "新しい半荘を開始できるのはホストだけです。",
    );
    await expect(
      page.getByRole("button", { name: "対局画面へ戻る" }),
    ).toBeVisible();
    const resultA11y = await new AxeBuilder({ page }).include("main").analyze();
    expect(resultA11y.violations).toEqual([]);

    await page.getByRole("button", { name: "対局画面へ戻る" }).click();
    await expect(page.locator('[data-phase="gameEnd"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新しい半荘を開始" }),
    ).toHaveCount(0);
    await expect(
      page
        .locator('[role="group"][aria-label="操作パネル"]:visible')
        .getByText("ホストの操作を待っています。"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "結果を見る" }),
    ).toBeFocused();
    const boardA11y = await new AxeBuilder({ page }).include("main").analyze();
    expect(boardA11y.violations).toEqual([]);

    const newGameRequests = await page.evaluate(() => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      return (socket?.sent ?? [])
        .map((message) => JSON.parse(message) as { type?: string })
        .filter((message) => message.type === "newGame");
    });
    expect(newGameRequests).toEqual([]);
  });
});
