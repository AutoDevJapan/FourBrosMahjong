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
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}
