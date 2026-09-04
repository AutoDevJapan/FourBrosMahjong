// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GameBoard from "./GameBoard";
import { GameProvider, useGame } from "./GameProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "sessionStorage",
);

function blockSessionStorage() {
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("Storage is disabled", "SecurityError");
    },
  });
}

/** localStorageとStorage prototypeを共有するjsdomでも、sessionStorageだけを失敗させる。 */
function failSessionStorageWrites(): () => void {
  const storage = window.sessionStorage;
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      get length() {
        return storage.length;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.getItem(key),
      key: (index: number) => storage.key(index),
      removeItem: (key: string) => storage.removeItem(key),
      setItem: () => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      },
    } satisfies Storage,
  });
  return () => {
    if (originalStorageDescriptor) {
      Object.defineProperty(
        window,
        "sessionStorage",
        originalStorageDescriptor,
      );
    }
  };
}

function StorageFailureProbe() {
  const { controls, view, sessionSaveStatus } = useGame();
  const self = view.slots.self;
  if (self.kind !== "seated" || !self.player.hand?.[0]) {
    throw new Error("human discard tile is missing");
  }
  const tile = self.player.hand[0];
  return (
    <>
      <button type="button" onClick={() => controls.discard(tile)}>
        打牌
      </button>
      <button type="button" onClick={controls.newGame}>
        新規半荘
      </button>
      <output data-testid="discards">
        {self.player.discards.length.toString()}
      </output>
      <output data-testid="session-save-status">{sessionSaveStatus}</output>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStorageDescriptor) {
    Object.defineProperty(window, "sessionStorage", originalStorageDescriptor);
  }
  window.sessionStorage.clear();
});

describe("GameProvider storage failure fallback (#244)", () => {
  it("sessionStorage getterが初期化時にSecurityErrorでもメモリ内で開始する", () => {
    blockSessionStorage();

    render(
      <GameProvider>
        <StorageFailureProbe />
      </GameProvider>,
    );

    expect(screen.getByRole("button", { name: "打牌" })).toBeInTheDocument();
    expect(screen.getByTestId("session-save-status")).toHaveTextContent(
      "failed",
    );
  });

  it("新規ジャーナルのsessionStorage書き込み失敗を公開し、対局は開始する", () => {
    failSessionStorageWrites();

    render(
      <GameProvider>
        <StorageFailureProbe />
      </GameProvider>,
    );

    expect(screen.getByRole("button", { name: "打牌" })).toBeInTheDocument();
    expect(screen.getByTestId("session-save-status")).toHaveTextContent(
      "failed",
    );
    expect(window.sessionStorage.getItem("four-bros-mahjong.game.v3")).toBe(
      null,
    );
  });

  it("開始後にsessionStorageが利用不能になっても通常操作を継続する", () => {
    render(
      <GameProvider>
        <StorageFailureProbe />
      </GameProvider>,
    );
    blockSessionStorage();

    fireEvent.click(screen.getByRole("button", { name: "打牌" }));

    expect(screen.getByTestId("discards")).toHaveTextContent("1");
    expect(screen.getByTestId("session-save-status")).toHaveTextContent(
      "failed",
    );
  });

  it("開始後にsessionStorageが利用不能になっても新規半荘を開始する", () => {
    render(
      <GameProvider>
        <StorageFailureProbe />
      </GameProvider>,
    );
    blockSessionStorage();

    fireEvent.click(screen.getByRole("button", { name: "新規半荘" }));

    expect(screen.getByRole("button", { name: "打牌" })).toBeInTheDocument();
    expect(screen.getByTestId("session-save-status")).toHaveTextContent(
      "failed",
    );
  });

  it("sessionStorageが復旧した次の操作でメモリ内の最新ジャーナルを再保存する", () => {
    render(
      <GameProvider>
        <StorageFailureProbe />
      </GameProvider>,
    );
    const restoreStorage = failSessionStorageWrites();

    fireEvent.click(screen.getByRole("button", { name: "打牌" }));
    expect(screen.getByTestId("session-save-status")).toHaveTextContent(
      "failed",
    );

    restoreStorage();
    fireEvent.click(screen.getByRole("button", { name: "打牌" }));

    expect(screen.getByTestId("session-save-status")).toHaveTextContent(
      "saved",
    );
    expect(
      JSON.parse(
        window.sessionStorage.getItem("four-bros-mahjong.game.v3") ?? "null",
      ).actions,
    ).toHaveLength(2);
  });

  it("sessionStorage書き込み失敗を対局画面へ明示する", () => {
    failSessionStorageWrites();

    render(
      <GameProvider>
        <GameBoard />
      </GameProvider>,
    );

    expect(
      screen.getByText(
        "対局状態をこのタブの保存領域(sessionStorage)へ保存できませんでした。",
      ),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-session-save-status",
      "failed",
    );
  });
});
