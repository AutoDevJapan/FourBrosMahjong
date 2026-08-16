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
 * - {@link randomAmbiguousMenzenHand}: 多重分解が**構造的に保証された**門前14枚
 *   (刻子 ⇔ 順子の読み替えを確実に踏む / issue #429)。
 * - {@link randomMeldedHand}: 副露(ポン/明槓/暗槓)1〜4 組 + 対応枚数の門前手
 *   (副露経路の分解・待ちを検証する / issue #390)。
 */

import type { Suit, Tile } from "../../tiles/tile";
import { index34ToKind, SANMA_INDICES_34 } from "./counts34";

/**
 * 赤5となるスート(オール赤5: 5筒・5索)。
 *
 * ⚠️ **本番の {@link "../../tiles/tile".createTile} との重複は意図的**(issue #375)。
 * 本ディレクトリは「本番コードへ依存しない独立オラクル」であることが検証価値の源泉
 * (→ `counts34.ts` 冒頭の方針)であり、本番ファクトリへ寄せると本番の赤5判定が壊れた
 * ときにオラクル側も同時に壊れてクロス検証が空振りする。そのため本番へは寄せず、
 * ここで独立に定義する。なお赤フラグは手牌の「構造」に影響しないため、この重複が
 * クロス検証の結果を左右することはない。
 */
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

/**
 * 牌の置き場所(1枚 / 雀頭2枚)を乱択で探す試行回数の上限。乱択が空振りし続けた場合に
 * 打ち切るためのもので、実際にはまず打ち切りに達しない。
 *
 * **規約**: この定数でループを打ち切る側は、打ち切り時に**呼び出し前の状態へ戻す**こと
 * (枚数を減らしたまま抜けない)。戻さないと生成手が規定枚数に満たなくなり、
 * クロス検証側は「照合対象が1手減った」ことに気づけないまま緑で通る(issue #444)。
 * 現在の利用箇所はいずれもこの規約を守っている
 * ({@link randomStructuredHand} / `buildAmbiguousConcealed` / `swapOne`)。
 *
 * ⚠️ 3箇所は「置き場所探し」という性質が同じというだけで、独立に調整したくなったら
 * 定数を分けること(`generator.test.ts` はこの値が 1 より大きいことに依存している)。
 */
export const PLACEMENT_TRIES = 20;

/**
 * 手牌全体を組み直す試行回数の上限({@link PLACEMENT_TRIES} が「1牌の置き場所」なのに対し、
 * こちらは「1手ぶんの組み立て」の再試行)。使い切った場合は決め打ちのフォールバックを返す。
 */
const REBUILD_ATTEMPTS = 200;

/** 34-index → ドメイン `Tile`(5筒/5索は赤)。 */
function indexToTile(idx: number): Tile {
  const { suit, rank } = index34ToKind(idx);
  return { suit, rank, isRed: rank === 5 && RED_FIVE_SUITS.has(suit) };
}

/**
 * 34-index カウント配列 → `Tile[]`(決定的な牌種順)。
 * 特殊形(七対子・国士)の決め打ち手を組み立てるテストからも使う(issue #429)。
 *
 * カウント → 牌の逆写像なので `counts34.ts` に置きたくなるが、こちらは赤5判定
 * ({@link RED_FIVE_SUITS})を持つ。`counts34.ts` は「`isRed` は構造に影響しないので
 * 種別のみで数える」と宣言しているモジュールなので、赤5ポリシーを持ち込まずに済む
 * 本ファイルに置く。
 */
export function count34ToTiles(counts34: readonly number[]): Tile[] {
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

/**
 * 順子開始として妥当な 34-index(pin/sou の 1..7 始まり。サンマで萬子順子は無い)。
 *
 * `generator.test.ts` の台本 RNG が「何番目の順子を引かせるか」を要素数から逆算するため
 * export している(`PLACEMENT_TRIES` と同じくテスト専用の公開)。
 */
export const SEQUENCE_STARTS: readonly number[] = [
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
  for (let attempt = 0; attempt < REBUILD_ATTEMPTS; attempt += 1) {
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
 *
 * **必ず14枚を返す**(置換に失敗しても枚数は減らない)。契約は `generator.test.ts` が
 * 直接固定し、呼び出し側のクロス検証も `expect(...).toHaveLength(14)` で
 * 明示的に落とす(issue #444)。
 */
export function randomStructuredHand(rng: () => number, maxSwaps = 3): Tile[] {
  const counts = buildCompleteCounts(rng);
  const swaps = randInt(rng, maxSwaps + 1);
  for (let s = 0; s < swaps; s += 1) {
    // 手牌中の1枚を除いてサンマ牌を1枚加え直す(4枚超は避ける)。加える先は乱択なので
    // 除いた牌種と同じになることもあり、その場合は手牌が変わらない。
    const present: number[] = [];
    for (const idx of SANMA_INDICES_34) {
      if (counts[idx] > 0) present.push(idx);
    }
    const remove = present[randInt(rng, present.length)];
    counts[remove] -= 1;
    let placed = false;
    for (let tries = 0; tries < PLACEMENT_TRIES && !placed; tries += 1) {
      const add = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
      if (counts[add] < 4) {
        counts[add] += 1;
        placed = true;
      }
    }
    // 追加先が見つからない(実際上到達しない)場合は元に戻す。`swapOne` と同じ方針で、
    // 「1枚減った手」を返して照合対象を静かに減らさない(issue #444)。
    if (!placed) counts[remove] += 1;
  }
  return count34ToTiles(counts);
}

/**
 * 分解が一意に定まらない門前14枚のうち、**連続7牌種を各2枚**の族(issue #429)。
 *
 * 例: `11223344556677p`。`[123][123][456][456][77]` と `[11][234][234][567][567]`
 * の2通り以上に必ず読めるので多重分解が保証され、同時に**七対子でもある**。
 * 帯3枚族(`111222333p` 型)だけだと「七対子かつ標準形」の手が corpus に現れず、
 * `isCompleteHand` の OR を両辺同時に真の状態で評価できないため、この族を混ぜる。
 */
function ambiguousSevenPairRun(rng: () => number): Tile[] {
  const base = rng() < 0.5 ? 9 : 18; // 筒子 / 索子
  const start = base + randInt(rng, 3); // start+6 が同一スート内に収まる(1..3 始まり)
  const counts = new Array<number>(34).fill(0);
  for (let offset = 0; offset < 7; offset += 1) counts[start + offset] = 2;
  return count34ToTiles(counts);
}

/**
 * 分解が一意に定まらない**門前14枚**を意図的に組む(issue #429)。
 *
 * 半々で2族から選ぶ。1つ目は同一スートの連続3牌種を各3枚
 * (`111222333p` 型 = 刻子3組 ⇔ 順子3組)+ 面子1組 + 雀頭1組。
 * 2つ目は {@link ambiguousSevenPairRun}(連続7牌種を各2枚 = 七対子かつ標準形)。
 * 以下は1つ目の族の説明。
 *
 * **多重分解が保証される根拠**: 4組目の面子と雀頭を帯と**牌種が交わらない**位置から
 * 取るため、帯の9枚は必ず「帯の中だけで3面子」に分解される。その分け方は
 * 刻子3組 / 順子3組 の2通りあるので、全体の分解も必ず2通り以上になる。
 * (「帯をまたぐ面子が作れない」という意味ではない。帯の外にも牌がある以上
 * `345p` のような跨ぎ面子自体は組めるが、残りが余って和了形にならない。)
 *
 * {@link randomStructuredHand} の乱択では多重分解の手が 20,000 手に 100 件前後
 * (1% 未満)しか現れず、「刻子が取れたら順子を試さない」型の列挙欠陥を踏むかどうかが
 * 運任せになる。副露経路で `buildAmbiguousConcealed` を用意したのと同じ理由で、
 * 門前にも決め打ち形を置く。
 */
export function randomAmbiguousMenzenHand(rng: () => number): Tile[] {
  if (rng() < 0.5) return ambiguousSevenPairRun(rng);
  for (let attempt = 0; attempt < REBUILD_ATTEMPTS; attempt += 1) {
    const counts = new Array<number>(34).fill(0);
    const base = rng() < 0.5 ? 9 : 18; // 筒子 / 索子
    const start = base + randInt(rng, 7); // start+2 が同一スート内に収まる
    for (const idx of [start, start + 1, start + 2]) counts[idx] += 3;

    // 4組目の面子と雀頭は帯の**外**(牌種が交わらない位置)から取る。これにより
    // 帯の9枚は帯内だけで3面子に分かれ、「刻子3組 ⇔ 順子3組」の2通りが必ず残る。
    const outside = (idx: number): boolean => idx < start || idx > start + 2;
    if (rng() < 0.5) {
      const seq = SEQUENCE_STARTS[randInt(rng, SEQUENCE_STARTS.length)];
      if (![seq, seq + 1, seq + 2].every(outside)) continue;
      for (const idx of [seq, seq + 1, seq + 2]) counts[idx] += 1;
    } else {
      const idx = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
      if (!outside(idx)) continue;
      counts[idx] += 3;
    }

    const pair = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
    if (!outside(pair) || counts[pair] > 2) continue;
    counts[pair] += 2;
    return count34ToTiles(counts);
  }
  // フォールバック(実際上到達しない): 111222333p 444p 55p(帯 1-3p + 刻子 + 雀頭)。
  const fallback = new Array<number>(34).fill(0);
  fallback[9] = 3; // 111p
  fallback[10] = 3; // 222p
  fallback[11] = 3; // 333p
  fallback[12] = 3; // 444p
  fallback[13] = 2; // 55p 雀頭
  return count34ToTiles(fallback);
}

// ---------------------------------------------------------------------------
// 副露あり手牌(issue #390)
// ---------------------------------------------------------------------------

/**
 * 生成された副露1組。本番の {@link "../decompose".MeldInput} と構造互換
 * (オラクル側は本番型に依存しないため、ここで独立に定義する)。
 */
export interface GeneratedMeld {
  readonly tiles: readonly Tile[];
  /** カンなら true(ポンは false)。 */
  readonly isKan: boolean;
  /** 暗槓なら true(ポン・明槓は false)。 */
  readonly concealed: boolean;
}

/** 副露あり手牌1件。`concealedTiles` は副露牌を**含まない**門前部分。 */
export interface MeldedHand {
  readonly concealedTiles: Tile[];
  readonly melds: readonly GeneratedMeld[];
}

/** サンマの副露はポン・明槓・暗槓のみ(チー無し)。牌種を1つ占有する。 */
function pickMelds(
  rng: () => number,
  meldCount: number,
  used: number[],
): GeneratedMeld[] | null {
  const melds: GeneratedMeld[] = [];
  for (let i = 0; i < meldCount; i += 1) {
    const idx = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
    if (used[idx] !== 0) return null; // 同一牌種の重複副露は避ける(再試行)
    const isKan = rng() < 0.35;
    const size = isKan ? 4 : 3;
    used[idx] = size;
    const tiles: Tile[] = [];
    for (let c = 0; c < size; c += 1) tiles.push(indexToTile(idx));
    melds.push({ tiles, isKan, concealed: isKan && rng() < 0.5 });
  }
  return melds;
}

/**
 * 密集帯: 同一スートの連続 3〜5 牌種(例: 筒子 3〜5 / 筒子 3〜7)。
 *
 * 面子候補をこの帯に閉じ込めると `222333444p` のような**分解が一意に決まらない形**
 * (刻子3組 ⇔ 順子3組)や多面待ちが高頻度で現れる。副露経路の照合で
 * 「複数分解・多面待ちを一度も踏まない」空回りを防ぐために使う(issue #390)。
 * 幅3の帯は順子の開始位置が1つに固定されるため、刻子 ⇔ 順子の読み替えが最も起きやすい。
 */
function pickBand(rng: () => number): { lo: number; hi: number } {
  const base = rng() < 0.5 ? 9 : 18; // 筒子 / 索子
  // 幅3: 111222333p 型(刻子3組 ⇔ 順子3組)。幅4: 22334455p 型(雀頭の取り方が2通り)。
  const width = 3 + randInt(rng, 3);
  const lo = base + randInt(rng, 10 - width); // 帯が同一スート内に収まる開始位置
  return { lo, hi: lo + width - 1 };
}

/** 門前部分を `groupsNeeded` 面子 + 雀頭で組む。牌が足りなければ null(再試行)。 */
function buildConcealedGroups(
  rng: () => number,
  groupsNeeded: number,
  used: number[],
  band: { lo: number; hi: number } | null,
): number[] | null {
  const tripletChoices = band
    ? rangeIndices(band.lo, band.hi)
    : SANMA_INDICES_34;
  const sequenceChoices = band
    ? SEQUENCE_STARTS.filter((s) => s >= band.lo && s + 2 <= band.hi)
    : SEQUENCE_STARTS;
  if (sequenceChoices.length === 0) return null;

  const counts = new Array<number>(34).fill(0);
  // 雀頭は半々で帯の外から取る。帯内の面子だけで 4 枚上限が埋まる形
  // (111222333p など)でも雀頭を確保できるようにするため。
  const pairChoices: readonly number[] =
    band && rng() < 0.5 ? tripletChoices : SANMA_INDICES_34;
  const pair = pairChoices[randInt(rng, pairChoices.length)];
  if (used[pair] + 2 > 4) return null;
  used[pair] += 2;
  counts[pair] += 2;

  for (let m = 0; m < groupsNeeded; m += 1) {
    if (rng() < 0.5) {
      const start = sequenceChoices[randInt(rng, sequenceChoices.length)];
      if (used[start] >= 4 || used[start + 1] >= 4 || used[start + 2] >= 4) {
        return null;
      }
      for (const idx of [start, start + 1, start + 2]) {
        used[idx] += 1;
        counts[idx] += 1;
      }
    } else {
      const idx = tripletChoices[randInt(rng, tripletChoices.length)];
      if (used[idx] + 3 > 4) return null;
      used[idx] += 3;
      counts[idx] += 3;
    }
  }
  return counts;
}

/**
 * 分解が一意に定まらない門前部分を**意図的に**組む(issue #390)。
 *
 * 密集帯の乱択だけでは多重分解が 2,000 手に 1 件程度しか現れず、
 * 「複数分解を一度も照合しない」空回りに近い状態になる。副露経路で最も価値の高い
 * ケースなので、確実に踏むための決め打ち形をここで用意する。
 *
 * - 面子3組(門前11枚): `{s, s+1, s+2}` を各3枚(刻子3組 ⇔ 順子3組)+ 帯外の雀頭。
 * - 面子2組(門前8枚): 連続4牌種を各2枚(`22334455p` 型。雀頭の取り方が2通り)。
 * - 面子1組(5枚)・0組(2枚): 多重分解は存在しないため `null`(通常生成にフォールバック)。
 */
function buildAmbiguousConcealed(
  rng: () => number,
  groupsNeeded: number,
  used: number[],
): number[] | null {
  // 失敗して null を返す経路では `used` を呼び出し前の状態へ完全に戻す。
  // 戻さないと後続の通常生成が「実際より牌が減っている山」で動き、
  // カバレッジ閾値を守るジェネレータに意図しない偏りが乗る。
  const snapshot = [...used];
  const rollback = (): null => {
    used.splice(0, used.length, ...snapshot);
    return null;
  };
  const base = rng() < 0.5 ? 9 : 18; // 筒子 / 索子
  const counts = new Array<number>(34).fill(0);

  if (groupsNeeded === 3) {
    const start = base + randInt(rng, 7); // start+2 が同一スート内に収まる
    for (const idx of [start, start + 1, start + 2]) {
      if (used[idx] + 3 > 4) return rollback();
      used[idx] += 3;
      counts[idx] += 3;
    }
    // 雀頭は帯の外から(帯内は既に3枚使用で、雀頭を足すと5枚になる)。
    for (let tries = 0; tries < PLACEMENT_TRIES; tries += 1) {
      const pair = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
      if (pair >= start && pair <= start + 2) continue;
      if (used[pair] + 2 > 4) continue;
      used[pair] += 2;
      counts[pair] += 2;
      return counts;
    }
    return rollback();
  }

  if (groupsNeeded === 2) {
    const start = base + randInt(rng, 6); // start+3 が同一スート内に収まる
    for (const idx of [start, start + 1, start + 2, start + 3]) {
      if (used[idx] + 2 > 4) return rollback();
      used[idx] += 2;
      counts[idx] += 2;
    }
    return counts;
  }

  return rollback();
}

/** `lo`..`hi`(両端含む)の 34-index 列。 */
function rangeIndices(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = lo; i <= hi; i += 1) out.push(i);
  return out;
}

/** 門前部分の1枚を別の牌へ置換する(全体で1牌種4枚を超えない範囲で)。 */
function swapOne(rng: () => number, counts: number[], used: number[]): void {
  const present: number[] = [];
  for (const idx of SANMA_INDICES_34) {
    if (counts[idx] > 0) present.push(idx);
  }
  if (present.length === 0) return;
  const remove = present[randInt(rng, present.length)];
  counts[remove] -= 1;
  used[remove] -= 1;
  for (let tries = 0; tries < PLACEMENT_TRIES; tries += 1) {
    const add = SANMA_INDICES_34[randInt(rng, SANMA_INDICES_34.length)];
    if (used[add] < 4) {
      counts[add] += 1;
      used[add] += 1;
      return;
    }
  }
  // 追加先が見つからない(実際上到達しない)場合は元に戻す。
  counts[remove] += 1;
  used[remove] += 1;
}

/** 決定的フォールバック(乱択が規定回数で成立しなかった場合のみ使用)。 */
function fallbackMeldedHand(
  meldCount: number,
  concealedSize: number,
): MeldedHand {
  const melds: GeneratedMeld[] = [];
  for (let i = 0; i < meldCount; i += 1) {
    const idx = 27 + i; // 東・南・西
    melds.push({
      tiles: [indexToTile(idx), indexToTile(idx), indexToTile(idx)],
      isKan: false,
      concealed: false,
    });
  }
  const counts = new Array<number>(34).fill(0);
  counts[26] = 2; // 99s 雀頭
  for (let m = 0; m < 4 - meldCount; m += 1) counts[9 + m] = 3; // 111p 222p …
  const tiles = count34ToTiles(counts);
  return { concealedTiles: tiles.slice(0, concealedSize), melds };
}

/**
 * 副露あり手牌を生成する。
 *
 * - `structured = true`: 副露を先に確定させたうえで門前部分を `4 - meldCount` 面子
 *   + 雀頭で組み、内訳を3系統に振り分ける(和了・テンパイ・多重分解を厚く)。
 *   1/4 は多重分解が確実に生じる決め打ち形、残りの半数は密集帯に閉じ込めた形、
 *   後者はさらに 0〜3 枚を無作為置換する。
 * - `structured = false`: 副露だけ先に決め、門前部分は残り山から無作為抽出する
 *   (向聴が深い「非和了・非テンパイ」を厚く)。
 *
 * 1牌種の総枚数(門前 + 副露)は常に 4 枚以下になる。
 *
 * @param rng 決定的 PRNG。
 * @param meldCount 副露数(1..4)。
 * @param concealedSize 門前部分の枚数。`14 - 3 * meldCount`(和了形サイズ)または
 *   `13 - 3 * meldCount`(待ち判定サイズ)を渡す。
 * @param structured 構造化生成にするか。
 */
export function randomMeldedHand(
  rng: () => number,
  meldCount: number,
  concealedSize: number,
  structured: boolean,
): MeldedHand {
  const groupsNeeded = 4 - meldCount;
  const fullSize = groupsNeeded * 3 + 2;

  for (let attempt = 0; attempt < REBUILD_ATTEMPTS; attempt += 1) {
    const used = new Array<number>(34).fill(0);
    const melds = pickMelds(rng, meldCount, used);
    if (melds === null) continue;

    let counts: number[] | null;
    if (structured) {
      // 1/4 は多重分解が確実に生じる形。置換を掛けると曖昧さが壊れるのでそのまま使う。
      const ambiguous =
        rng() < 0.25 ? buildAmbiguousConcealed(rng, groupsNeeded, used) : null;
      if (ambiguous !== null) {
        counts = ambiguous;
      } else {
        // 残りは半数を密集帯に閉じ込め、多面待ち・低向聴を厚く生成する。
        const band = rng() < 0.5 ? pickBand(rng) : null;
        counts = buildConcealedGroups(rng, groupsNeeded, used, band);
        if (counts === null) continue;
        const swaps = randInt(rng, 4);
        for (let s = 0; s < swaps; s += 1) swapOne(rng, counts, used);
      }
    } else {
      // 残り山(牌種ごとに 4 − used 枚)から無作為抽出。
      const wall: number[] = [];
      for (const idx of SANMA_INDICES_34) {
        for (let c = used[idx]; c < 4; c += 1) wall.push(idx);
      }
      for (let i = 0; i < fullSize; i += 1) {
        const j = i + randInt(rng, wall.length - i);
        [wall[i], wall[j]] = [wall[j], wall[i]];
      }
      counts = new Array<number>(34).fill(0);
      for (const idx of wall.slice(0, fullSize)) counts[idx] += 1;
    }

    // 待ち判定サイズ(1枚少ない)が要求されたら1枚落とす。
    // ここから先で `used` は読まないので、枚数を減らしても同期は不要。
    for (let extra = fullSize; extra > concealedSize; extra -= 1) {
      const present: number[] = [];
      for (const idx of SANMA_INDICES_34) {
        if (counts[idx] > 0) present.push(idx);
      }
      counts[present[randInt(rng, present.length)]] -= 1;
    }

    return { concealedTiles: count34ToTiles(counts), melds };
  }
  return fallbackMeldedHand(meldCount, concealedSize);
}
