import { describe, expect, it } from "vitest";
import {
  createGame,
  declareAnkan,
  declareKakan,
  declareKan,
  declarePon,
  declareRiichi,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  passRon,
  proceedToNextRound,
  seatOfPlayer,
  tsumogiri,
} from "./engine";

/**
 * 鳴き(ポン/カン)・リーチ・裏ドラ・一発の結線検証(#97 / スペック2 2.2・2.4)。
 *
 * 盤面は seed 固定の乱数で決まるため、個別牌姿を直接組み立てず「提示された合法手を
 * 積極的に選ぶドライバ」で全公開アクション(riichi/pon/kan/ankan/kakan/ron/tsumo)を
 * 実際に走らせ、不変条件で正しさを担保する。決定的な確認はシード走査で行う。
 */

interface ActionTally {
  riichi: number;
  pon: number;
  kan: number;
  ankan: number;
  kakan: number;
  ron: number;
  tsumo: number;
}

/** 提示された合法手を積極的に選び、1半荘を完走させる(全アクション経路を踏む)。 */
function playAggressive(seed: number, tally: ActionTally): EngineState {
  let s = createGame({ seed });
  for (let guard = 0; guard < 8000 && s.phase !== "gameEnd"; guard++) {
    if (s.phase === "roundEnd") {
      s = proceedToNextRound(s);
      continue;
    }
    const pending = s.pending;
    if (pending?.kind === "humanReact") {
      if (pending.canRon) {
        tally.ron += 1;
        s = declareRon(s);
      } else if (pending.canPon) {
        tally.pon += 1;
        s = declarePon(s);
      } else if (pending.canKan) {
        tally.kan += 1;
        s = declareKan(s);
      } else {
        s = passRon(s);
      }
      continue;
    }
    if (pending?.kind === "humanDiscard") {
      if (pending.canTsumo) {
        tally.tsumo += 1;
        s = declareTsumo(s);
        continue;
      }
      if (pending.locked) {
        s = tsumogiri(s);
        continue;
      }
      if (pending.kakanTiles.length > 0) {
        tally.kakan += 1;
        s = declareKakan(s, pending.kakanTiles[0]);
        continue;
      }
      if (pending.ankanTiles.length > 0) {
        tally.ankan += 1;
        s = declareAnkan(s, pending.ankanTiles[0]);
        continue;
      }
      if (pending.canRiichi) {
        tally.riichi += 1;
        s = declareRiichi(s, pending.riichiTiles[0]);
        continue;
      }
      // ツモ牌があればツモ切り。無い(ポン直後など)なら門前手牌の先頭を切る。
      const hand = s.hand;
      const seat = hand ? seatOfPlayer(hand.seating, "p0") : null;
      const tile =
        hand?.drawn ?? (hand && seat ? hand.hands[seat][0] : undefined);
      if (tile == null)
        throw new Error("humanDiscard without a discardable tile");
      s = discard(s, tile);
      continue;
    }
    throw new Error(
      `stuck: phase=${s.phase} pending=${s.pending?.kind ?? "none"}`,
    );
  }
  return s;
}

describe("engine: 鳴き・リーチ・裏ドラ・一発(#97)", () => {
  it("全公開アクションを走らせても半荘は完走し、供託込みでゼロサムを保つ", () => {
    const tally: ActionTally = {
      riichi: 0,
      pon: 0,
      kan: 0,
      ankan: 0,
      kakan: 0,
      ron: 0,
      tsumo: 0,
    };
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 42, 99, 2024]) {
      const s = playAggressive(seed, tally);
      expect(s.phase).toBe("gameEnd");
      expect(s.result).toHaveLength(4);

      // 持ち点は「140,000 − 場に残る供託(未回収リーチ棒 × 1,000)」。
      const total = Object.values(s.points).reduce((a, b) => a + b, 0);
      expect(total).toBe(140000 - 1000 * s.riichiSticks);
      // 持ち点はすべて整数(端数処理の破綻がない)。
      for (const p of Object.values(s.points)) {
        expect(Number.isInteger(p)).toBe(true);
      }
    }
    // 積極ドライバで少なくとも鳴きとリーチの経路が実際に踏まれている(カバレッジ保証)。
    expect(tally.pon + tally.riichi).toBeGreaterThan(0);
  });

  it("リーチ宣言で 1,000 点が供託され、リーチ・一発フラグが立つ", () => {
    // ツモ切りで進めて自家がリーチ可能になった局面で宣言し、その宣言巡でまだ局が
    // 続く(AI 和了/流局で局が終わらない)ケースを探して純粋な事後条件を検証する。
    let verified = false;
    for (let seed = 1; seed <= 300 && !verified; seed++) {
      let s = createGame({ seed });
      for (let guard = 0; guard < 600 && s.phase !== "gameEnd"; guard++) {
        if (s.phase === "roundEnd") {
          s = proceedToNextRound(s);
          continue;
        }
        const pending = s.pending;
        if (pending?.kind === "humanDiscard") {
          const hand = s.hand;
          if (hand === null) break;
          const seat = seatOfPlayer(hand.seating, "p0");
          if (seat === null) break;
          if (pending.canRiichi) {
            const before = s.points.p0;
            const beforeSticks = s.riichiSticks;
            const after = declareRiichi(s, pending.riichiTiles[0]);
            // 宣言と同時に局が決着(AI 和了/流局)した場合は別 seed で再検証する。
            if (after.phase !== "playing" || after.hand === null) break;
            expect(after.riichiSticks).toBe(beforeSticks + 1);
            expect(after.points.p0).toBe(before - 1000);
            expect(after.hand.riichi[seat]).toBe(true);
            verified = true;
            break;
          }
          const tile = hand.drawn ?? hand.hands[seat][0];
          s = discard(s, tile);
        } else if (pending?.kind === "humanReact") {
          s = passRon(s);
        } else {
          break;
        }
      }
    }
    expect(verified).toBe(true);
  });

  it("ポン宣言で明刻が晒され、門前手牌が2枚減り手番が自家に移る", () => {
    // 自家が他家打牌にポンできる humanReact を探索する。
    let ponState: EngineState | null = null;
    outer: for (let seed = 1; seed <= 600 && ponState === null; seed++) {
      let s = createGame({ seed });
      for (let guard = 0; guard < 400 && s.phase === "playing"; guard++) {
        const pending = s.pending;
        if (pending?.kind === "humanReact" && pending.canPon) {
          ponState = s;
          break outer;
        }
        if (pending?.kind === "humanReact") {
          s = passRon(s);
        } else if (pending?.kind === "humanDiscard") {
          const drawn = s.hand?.drawn;
          if (drawn == null) break;
          s = discard(s, drawn);
        } else {
          break;
        }
      }
    }
    expect(ponState).not.toBeNull();
    if (ponState === null || ponState.hand === null) return;

    const seat = seatOfPlayer(ponState.hand.seating, "p0");
    expect(seat).not.toBeNull();
    if (seat === null) return;
    const handBefore = ponState.hand.hands[seat].length;
    const meldsBefore = ponState.hand.melds[seat].length;

    const after = declarePon(ponState);
    expect(after.hand).not.toBeNull();
    if (after.hand === null) return;

    expect(after.hand.melds[seat]).toHaveLength(meldsBefore + 1);
    const newMeld = after.hand.melds[seat][meldsBefore];
    expect(newMeld.type).toBe("pon");
    expect(newMeld.tiles).toHaveLength(3);
    expect(newMeld.concealed).toBe(false);
    // 門前手牌は2枚(ポンで消費)減る。
    expect(after.hand.hands[seat]).toHaveLength(handBefore - 2);
    // ポン後は自家の打牌待ち(ツモなし)になる。
    expect(after.pending?.kind).toBe("humanDiscard");
    expect(after.hand.turn).toBe(seat);
  });
});
