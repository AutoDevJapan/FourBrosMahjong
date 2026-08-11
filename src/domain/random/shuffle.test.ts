import { describe, expect, it } from "vitest";
import { TOTAL_TILE_COUNT } from "../tiles/tileSet";
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
 * flaky にはならない(同じ入力から常に同じ統計量が出る)。`rng.next()` は
 * 32bit 整数を 2^32 で割った値で、`rng.next() * (i + 1)` の分子は i+1 ≤ 108 でも
 * 2^39 未満に収まり倍精度の仮数へ厳密に入るため、処理系やアーキテクチャによる
 * 丸め差も生じない。
 *
 * 一方でこれらは shuffle 単体ではなく **`shuffle` × `rng.ts` の合成**に対する検定
 * である点に注意。連続 seed の初期出力に構造が残る PRNG へ `rng.ts` を差し替えると
 * red になる(実測: xorshift32 でカバレッジ 48/120・χ² = 302 / minstd LCG で
 * 24/120・χ² = 5,066)。その場合の原因は `shuffle.ts` ではなく `rng.ts` 側にある。
 */
describe("shuffle の一様性 (#385)", () => {
  /** 一様性を見る配列長。5! = 120 通りなら全順列を現実的な試行数で網羅できる。 */
  const N = 5;
  /** N! (= 出現しうる順列の総数)。 */
  const PERMUTATION_COUNT = 120;
  /** 全順列カバレッジに使う連続 seed の本数(正しい実装は seed 532 で全網羅)。 */
  const COVERAGE_SEEDS = 5_000;
  /** χ² 適合度検定の試行数(連続 seed 0..119,999)。各順列の期待度数は 1,000。 */
  const CHI2_TRIALS = 120_000;
  /**
   * χ² の臨界値。自由度 = 順列数 − 1 = 119(期待度数は `試行数 / 120` で事前に
   * 完全指定しており標本から推定していないため df = k − 1)。
   *
   * 上側 α = 0.1% ≒ 172.5 / 下側 α = 0.1% ≒ 77.0。
   * (Wilson–Hilferty 近似。上側 α = 5% なら ≒ 145.5 で issue #385 の記載と一致。)
   */
  const CHI2_UPPER_TAIL_0_1_PERCENT_DF_119 = 172.5;
  const CHI2_LOWER_TAIL_0_1_PERCENT_DF_119 = 77.0;
  /**
   * 安全率。臨界値をそのまま使うと、正当な `rng.ts` の差し替えでも境界に近づく。
   * 代償として検出できる最小バイアスが約 2.8 倍粗くなる(順列ごとの最大偏差
   * 9% → 17% 相当)が、その帯域は下の 108×108 分割表検定が受け持つ。
   */
  const CHI2_SAFETY_FACTOR = 3;
  const CHI2_UPPER_THRESHOLD =
    CHI2_UPPER_TAIL_0_1_PERCENT_DF_119 * CHI2_SAFETY_FACTOR;
  const CHI2_LOWER_THRESHOLD =
    CHI2_LOWER_TAIL_0_1_PERCENT_DF_119 / CHI2_SAFETY_FACTOR;

  /** 不動点を数えるシャッフル回数。 */
  const FIXED_POINT_TRIALS = 2_000;
  /**
   * 許容幅(標準偏差の何倍か)。一様順列の不動点数は n ≥ 2 で平均・分散ともに
   * **厳密に 1** なので、試行数 T の総和は平均 T・σ = √T ≒ 44.7。6σ ≒ ±268。
   */
  const FIXED_POINT_SIGMA_BAND = 6;

  /**
   * 108×108 分割表(位置 × 牌)の χ² 検定のパラメータ。
   * 行和・列和がともに固定されるため自由度は (108 − 1)² = 11,449。
   */
  const CONTINGENCY_TRIALS = 10_800; // 各セルの期待度数 = 100
  const CONTINGENCY_DF = (TOTAL_TILE_COUNT - 1) ** 2;
  const CONTINGENCY_SIGMA = Math.sqrt(2 * CONTINGENCY_DF); // ≒ 151.3
  /**
   * 許容幅(標準化した χ² が平均からいくつの σ 以内か)。
   * 実測: 正しい実装 z = +0.4 に対し、この検定でしか捕まらない欠陥でも z = +33 以上。
   */
  const CONTINGENCY_SIGMA_BAND = 15;

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
      `χ² = ${chiSquare.toFixed(1)} が上側閾値 ${CHI2_UPPER_THRESHOLD} を超えた(順列の出現が一様でない)`,
    ).toBeLessThan(CHI2_UPPER_THRESHOLD);
    // 下側も見るのは「規則的すぎる」実装(順列テーブルの巡回など)を捕まえるため。
    // 真に一様なら χ² が自由度に対して極端に小さくなることは起こらない。
    expect(
      chiSquare,
      `χ² = ${chiSquare.toFixed(1)} が下側閾値 ${CHI2_LOWER_THRESHOLD.toFixed(1)} を下回った(出現が規則的すぎる)`,
    ).toBeGreaterThan(CHI2_LOWER_THRESHOLD);
  });

  it("山サイズ 108 で不動点の総数が期待値の 6σ 以内に収まる", () => {
    const source = Array.from({ length: TOTAL_TILE_COUNT }, (_, i) => i);
    let fixedPoints = 0;
    for (let seed = 0; seed < FIXED_POINT_TRIALS; seed++) {
      const shuffled = shuffle(source, createSeededRng(seed));
      for (let i = 0; i < TOTAL_TILE_COUNT; i++) {
        if (shuffled[i] === i) fixedPoints++;
      }
    }
    // 各位置が元の牌を保つ確率は 1/108、位置は 108 個なので 1 回あたり期待値 1。
    const expected = FIXED_POINT_TRIALS;
    const tolerance = FIXED_POINT_SIGMA_BAND * Math.sqrt(expected);
    expect(
      Math.abs(fixedPoints - expected),
      `不動点の総数 ${fixedPoints} が期待値 ${expected} ± ${tolerance.toFixed(0)} の外(巡回置換なら 0 になる)`,
    ).toBeLessThan(tolerance);
  });

  /**
   * 上の 3 件は n=5 の全数検定と n=108 のスカラー 1 個(不動点)しか見ていないため、
   * 「n=5 ではほぼ一様だが実サイズで偏る」実装が素通りする。実測でそうなる代表例:
   *
   * | 実装 | 順列 | χ²(n=5) | 不動点 | 108×108 の z |
   * | --- | --- | --- | --- | --- |
   * | 正しい Fisher–Yates | 120/120 | 126.0 | 1,975 | **+0.4** |
   * | `Math.floor(rng.next()*256) % (i+1)`(モジュロバイアス) | 120/120 | 111.8 | 1,828 | **+65.9** |
   * | 乱数の下位 8bit のみ使用 | 120/120 | 137.8 | 1,761 | **+65.9** |
   * | `u**1.1` の軽い傾き(i ≥ 5 のみ) | 120/120 | 126.0 | 1,832 | **+33.1** |
   *
   * いずれも上の 3 件を全通過するが、実サイズでは「ある牌が特定の位置に来る確率」が
   * 理論値から大きくずれる。山の公平性を主張するには実サイズの同時分布が要る。
   */
  it("山サイズ 108 で (位置 × 牌) の同時分布が一様(χ² 分割表・自由度 11,449)", () => {
    const source = Array.from({ length: TOTAL_TILE_COUNT }, (_, i) => i);
    // table[position * 108 + tile] = その位置にその牌が来た回数。
    const table = new Int32Array(TOTAL_TILE_COUNT * TOTAL_TILE_COUNT);
    for (let seed = 0; seed < CONTINGENCY_TRIALS; seed++) {
      const shuffled = shuffle(source, createSeededRng(seed));
      for (let position = 0; position < TOTAL_TILE_COUNT; position++) {
        table[position * TOTAL_TILE_COUNT + (shuffled[position] as number)]++;
      }
    }
    const expected = CONTINGENCY_TRIALS / TOTAL_TILE_COUNT;
    let chiSquare = 0;
    for (const observed of table) {
      chiSquare += (observed - expected) ** 2 / expected;
    }
    // χ² は自由度が大きいと平均 df・分散 2df の正規分布に近づくので、σ 単位で見る。
    const z = (chiSquare - CONTINGENCY_DF) / CONTINGENCY_SIGMA;
    expect(
      Math.abs(z),
      `χ² = ${chiSquare.toFixed(0)}(自由度 ${CONTINGENCY_DF}、z = ${z.toFixed(1)})が ±${CONTINGENCY_SIGMA_BAND}σ の外`,
    ).toBeLessThan(CONTINGENCY_SIGMA_BAND);
  });
});
