// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NAMES } from "@/domain/game/engine";
import { saveJournal } from "@/domain/game/gamePersistence";
import {
  deterministicSeedEnabled,
  freshSeed,
  GameProvider,
  SecureRandomUnavailableError,
  seedFromLocation,
  useGame,
} from "./GameProvider";

function NewGameSeedProbe() {
  const { controls, seedGenerationError } = useGame();
  return (
    <>
      <button type="button" onClick={controls.newGame}>
        新しい半荘
      </button>
      <output data-testid="seed-generation-error">
        {seedGenerationError ? "failed" : "ready"}
      </output>
    </>
  );
}

describe("deterministicSeedEnabled", () => {
  it("developmentではE2Eフラグなしでも決定的seedを許可する", () => {
    expect(deterministicSeedEnabled("development", undefined)).toBe(true);
  });

  it("productionでは明示したE2E buildだけ決定的seedを許可する", () => {
    expect(deterministicSeedEnabled("production", undefined)).toBe(false);
    expect(deterministicSeedEnabled("production", "0")).toBe(false);
    expect(deterministicSeedEnabled("production", "1")).toBe(true);
  });
});

describe("freshSeed", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Web Crypto の uint32 を時刻に依存せず seed として返す", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(123_456_789);
    const getRandomValues = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((array) => {
        (array as Uint32Array)[0] = 0xfedcba98;
        return array;
      });

    expect(freshSeed()).toBe(0xfedcba98);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint32Array);
    expect(now).not.toHaveBeenCalled();
  });

  it("uint32 の境界値 0 と 2^32-1 を保持する", () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");
    for (const expected of [0, 0xffffffff]) {
      getRandomValues.mockImplementationOnce((array) => {
        (array as Uint32Array)[0] = expected;
        return array;
      });
      expect(freshSeed()).toBe(expected);
    }
  });

  it("Web Crypto の getter/method 失敗を固定エラーへ変換し、予測可能なseedを作らない", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto",
    );

    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        get() {
          throw new Error("crypto capability is unreadable");
        },
      });
      expect(() => freshSeed()).toThrow(SecureRandomUnavailableError);

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {
          getRandomValues() {
            throw new Error("random source is unavailable");
          },
        },
      });
      expect(() => freshSeed()).toThrow(SecureRandomUnavailableError);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      }
    }
  });
});

describe("GameProvider secure seed failure (#1046)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("初期seedを作れない場合は未処理例外ではなく再試行とロビー復帰を表示する", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto",
    );
    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {},
      });

      expect(() => render(<GameProvider>{null}</GameProvider>)).not.toThrow();
      expect(
        screen.getByRole("heading", { name: "対局を開始できません" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "再試行" })).toBeVisible();
      expect(
        screen.getByRole("link", { name: "ロビーへ戻る" }),
      ).toHaveAttribute("href", "/");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      }
    }
  });

  it("新しい半荘のseedを作れない場合も現在のproviderを保持して状態を通知する", () => {
    render(
      <GameProvider>
        <NewGameSeedProbe />
      </GameProvider>,
    );
    const random = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation(() => {
        throw new Error("random source is unavailable");
      });

    fireEvent.click(screen.getByRole("button", { name: "新しい半荘" }));

    expect(random).toHaveBeenCalledOnce();
    expect(screen.getByTestId("seed-generation-error")).toHaveTextContent(
      "failed",
    );
  });
});

describe("seedFromLocation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("uint32範囲内のURL seedだけを受け入れる", () => {
    window.history.replaceState(null, "", "/game?seed=0");
    expect(seedFromLocation()).toBe(0);

    window.history.replaceState(null, "", "/game?seed=4294967295");
    expect(seedFromLocation()).toBe(0xffffffff);
  });

  it.each(["-1", "4294967296", "1.5", "9007199254740991"])(
    "uint32範囲外のURL seed %s は既定の乱数へフォールバックする",
    (raw) => {
      window.history.replaceState(null, "", `/game?seed=${raw}`);
      expect(seedFromLocation()).toBeNull();
    },
  );

  it("不正なseedクエリは既存ジャーナルを復元せず、新しい乱数へフォールバックする", () => {
    window.history.replaceState(null, "", "/game?seed=1.5");
    saveJournal(window.sessionStorage, {
      version: 3,
      seed: 7,
      names: DEFAULT_NAMES,
      explicitKita: true,
      actions: [],
    });
    const getRandomValues = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((array) => {
        (array as Uint32Array)[0] = 42;
        return array;
      });

    expect(() => {
      // `initialSession` は GameProvider の state lazy initializer で評価される。
      // 子要素は不要だが、React経由で実際の復元境界を通す。
      const { unmount } = render(<GameProvider>{null}</GameProvider>);
      unmount();
    }).not.toThrow();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        window.sessionStorage.getItem("four-bros-mahjong.game.v3") ?? "null",
      ),
    ).toMatchObject({ seed: 42, actions: [] });
  });
});
