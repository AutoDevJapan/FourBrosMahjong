import { afterEach, describe, expect, it } from "vitest";
import { formatSignedSoshii } from "./soshiiFormat";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatSignedSoshii", () => {
  it("prefixes a plus and a positive screen-reader label for positive values", () => {
    const r = formatSignedSoshii(10000);
    expect(r.display).toBe("+10,000");
    expect(r.srLabel).toBe("プラス10,000ソシー");
    expect(r.isPositive).toBe(true);
  });

  it("uses a minus sign (U+2212) and a negative label for negative values", () => {
    const r = formatSignedSoshii(-5000);
    expect(r.display).toBe("−5,000");
    expect(r.display.charCodeAt(0)).toBe(0x2212); // ASCII ハイフン(U+002D)ではないことを明示検証
    expect(r.srLabel).toBe("マイナス5,000ソシー");
    expect(r.isPositive).toBe(false);
  });

  it("renders zero without a sign and is not treated as positive", () => {
    const r = formatSignedSoshii(0);
    expect(r.display).toBe("0");
    expect(r.srLabel).toBe("0ソシー");
    expect(r.isPositive).toBe(false);
  });

  it("uses a deterministic grouped fallback when localized formatting throws", () => {
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("localized number formatting unavailable");
    });

    expect(formatSignedSoshii(1_234_000)).toEqual({
      display: "+1,234,000",
      srLabel: "プラス1,234,000ソシー",
      isPositive: true,
    });
    expect(formatSignedSoshii(-5_000)).toEqual({
      display: "−5,000",
      srLabel: "マイナス5,000ソシー",
      isPositive: false,
    });
    expect(formatSignedSoshii(0)).toEqual({
      display: "0",
      srLabel: "0ソシー",
      isPositive: false,
    });
  });
});
