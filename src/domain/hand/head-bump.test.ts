import { describe, expect, it } from "vitest";
import { type RonClaim, resolveHeadBump } from "./head-bump";

describe("resolveHeadBump(頭ハネ=上家取り / spec 2.4)", () => {
  it("同時ロンは放銃者に手番順で最も近い1人が取る", () => {
    // 放銃者=席0。席1(上家)と席2が同時ロン → 席1が勝つ。
    const claims: RonClaim<string>[] = [
      { seat: 2, claimant: "B" },
      { seat: 1, claimant: "A" },
    ];
    expect(resolveHeadBump(0, claims, 3)?.claimant).toBe("A");
  });

  it("放銃者から見た近さは環状(wrap-around)で測る", () => {
    // 放銃者=席2。席0(距離1)と席1(距離2)→ 席0 が上家。
    const claims: RonClaim<string>[] = [
      { seat: 1, claimant: "X" },
      { seat: 0, claimant: "Y" },
    ];
    expect(resolveHeadBump(2, claims, 3)?.claimant).toBe("Y");
  });

  it("放銃者自身の主張(距離0)は除外する", () => {
    const claims: RonClaim<string>[] = [{ seat: 0, claimant: "self" }];
    expect(resolveHeadBump(0, claims, 3)).toBeNull();
  });

  it("単独ロンはその者が和了する", () => {
    expect(
      resolveHeadBump(0, [{ seat: 2, claimant: "only" }], 3)?.claimant,
    ).toBe("only");
  });
});
