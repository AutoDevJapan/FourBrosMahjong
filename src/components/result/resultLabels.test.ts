import { describe, expect, it } from "vitest";
import { OKA, RETURN_POINTS } from "@/domain/scoring/settlement";
import { formatPoints, RAW_SCORE_LABEL, TOP_OKA_NOTE } from "./resultLabels";

describe("result labels", () => {
  it("返し点とオカを精算domainのSSOTから表示する", () => {
    expect(RAW_SCORE_LABEL).toBe(
      `素点（最終持ち点−返し${RETURN_POINTS.toLocaleString("en-US")}）`,
    );
    expect(TOP_OKA_NOTE).toBe(`1位はオカ${OKA.toLocaleString("en-US")}を含む`);
  });

  it("Intl.NumberFormatがない環境でも結果ラベル用の値を整形する", () => {
    vi.stubGlobal("Intl", { ...Intl, NumberFormat: undefined });

    expect(formatPoints(RETURN_POINTS)).toBe("40,000");
    expect(formatPoints(OKA)).toBe("20,000");

    vi.unstubAllGlobals();
  });

  it("Intl.NumberFormatがthrowする環境でも結果ラベル用の値を整形する", () => {
    vi.stubGlobal("Intl", {
      ...Intl,
      NumberFormat: class {
        constructor() {
          throw new Error("Intl.NumberFormat unavailable");
        }
      },
    });

    expect(formatPoints(RETURN_POINTS)).toBe("40,000");

    vi.unstubAllGlobals();
  });

  it("Intl.NumberFormatがない環境でもラベルmoduleをimportできる", async () => {
    vi.resetModules();
    vi.stubGlobal("Intl", { ...Intl, NumberFormat: undefined });

    await expect(import("./resultLabels")).resolves.toMatchObject({
      RAW_SCORE_LABEL: "素点（最終持ち点−返し40,000）",
      TOP_OKA_NOTE: "1位はオカ20,000を含む",
    });

    vi.unstubAllGlobals();
  });
});
