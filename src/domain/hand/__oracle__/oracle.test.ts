/**
 * 参照オラクル自体の単体検証(issue #138)。
 *
 * オラクルは MIT ライブラリ MahjongRepository/mahjong のアルゴリズム構造を独自再実装した
 * もの。大量ランダム照合(参照ライブラリ is_three_player=True と 4枚使い除外の 12,478 手で
 * shanten/regular/和了/待ち 全一致)でアンカー済みだが、ここでは既知手牌で意図した挙動を
 * 固定し、オラクルのリグレッションを防ぐ(サンマ萬子2-8スキップ・七対子・国士・赤5・
 * 4枚使いの理想化を明示)。
 */

import { describe, expect, it } from "vitest";
import { parseTiles } from "../notation";
import {
  isCompleteOracle34,
  standardDecompositions34,
  waitingIndicesOracle34,
} from "./agari-oracle";
import { SANMA_INDICES_34, tilesToCount34, tileTo34Index } from "./counts34";
import {
  isSevenPairsByDefinition34,
  isThirteenOrphansByDefinition34,
  menzenWaitingIndicesByDefinition34,
  standardFormsByDefinition34,
  waitingIndicesByDefinition34,
} from "./definition-oracle";
import { AGARI, shantenOracle34, TENPAI } from "./shanten-oracle";

const sh = (notation: string): number =>
  shantenOracle34(tilesToCount34(parseTiles(notation)));
const complete = (notation: string): boolean =>
  isCompleteOracle34(tilesToCount34(parseTiles(notation)));
const waits = (notation: string): number[] =>
  [...waitingIndicesOracle34(tilesToCount34(parseTiles(notation)))].sort(
    (a, b) => a - b,
  );
const waitIndices = (notation: string): number[] =>
  parseTiles(notation)
    .map(tileTo34Index)
    .sort((a, b) => a - b);

describe("shantenOracle34: 標準形", () => {
  it("4面子1雀頭は和了(-1)", () => {
    expect(sh("123p 456p 789p 111s 99s")).toBe(AGARI);
  });

  it("4面子+単騎はテンパイ(0)", () => {
    expect(sh("123p 456p 789p 111s 9s")).toBe(TENPAI);
  });

  it("赤5(5筒/5索)を含む順子でも構造は同一(赤は無視)", () => {
    // 345p / 345s は 5 が赤でも順子として成立する。
    expect(complete("345p 678p 111s 999s 33z")).toBe(true); // 345p に赤5筒
    expect(sh("345p 678p 111s 999s 3z")).toBe(TENPAI); // 3z 単騎
  });

  it("1向聴・2向聴を正しく数える", () => {
    // 3面子 + 塔子2・雀頭なし → 1向聴。
    expect(sh("123p 456p 789p 12s 46s")).toBe(1);
    // 2面子 + 塔子3・雀頭なし + 孤立 → 2向聴。
    expect(sh("123p 456p 12s 45s 78s 5z")).toBe(2);
  });
});

describe("shantenOracle34: サンマ制約(萬子2-8スキップ)", () => {
  it("萬子は順子を作れない(1m9m は孤立)", () => {
    // 19m を含む形は萬子順子が作れないため和了にならない。
    expect(complete("19m 123p 456p 789p 99s")).toBe(false);
  });

  it("1m/9m は刻子・雀頭にはなれる", () => {
    expect(complete("111m 123p 456p 789p 99s")).toBe(true);
    expect(complete("99m 123p 456p 789p 111s")).toBe(true);
  });
});

describe("shantenOracle34: 七対子・国士", () => {
  it("6対子+1単騎は七対子テンパイ(0)", () => {
    expect(sh("11p 33p 55p 77p 99p 22s 4s")).toBe(TENPAI);
    expect(waits("11p 33p 55p 77p 99p 22s 4s")).toEqual(waitIndices("4s"));
  });

  it("相異なる7対子は和了(-1)", () => {
    expect(sh("11p 33p 55p 77p 99p 22s 44s")).toBe(AGARI);
    expect(complete("11p 33p 55p 77p 99p 22s 44s")).toBe(true);
  });

  it("国士十三面(么九13種)はテンパイで13面待ち", () => {
    const hand = "19m 19p 19s 1234567z";
    expect(sh(hand)).toBe(TENPAI);
    expect(waits(hand)).toEqual(waitIndices("19m 19p 19s 1234567z"));
  });

  it("国士(13種+1雀頭)は和了(-1)", () => {
    expect(sh("19m 19p 19s 11234567z")).toBe(AGARI);
    expect(complete("19m 19p 19s 11234567z")).toBe(true);
  });
});

describe("standardDecompositions34: 多面分解", () => {
  it("刻子/順子の二義性を全通り列挙する", () => {
    // 222333444p は [222][333][444] / [234][234][234] / (22雀頭+234+345+345… は别形)。
    const forms = standardDecompositions34(
      tilesToCount34(parseTiles("222333444p 55p 678s")),
    );
    expect(forms.size).toBe(3);
  });

  it("和了形でない手は空", () => {
    expect(
      standardDecompositions34(
        tilesToCount34(parseTiles("123p 456p 789p 135s 99s")),
      ).size,
    ).toBe(0);
  });
});

describe("waitingIndicesOracle34", () => {
  it("両面待ちを列挙する", () => {
    // 123p 456p 789p 11s + 45s → 3s/6s 両面待ち。
    expect(waits("123p 456p 789p 11s 45s")).toEqual(waitIndices("3s 6s"));
  });

  it("シャンポン待ちを列挙する", () => {
    // 123p 456p 789p 11s 99s(13枚) → 1s/9s シャンポン。
    expect(waits("123p 456p 789p 11s 99s")).toEqual(waitIndices("1s 9s"));
  });

  it("テンパイでなければ空", () => {
    expect(waits("123p 456p 78p 13s 57s 9s")).toEqual([]);
  });
});

describe("定義ベースの分解・待ちオラクル(副露経路 / #390)", () => {
  const forms = (notation: string, groupsNeeded: number): string[] =>
    [
      ...standardFormsByDefinition34(
        tilesToCount34(parseTiles(notation)),
        groupsNeeded,
      ),
    ].sort();
  const defWaits = (
    notation: string,
    groupsNeeded: number,
    meldNotation = "",
  ): number[] => {
    const concealed = tilesToCount34(parseTiles(notation));
    const used = tilesToCount34([
      ...parseTiles(notation),
      ...parseTiles(meldNotation),
    ]);
    return [
      ...waitingIndicesByDefinition34(concealed, groupsNeeded, used),
    ].sort((a, b) => a - b);
  };

  it("副露1組(門前は3面子+雀頭の11枚)の多面分解を全通り列挙する", () => {
    // 222333444p + 55p 雀頭 → [222][333][444] / [234]×3 / [234][345]… の3通り。
    // 門前14枚のケース(standardDecompositions34)と同じ分解数になる。
    expect(forms("222333444p 55p", 3)).toHaveLength(3);
  });

  it("副露2組(門前は2面子+雀頭の8枚)の分解を列挙する", () => {
    expect(forms("123p 456p 99s", 2)).toEqual([
      "pair:sou9|sequence:pin1|sequence:pin4",
    ]);
  });

  it("和了形でない門前部分は空集合", () => {
    expect(forms("123p 457p 99s", 2)).toEqual([]);
  });

  it("枚数と groupsNeeded が噛み合わない呼び出しは失敗する(静かに0件にしない)", () => {
    // 8枚を「3面子+雀頭(11枚)」として渡す契約違反。空集合を返すと
    // 「和了形でない」と区別が付かず、照合が静かに空回りする。
    expect(() => forms("123p 456p 99s", 3)).toThrow(RangeError);
    expect(() => defWaits("123p 9s", 2)).toThrow(RangeError);
    expect(() => forms("123p 456p 99s", 5)).toThrow(RangeError);
    expect(() => forms("123p 456p 99s", -1)).toThrow(RangeError);
  });

  it("副露2組の三面張を列挙する(2面子+雀頭の1枚不足)", () => {
    // 23456p 99s(7枚)→ 1p(123+456) / 4p(234+456) / 7p(234+567)。
    expect(defWaits("23456p 99s", 2)).toEqual(waitIndices("1p 4p 7p"));
  });

  it("副露3組の単騎待ちを列挙する(門前4枚)", () => {
    expect(defWaits("123p 9s", 1)).toEqual(waitIndices("9s"));
  });

  it("副露牌で4枚使い切った牌種は待ちから除外する", () => {
    // 門前 1p 単騎、副露に 1p が3枚(ポン)→ 1p は4枚使い切りで待ちにならない。
    expect(defWaits("1p", 0, "111p")).toEqual([]);
    // 副露が別牌種なら 1p 単騎が成立する。
    expect(defWaits("1p", 0, "111z")).toEqual(waitIndices("1p"));
  });

  it("テンパイでなければ空", () => {
    expect(defWaits("1p 3p 5s 7s 9s 1z 3z", 2)).toEqual([]);
  });

  // `cross-validation.test.ts` の副露3組・4組は `multiFormCount` が 0 であることを
  // 積極的に固定している。その根拠が「ジェネレータが偶然作れていないだけ」ではなく
  // **構造的事実**であることを、和了形の総当たりでここに固定する。
  it("1面子+雀頭(5枚)の和了形は総当たりしても分解が常に1通り", () => {
    let hands = 0;
    let maxForms = 0;
    for (const counts of allWinningCounts(1)) {
      hands += 1;
      maxForms = Math.max(
        maxForms,
        standardFormsByDefinition34(counts, 1).size,
      );
    }
    expect(hands).toBeGreaterThan(1_000); // 空回り防止
    expect(maxForms).toBe(1);
  });

  it("雀頭のみ(2枚)の和了形も分解が常に1通り", () => {
    let hands = 0;
    let maxForms = 0;
    for (const counts of allWinningCounts(0)) {
      hands += 1;
      maxForms = Math.max(
        maxForms,
        standardFormsByDefinition34(counts, 0).size,
      );
    }
    expect(hands).toBe(SANMA_INDICES_34.length);
    expect(maxForms).toBe(1);
  });

  it("副露4組(門前1枚)の待ちは総当たりしても常に単騎1種以下", () => {
    let maxWaits = 0;
    for (const index of SANMA_INDICES_34) {
      const concealed = new Array<number>(34).fill(0);
      concealed[index] = 1;
      const used = [...concealed];
      maxWaits = Math.max(
        maxWaits,
        waitingIndicesByDefinition34(concealed, 0, used).size,
      );
    }
    expect(maxWaits).toBe(1);
  });
});

describe("定義ベースの門前オラクル(標準形 + 七対子・国士 / #429)", () => {
  const counts = (notation: string): number[] =>
    tilesToCount34(parseTiles(notation));
  const forms = (notation: string): string[] =>
    [...standardFormsByDefinition34(counts(notation), 4)].sort();
  const menzenWaits = (notation: string): number[] =>
    [...menzenWaitingIndicesByDefinition34(counts(notation))].sort(
      (a, b) => a - b,
    );

  it("門前14枚(groupsNeeded=4)の多面分解を全通り列挙する", () => {
    // `standardDecompositions34` と同じ 3 通り(222/333/444 ⇔ 234×3 ⇔ 234+345+345…)。
    expect(forms("222333444p 55p 678s")).toHaveLength(3);
    // 列挙構造が独立でも結果は一致する。
    expect(forms("222333444p 55p 678s")).toEqual(
      [...standardDecompositions34(counts("222333444p 55p 678s"))].sort(),
    );
  });

  it("門前13枚の標準形の待ちを列挙する(三面張)", () => {
    // 234567p は 1p/4p/7p の三面張。
    expect(menzenWaits("23456p 789p 111s 99s")).toEqual(
      waitIndices("1p 4p 7p"),
    );
  });

  it("七対子は相異なる7対子のみ成立し、4枚使いは弾く", () => {
    expect(
      isSevenPairsByDefinition34(counts("11p 33p 55p 77p 99p 22s 44s")),
    ).toBe(true);
    // 2枚+4枚の「6種」は 7 対子にならない。
    expect(
      isSevenPairsByDefinition34(counts("1111p 33p 55p 77p 99p 22s")),
    ).toBe(false);
    // 標準形の和了(4面子1雀頭)は七対子ではない。
    expect(isSevenPairsByDefinition34(counts("123p 456p 789p 111s 99s"))).toBe(
      false,
    );
  });

  it("七対子テンパイの単騎待ちを待ち集合に含める", () => {
    // 6対子 + 4s 単騎。標準形では和了れないので待ちは 4s のみ。
    expect(menzenWaits("11p 33p 55p 77p 99p 22s 4s")).toEqual(
      waitIndices("4s"),
    );
  });

  it("国士は么九13種+1雀頭で成立し、么九以外が混ざれば不成立", () => {
    expect(
      isThirteenOrphansByDefinition34(counts("19m 19p 19s 11234567z")),
    ).toBe(true);
    // 么九以外(5p)が混ざれば不成立。
    expect(
      isThirteenOrphansByDefinition34(counts("19m 159p 19s 1234567z")),
    ).toBe(false);
    // 全て么九でも 12 種しかない(1m と 9p が対子・9s 欠け)なら不成立。
    expect(
      isThirteenOrphansByDefinition34(counts("119m 199p 1s 1234567z")),
    ).toBe(false);
  });

  it("国士十三面待ちを待ち集合に含める", () => {
    expect(menzenWaits("19m 19p 19s 1234567z")).toEqual(
      waitIndices("19m 19p 19s 1234567z"),
    );
  });

  it("門前の枚数が噛み合わない呼び出しは失敗する(静かに false / 空集合にしない)", () => {
    expect(() => isSevenPairsByDefinition34(counts("11p 33p 55p"))).toThrow(
      RangeError,
    );
    expect(() =>
      isThirteenOrphansByDefinition34(counts("19m 19p 19s 1234567z")),
    ).toThrow(RangeError); // 13枚を14枚判定へ渡した
    expect(() =>
      menzenWaitingIndicesByDefinition34(counts("19m 19p 19s 11234567z")),
    ).toThrow(RangeError); // 14枚を13枚判定へ渡した
  });
});

/**
 * `groupsNeeded` 面子 + 雀頭で作れる和了形の 34-index カウントを重複なく全列挙する。
 * 面子候補(刻子27種 + 順子14種)と雀頭候補の直積から作るため、
 * 「和了形になる多重集合」を漏れなく覆う。
 */
function* allWinningCounts(groupsNeeded: number): Generator<number[]> {
  const groups: number[][] = [];
  for (const index of SANMA_INDICES_34) groups.push([index, index, index]);
  for (const base of [9, 18]) {
    for (let offset = 0; offset < 7; offset += 1) {
      groups.push([base + offset, base + offset + 1, base + offset + 2]);
    }
  }
  const seen = new Set<string>();
  const emit = function* (
    counts: number[],
    start: number,
    remaining: number,
  ): Generator<number[]> {
    if (remaining === 0) {
      for (const pair of SANMA_INDICES_34) {
        if (counts[pair] + 2 > 4) continue;
        counts[pair] += 2;
        const key = counts.join(",");
        if (!seen.has(key)) {
          seen.add(key);
          yield [...counts];
        }
        counts[pair] -= 2;
      }
      return;
    }
    for (let g = start; g < groups.length; g += 1) {
      const group = groups[g] as number[];
      let pushed = 0;
      let ok = true;
      for (const i of group) {
        if (counts[i] >= 4) {
          ok = false;
          break;
        }
        counts[i] += 1;
        pushed += 1;
      }
      if (ok) yield* emit(counts, g, remaining - 1);
      for (let k = pushed - 1; k >= 0; k -= 1) counts[group[k] as number] -= 1;
    }
  };
  yield* emit(new Array<number>(34).fill(0), 0, groupsNeeded);
}

describe("4枚使いの理想化(本作 ai.ts と共通・参照とは既知の ±1 差・#143)", () => {
  it("全4枚が手牌の単騎/シャンポンは牌残量無視の理想化で 0(参照は 1)", () => {
    // 444p 8888p 789s 東東東: 888p+浮き8p の単騎待ちは5枚目が引けず本来デッド。
    // 本作 ai.ts と同じ理想化(牌残量を見ない)により向聴 0 として扱う。
    expect(sh("444p 8888p 789s 111z")).toBe(TENPAI);
  });
});
