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
  tilesToCount34,
  tileTo34Index,
} from "./__oracle__/counts34";
import {
  shantenByDefinition34,
  standardFormsByDefinition34,
  waitingIndicesByDefinition34,
} from "./__oracle__/definition-oracle";
import {
  type GeneratedMeld,
  type MeldedHand,
  makeRng,
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
    const samples: string[] = [];
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      const tiles = randomStructuredHand(rng);
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
    }
    if (samples.length) console.log(samples.join("\n"));
    console.log(
      `[cross] 14-tile hands compared, complete=${completeCount} completeMismatch=${completeMismatch} decompMismatch=${decompMismatch}`,
    );
    expect(completeMismatch).toBe(0);
    expect(decompMismatch).toBe(0);
  });

  it("13枚: waitingTiles と待ちオラクルの集合が一致する", () => {
    const rng = makeRng(0x3030_4040);
    let waitMismatch = 0;
    let tenpaiCount = 0;
    const samples: string[] = [];
    // ランダム+構造化を混ぜてテンパイ〜非テンパイを厚く。
    for (let i = 0; i < STRUCTURED_HANDS; i += 1) {
      const tiles = rng() < 0.5 ? randomHand(rng, 13) : structured13(rng);
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
  if (tiles.length !== 14) return tiles.slice(0, 13);
  const drop = Math.floor(rng() * 14);
  return [...tiles.slice(0, drop), ...tiles.slice(drop + 1)];
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
