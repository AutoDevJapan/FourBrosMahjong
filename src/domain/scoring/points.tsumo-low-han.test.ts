import { describe, expect, it } from "vitest";
import { computeScore } from "./points";

/** 非役満(翻指定)の入力ヘルパ。 */
function han(n: number) {
  return { han: n, yakumanMultiplier: 0 };
}

/**
 * 4翻以下のツモ配分(北家折半・切り上げ)の確定挙動を固定する(issue #120)。
 *
 * `points.test.ts` のツモ配分テストは満貫以上(basePoints ≥ 2000)のみを
 * 検証しており、`ceil100(a×1.5/2.5/3)` が満貫帯とは別の切り上げ regime に
 * 入る低翻(basePoints 240〜1,920)が未検証だった。spec 3.1 の確定テーブル
 * (`scoring-and-settlement.md:134-141`)と +100 注記(`:143`)を固定する。
 */
describe("computeScore — 4翻以下のツモ配分(北家折半・切り上げ / issue #120)", () => {
  const table: Array<{
    han: number;
    basePoints: number;
    childFromDealer: number; // 子ツモ: 親払い ceil100(a×2.5)
    childFromChild: number; // 子ツモ: 子払い ceil100(a×1.5)
    dealerFromChild: number; // 親ツモ: 子各払い ceil100(a×3)
  }> = [
    {
      han: 1,
      basePoints: 240,
      childFromDealer: 600,
      childFromChild: 400,
      dealerFromChild: 800,
    },
    {
      han: 2,
      basePoints: 480,
      childFromDealer: 1200,
      childFromChild: 800,
      dealerFromChild: 1500,
    },
    {
      han: 3,
      basePoints: 960,
      childFromDealer: 2400,
      childFromChild: 1500,
      dealerFromChild: 2900,
    },
    {
      han: 4,
      basePoints: 1920,
      childFromDealer: 4800,
      childFromChild: 2900,
      dealerFromChild: 5800,
    },
  ];

  for (const t of table) {
    it(`${t.han}翻(a=${t.basePoints}): 子ツモ 親${t.childFromDealer}/子${t.childFromChild}・親ツモ 子各${t.dealerFromChild}`, () => {
      const child = computeScore(han(t.han), false);
      expect(child.category).toBe("normal");
      expect(child.basePoints).toBe(t.basePoints);
      // 受け入れ基準: 子ツモ配分が確定テーブルと一致
      expect(child.tsumo.fromDealer).toBe(t.childFromDealer);
      expect(child.tsumo.fromNonDealer).toBe(t.childFromChild);

      const dealer = computeScore(han(t.han), true);
      expect(dealer.tsumo.fromDealer).toBe(0);
      // 受け入れ基準: 親ツモ子各払いが確定テーブルと一致
      expect(dealer.tsumo.fromNonDealer).toBe(t.dealerFromChild);
    });
  }

  it("子ツモ総額は各翻で子ロンと一致(子側は端数ズレなし)", () => {
    // 子側は親払い+子払いがちょうど 4a に切り上がるため、ツモ損なしが厳密成立。
    for (const t of table) {
      const child = computeScore(han(t.han), false);
      expect(child.tsumo.total).toBe(child.ronTotal);
    }
  });
});

/**
 * 低翻の親ツモ総額 > 親ロン(+100)の非自明挙動(spec `:143`)。
 *
 * 各支払額を独立に切り上げるため、1翻・2翻の親ツモは総額がロンを +100 上回る。
 * 「ツモ損なし(ツモ総額=ロン)」の厳密一致は満貫以上でのみ成立することを、
 * 満貫との対比で明示固定する。
 */
describe("computeScore — 低翻の親ツモ総額 > 親ロン(+100 の切り上げ由来 / issue #120)", () => {
  it("1翻: 親ツモ総額1600(800×2) > 親ロン1500(+100)", () => {
    const dealer = computeScore(han(1), true);
    expect(dealer.tsumo.fromNonDealer).toBe(800);
    expect(dealer.tsumo.total).toBe(1600);
    expect(dealer.ronTotal).toBe(1500);
    expect(dealer.tsumo.total - dealer.ronTotal).toBe(100);
  });

  it("2翻: 親ツモ総額3000(1500×2) > 親ロン2900(+100)", () => {
    const dealer = computeScore(han(2), true);
    expect(dealer.tsumo.fromNonDealer).toBe(1500);
    expect(dealer.tsumo.total).toBe(3000);
    expect(dealer.ronTotal).toBe(2900);
    expect(dealer.tsumo.total - dealer.ronTotal).toBe(100);
  });

  it("3翻・4翻の親ツモは端数が生じず総額=ロン(+100 は低翻限定)", () => {
    // 3翻: a=960 → 子各 ceil100(2880)=2900, 総額5800 = ronTotal5800
    // 4翻: a=1920 → 子各 ceil100(5760)=5800, 総額11600 = ronTotal11600
    for (const h of [3, 4]) {
      const dealer = computeScore(han(h), true);
      expect(dealer.tsumo.total).toBe(dealer.ronTotal);
    }
  });

  it("満貫は親ツモ総額=親ロンで厳密一致(spec :143 の対比)", () => {
    const dealer = computeScore(han(5), true);
    expect(dealer.tsumo.total).toBe(dealer.ronTotal);
    expect(dealer.tsumo.total).toBe(12000);
  });
});
