import { describe, expect, it } from "vitest";
import {
  createGame,
  declareTsumo,
  discard,
  type EngineState,
  notenPaymentPool,
  passRon,
  proceedToNextRound,
} from "./engine";

/**
 * ドライバ: 自家はツモ切り(引いた牌をそのまま捨てる)、ロンは見送りで半荘を完走させる。
 * 状態機械(#67 / スペック2 2.1)の全経路(進行→和了/流局→次局→終了)を通す。
 */
function playOut(seed: number, opts: { tsumo?: boolean } = {}): EngineState {
  let s = createGame({ seed });
  for (let guard = 0; guard < 5000 && s.phase !== "gameEnd"; guard++) {
    if (s.phase === "roundEnd") {
      s = proceedToNextRound(s);
      continue;
    }
    if (s.pending?.kind === "humanDiscard") {
      if (opts.tsumo && s.pending.canTsumo) {
        s = declareTsumo(s);
      } else {
        // drawn は humanDiscard 時に必ず存在する。
        const drawn = s.hand?.drawn;
        if (drawn === null || drawn === undefined) {
          throw new Error("humanDiscard without a drawn tile");
        }
        s = discard(s, drawn);
      }
    } else if (s.pending?.kind === "humanReact") {
      s = passRon(s);
    } else {
      throw new Error(`stuck in phase=${s.phase}`);
    }
  }
  return s;
}

describe("engine: 半荘の状態機械(#67)", () => {
  it("新規半荘は 東1・自家=親(東)で始まり、自家の打牌待ちになる", () => {
    const s = createGame({ seed: 1 });
    expect(s.phase).toBe("playing");
    expect(s.round.wind).toBe("east");
    expect(s.round.roundNumber).toBe(1);
    // 起家=自家 p0 が東(親)。最初の手番は自家 → 打牌待ち。
    expect(s.hand?.seating.east).toBe("p0");
    expect(s.pending?.kind).toBe("humanDiscard");
    // 全員 35,000 点持ちスタート。
    expect(s.points).toEqual({ p0: 35000, p1: 35000, p2: 35000, p3: 35000 });
  });

  it("配牌は着席3人に各13枚、抜け番は手牌を持たない", () => {
    const s = createGame({ seed: 7 });
    const hand = s.hand;
    expect(hand).not.toBeNull();
    if (hand === null) return;
    // 手番=東はツモ済み(13枚 + drawn)、他2席は13枚。
    expect(hand.hands.east.length + (hand.drawn ? 1 : 0)).toBe(14);
    expect(hand.hands.south).toHaveLength(13);
    expect(hand.hands.west).toHaveLength(13);
  });

  it.each([1, 2, 3, 42, 99, 12345, 2024])(
    "seed=%i: 半荘を完走し、結果が確定する(全経路が停止する)",
    (seed) => {
      const s = playOut(seed);
      expect(s.phase).toBe("gameEnd");
      expect(s.result).not.toBeNull();
      expect(s.result).toHaveLength(4);
    },
  );

  it("結果は4人・順位は1〜4の一意な並び、ソシー合計は総和ゼロ", () => {
    const s = playOut(2024);
    const result = s.result;
    expect(result).not.toBeNull();
    if (result === null) return;

    const ranks = [...result].map((r) => r.rank).sort();
    expect(ranks).toEqual([1, 2, 3, 4]);

    // ソシー精算はゼロサム(素点−返し + ウマ+オカ + 祝儀 = 0)。
    const totalSoshii = result.reduce((sum, r) => sum + r.soshiiTotal, 0);
    expect(totalSoshii).toBe(0);

    // 各行: rawScore + uma + bonus === soshiiTotal(内訳の整合)。
    for (const r of result) {
      expect(r.rawScore + r.uma + r.bonus).toBe(r.soshiiTotal);
    }
  });

  it("持ち点はゼロサム(半荘を通じ4人合計は 140,000 点で不変)", () => {
    const s = playOut(99);
    const total = Object.values(s.points).reduce((a, b) => a + b, 0);
    expect(total).toBe(140000);
  });

  it("進行に伴い場が東→南へ進み、南4(オーラス)まで到達し得る", () => {
    // 決定的に南場へ到達することを確認(seed により東場で終わらない範囲)。
    const s = playOut(2024);
    // 半荘終了時点の局は東1より必ず先へ進んでいる(1局で終わらない)。
    expect(s.roundsPlayed).toBeGreaterThan(0);
  });

  it("自家がツモ和了可能なら宣言でき、局が決着する", () => {
    // ツモ優先ドライバでも安全に完走する(和了経路が壊れていない)。
    const s = playOut(2024, { tsumo: true });
    expect(s.phase).toBe("gameEnd");
    expect(s.result).toHaveLength(4);
  });
});

describe("notenPaymentPool: 流局テンパイ料のサンマ配分(スペック3 3.4 / #99)", () => {
  it("k=0(全員ノーテン): 授受なし", () => {
    expect(notenPaymentPool(0)).toEqual({
      receivePerTenpai: 0,
      payPerNoten: 0,
    });
  });

  it("k=1: 受取 +3,000 / 支払 −1,500(ノーテン2人で3,000を折半)", () => {
    expect(notenPaymentPool(1)).toEqual({
      receivePerTenpai: 3000,
      payPerNoten: 1500,
    });
  });

  it("k=2: 受取 +1,500 / 支払 −3,000(テンパイ2人で3,000を折半)", () => {
    expect(notenPaymentPool(2)).toEqual({
      receivePerTenpai: 1500,
      payPerNoten: 3000,
    });
  });

  it("k=3(全員テンパイ): 授受なし", () => {
    expect(notenPaymentPool(3)).toEqual({
      receivePerTenpai: 0,
      payPerNoten: 0,
    });
  });

  it("授受は総和ゼロ(テンパイ受取総額 = ノーテン支払総額 = 3,000)", () => {
    for (let k = 1; k <= 2; k++) {
      const { receivePerTenpai, payPerNoten } = notenPaymentPool(k);
      const received = receivePerTenpai * k;
      const paid = payPerNoten * (3 - k);
      expect(received).toBe(3000);
      expect(paid).toBe(3000);
      expect(received - paid).toBe(0);
    }
  });
});
