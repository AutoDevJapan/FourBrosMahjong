import { describe, expect, it } from "vitest";
import { createSeededRng } from "./rng";

describe("createSeededRng(決定的 PRNG)", () => {
  it("同じ seed からは同じ数列を返す(再現性)", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("異なる seed からは異なる数列になる", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("出力は常に [0, 1) の範囲に収まる", () => {
    const rng = createSeededRng(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("負の seed も 32bit 符号なしとして安定に扱う", () => {
    const a = createSeededRng(-7);
    const b = createSeededRng(-7);
    expect(a.next()).toBe(b.next());
  });
});
