import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { walkToGameEnd } from "../src/components/game/finishedGameFixture";
import { replayJournal } from "../src/components/game/gamePersistence";
import { selectView } from "../src/components/game/gameView";
import type { OnlineSnapshot } from "../src/components/online/types";
import type { EngineState } from "../src/domain/game/engine";
import {
  installWebSocketStub,
  type OnlineTestWindow,
} from "./helpers/onlineTest";

function roundEndState(seed = 2024): EngineState {
  const { journal } = walkToGameEnd(seed);
  const firstNextRound = journal.actions.findIndex(
    (action) => action.type === "nextRound",
  );
  if (firstNextRound === -1) throw new Error("roundEndを通過しないjournal");
  return replayJournal({
    ...journal,
    actions: journal.actions.slice(0, firstNextRound),
  });
}

function snapshotFor(
  state: EngineState,
  phase: "roundEnd" | "gameEnd",
  hostId: "p0" | "p1",
): OnlineSnapshot {
  const sourceView = selectView(state, "p1");
  const view = {
    ...sourceView,
    slots: {
      self: withOnlineName(sourceView.slots.self),
      right: withOnlineName(sourceView.slots.right),
      across: withOnlineName(sourceView.slots.across),
      left: withOnlineName(sourceView.slots.left),
    },
  };
  return {
    code: "ABC234",
    version: 1,
    you: "p1",
    hostId,
    phase,
    view,
    pending: null,
    roundSummary: state.lastRound,
    players: [
      {
        id: "p0",
        name: "ホスト",
        connected: hostId === "p0",
        isHost: hostId === "p0",
      },
      { id: "p1", name: "ゲスト", connected: true, isHost: hostId === "p1" },
    ],
    currentTurn: state.hand ? state.hand.seating[state.hand.turn] : null,
    hostNotice:
      hostId === "p1"
        ? {
            reason: "disconnected",
            message:
              "「ホスト」さん（ホスト）が切断したため、ゲストさんへホスト権限を引き継ぎました。",
            nextAction:
              phase === "roundEnd"
                ? "「次の局へ」を押して対局を続けてください。"
                : "「新しい半荘を開始」を押して次の半荘へ進めてください。",
          }
        : null,
  };
}

function withOnlineName<T extends OnlineSnapshot["view"]["slots"]["self"]>(
  slot: T,
): T {
  const name =
    slot.player.playerId === "p0"
      ? "ホスト"
      : slot.player.playerId === "p1"
        ? "ゲスト"
        : undefined;
  return name ? { ...slot, player: { ...slot.player, name } } : slot;
}

async function openOnlineSnapshot(
  page: Page,
  snapshot: OnlineSnapshot,
): Promise<void> {
  await page.goto("/online");
  await installWebSocketStub(page);
  await page.getByLabel("表示名").fill("ゲスト");
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

test.describe("online host handoff UI (#681 / #678)", () => {
  test("引継ぎ後のroundEndで次操作を案内し、host-only操作とaxe違反がない", async ({
    page,
  }) => {
    const state = roundEndState();
    await openOnlineSnapshot(page, snapshotFor(state, "roundEnd", "p1"));

    await expect(page.getByRole("button", { name: "次の局へ" })).toBeVisible();
    await expect(
      page.getByText("次の操作: 「次の局へ」を押して対局を続けてください。"),
    ).toBeVisible();
    await expect(
      new AxeBuilder({ page }).include("main").analyze(),
    ).resolves.toMatchObject({
      violations: [],
    });
  });

  test("引継ぎ前のgameEnd guestは新半荘を操作できず、host待ちの理由をaxeとともに確認する", async ({
    page,
  }) => {
    const state = walkToGameEnd(2024).state;
    await openOnlineSnapshot(page, snapshotFor(state, "gameEnd", "p0"));

    await expect(
      page.getByRole("button", { name: "結果を見る" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新しい半荘を開始" }),
    ).toHaveCount(0);
    await expect(
      new AxeBuilder({ page }).include("main").analyze(),
    ).resolves.toMatchObject({
      violations: [],
    });
  });
});
