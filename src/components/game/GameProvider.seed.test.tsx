// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deterministicSeedEnabled,
  freshSeed,
  seedFromLocation,
} from "./GameProvider";

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
});

describe("seedFromLocation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
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
});
