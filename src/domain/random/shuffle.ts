/**
 * 注入された `Rng` を使う決定的シャッフル(Fisher–Yates)。
 *
 * 乱数源を引数で受け取ることで、テストは固定 seed の `Rng` を渡して
 * 結果を再現できる(`Math.random` 直呼びを避ける / issue #63)。
 * 入力は変更せず新しい配列を返す(副作用なし)。
 */

import type { Rng } from "./rng";

/**
 * `items` をシャッフルした**新しい配列**を返す(元配列は不変)。
 *
 * @param items シャッフル対象(読み取り専用)。
 * @param rng   乱数源。同じ入力・同じ `Rng` の状態からは常に同じ並びを返す。
 * @throws RangeError `rng.next()` が有限な `[0, 1)` の値を返さないとき。
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const sample = rng.next();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      // A malformed injected RNG must not turn into a sparse/corrupt result
      // through an out-of-range array index. Failing before the swap keeps the
      // wall-construction boundary explicit and preserves Fisher–Yates' range
      // invariant.
      throw new RangeError("rng.next() must return a finite number in [0, 1).");
    }
    const j = Math.floor(sample * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}
