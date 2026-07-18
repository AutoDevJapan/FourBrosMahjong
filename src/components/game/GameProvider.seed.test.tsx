// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { freshSeed } from "./GameProvider";

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
