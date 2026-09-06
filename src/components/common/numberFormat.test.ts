import { afterEach, describe, expect, it, vi } from "vitest";
import { formatInteger } from "./numberFormat";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatInteger", () => {
  it("formats integers with the supported Japanese locale", () => {
    expect(formatInteger(35000)).toBe("35,000");
    expect(formatInteger(-1200)).toBe("-1,200");
  });

  it("falls back to deterministic grouping when localized formatting throws", () => {
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("localized number formatting is unavailable");
    });

    expect(formatInteger(1_234_000)).toBe("1,234,000");
    expect(formatInteger(-1200)).toBe("-1,200");
  });
});
