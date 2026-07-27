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

/**
 * シャッフルの**一様性**(= 山の公平性)を固定する(#385)。
 *
 * 上の 6 テストが見ているのは「元配列不変」「多重集合保存」「同 seed 再現性」
 * 「異 seed で相違」「`rng.next()` の呼び出し回数」「空/単一要素」だけで、
 * **いずれもバイアスの有無と独立**している。そのため Fisher–Yates を明確に偏った
 * 実装(例: `* (i + 1)` → `* i` の Sattolo = 巡回置換しか生成しない)へ置き換えても
 * 全件パスしてしまう。山 108 枚の並びは配牌の公平性そのものなので、ここで
 * 「一様である」ことを主張するテストを置く。
 *
 * 全テストが**連続 seed による決定的な列挙**なので、統計検定を使っていても
 * flaky にはならない(同じ入力から常に同じ統計量が出る)。閾値はいずれも
 * 実測値との間に 1 桁以上の余裕を取ってあり、乱数源(`rng.ts`)の実装を
 * 差し替えた程度では落ちない。
 */
describe("shuffle の一様性 (#385)", () => {
  /** 一様性を見る配列長。5! = 120 通りなら全順列を現実的な試行数で網羅できる。 */
  const N = 5;
  /** N! (= 出現しうる順列の総数)。 */
  const PERMUTATION_COUNT = 120;
  /** 全順列カバレッジに使う連続 seed の本数(正しい実装は seed 532 で全網羅)。 */
  const COVERAGE_SEEDS = 5_000;
  /** χ² 適合度検定の試行数(連続 seed 0..N-1)。各順列の期待度数は 1,000。 */
  const CHI2_TRIALS = 120_000;
  /**
   * χ² の棄却限界。自由度 = 順列数 − 1 = 119、有意水準 α = 0.1% の上側臨界値
   * ≒ 172.5(Wilson–Hilferty 近似。α = 5% なら ≒ 145.5)。
   *
   * さらに安全率 3 を掛けて閾値とする。これは「乱数源の実装を差し替えた程度の
   * 揺れで落ちないこと」を優先した設定で、実測値との余裕は次のとおり:
   * 正しい実装 = 126.0(閾値の 1/4)/ 最も偏りの小さい欠陥実装でも 44,359(閾値の 86 倍)。
   */
  const CHI2_UPPER_TAIL_0_1_PERCENT_DF_119 = 172.5;
  const CHI2_SAFETY_FACTOR = 3;
  const CHI2_THRESHOLD =
    CHI2_UPPER_TAIL_0_1_PERCENT_DF_119 * CHI2_SAFETY_FACTOR;

  /** 実際の山の枚数(`buildTileSet()` が返す 108 枚)。 */
  const WALL_SIZE = 108;
  /** 不動点を数えるシャッフル回数。 */
  const FIXED_POINT_TRIALS = 2_000;
  /**
   * 許容幅(標準偏差の何倍か)。不動点の総数は近似的に平均 = 分散 = 試行数の
   * ポアソン分布に従うため σ = √試行数 ≒ 44.7。6σ ≒ ±268。
   */
  const FIXED_POINT_SIGMA_BAND = 6;

  /** 0..n-1 の全順列を文字列キーとして列挙する。 */
  function allPermutationKeys(n: number): string[] {
    const keys: string[] = [];
    const walk = (rest: number[], acc: number[]): void => {
      if (rest.length === 0) {
        keys.push(acc.join(""));
        return;
      }
      rest.forEach((value, index) => {
        walk(
          [...rest.slice(0, index), ...rest.slice(index + 1)],
          [...acc, value],
        );
      });
    };
    walk(
      Array.from({ length: n }, (_, i) => i),
      [],
    );
    return keys;
  }

  /** 連続 seed で `N` 要素をシャッフルし、順列キーごとの出現数を数える。 */
  function permutationCounts(trials: number): Map<string, number> {
    const source = Array.from({ length: N }, (_, i) => i);
    const counts = new Map<string, number>();
    for (let seed = 0; seed < trials; seed++) {
      const key = shuffle(source, createSeededRng(seed)).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  it("全 120 通りの順列が出現する(巡回置換しか作らない実装を排除)", () => {
    const counts = permutationCounts(COVERAGE_SEEDS);
    expect(counts.size).toBe(PERMUTATION_COUNT);
  });

  it("順列の出現分布が一様(χ² 適合度検定・自由度 119)", () => {
    const counts = permutationCounts(CHI2_TRIALS);
    const expected = CHI2_TRIALS / PERMUTATION_COUNT;
    let chiSquare = 0;
    for (const key of allPermutationKeys(N)) {
      const observed = counts.get(key) ?? 0;
      chiSquare += (observed - expected) ** 2 / expected;
    }
    expect(
      chiSquare,
      `χ² = ${chiSquare.toFixed(1)} が閾値 ${CHI2_THRESHOLD} を超えた(順列の出現が一様でない)`,
    ).toBeLessThan(CHI2_THRESHOLD);
  });

  it("山サイズ 108 で牌が元の位置に留まる割合が 1/108 の近傍にある", () => {
    const source = Array.from({ length: WALL_SIZE }, (_, i) => i);
    let fixedPoints = 0;
    for (let seed = 0; seed < FIXED_POINT_TRIALS; seed++) {
      const shuffled = shuffle(source, createSeededRng(seed));
      for (let i = 0; i < WALL_SIZE; i++) {
        if (shuffled[i] === i) fixedPoints++;
      }
    }
    // 各位置が元の牌を保つ確率は 1/108、位置は 108 個なので 1 回あたり期待値 1。
    const expected = FIXED_POINT_TRIALS;
    const tolerance = FIXED_POINT_SIGMA_BAND * Math.sqrt(expected);
    expect(
      fixedPoints,
      `不動点の総数 ${fixedPoints} が期待値 ${expected} ± ${tolerance.toFixed(0)} の外(巡回置換なら 0 になる)`,
    ).toBeGreaterThan(expected - tolerance);
    expect(fixedPoints).toBeLessThan(expected + tolerance);
  });
});
