import { describe, expect, it } from "vitest";
import { type DiceRoll, omoteDoraCount } from "./dice";

describe("omoteDoraCount", () => {
  it("通常(ゾロ目でない)の出目は表ドラ1枚 [受け入れ基準 (3,5)]", () => {
    expect(omoteDoraCount([3, 5])).toBe(1);
  });

  it("順序を入れ替えても結果は同じ (5,3)=(3,5)", () => {
    expect(omoteDoraCount([5, 3])).toBe(1);
  });

  it("ゾロ目(6以外)は表ドラ2枚 [受け入れ基準 (4,4)]", () => {
    expect(omoteDoraCount([4, 4])).toBe(2);
  });

  it("6のゾロ目のみ表ドラ3枚 [受け入れ基準 (6,6)]", () => {
    expect(omoteDoraCount([6, 6])).toBe(3);
  });

  it("全ゾロ目 (1,1)〜(5,5) は2枚、(6,6) だけ3枚", () => {
    for (let pip = 1; pip <= 5; pip++) {
      expect(omoteDoraCount([pip, pip] as DiceRoll)).toBe(2);
    }
    expect(omoteDoraCount([6, 6])).toBe(3);
  });

  it("6を含むがゾロ目でない (6,5)/(1,6) は1枚(3枚は6・6のみ)", () => {
    expect(omoteDoraCount([6, 5])).toBe(1);
    expect(omoteDoraCount([1, 6])).toBe(1);
  });

  it("2個のサイコロ全36通りが常に 1〜3 を返す", () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const count = omoteDoraCount([a, b] as DiceRoll);
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(3);
      }
    }
  });

  it("範囲外・非整数の出目は RangeError", () => {
    // ランタイム検証の確認。型では表現できない不正値を通すため unknown 経由。
    const bad = (a: number, b: number): DiceRoll =>
      [a, b] as unknown as DiceRoll;
    expect(() => omoteDoraCount(bad(0, 3))).toThrow(RangeError);
    expect(() => omoteDoraCount(bad(3, 7))).toThrow(RangeError);
    expect(() => omoteDoraCount(bad(2.5, 3))).toThrow(RangeError);
  });
});
