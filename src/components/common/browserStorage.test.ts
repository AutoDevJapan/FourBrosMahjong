import { afterEach, describe, expect, it, vi } from "vitest";
import { localStorageOrNull } from "./browserStorage";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window",
);

function restoreWindow(): void {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
}

afterEach(restoreWindow);

describe("localStorageOrNull", () => {
  it("SSRではnullを返す", () => {
    restoreWindow();

    expect(localStorageOrNull()).toBeNull();
  });

  it("localStorageのgetterが失敗した場合はnullを返す", () => {
    const fakeWindow = {};
    Object.defineProperty(fakeWindow, "localStorage", {
      get() {
        throw new Error("storage is disabled");
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    expect(localStorageOrNull()).toBeNull();
  });

  it("読み取りメソッドが失敗した場合もnullを返す", () => {
    const getItem = vi.fn(() => {
      throw new Error("storage read is disabled");
    });
    const storage = { getItem } as unknown as Storage;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });

    expect(localStorageOrNull()).toBeNull();
    expect(getItem).toHaveBeenCalledWith("four-bros-mahjong.storage-probe");
  });

  it("読み取りプローブが成功したStorageを返し、書き込みを行わない", () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const storage = { getItem, setItem, removeItem } as unknown as Storage;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });

    expect(localStorageOrNull()).toBe(storage);
    expect(getItem).toHaveBeenCalledWith("four-bros-mahjong.storage-probe");
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
