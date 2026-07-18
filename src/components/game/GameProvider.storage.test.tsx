// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameProvider, useGame } from "./GameProvider";

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

function StorageFailureProbe() {
  const { controls, view } = useGame();
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
    </>
  );
}

afterEach(() => {
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
  });
});
