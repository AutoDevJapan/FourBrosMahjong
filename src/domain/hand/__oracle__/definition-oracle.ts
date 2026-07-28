/**
 * 定義ベースの向聴オラクル(テスト専用 / issue #392)。
 *
 * ⚠️ **本番コードから import しない**検証用オラクル。
 *
 * `__oracle__/shanten-oracle.ts` と `src/domain/game/ai.ts` は、どちらも
 * 「スート別に (面子, 塔子, 対子) を数え上げて式で最小化する」**同型の列挙**を持つ
 * (差分は最終式とパレート枝刈りの有無だけ)。したがって両者の照合は
 * **列挙側の共通欠陥(ある塔子形の取りこぼし等)を検出できない**。
 *
 * 本モジュールはその死角を埋めるため、**塔子・面子候補の列挙を一切行わない**。
 * 向聴数の定義そのもの:
 *
 * > 向聴数 = min(和了形 W にわたって)「W を完成させるために追加で必要な牌数」− 1
 *
 * を、和了形 W の側を全列挙して直接計算する。手牌側の分解は行わず、
 * 「手牌と W の重なり」しか見ないため、探索構造が本体実装と独立になる。
 *
 * ## 適用範囲
 *
 * - {@link shantenByDefinition34}(向聴数)は副露数 `meldCount ≥ 1` 限定。向聴は
 *   「最も近い W」を求めるため W を**全通り**見る必要があり、門前は W が爆発する
 *   (4 面子 + 雀頭 ≈ 1,300 万通り)。副露手は面子が固定されるぶん W が激減し、
 *   `meldCount = 1` でも 33 万通り程度で全列挙できる。
 * - {@link standardFormsByDefinition34}(分解)と
 *   {@link waitingIndicesByDefinition34}(待ち)は「手牌と一致する W / 1枚だけ足りない W」
 *   しか要らないため、可容な枝刈り(`waste > maxWaste` で打ち切り)が効き、
 *   副露数に依存せず 1 手あたり 1ms 未満で終わる(issue #390)。ただし標準形のみを
 *   扱うため、七対子・国士が成立し得る門前手には使わないこと。
 *
 * 純関数・決定的。
 */

import { COUNT34_LEN, index34ToKind, SANMA_INDICES_34 } from "./counts34";

/** 同一牌種の最大枚数。 */
const COPIES = 4;
/** 和了形の面子 + 雀頭の総数(4 面子 1 雀頭)。 */
const TOTAL_GROUPS = 4;

/** 面子候補1件(和了形の構成要素)。 */
interface GroupSpec {
  readonly kind: "triplet" | "sequence";
  /** 刻子は牌種、順子は開始牌の 34-index。 */
  readonly index: number;
  /** 構成牌の 34-index(3枚)。 */
  readonly indices: readonly number[];
}

/**
 * 面子候補(刻子 + 順子)の一覧。
 * 刻子はサンマに実在する 27 種すべて。順子は萬子 2-8 が無いため筒子・索子のみ
 * (開始 rank 1..7 の 7 種 × 2 スート = 14 種)。
 */
function buildGroups(): readonly GroupSpec[] {
  const groups: GroupSpec[] = [];
  for (const index of SANMA_INDICES_34) {
    groups.push({ kind: "triplet", index, indices: [index, index, index] });
  }
  for (const base of [9, 18]) {
    // 筒子 (9..17) / 索子 (18..26)
    for (let offset = 0; offset < 7; offset++) {
      const start = base + offset;
      groups.push({
        kind: "sequence",
        index: start,
        indices: [start, start + 1, start + 2],
      });
    }
  }
  return groups;
}

const GROUPS = buildGroups();

/**
 * 定義ベースの向聴数(標準形のみ)。
 *
 * `concealed` は**門前部分**の 34-index カウント配列(副露牌を含めない)。
 * 枚数は `13 − 3 × meldCount` を想定する。
 *
 * @param concealed 門前部分のカウント配列。
 * @param meldCount 副露数(1..3)。
 * @returns 向聴数(0 = テンパイ、-1 = 和了)。
 */
export function shantenByDefinition34(
  concealed: readonly number[],
  meldCount: number,
): number {
  if (meldCount < 1 || meldCount > 3) {
    throw new RangeError(
      `shantenByDefinition34 は meldCount 1..3 のみ対応(受領: ${meldCount})。門前は和了形が爆発するため対象外。`,
    );
  }
  const groupsNeeded = TOTAL_GROUPS - meldCount;
  const handSize = 13 - 3 * meldCount;

  // 和了形 W を作りながら、手牌との重なりを増分で持つ。
  const work = new Array<number>(COUNT34_LEN).fill(0);
  let overlap = 0;
  let best = Number.POSITIVE_INFINITY;

  /** `index` の牌を1枚 W へ足す。枚数上限を超えるなら false。 */
  const push = (index: number): boolean => {
    if (work[index] >= COPIES) return false;
    work[index] += 1;
    // 重なりは min(W[k], hand[k]) の総和。W 側が hand 側を超えた分は数えない。
    if (work[index] <= (concealed[index] ?? 0)) overlap += 1;
    return true;
  };
  const pop = (index: number): void => {
    if (work[index] <= (concealed[index] ?? 0)) overlap -= 1;
    work[index] -= 1;
  };

  /** 面子を `start` 以降から `remaining` 個選ぶ(重複組合せ)。 */
  const chooseGroups = (start: number, remaining: number): void => {
    if (remaining === 0) {
      const distance = handSize - overlap;
      if (distance < best) best = distance;
      return;
    }
    for (let g = start; g < GROUPS.length; g++) {
      const group = (GROUPS[g] as GroupSpec).indices;
      let pushed = 0;
      let ok = true;
      for (const index of group) {
        if (!push(index)) {
          ok = false;
          break;
        }
        pushed += 1;
      }
      if (ok) chooseGroups(g, remaining - 1);
      for (let i = pushed - 1; i >= 0; i--) pop(group[i] as number);
    }
  };

  for (const pair of SANMA_INDICES_34) {
    if (!push(pair)) continue;
    if (push(pair)) {
      chooseGroups(0, groupsNeeded);
      pop(pair);
    }
    pop(pair);
  }

  return best;
}

// ---------------------------------------------------------------------------
// 副露手の分解・待ち(issue #390)
// ---------------------------------------------------------------------------

/**
 * 和了形 W の構成ブロック1件(雀頭を含む)。
 * `standardFormsByDefinition34` のシグネチャ生成にのみ使う。
 */
interface FormBlock {
  readonly kind: "triplet" | "sequence" | "pair";
  readonly index: number;
}

/** ブロック列 → `hand/decompose.ts` の `mentsuSignature` と同形式の正規化文字列。 */
function canonicalSignature(blocks: readonly FormBlock[]): string {
  return blocks
    .map((b) => {
      const { suit, rank } = index34ToKind(b.index);
      return `${b.kind}:${suit}${rank}`;
    })
    .sort()
    .join("|");
}

/**
 * 「手牌をほぼ覆う和了形 W」を列挙する共通コア(定義ベース)。
 *
 * `shantenByDefinition34` と同じく **和了形 W の側を全列挙**し、手牌側の分解は一切
 * 行わない。ただし用途が「距離 0(=完全一致)/ 距離 0 の1枚不足(=待ち)」に限られる
 * ため、`waste`(= W に積んだ枚数のうち手牌に無い分 = Σ max(0, W[i] − hand[i]))が
 * `maxWaste` を超えた時点で枝を捨てる。`waste` は単調非減少なのでこの枝刈りは
 * **可容(admissible)** であり、列挙結果は無枝刈りの全列挙と一致する。
 *
 * この枝刈りにより探索は「手牌にほぼ含まれる面子の組合せ」だけに絞られ、
 * `meldCount = 1`(3面子+雀頭)でも 1 手あたり 1ms 未満で終わる。
 *
 * @param concealed 門前部分の 34-index カウント配列。
 * @param groupsNeeded 門前部分で作るべき面子数(= 4 − 副露数)。
 * @param maxWaste 許容する「手牌に無い枚数」。0 なら完全一致、1 なら1枚不足まで。
 * @param visit 条件を満たす W ごとに呼ばれる。`work` は W のカウント配列。
 *   ⚠️ `work` / `blocks` は探索中に**巻き戻される可変バッファ**。`visit` の外へ
 *   保持してはならない(必要ならコピーを取ること)。
 *
 * なお `shantenByDefinition34` も同形の push/pop を持つが、あちらは枝刈りが無く
 * `blocks` も追わないため、**意図的に別実装**にしてある(共通化すると片方の枝刈り条件が
 * もう片方へ漏れる)。
 */
function forEachCoveringForm(
  concealed: readonly number[],
  groupsNeeded: number,
  maxWaste: number,
  visit: (
    work: readonly number[],
    blocks: readonly FormBlock[],
    waste: number,
  ) => void,
): void {
  const work = new Array<number>(COUNT34_LEN).fill(0);
  const blocks: FormBlock[] = [];
  let waste = 0;

  /** `index` の牌を1枚 W へ足す。枚数上限超過・waste 超過なら false(積まずに戻す)。 */
  const push = (index: number): boolean => {
    if (work[index] >= COPIES) return false;
    work[index] += 1;
    if (work[index] > (concealed[index] ?? 0)) waste += 1;
    if (waste > maxWaste) {
      // 枝刈り: 積んだ1枚を戻してから失敗を返す。
      if (work[index] > (concealed[index] ?? 0)) waste -= 1;
      work[index] -= 1;
      return false;
    }
    return true;
  };
  const pop = (index: number): void => {
    if (work[index] > (concealed[index] ?? 0)) waste -= 1;
    work[index] -= 1;
  };

  const chooseGroups = (start: number, remaining: number): void => {
    if (remaining === 0) {
      visit(work, blocks, waste);
      return;
    }
    for (let g = start; g < GROUPS.length; g++) {
      const group = GROUPS[g] as GroupSpec;
      let pushed = 0;
      let ok = true;
      for (const index of group.indices) {
        if (!push(index)) {
          ok = false;
          break;
        }
        pushed += 1;
      }
      if (ok) {
        blocks.push({ kind: group.kind, index: group.index });
        chooseGroups(g, remaining - 1);
        blocks.pop();
      }
      for (let i = pushed - 1; i >= 0; i--) {
        pop(group.indices[i] as number);
      }
    }
  };

  for (const pair of SANMA_INDICES_34) {
    if (!push(pair)) continue;
    if (push(pair)) {
      blocks.push({ kind: "pair", index: pair });
      chooseGroups(0, groupsNeeded);
      blocks.pop();
      pop(pair);
    }
    pop(pair);
  }
}

/** 34-index カウント配列の総枚数。 */
function totalOf(counts: readonly number[]): number {
  let total = 0;
  for (const n of counts) total += n;
  return total;
}

/**
 * 入力枚数と `groupsNeeded` の整合を検査する。
 * `extra` は面子以外の枚数(和了形なら雀頭の 2、待ち判定ならその 1 枚不足で 1)。
 */
function assertFormArity(
  concealed: readonly number[],
  groupsNeeded: number,
  extra: 1 | 2,
): void {
  if (!Number.isInteger(groupsNeeded) || groupsNeeded < 0) {
    throw new RangeError(
      `groupsNeeded は 0 以上の整数(受領: ${groupsNeeded})。`,
    );
  }
  if (groupsNeeded > TOTAL_GROUPS) {
    throw new RangeError(
      `groupsNeeded は ${TOTAL_GROUPS} 以下(受領: ${groupsNeeded})。`,
    );
  }
  const expected = groupsNeeded * 3 + extra;
  const total = totalOf(concealed);
  if (total !== expected) {
    throw new RangeError(
      `門前部分の枚数が groupsNeeded=${groupsNeeded} と噛み合わない(期待: ${expected} / 受領: ${total})。`,
    );
  }
}

/**
 * 副露手の**門前部分**が作る標準形(面子 + 雀頭)の全分解を、正規化シグネチャ集合で返す。
 *
 * 和了形の側を全列挙し「手牌と完全に一致する W」を拾うだけなので、
 * `hand/decompose.ts` の `extractMentsuAll`(手牌の最小牌から刻子/順子へ再帰的に
 * 切り出す)とは**探索構造が独立**。両者に共通の列挙欠陥があっても検出できる。
 *
 * 返すのは**門前部分のみ**(副露由来の面子は含まない)。呼び出し側で合成すること。
 *
 * @param concealed 門前部分の 34-index カウント配列(枚数は `groupsNeeded * 3 + 2`)。
 * @param groupsNeeded 門前部分で作るべき面子数(= 4 − 副露数)。
 * @returns 分解の正規化シグネチャ集合。空なら標準形にならない。
 * @throws RangeError `groupsNeeded` が 0..4 の外、または枚数が噛み合わない場合。
 *   「和了形でない」と「呼び出し側の契約違反」を空集合で同一視すると照合が静かに
 *   空回りするため、後者は明示的に失敗させる。
 */
export function standardFormsByDefinition34(
  concealed: readonly number[],
  groupsNeeded: number,
): Set<string> {
  assertFormArity(concealed, groupsNeeded, 2);
  const out = new Set<string>();
  forEachCoveringForm(concealed, groupsNeeded, 0, (_work, blocks) => {
    out.add(canonicalSignature(blocks));
  });
  return out;
}

/**
 * 副露手の待ち牌(和了牌候補)の 34-index 集合を、定義ベースで返す。
 *
 * 待ち牌 t の定義は「`concealed + t` が和了形 W と完全に一致する t」。
 * これは「W が手牌をちょうど1枚だけ超過して覆う」ことと同値なので、
 * `maxWaste = 1` の列挙1回で全待ちが得られる(牌種ごとに再評価する必要がない)。
 *
 * @param concealed 門前部分の 34-index カウント配列(枚数は `groupsNeeded * 3 + 1`)。
 * @param groupsNeeded 門前部分で作るべき面子数(= 4 − 副露数)。
 * @param used 手牌 + 副露を合わせた 34-index カウント配列。4枚使い切った牌種は待てない。
 * @returns 待ち牌の 34-index 集合。空ならテンパイでない。
 * @throws RangeError `groupsNeeded` が 0..4 の外、枚数が噛み合わない、または
 *   `used` が `concealed` を含まない(手牌より少ない)場合。`used` の取り違えを
 *   静かに受け入れると、待ちが不当に絞られて false red になる。
 */
export function waitingIndicesByDefinition34(
  concealed: readonly number[],
  groupsNeeded: number,
  used: readonly number[],
): Set<number> {
  assertFormArity(concealed, groupsNeeded, 1);
  for (let i = 0; i < COUNT34_LEN; i++) {
    if ((used[i] ?? 0) < (concealed[i] ?? 0)) {
      throw new RangeError(
        `used は concealed を含む必要がある(index ${i}: used=${used[i] ?? 0} < concealed=${concealed[i] ?? 0})。`,
      );
    }
  }
  const out = new Set<number>();
  forEachCoveringForm(concealed, groupsNeeded, 1, (work) => {
    // W は手牌より1枚多く、枝刈りで waste ≤ 1 なので waste は常にちょうど 1。
    // したがって超過している牌種はちょうど1種・1枚で、それが待ち牌。
    for (let i = 0; i < COUNT34_LEN; i++) {
      if (work[i] <= (concealed[i] ?? 0)) continue;
      if ((used[i] ?? 0) < COPIES) out.add(i);
      return;
    }
  });
  return out;
}
