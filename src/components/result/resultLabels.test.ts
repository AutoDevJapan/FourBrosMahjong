import { describe, expect, it } from "vitest";
import { OKA, RETURN_POINTS } from "@/domain/scoring/settlement";
import { RAW_SCORE_LABEL, TOP_OKA_NOTE } from "./resultLabels";

describe("result labels", () => {
  it("返し点とオカを精算domainのSSOTから表示する", () => {
    expect(RAW_SCORE_LABEL).toBe(
      `素点（最終持ち点−返し${RETURN_POINTS.toLocaleString("en-US")}）`,
    );
    expect(TOP_OKA_NOTE).toBe(`1位はオカ${OKA.toLocaleString("en-US")}を含む`);
  });
});
