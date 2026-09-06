import { afterEach, describe, expect, it, vi } from "vitest";
import { formatGameInteger } from "./gameNumberFormat";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatGameInteger", () => {
  it("formats integer scores with the supported locale", () => {
    expect(formatGameInteger(35000)).toBe("35,000");
  });

  it("falls back when localized number formatting throws", () => {
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("localized number formatting is unavailable");
    });

    expect(formatGameInteger(35000)).toBe("35,000");
    expect(formatGameInteger(-1200)).toBe("-1,200");
  });
});
