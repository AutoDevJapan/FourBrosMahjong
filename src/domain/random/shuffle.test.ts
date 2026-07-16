import { describe, expect, it } from "vitest";
import { createSeededRng, type Rng } from "./rng";
import { shuffle } from "./shuffle";

describe("shuffle(Fisher–Yates, seed 注入)", () => {
  it("元配列を変更せず、新しい配列を返す", () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    const out = shuffle(input, createSeededRng(1));
    expect(input).toEqual(snapshot); // 元配列は不変
    expect(out).not.toBe(input); // 別インスタンス
  });

  it("要素の多重集合を保存する(要素の増減・改変なし)", () => {
    const input = Array.from({ length: 108 }, (_, i) => i);
    const out = shuffle(input, createSeededRng(99));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it("同じ seed からは同じ並びを返す(再現性)", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffle(input, createSeededRng(7));
    const b = shuffle(input, createSeededRng(7));
    expect(a).toEqual(b);
  });

  it("異なる seed では並びが変わる(十分な要素数で)", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const a = shuffle(input, createSeededRng(1));
    const b = shuffle(input, createSeededRng(2));
    expect(a).not.toEqual(b);
  });

  it("注入した Rng の呼び出し回数は length-1 回(Fisher–Yates)", () => {
    let calls = 0;
    const base = createSeededRng(3);
    const counting: Rng = {
      next() {
        calls += 1;
        return base.next();
      },
    };
    shuffle([10, 20, 30, 40], counting);
    expect(calls).toBe(3);
  });

  it("空配列・単一要素はそのまま返す", () => {
    expect(shuffle([], createSeededRng(1))).toEqual([]);
    expect(shuffle([42], createSeededRng(1))).toEqual([42]);
  });
});
