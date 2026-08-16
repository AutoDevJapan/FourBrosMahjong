import { expect, type Page, test } from "@playwright/test";
import { selectView } from "../src/components/game/gameView";
import type { OnlineSnapshot } from "../src/components/online/types";
import { createGame } from "../src/domain/game/engine";

interface OnlineTestSocket {
  readonly sent: string[];
  fail(): void;
  open(): void;
  message(value: unknown): void;
}

interface OnlineTestWindow extends Window {
  __fourBrosOnlineSockets: OnlineTestSocket[];
}

function snapshotFixture(): OnlineSnapshot {
  const engine = createGame({ seed: 31, humanPlayerIds: ["p0"] });
  return {
    code: "ABC234",
    version: 0,
    you: "p0",
    phase: engine.phase,
    view: selectView(engine, "p0"),
    pending: engine.pending,
    roundSummary: engine.lastRound,
    players: [{ id: "p0", name: "たろう", connected: true, isHost: true }],
    currentTurn: "p0",
  };
}

async function installWebSocketStub(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Listener = (event: Event) => void;

    class TestWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;

      readonly sent: string[] = [];
      readyState = 0;
      private readonly listeners = new Map<string, Set<Listener>>();

      constructor() {
        (window as unknown as OnlineTestWindow).__fourBrosOnlineSockets.push(
          this,
        );
      }

      addEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? new Set<Listener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      send(value: string): void {
        this.sent.push(value);
      }

      close(): void {
        if (this.readyState === TestWebSocket.CLOSED) return;
        this.readyState = TestWebSocket.CLOSED;
        this.dispatch("close");
      }

      fail(): void {
        this.dispatch("error");
      }

      open(): void {
        this.readyState = TestWebSocket.OPEN;
        this.dispatch("open");
      }

      message(value: unknown): void {
        this.dispatch(
          "message",
          new MessageEvent("message", { data: JSON.stringify(value) }),
        );
      }

      private dispatch(type: string, event: Event = new Event(type)): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    const testWindow = window as unknown as OnlineTestWindow & {
      WebSocket: typeof WebSocket;
    };
    testWindow.__fourBrosOnlineSockets = [];
    testWindow.WebSocket = TestWebSocket as unknown as typeof WebSocket;
  });
}

test.describe("オンラインロビーの接続失敗復帰", () => {
  test("接続失敗時に再試行でき、入力を保持したまま成功状態へ遷移する", async ({
    page,
  }) => {
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
    }, snapshotFixture());

    await expect(
      page.locator('[data-connection-status="connected"]'),
    ).toBeVisible();
    await expect(
      page.getByText("オンラインサーバーに接続しました。"),
    ).toBeVisible();
  });
});
