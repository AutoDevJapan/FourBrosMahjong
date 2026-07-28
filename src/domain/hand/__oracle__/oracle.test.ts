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
import { tilesToCount34, tileTo34Index } from "./counts34";
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

describe("4枚使いの理想化(本作 ai.ts と共通・参照とは既知の ±1 差・#143)", () => {
  it("全4枚が手牌の単騎/シャンポンは牌残量無視の理想化で 0(参照は 1)", () => {
    // 444p 8888p 789s 東東東: 888p+浮き8p の単騎待ちは5枚目が引けず本来デッド。
    // 本作 ai.ts と同じ理想化(牌残量を見ない)により向聴 0 として扱う。
    expect(sh("444p 8888p 789s 111z")).toBe(TENPAI);
  });
});
