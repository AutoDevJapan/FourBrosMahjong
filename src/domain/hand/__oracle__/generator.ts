/**
 * 決定的サンマ手牌ジェネレータ(テスト専用 / issue #138)。
 *
 * ⚠️ **本番コードから import しない**。クロス検証で大量の手牌を再現可能に生成する。
 * シード付き PRNG(mulberry32)で決定的。サンマの実在牌のみ・1牌種は最大4枚。
 * 5筒・5索は不変条件どおり常に赤(構造には影響しない)。
 *
 * 生成モード:
 * - {@link randomHand}: 山から k 枚を無作為抽出(向聴が深い手が多く「非和了」を厚く検証)。
 * - {@link randomStructuredHand}: 4面子1雀頭を組んでから 0〜3 枚を無作為置換
 *   (テンパイ〜低向聴の「和了に近い形」を厚く検証)。
 */

import type { Suit, Tile } from "../../tiles/tile";
import { index34ToKind, SANMA_INDICES_34 } from "./counts34";

const RED_FIVE_SUITS: ReadonlySet<Suit> = new Set(["pin", "sou"]);

/** mulberry32: 32bit シードの決定的 PRNG(0<=x<1)。 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/** 34-index → ドメイン `Tile`(5筒/5索は赤)。 */
function indexToTile(idx: number): Tile {
  const { suit, rank } = index34ToKind(idx);
  return { suit, rank, isRed: rank === 5 && RED_FIVE_SUITS.has(suit) };
}

/** 34-index カウント配列 → `Tile[]`(決定的な牌種順)。 */
function count34ToTiles(counts34: readonly number[]): Tile[] {
  const tiles: Tile[] = [];
  for (const idx of SANMA_INDICES_34) {
    for (let c = 0; c < counts34[idx]; c += 1) tiles.push(indexToTile(idx));
  }
  return tiles;
}

/** サンマの山(各牌種4枚)の 34-index 多重集合。 */
function fullWallIndices(): number[] {
  const wall: number[] = [];
  for (const idx of SANMA_INDICES_34) {
    for (let c = 0; c < 4; c += 1) wall.push(idx);
  }
  return wall;
}

/** 山から size 枚を無作為抽出(重複なし=同一牌は最大4枚)。 */
export function randomHand(rng: () => number, size: number): Tile[] {
  const wall = fullWallIndices();
  // Fisher-Yates の部分シャッフル(先頭 size 枚)。
  for (let i = 0; i < size; i += 1) {
    const j = i + randInt(rng, wall.length - i);
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall.slice(0, size).map(indexToTile);
}

/** 順子開始として妥当な 34-index(pin/sou の 1..7 始まり。サンマで萬子順子は無い)。 */
const SEQUENCE_STARTS: readonly number[] = [
  9,
  10,
  11,
  12,
  13,
  14,
  15, // 1p-7p
  18,
  19,
  20,
  21,
  22,
  23,
  24, // 1s-7s
];

/**
 * 4面子1雀頭の完成形(14枚)を 34-index カウントで組む。
 * 1牌種4枚を超えないよう配置し、失敗時は最初からやり直す(有界)。
 */
function buildCompleteCounts(rng: () => number): number[] {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const counts = new Array<number>(34).fill(0);
    let ok = true;

    // 雀頭
    {
      const idx = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
      counts[idx] += 2;
    }

    for (let m = 0; m < 4 && ok; m += 1) {
      const useSequence = rng() < 0.5;
      if (useSequence) {
        const start = SEQUENCE_STARTS[randInt(rng, SEQUENCE_STARTS.length)];
        if (
          counts[start] < 4 &&
          counts[start + 1] < 4 &&
          counts[start + 2] < 4
        ) {
          counts[start] += 1;
          counts[start + 1] += 1;
          counts[start + 2] += 1;
        } else {
          ok = false;
        }
      } else {
        const idx = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
        if (counts[idx] <= 1) counts[idx] += 3;
        else ok = false;
      }
    }

    if (ok) return counts;
  }
  // フォールバック(実際上到達しない): 決め打ちの和了形 111p 222p 333p 444p 55p。
  const fallback = new Array<number>(34).fill(0);
  fallback[9] = 3; // 111p
  fallback[10] = 3; // 222p
  fallback[11] = 3; // 333p
  fallback[12] = 3; // 444p
  fallback[13] = 2; // 55p 雀頭
  return fallback;
}

/**
 * 構造化手牌: 完成形(14枚)を組み、0〜`maxSwaps` 枚を無作為に別牌へ置換する。
 * 置換により向聴が上下し、テンパイ〜低向聴の形を厚く生成する。
 */
export function randomStructuredHand(rng: () => number, maxSwaps = 3): Tile[] {
  const counts = buildCompleteCounts(rng);
  const swaps = randInt(rng, maxSwaps + 1);
  for (let s = 0; s < swaps; s += 1) {
    // 手牌中の1枚を除いて別のサンマ牌を1枚加える(4枚超は避ける)。
    const present: number[] = [];
    for (const idx of SANMA_INDICES_34) {
      if (counts[idx] > 0) present.push(idx);
    }
    const remove = present[randInt(rng, present.length)];
    counts[remove] -= 1;
    for (let tries = 0; tries < 20; tries += 1) {
      const add = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
      if (counts[add] < 4) {
        counts[add] += 1;
        break;
      }
    }
  }
  return count34ToTiles(counts);
}
