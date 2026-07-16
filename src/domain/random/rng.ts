/**
 * 決定的擬似乱数生成器(seed 注入可能)。
 *
 * ゲームのシャッフルはテストで再現可能である必要があるため、`Math.random` を
 * 直接使わず、この `Rng` を注入する設計にする(issue #63「seed 注入可能」)。
 * 純ロジック・副作用なし。
 */

/** [0, 1) の一様乱数を返す最小インターフェース。`Math.random` 互換。 */
export interface Rng {
  /** 次の乱数([0, 1))を返す。 */
  next(): number;
}

/**
 * seed から決定的な `Rng` を生成する(mulberry32)。
 *
 * 同じ seed からは常に同じ数列が得られるため、テストで固定 seed を渡せば
 * シャッフル・配牌の結果が完全に再現できる。
 *
 * @param seed 32bit 符号なし整数として扱う任意の整数。
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
