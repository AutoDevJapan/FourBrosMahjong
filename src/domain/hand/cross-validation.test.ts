/**
 * 向聴・和了・手牌分解のクロス検証(issue #138)。
 *
 * 大量のランダムなサンマ手牌を決定的シードで生成し、本作の本番実装
 * - `src/domain/game/ai.ts` の `shanten()`
 * - `src/domain/hand/tenpai.ts` の `waitingTiles()`
 * - `src/domain/hand/decompose.ts` の `isCompleteHand()` / `decomposeStandard()`
 * を、独立参照オラクル(`__oracle__/`。MIT ライブラリ MahjongRepository/mahjong の
 * アルゴリズム構造を独自再実装。参照ライブラリとの照合済み)と突き合わせる。
 *
 * オラクルの正しさは、参照ライブラリ(is_three_player=True)との大量ランダム照合で
 * 別途アンカー済み(4枚使いを除く 12,478 手で shanten/regular/和了/待ち 全一致)。
 * 4枚全てが手牌にある「デッドウォール待ち」の向聴は、本作 ai.ts とオラクルが共通で
 * 採用する牌残量無視の理想化により参照と ±1 差が出る既知クラス(#143 で追跡)。
 * ai.ts とオラクルは同じ理想化を共有するため、本テストでは全手で一致する。
 */

import { describe, expect, it } from "vitest";
import { shanten, ukeire } from "../game/ai";
import type { Tile } from "../tiles/tile";
import { COPIES_PER_TILE } from "../tiles/tileSet";
import {
  isCompleteOracle34,
  standardDecompositions34,
  waitingIndicesOracle34,
} from "./__oracle__/agari-oracle";
import {
  SANMA_INDICES_34,
  TERMINAL_AND_HONOR_INDICES_34,
  tilesToCount34,
  tileTo34Index,
} from "./__oracle__/counts34";
import {
  isSevenPairsByDefinition34,
  isThirteenOrphansByDefinition34,
  menzenWaitingIndicesByDefinition34,
  shantenByDefinition34,
  standardFormsByDefinition34,
  waitingIndicesByDefinition34,
} from "./__oracle__/definition-oracle";
import {
  count34ToTiles,
  type GeneratedMeld,
  type MeldedHand,
  makeRng,
  randomAmbiguousMenzenHand,
  randomHand,
  randomMeldedHand,
  randomStructuredHand,
} from "./__oracle__/generator";
import { shantenOracle34 } from "./__oracle__/shanten-oracle";
import { decomposeStandard, isCompleteHand, type Mentsu } from "./decompose";
import { parseTiles, tileNotation } from "./notation";
import { waitingTiles } from "./tenpai";

/**
 * クロス検証の手牌数。反復回数はここで調整する(実行時間と網羅性のトレードオフ)。
 * ランダム(向聴が深い手を厚く)と構造化(テンパイ〜低向聴を厚く)を各モードで回す。
 */
const RANDOM_HANDS = 20_000;
const STRUCTURED_HANDS = 20_000;

/**
 * 受け入れ照合の手牌数(#368)。1手あたり全27牌種ぶんオラクルを再評価するため、
 * 向聴照合より1手のコストが約27倍になる。網羅性と実行時間の釣り合いをここで調整する。
 */
const UKEIRE_HANDS = 2_000;

/** 門前手が作るべき面子数(副露なし = 4面子1雀頭)。 */
const MENZEN_GROUPS = 4;

/** `menzen14` が曖昧形(多重分解が構造的に保証された形)を返す周期。 */
const AMBIGUOUS_MENZEN_EVERY = 4;

/**
 * 門前14枚を生成する。`AMBIGUOUS_MENZEN_EVERY` 手に 1 手は多重分解が
 * **構造的に保証された**形(`randomAmbiguousMenzenHand`)。乱択だけだと多重分解の手が
 * 1% 未満しか現れず、刻子 ⇔ 順子の読み替えを踏むかどうかが運任せになるため。
 */
function menzen14(rng: () => number, index: number): Tile[] {
  return index % AMBIGUOUS_MENZEN_EVERY === 0
    ? randomAmbiguousMenzenHand(rng)
    : randomStructuredHand(rng);
}

/** 14枚から1枚を無作為に抜いて13枚にする。 */
function dropOne(rng: () => number, tiles: readonly Tile[]): Tile[] {
  const drop = Math.floor(rng() * tiles.length);
  return [...tiles.slice(0, drop), ...tiles.slice(drop + 1)];
}

/** 本作 `StandardForm` を decompose.ts の mentsuSignature と同形式へ正規化。 */
function formSignature(
  melds: readonly { kind: string; suit: string; startRank: number }[],
  pair: { kind: string; suit: string; startRank: number },
): string {
  return [...melds, pair]
    .map((g) => `${g.kind}:${g.suit}${g.startRank}`)
    .sort()
    .join("|");
}

describe("クロス検証: 向聴数(ai.shanten ⇔ オラクル)", () => {
  it("ランダム手牌で ai.shanten とオラクルの向聴が一致する", () => {
    const rng = makeRng(0x5eed_1234);
    let mismatches = 0;
    const samples: string[] = [];
    for (let i = 0; i < RANDOM_HANDS; i += 1) {
      const size = rng() < 0.5 ? 13 : 14;
      const tiles = randomHand(rng, size);
      const a = shanten(tiles);
      const o = shantenOracle34(tilesToCount34(tiles));
      if (a !== o) {
        mismatches += 1;
        if (samples.length < 8)
          samples.push(`${describeHand(tiles)} ai=${a} oracle=${o}`);
      }
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] random shanten hands=${RANDOM_HANDS} mismatches=${mismatches}`,
    );
    expect(mismatches).toBe(0);
  });

  it("構造化手牌(和了近傍)で ai.shanten とオラクルの向聴が一致する", () => {
    const rng = makeRng(0x5eed_abcd);
    let mismatches = 0;
    const samples: string[] = [];
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      const tiles = randomStructuredHand(rng);
      const a = shanten(tiles);
      const o = shantenOracle34(tilesToCount34(tiles));
      if (a !== o) {
        mismatches += 1;
        if (samples.length < 8)
          samples.push(`${describeHand(tiles)} ai=${a} oracle=${o}`);
      }
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] structured shanten hands=${STRUCTURED_HANDS} mismatches=${mismatches}`,
    );
    expect(mismatches).toBe(0);
  });
});

describe("クロス検証: 受け入れ候補枝刈り(#368)", () => {
  it("門前13枚で全27牌種を走査する独立向聴オラクルと一致する", () => {
    const rng = makeRng(0x3680_0001);
    for (let i = 0; i < UKEIRE_HANDS; i += 1) {
      const tiles = rng() < 0.5 ? randomHand(rng, 13) : structured13(rng);
      const counts = tilesToCount34(tiles);
      const base = shantenOracle34(counts);
      let kinds = 0;
      let copies = 0;
      for (const index of SANMA_INDICES_34) {
        if (counts[index] >= COPIES_PER_TILE) continue;
        const drawn = [...counts];
        drawn[index] += 1;
        if (shantenOracle34(drawn) < base) {
          kinds += 1;
          copies += COPIES_PER_TILE - counts[index];
        }
      }
      expect(ukeire(tiles), describeHand(tiles)).toEqual({ kinds, copies });
    }
  });
});

describe("クロス検証: 和了・分解・待ち(decompose/tenpai ⇔ オラクル)", () => {
  it("14枚: isCompleteHand と和了オラクルが一致し、標準分解の集合も一致する", () => {
    const rng = makeRng(0x1010_2020);
    let completeMismatch = 0;
    let decompMismatch = 0;
    let completeCount = 0;
    let multiFormCount = 0;
    const samples: string[] = [];
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      // 乱択だけだと多重分解の手が 1% 未満しか出ず、刻子 ⇔ 順子の読み替え
      // (片側リグレッションで最も壊れやすい箇所)をほとんど踏まない(#429)。
      const tiles = menzen14(rng, i);
      if (tiles.length !== 14) continue;
      const counts = tilesToCount34(tiles);

      const aComplete = isCompleteHand(tiles, []);
      const oComplete = isCompleteOracle34(counts);
      if (aComplete !== oComplete) {
        completeMismatch += 1;
        if (samples.length < 8)
          samples.push(
            `complete ${describeHand(tiles)} ai=${aComplete} oracle=${oComplete}`,
          );
      }
      if (oComplete) completeCount += 1;

      // 標準形の分解集合(順子/刻子/雀頭の正規化シグネチャ)を突き合わせる。
      const aForms = new Set(
        decomposeStandard(tiles, []).map((f) => formSignature(f.melds, f.pair)),
      );
      const oForms = standardDecompositions34(counts);
      if (!setEqual(aForms, oForms)) {
        decompMismatch += 1;
        if (samples.length < 8)
          samples.push(
            `decomp ${describeHand(tiles)} ai=${[...aForms].sort().join(" / ")} oracle=${[...oForms].sort().join(" / ")}`,
          );
      }
      if (oForms.size > 1) multiFormCount += 1;
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] 14-tile hands compared, complete=${completeCount} multiForm=${multiFormCount} completeMismatch=${completeMismatch} decompMismatch=${decompMismatch}`,
    );
    expect(completeMismatch).toBe(0);
    expect(decompMismatch).toBe(0);
    // 刻子 ⇔ 順子の読み替えは片側リグレッションで最も壊れやすい箇所。`menzen14` を
    // `randomStructuredHand` に戻すと多重分解率が 25% → 1% 未満に落ちるので、
    // 曖昧形の生成比から導いた下限で固定する(#429)。
    expect(multiFormCount).toBeGreaterThanOrEqual(
      STRUCTURED_HANDS / AMBIGUOUS_MENZEN_EVERY,
    );
  });

  it("13枚: waitingTiles と待ちオラクルの集合が一致する", () => {
    const rng = makeRng(0x3030_4040);
    let waitMismatch = 0;
    let tenpaiCount = 0;
    const samples: string[] = [];
    // ランダム+構造化を混ぜてテンパイ〜非テンパイを厚く。構造化側は多重分解を
    // 構造的に含む `menzen14` から1枚落として作る(#429)。
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      const tiles =
        rng() < 0.5 ? randomHand(rng, 13) : dropOne(rng, menzen14(rng, i));
      if (tiles.length !== 13) continue;
      const counts = tilesToCount34(tiles);

      const aWaits = new Set(
        waitingTiles(tiles, []).map((t) => tileTo34Index(t)),
      );
      const oWaits = waitingIndicesOracle34(counts);
      if (!setEqualNum(aWaits, oWaits)) {
        waitMismatch += 1;
        if (samples.length < 8)
          samples.push(
            `waits ${describeHand(tiles)} ai=${[...aWaits].sort((x, y) => x - y)} oracle=${[...oWaits].sort((x, y) => x - y)}`,
          );
      }
      if (oWaits.size > 0) tenpaiCount += 1;
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] 13-tile hands compared, tenpai=${tenpaiCount} waitMismatch=${waitMismatch}`,
    );
    expect(waitMismatch).toBe(0);
  });
});

/** 構造化13枚(完成形から1枚除去 → テンパイを厚く)。 */
function structured13(rng: () => number): Tile[] {
  const tiles = randomStructuredHand(rng);
  return tiles.length !== 14 ? tiles.slice(0, 13) : dropOne(rng, tiles);
}

function setEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function setEqualNum(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** 手牌をデバッグ用の簡易記法へ(例: "123p 55z")。 */
function describeHand(tiles: readonly Tile[]): string {
  const order = ["man", "pin", "sou", "honor"];
  const sorted = [...tiles].sort(
    (a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || a.rank - b.rank,
  );
  return sorted.map(tileNotation).join("");
}

/**
 * 列挙非依存の定義ベース照合(#392)。
 *
 * 上のクロス検証は `__oracle__/shanten-oracle.ts` と `src/domain/game/ai.ts` を
 * 突き合わせているが、両者は「スート別に (面子, 塔子, 対子) を数え上げる」**同型の列挙**を
 * 持つ(差分は最終式とパレート枝刈りの有無だけ)。そのため片側のリグレッションは検出できる
 * 一方で、**列挙側の共通欠陥(ある塔子形の取りこぼし等)は両者で共有され素通りする**。
 *
 * ここでは塔子・面子候補の列挙を一切行わない
 * {@link shantenByDefinition34}(和了形の側を全列挙し「手牌との最大重なり」から距離を直接
 * 算出する)と突き合わせ、その欠陥クラスを初めて検出できるようにする。
 *
 * 副露数 1..3 に限定しているのは、門前 13 枚だと和了形が約 1,300 万通りに爆発して
 * 現実的でないため(副露手は面子が固定されるぶん探索が激減する)。実測の内訳は
 * meldCount=3 が 400 手で 23ms、2 が 200 手で 166ms、1 が 30 手で 325ms。
 */
describe("列挙非依存の定義ベース向聴オラクルとの照合 (#392)", () => {
  it.each([
    [3, 400],
    [2, 200],
    [1, 30],
  ])("meldCount=%d の %d 手で shanten() と一致する", (meldCount, samples) => {
    const rng = makeRng(0x39_2a + meldCount);
    const mismatches: string[] = [];
    for (let i = 0; i < samples; i++) {
      const tiles = randomHand(rng, 13 - 3 * meldCount);
      const actual = shanten(tiles, meldCount);
      const expected = shantenByDefinition34(tilesToCount34(tiles), meldCount);
      if (actual !== expected) {
        mismatches.push(
          `${tiles.map(tileNotation).join("")} → shanten=${actual} / 定義ベース=${expected}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("定義ベースオラクル自身の既知手を固定する", () => {
    const at = (notation: string, meldCount: number) =>
      shantenByDefinition34(tilesToCount34(parseTiles(notation)), meldCount);
    // 副露3 + 門前4枚(和了形は 1面子 + 雀頭 = 5枚)。
    expect(at("123p 9s", 3)).toBe(0); // 順子完成 + 単騎 → テンパイ
    expect(at("12p 99s", 3)).toBe(0); // 雀頭完成 + 両面 → テンパイ
    expect(at("19p 28s", 3)).toBe(2); // 重なりは最大2枚 → 4 − 2 = 2
    // 副露2 + 門前7枚(和了形は 2面子 + 雀頭 = 8枚)。
    expect(at("123p 456p 9s", 2)).toBe(0);
    expect(at("111p 222p 9s", 2)).toBe(0);
  });

  it("門前(meldCount=0)は対象外として明示的に拒否する", () => {
    expect(() => shantenByDefinition34(new Array(34).fill(0), 0)).toThrow(
      RangeError,
    );
  });
});

/**
 * 副露あり(`melds ≠ []`)の分解・和了・待ちの照合(#390)。
 *
 * 上のクロス検証は `melds` に常に `[]` を渡しており、`decomposeStandard` /
 * `isCompleteHand` / `waitingTiles` の**副露経路が一度も照合されていなかった**
 * (issue #390)。ここでは副露 1〜4 組を持つ手を生成して照合する。
 *
 * 照合相手は `__oracle__/agari-oracle.ts`(本体 `extractMentsuAll` と分岐順まで同型で、
 * 共通欠陥に無力)ではなく、列挙非依存の
 * {@link standardFormsByDefinition34} / {@link waitingIndicesByDefinition34}。
 * これらは「和了形 W の側を全列挙して手牌との重なりを見る」だけで手牌の分解を行わないため、
 * 本体とオラクルの**両方に同じ列挙欠陥を注入しても red になる**(→ PR に実測を記載)。
 */
describe("クロス検証: 副露あり手の分解・和了・待ち (#390)", () => {
  /**
   * 副露経路の照合手牌数(副露数ごと)。定義ベースオラクルは可容な枝刈りが効くため
   * 1 手あたり 0.02ms 程度で、8 テスト合計でも 1 秒未満に収まる(→ PR に実測)。
   */
  const MELDED_HANDS = 2_000;

  it.each([[1], [2], [3], [4]])(
    "副露%d組: isCompleteHand と標準分解の集合が定義ベースオラクルと一致する",
    (meldCount) => {
      const rng = makeRng(0x3900_0100 + meldCount);
      const groupsNeeded = 4 - meldCount;
      // 不一致は「件数カウンタ」と「表示用サンプル(上限8)」を分ける。
      // 表示上限を検出条件に混ぜると、後で判定を緩めた瞬間に穴になる。
      let decompMismatch = 0;
      let completeMismatch = 0;
      const samples: string[] = [];
      let completeCount = 0;
      let multiFormCount = 0;
      let kanCount = 0;
      let ankanCount = 0;

      for (let i = 0; i < MELDED_HANDS; i += 1) {
        const hand = randomMeldedHand(
          rng,
          meldCount,
          14 - 3 * meldCount,
          i % 2 === 0,
        );
        const { concealedTiles, melds } = hand;
        for (const meld of melds) {
          if (meld.isKan) kanCount += 1;
          if (meld.concealed) ankanCount += 1;
        }

        const oracleForms = standardFormsByDefinition34(
          tilesToCount34(concealedTiles),
          groupsNeeded,
        );
        const expected = new Set(
          [...oracleForms].map((sig) =>
            joinSignature([
              ...sig.split("|").map((part) => `${part}@c`),
              ...meldSignatureParts(melds),
            ]),
          ),
        );
        const forms = decomposeStandard(concealedTiles, melds);
        const actual = new Set(
          forms.map((form) => formFullSignature([...form.melds, form.pair])),
        );

        if (!setEqual(actual, expected)) {
          decompMismatch += 1;
          if (samples.length < 8) {
            samples.push(
              `decomp ${describeMeldedHand(hand)} 本体=${[...actual].sort().join(" / ")} 定義ベース=${[...expected].sort().join(" / ")}`,
            );
          }
        }
        // 分解が食い違った手でも和了判定は独立に照合する(道連れで落とさない)。
        const complete = isCompleteHand(concealedTiles, melds);
        const oracleComplete = oracleForms.size > 0;
        if (complete !== oracleComplete) {
          completeMismatch += 1;
          if (samples.length < 8) {
            samples.push(
              `complete ${describeMeldedHand(hand)} 本体=${complete} 定義ベース=${oracleComplete}`,
            );
          }
        }
        if (oracleComplete) completeCount += 1;
        if (oracleForms.size > 1) multiFormCount += 1;
      }

      if (samples.length) console.log(samples.join("\n"));
      console.log(
        `[cross] melds=${meldCount} hands=${MELDED_HANDS} complete=${completeCount} multiForm=${multiFormCount} kan=${kanCount} ankan=${ankanCount} decompMismatch=${decompMismatch} completeMismatch=${completeMismatch}`,
      );
      expect(decompMismatch).toBe(0);
      expect(completeMismatch).toBe(0);
      // 照合が「和了しない手ばかり」で空回りしていないことを固定する(vacuum 防止)。
      expect(completeCount).toBeGreaterThan(MELDED_HANDS * 0.1);
      expect(kanCount).toBeGreaterThan(0);
      expect(ankanCount).toBeGreaterThan(0);
      // 「分解が一意に定まらない手」を踏んでいることも固定する。刻子3組 ⇔ 順子3組の
      // 読み替え(222333444p 等)は副露経路の照合で最も価値が高いケースなので、
      // ジェネレータが密集帯を作らなくなったら即座に落ちるようにしておく。
      //
      // 副露3組(門前5枚 = 1面子+雀頭)・4組(門前2枚 = 雀頭のみ)は分解が**常に一意**。
      // これはジェネレータの都合ではなく構造的事実で、`oracle.test.ts` の
      // 「1面子+雀頭 / 雀頭のみの和了形を総当たりすると分解は常に1通り」で固定してある。
      // よってここでも 0 であることを積極的に固定する。
      if (meldCount <= 2) {
        expect(multiFormCount).toBeGreaterThan(MELDED_HANDS * 0.05);
      } else {
        expect(multiFormCount).toBe(0);
      }
    },
  );

  it.each([[1], [2], [3], [4]])(
    "副露%d組: waitingTiles が定義ベースの待ちオラクルと一致する",
    (meldCount) => {
      const rng = makeRng(0x3900_0200 + meldCount);
      const groupsNeeded = 4 - meldCount;
      let waitMismatch = 0;
      const samples: string[] = [];
      let tenpaiCount = 0;
      let multiWaitCount = 0;

      for (let i = 0; i < MELDED_HANDS; i += 1) {
        const hand = randomMeldedHand(
          rng,
          meldCount,
          13 - 3 * meldCount,
          i % 2 === 0,
        );
        const { concealedTiles, melds } = hand;

        // 4枚使い切りの判定には副露牌も数える(`tenpai.ts` の usedCounts と同じ定義)。
        const used = tilesToCount34([
          ...concealedTiles,
          ...melds.flatMap((m) => [...m.tiles]),
        ]);
        const expected = waitingIndicesByDefinition34(
          tilesToCount34(concealedTiles),
          groupsNeeded,
          used,
        );
        const actual = new Set(
          waitingTiles(concealedTiles, melds).map((t) => tileTo34Index(t)),
        );

        if (!setEqualNum(actual, expected)) {
          waitMismatch += 1;
          if (samples.length < 8) {
            samples.push(
              `waits ${describeMeldedHand(hand)} 本体=${[...actual].sort((x, y) => x - y)} 定義ベース=${[...expected].sort((x, y) => x - y)}`,
            );
          }
        }
        if (expected.size > 0) tenpaiCount += 1;
        if (expected.size > 1) multiWaitCount += 1;
      }

      if (samples.length) console.log(samples.join("\n"));
      console.log(
        `[cross] melds=${meldCount} hands=${MELDED_HANDS} tenpai=${tenpaiCount} multiWait=${multiWaitCount} waitMismatch=${waitMismatch}`,
      );
      expect(waitMismatch).toBe(0);
      // vacuum 防止: テンパイ手と多面待ちを実際に踏んでいることを固定する。
      expect(tenpaiCount).toBeGreaterThan(MELDED_HANDS * 0.1);
      // 副露4組は門前1枚の単騎のみで、待ちは常に1種類(多面待ちは構造上あり得ない)。
      if (meldCount <= 3) {
        expect(multiWaitCount).toBeGreaterThan(MELDED_HANDS * 0.01);
      } else {
        expect(multiWaitCount).toBe(0);
      }
    },
  );

  it("副露牌で4枚使い切った牌種は単騎待ちにならない(副露の消費を数える)", () => {
    // 4副露 + 門前1枚の単騎テンパイ。単騎の牌種が副露で3枚消費済みなら、
    // 5枚目は存在しないので待ちは空になる。`tenpai.ts` の `usedCounts` が
    // 副露牌を数えなくなると、この手が「東単騎テンパイ」として通ってしまう。
    const pon = (notation: string): GeneratedMeld => ({
      tiles: parseTiles(notation),
      isKan: false,
      concealed: false,
    });
    const base = [pon("111p"), pon("222p"), pon("333p")];
    const concealed = parseTiles("1z");

    // 東を3枚ポン済み → 門前の東と合わせて4枚使い切り。待ちなし。
    expect(waitingTiles(concealed, [pon("111z"), ...base])).toEqual([]);
    // 対照: 副露が南なら東は残り3枚あるので単騎待ちが成立する。
    expect(
      waitingTiles(concealed, [pon("222z"), ...base]).map(tileNotation),
    ).toEqual(["1z"]);
  });
});

/**
 * 門前手(`melds = []`)の分解・待ちの定義ベース照合(#429)。
 *
 * 冒頭の「クロス検証: 和了・分解・待ち」は門前手を `__oracle__/agari-oracle.ts` と
 * だけ突き合わせている。しかし `agari-oracle.ts` の `decomposeMeldsOnly` は本体
 * `hand/decompose.ts` の `extractMentsuAll` と**再帰の分岐順まで同型**なので、
 * **列挙側の共通欠陥は素通りする**。実際 PR #427 では、両方に同じ
 * 「刻子が取れたら順子を試さない」欠陥を注入しても門前14枚の分解照合は緑のまま通り、
 * 副露経路の定義ベース照合だけが検出した(#429 の起票理由)。
 *
 * ここでは #390 で副露経路に用意した列挙非依存のオラクルを `groupsNeeded = 4` で
 * 門前にも適用し、その空白を埋める。門前は七対子・国士も成立し得るため、
 * 定義ベース側に両特殊形を追加して `isCompleteHand` / `waitingTiles` と同じ粒度で
 * 突き合わせる(issue #429 の提案2の後者)。
 */
describe("クロス検証: 門前手の分解・和了・待ち(定義ベース / #429)", () => {
  /**
   * 門前照合の手牌数。定義ベースオラクル自体は門前でも 1 手あたり 0.01〜0.02ms だが、
   * 突き合わせ相手の `waitingTiles()` が 1 手につき 27 牌種ぶん `isCompleteHand` を
   * 回すため、13枚側の実行時間はそちらに支配される。冒頭のクロス検証と手牌の作り方が
   * 重なるので、CI 時間とのバランスでここは半分(10,000 手)に絞る(→ PR に実測)。
   *
   * 冒頭のブロックと**統合はしない**。あちらの相手 `agari-oracle.ts` は外部参照
   * ライブラリでアンカーされた唯一のオラクルで、定義ベースオラクルは外部アンカーを
   * 持たない代わりに列挙構造が独立という別の役割を持つ(README の三層構造)。
   */
  const MENZEN_HANDS = 10_000;

  /** `menzen14` が必ず多重分解の手を返す回数(= 下限アサーションの根拠)。 */
  const GUARANTEED_AMBIGUOUS = MENZEN_HANDS / AMBIGUOUS_MENZEN_EVERY;

  it("門前14枚: 標準分解の集合と和了判定が定義ベースオラクルと一致する", () => {
    const rng = makeRng(0x4290_0014);
    let decompMismatch = 0;
    let completeMismatch = 0;
    const samples: string[] = [];
    let completeCount = 0;
    let multiFormCount = 0;

    for (let i = 0; i < MENZEN_HANDS; i += 1) {
      const tiles = menzen14(rng, i);
      const counts = tilesToCount34(tiles);

      const oracleForms = standardFormsByDefinition34(counts, MENZEN_GROUPS);
      const actual = new Set(
        decomposeStandard(tiles, []).map((f) => formSignature(f.melds, f.pair)),
      );
      if (!setEqual(actual, oracleForms)) {
        decompMismatch += 1;
        if (samples.length < 8) {
          samples.push(
            `decomp ${describeHand(tiles)} 本体=${[...actual].sort().join(" / ")} 定義ベース=${[...oracleForms].sort().join(" / ")}`,
          );
        }
      }

      // `isCompleteHand` は特殊形も含むので、定義ベース側も同じ和を取る。
      const oracleComplete =
        oracleForms.size > 0 ||
        isSevenPairsByDefinition34(counts) ||
        isThirteenOrphansByDefinition34(counts);
      const complete = isCompleteHand(tiles, []);
      if (complete !== oracleComplete) {
        completeMismatch += 1;
        if (samples.length < 8) {
          samples.push(
            `complete ${describeHand(tiles)} 本体=${complete} 定義ベース=${oracleComplete}`,
          );
        }
      }
      if (oracleComplete) completeCount += 1;
      if (oracleForms.size > 1) multiFormCount += 1;
    }

    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] menzen 14-tile hands=${MENZEN_HANDS} complete=${completeCount} multiForm=${multiFormCount} decompMismatch=${decompMismatch} completeMismatch=${completeMismatch}`,
    );
    expect(decompMismatch).toBe(0);
    expect(completeMismatch).toBe(0);
    // vacuum 防止: 和了手と多重分解手を実際に踏んでいることを固定する。
    // 閾値は「`menzen14` が返す曖昧形は必ず和了形かつ多重分解」という構造的事実から
    // 導く(固定シード頼みにしない)。`AMBIGUOUS_MENZEN_EVERY` を変えれば追随する。
    expect(completeCount).toBeGreaterThanOrEqual(GUARANTEED_AMBIGUOUS);
    expect(multiFormCount).toBeGreaterThanOrEqual(GUARANTEED_AMBIGUOUS);
  });

  it("門前13枚: waitingTiles が定義ベースの待ちオラクルと一致する", () => {
    const rng = makeRng(0x4290_0013);
    let waitMismatch = 0;
    const samples: string[] = [];
    let tenpaiCount = 0;
    let multiWaitCount = 0;

    for (let i = 0; i < MENZEN_HANDS; i += 1) {
      const tiles = dropOne(rng, menzen14(rng, i));
      const counts = tilesToCount34(tiles);

      const expected = menzenWaitingIndicesByDefinition34(counts);
      const actual = new Set(
        waitingTiles(tiles, []).map((t) => tileTo34Index(t)),
      );
      if (!setEqualNum(actual, expected)) {
        waitMismatch += 1;
        if (samples.length < 8) {
          samples.push(
            `waits ${describeHand(tiles)} 本体=${[...actual].sort((x, y) => x - y)} 定義ベース=${[...expected].sort((x, y) => x - y)}`,
          );
        }
      }
      if (expected.size > 0) tenpaiCount += 1;
      if (expected.size > 1) multiWaitCount += 1;
    }

    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] menzen 13-tile hands=${MENZEN_HANDS} tenpai=${tenpaiCount} multiWait=${multiWaitCount} waitMismatch=${waitMismatch}`,
    );
    expect(waitMismatch).toBe(0);
    // 曖昧形(和了形)から1枚落とした手は必ずテンパイなので、下限は構造的に決まる。
    expect(tenpaiCount).toBeGreaterThanOrEqual(GUARANTEED_AMBIGUOUS);
    // 多面待ちは構造保証が無いので割合で押さえる(実測は 40% 前後)。
    expect(multiWaitCount).toBeGreaterThan(MENZEN_HANDS * 0.05);
  });

  /**
   * ランダム生成では七対子・国士は事実上出ない(`randomStructuredHand` は
   * 4面子1雀頭から作る)。定義ベース側に足した特殊形が空回りしないよう、
   * 特殊形の手を**決め打ちで総当たり**して照合する。
   */
  it("七対子: 相異なる7対子の和了形とその1枚不足を総当たりで照合する", () => {
    // サンマの牌種が27であることを固定してから件数をリテラルで押さえる。
    // `SANMA_INDICES_34.length` から導くと self-fulfilling になり、牌種が縮んでも
    // 総当たりが減ったことを検出できない(国士側と同じ理由)。なお stride 2 は
    // 牌種数が偶数でも 14 以上なら 7 種は相異なるので、それだけでは守れない。
    expect(SANMA_INDICES_34).toHaveLength(27);
    let hands = 0;
    let tenpaiHands = 0;
    for (let offset = 0; offset < SANMA_INDICES_34.length; offset += 1) {
      // 27 牌種から stride 2 で 7 種を選ぶ(相異なることが保証される)。
      const kinds = Array.from(
        { length: 7 },
        (_, k) =>
          SANMA_INDICES_34[
            (offset + 2 * k) % SANMA_INDICES_34.length
          ] as number,
      );
      // stride 2 は 27 と互いに素なので 7 種は必ず相異なる。前提を直接固定する。
      expect(new Set(kinds).size, `offset=${offset}`).toBe(7);
      const counts = new Array<number>(34).fill(0);
      for (const index of kinds) counts[index] = 2;

      const tiles14 = count34ToTiles(counts);
      hands += 1;
      expect(isSevenPairsByDefinition34(counts), describeHand(tiles14)).toBe(
        true,
      );
      expect(isCompleteHand(tiles14, []), describeHand(tiles14)).toBe(true);

      // 1枚落とすと七対子テンパイ(その牌の単騎待ち)。標準形の待ちが加わることも
      // あるので、集合そのものを本体と突き合わせる。
      for (const dropped of kinds) {
        counts[dropped] = 1;
        const tiles13 = count34ToTiles(counts);
        const expectedWaits = menzenWaitingIndicesByDefinition34(counts);
        const actualWaits = new Set(
          waitingTiles(tiles13, []).map((t) => tileTo34Index(t)),
        );
        expect(expectedWaits.has(dropped), describeHand(tiles13)).toBe(true);
        expect(
          setEqualNum(actualWaits, expectedWaits),
          `${describeHand(tiles13)} 本体=${[...actualWaits].sort((x, y) => x - y)} 定義ベース=${[...expectedWaits].sort((x, y) => x - y)}`,
        ).toBe(true);
        tenpaiHands += 1;
        counts[dropped] = 2;
      }
    }
    expect(hands).toBe(27);
    expect(tenpaiHands).toBe(27 * 7);
  });

  it("国士無双: 雀頭13通りの和了形と、単騎・十三面のテンパイを照合する", () => {
    const orphans = TERMINAL_AND_HONOR_INDICES_34;
    // 么九が13種であることと総当たり件数を固定する(七対子側と対称)。
    // これが無いと `TERMINAL_AND_HONOR_INDICES_34` が縮んでも静かに緑のまま通る。
    expect(orphans).toHaveLength(13);
    let hands = 0;
    let tenpaiHands = 0;
    for (const doubled of orphans) {
      const counts = new Array<number>(34).fill(0);
      for (const index of orphans) counts[index] = index === doubled ? 2 : 1;
      const tiles14 = count34ToTiles(counts);
      hands += 1;
      expect(
        isThirteenOrphansByDefinition34(counts),
        describeHand(tiles14),
      ).toBe(true);
      expect(isCompleteHand(tiles14, []), describeHand(tiles14)).toBe(true);

      // 雀頭の1枚を落とすと単騎待ち、他の1種を落とすとその牌の待ち。
      for (const dropped of orphans) {
        counts[dropped] -= 1;
        const tiles13 = count34ToTiles(counts);
        const expectedWaits = menzenWaitingIndicesByDefinition34(counts);
        const actualWaits = new Set(
          waitingTiles(tiles13, []).map((t) => tileTo34Index(t)),
        );
        expect(expectedWaits.has(dropped), describeHand(tiles13)).toBe(true);
        expect(
          setEqualNum(actualWaits, expectedWaits),
          `${describeHand(tiles13)} 本体=${[...actualWaits].sort((x, y) => x - y)} 定義ベース=${[...expectedWaits].sort((x, y) => x - y)}`,
        ).toBe(true);
        tenpaiHands += 1;
        counts[dropped] += 1;
      }
    }
    expect(hands).toBe(13);
    expect(tenpaiHands).toBe(13 * 13);

    // 么九13種を1枚ずつ(13枚)= 十三面待ち。本体とも突き合わせる。
    const thirteenSided = new Array<number>(34).fill(0);
    for (const index of orphans) thirteenSided[index] = 1;
    const sortedOrphans = [...orphans].sort((a, b) => a - b);
    expect(
      [...menzenWaitingIndicesByDefinition34(thirteenSided)].sort(
        (a, b) => a - b,
      ),
    ).toEqual(sortedOrphans);
    expect(
      waitingTiles(count34ToTiles(thirteenSided), [])
        .map(tileTo34Index)
        .sort((a, b) => a - b),
    ).toEqual(sortedOrphans);
  });

  /**
   * 七対子と標準形が**同時に**成立する手(`11223344556677p` 型)。
   *
   * 乱択側にも `randomAmbiguousMenzenHand` 経由でこの族が入っているが、期待値を
   * 名指しで固定するのはここだけ。上の総当たりは 27 牌種を stride 2 で拾うため
   * 数牌が隣接せず、標準形は一度も成立しない。つまり 14枚の
   * `oracleForms.size > 0 || isSevenPairs… || isThirteenOrphans…` という OR が、
   * **両辺同時に真**の状態で一度も評価されていない。ここで踏んでおく。
   *
   * ⚠️ 13枚の待ちについては、この手を足しても「和」そのものは固定できない。
   * 標準形テンパイと七対子テンパイが同時に成立する手では、七対子の単騎は
   * **必ず標準形の待ちに含まれる**ため(6対子+1単騎の 13 枚 C(27,7)×7 通りを
   * 総当たりして反例 0 を確認済み)、七対子項は何も足さないからである。
   * 七対子項の寄与は上の stride-2 総当たり(標準形が空になる手)が固定している。
   */
  it("七対子かつ標準形の手で、和了判定と待ちの合成が本体と一致する", () => {
    const tiles14 = parseTiles("11223344556677p");
    const counts14 = tilesToCount34(tiles14);
    const forms = standardFormsByDefinition34(counts14, MENZEN_GROUPS);
    // 両辺が同時に非空であること自体を固定する(片方だけになったら空回り)。
    expect(isSevenPairsByDefinition34(counts14)).toBe(true);
    expect(forms.size).toBeGreaterThan(0);
    expect(isCompleteHand(tiles14, [])).toBe(true);
    expect(
      new Set(
        decomposeStandard(tiles14, []).map((f) =>
          formSignature(f.melds, f.pair),
        ),
      ),
    ).toEqual(forms);

    // 13枚: 標準形の三面張(1p/4p/7p)と七対子の単騎(7p)。上のとおり七対子の単騎は
    // 標準形の待ちに含まれるので、和は標準形の三面張と一致する。
    const tiles13 = parseTiles("1122334455667p");
    const counts13 = tilesToCount34(tiles13);
    const expectedWaits = menzenWaitingIndicesByDefinition34(counts13);
    expect([...expectedWaits].sort((a, b) => a - b)).toEqual(
      parseTiles("1p 4p 7p")
        .map(tileTo34Index)
        .sort((a, b) => a - b),
    );
    expect(
      new Set(waitingTiles(tiles13, []).map((t) => tileTo34Index(t))),
    ).toEqual(expectedWaits);

    // 対照1: 么九だらけでも国士でも七対子でもない13枚は待ちが空(特殊形の偽陽性固定)。
    const notSpecial = parseTiles("111m 999p 19s 12345z");
    expect(
      menzenWaitingIndicesByDefinition34(tilesToCount34(notSpecial)).size,
    ).toBe(0);
    expect(waitingTiles(notSpecial, [])).toEqual([]);

    // 対照2: 4枚使いを含む「6種」は七対子にならない。オラクル側だけでなく
    // 本体(`decomposeSevenPairs`)とも突き合わせる。
    const fourCopies = parseTiles("1111p 33p 55p 77p 99p 22s");
    expect(isSevenPairsByDefinition34(tilesToCount34(fourCopies))).toBe(false);
    expect(isCompleteHand(fourCopies, [])).toBe(false);
  });
});

/** 分解1件(副露由来の面子を含む)の正規化シグネチャ。`@c` は暗、`@o` は明。 */
function formFullSignature(groups: readonly Mentsu[]): string {
  return joinSignature(
    groups.map(
      (g) => `${g.kind}:${g.suit}${g.startRank}@${g.concealed ? "c" : "o"}`,
    ),
  );
}

/** 生成された副露が分解結果に現れるべき姿(カンは quad・暗槓のみ concealed)。 */
function meldSignatureParts(melds: readonly GeneratedMeld[]): string[] {
  return melds.map((meld) => {
    const tile = meld.tiles[0];
    return `${meld.isKan ? "quad" : "triplet"}:${tile.suit}${tile.rank}@${
      meld.concealed ? "c" : "o"
    }`;
  });
}

function joinSignature(parts: readonly string[]): string {
  return [...parts].sort().join("|");
}

/** 失敗メッセージ用。副露はポン/明槓/暗槓が読み分けられる形で書き出す。 */
function describeMeldedHand(hand: MeldedHand): string {
  const label = (m: GeneratedMeld): string => {
    if (!m.isKan) return "ポン";
    return m.concealed ? "暗槓" : "明槓";
  };
  const melds = hand.melds
    .map((m) => `[${m.tiles.map(tileNotation).join("")}${label(m)}]`)
    .join("");
  return `${describeHand(hand.concealedTiles)} ${melds}`;
}
