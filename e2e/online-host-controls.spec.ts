import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import { replayJournal } from "../src/components/game/gamePersistence";
import { selectView } from "../src/components/game/gameView";
import type { OnlineSnapshot } from "../src/components/online/types";
import type { EngineState, PlayerId } from "../src/domain/game/engine";
import {
  installWebSocketStub,
  type OnlineTestWindow,
} from "./helpers/onlineTest";

function firstRoundEndGame(seed = 2024): EngineState {
  const { journal } = walkToGameEnd(seed);
  const firstNextRound = journal.actions.findIndex(
    (action) => action.type === "nextRound",
  );
  if (firstNextRound === -1) throw new Error("roundEnd を通過しない journal");
  return replayJournal({
    ...journal,
    actions: journal.actions.slice(0, firstNextRound),
  });
}

function onlineSnapshot(state: EngineState, you: PlayerId): OnlineSnapshot {
  return {
    code: "ABC234",
    version: 0,
    you,
    hostId: "p0",
    phase: state.phase,
    view: selectView(state, you),
    pending:
      state.pending && (state.pending.playerId ?? "p0") === you
        ? state.pending
        : null,
    roundSummary: state.lastRound,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: true,
      isHost: player.id === "p0",
    })),
    currentTurn: state.hand ? state.hand.seating[state.hand.turn] : null,
    hostNotice: null,
  };
}

function visibleActionPanel(page: Page) {
  return page.locator('[role="group"][aria-label="操作パネル"]:visible');
}

async function openOnlineSnapshot(
  page: Page,
  snapshot: OnlineSnapshot,
): Promise<void> {
  await page.goto("/online");
  await installWebSocketStub(page);
  await page
    .getByLabel("表示名")
    .fill(snapshot.you === "p0" ? "ホスト" : "ゲスト");
  await page.getByRole("button", { name: "新しいルームを作る" }).click();
  await expect(
    page.locator('[data-connection-status="connecting"]'),
  ).toBeVisible();

  await page.evaluate((nextSnapshot) => {
    const socket = (window as unknown as OnlineTestWindow)
      .__fourBrosOnlineSockets[0];
    if (!socket) throw new Error("オンラインテスト用socketがありません");
    socket.open();
    socket.message({
      type: "session",
      token: "t".repeat(24),
      snapshot: nextSnapshot,
    });
  }, snapshot);

  await expect(
    page.locator('[data-connection-status="connected"]'),
  ).toBeVisible();
  await expect(page.locator("[data-phase]").first()).toHaveAttribute(
    "data-phase",
    snapshot.phase,
  );
}

async function expectA11yClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations).toEqual([]);
}

test.describe("オンライン host-only 操作(#678)", () => {
  test("roundEnd のguestはホスト待ちになり、再接続中もhost-onlyボタンを表示しない", async ({
    page,
  }) => {
    await openOnlineSnapshot(page, onlineSnapshot(firstRoundEndGame(), "p1"));

    const self = page
      .locator('[data-player-role="self"]')
      .filter({ visible: true })
      .first();
    await expect(self).toHaveAccessibleName(/竜二\(あなた・/);
    await expect(self.getByText("あなた", { exact: true })).toBeVisible();

    const panel = visibleActionPanel(page);
    await expect(panel.getByRole("button", { name: "次の局へ" })).toHaveCount(
      0,
    );
    await expect(panel.getByText("ホストの操作を待っています。")).toBeVisible();
    await expectA11yClean(page);

    await page.evaluate(() => {
      const socket = (window as unknown as OnlineTestWindow)
        .__fourBrosOnlineSockets[0];
      socket?.fail();
    });
    await expect(
      page.locator('[data-connection-status="reconnecting"]'),
    ).toBeVisible();
    await expect(
      panel
        .getByText(
          "オンラインサーバーとの接続を待っています。再接続後に操作を再開できます。",
        )
        .first(),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "次の局へ" })).toHaveCount(
      0,
    );
  });

  test("roundEnd のhostには次の局へを有効表示する", async ({ page }) => {
    await openOnlineSnapshot(page, onlineSnapshot(firstRoundEndGame(), "p0"));

    await expect(
      visibleActionPanel(page).getByRole("button", { name: "次の局へ" }),
    ).toBeEnabled();
  });

  test("gameEnd のguestには結果確認だけを許可し、host-onlyボタンを出さずaxe違反もない", async ({
    page,
  }) => {
    await openOnlineSnapshot(
      page,
      onlineSnapshot(walkToGameEnd(2024).state, "p1"),
    );

    const panel = visibleActionPanel(page);
    await expect(
      panel.getByRole("button", { name: "結果を見る" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "新しい半荘を開始" }),
    ).toHaveCount(0);
    await expect(panel.getByText("ホストの操作を待っています。")).toBeVisible();
    await expectA11yClean(page);
  });

  test("gameEnd のhostには結果を見ると新しい半荘を有効表示する", async ({
    page,
  }) => {
    await openOnlineSnapshot(
      page,
      onlineSnapshot(walkToGameEnd(2024).state, "p0"),
    );

    const panel = visibleActionPanel(page);
    await expect(
      panel.getByRole("button", { name: "結果を見る" }),
    ).toBeEnabled();
    await expect(
      panel.getByRole("button", { name: "新しい半荘を開始" }),
    ).toBeEnabled();
  });
});
