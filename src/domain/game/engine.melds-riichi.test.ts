import { describe, expect, it } from "vitest";
import { TOTAL_POINTS } from "../scoring/settlement";
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
  potTotal,
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
      // ツモ牌があればツモ切り。無い(ポン直後など)なら門前手牌から切る。
      // 喰い替え禁止(#105)でポンした牌種は切れないため、それを避けて選ぶ。
      const hand = s.hand;
      const seat = hand ? seatOfPlayer(hand.seating, "p0") : null;
      const forbidden = pending.forbiddenDiscards;
      const isForbidden = (t: { suit: string; rank: number }): boolean =>
        forbidden.some((f) => f.suit === t.suit && f.rank === t.rank);
      let tile = hand?.drawn ?? undefined;
      if ((tile == null || isForbidden(tile)) && hand && seat) {
        tile = hand.hands[seat].find((t) => !isForbidden(t));
      }
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

/**
 * リーチ局面探索で走査する seed 数(#450)。配牌が既にテンパイに届いている確率は
 * 低く、現行エンジンではこの範囲に `canRiichi` が 7 局面(うち宣言後も続行するのが
 * 4 局面)現れる。1 seed あたり配牌 1 回分しか消費しないので全走査でも約 1.5s。
 */
const RIICHI_SCAN_SEEDS = 3000;

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
      expect(s.phase, `seed=${seed}`).toBe("gameEnd");
      expect(s.result).toHaveLength(4);

      // 保存則: 持ち点総和 + 場に残る供託 = 140,000。供託は種別ごとの本数ではなく
      // 集約 `potTotal` で数える(#430)。半荘終了時は残存供託の帰属先が一意に定まる
      // (Q15 = 1位取得 / #130、Q20 = 同点最高は席順上位 / #131)ため全額が素点へ移り、
      // 実際には `potTotal(s) === 0`(帰属の詳細は engine.residual-riichi.test.ts、
      // 保存則そのものは engine.pot-invariant.test.ts)。
      const total = Object.values(s.points).reduce((a, b) => a + b, 0);
      expect(total + potTotal(s), `seed=${seed}`).toBe(TOTAL_POINTS);
      expect(potTotal(s), `seed=${seed} pot at gameEnd`).toBe(0);
      // 持ち点はすべて整数(端数処理の破綻がない)。
      for (const p of Object.values(s.points)) {
        expect(Number.isInteger(p)).toBe(true);
      }
    }
    // 積極ドライバで少なくとも鳴きとリーチの経路が実際に踏まれている(カバレッジ保証)。
    expect(tally.pon + tally.riichi).toBeGreaterThan(0);
  });

  /**
   * リーチ宣言の事後条件(供託 +1,000 / 自家 -1,000 / リーチフラグ)を、エンジンが
   * 実際に提示した `canRiichi` に対してのみ検証する。宣言と同時に局が決着した場合は
   * 事後条件を観測できないので対象外とし、別 seed で拾う。
   *
   * 走査コストの設計(#450)。旧実装は seed ごとに半荘を最後まで回してリーチ機会を
   * 探していた。しかし自家はツモ切りしか行わないため門前 13 枚は配牌のまま変わらず、
   * リーチ機会は実質「配牌の引き」で決まる。つまり新しい配牌を得ること以外に価値の
   * 無い AI 対局を丸ごと回しており、53 seed(約 300 配牌)で 10.2s、フルスイート
   * 並列下では 12.1s を 1 テストで消費していた。unit プロジェクトの `testTimeout`
   * 30s の 4 割を占めるため CPU 競合に耐えられず、負荷を掛けた再現実行では 58.7s
   * まで伸びて timeout している(同期ループなので時間切れでも中断されず、超過分だけ
   * ファイル全体が待たされる)。
   *
   * そこで各 seed は自家の最初の打牌局面だけを見て次の seed へ進む。1 seed あたりの
   * 費用が「半荘 1 回」から「配牌 1 回」に下がり、early-exit 無しで seed を全走査
   * しても 10.2s → 1.5s(単体実行・実測)に収まる。当たり seed で打ち切らないため、
   * エンジン変更で当たり位置が動いても実行時間は変わらない。現行エンジンではこの
   * 範囲で 7 局面が `canRiichi` を提示し、うち 4 局面が宣言後も局を続行する。
   */
  it("リーチ宣言で 1,000 点が供託され、リーチ・一発フラグが立つ", () => {
    // 自家の最初の打牌待ちに到達するまでに挟まるのは他家の打牌(humanReact)だけで、
    // サンマなので高々 2 回。天和/地和で局が即決着する場合は phase 条件で抜ける。
    const REACT_GUARD = 8;
    let verified = 0;
    for (let seed = 1; seed <= RIICHI_SCAN_SEEDS; seed++) {
      let s = createGame({ seed });
      for (
        let guard = 0;
        guard < REACT_GUARD && s.phase === "playing";
        guard++
      ) {
        const pending = s.pending;
        if (pending?.kind === "humanReact") {
          s = passRon(s);
          continue;
        }
        if (pending?.kind !== "humanDiscard") break;
        const hand = s.hand;
        if (hand === null) break;
        const seat = seatOfPlayer(hand.seating, "p0");
        if (seat === null) break;
        if (pending.canRiichi) {
          const before = s.points.p0;
          const beforeSticks = s.riichiSticks;
          const after = declareRiichi(s, pending.riichiTiles[0]);
          // 宣言と同時に局が決着(AI 和了/流局)した局面は事後条件を観測できない。
          if (after.phase === "playing" && after.hand !== null) {
            expect(after.riichiSticks, `seed=${seed}`).toBe(beforeSticks + 1);
            expect(after.points.p0, `seed=${seed}`).toBe(before - 1000);
            expect(after.hand.riichi[seat], `seed=${seed}`).toBe(true);
            verified += 1;
          }
        }
        break; // この seed の判定は自家の最初の打牌局面で完結する。
      }
    }
    expect(
      verified,
      `走査範囲(seed 1..${RIICHI_SCAN_SEEDS})に検証可能なリーチ局面が無い`,
    ).toBeGreaterThan(0);
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

/**
 * 喰い替え(現物)禁止の結線検証(#105 / スペック1 1.4「喰い替えなし」)。
 *
 * サンマはチーが無くポンのみのため喰い替えは「現物喰い替え」(ポンした牌と同種を直後に
 * 切る)に限られる。ポン直後の `humanDiscard` で:
 * - `forbiddenDiscards` にポンした牌種がちょうど1種入る。
 * - その牌種を切る `discard` は非合法手として no-op(状態不変=同一参照を返す)。
 * - 同種以外の合法牌を切る `discard` は進行する(状態が変わる)。
 */
describe("engine: 喰い替え(現物)禁止(#105)", () => {
  /** 自家が他家打牌にポンできる humanReact を探索し、ポン実行後の状態を返す。 */
  function findPonnedState(): EngineState | null {
    outer: for (let seed = 1; seed <= 600; seed++) {
      let s = createGame({ seed });
      for (let guard = 0; guard < 400 && s.phase === "playing"; guard++) {
        const pending = s.pending;
        if (pending?.kind === "humanReact" && pending.canPon) {
          return declarePon(s);
        }
        if (pending?.kind === "humanReact") {
          s = passRon(s);
        } else if (pending?.kind === "humanDiscard") {
          const drawn = s.hand?.drawn;
          if (drawn == null) break;
          s = discard(s, drawn);
        } else {
          break outer;
        }
      }
    }
    return null;
  }

  it("ポン直後は forbiddenDiscards にポンした牌種がちょうど1種入る", () => {
    const after = findPonnedState();
    expect(after).not.toBeNull();
    if (after === null || after.hand === null) return;
    expect(after.pending?.kind).toBe("humanDiscard");
    if (after.pending?.kind !== "humanDiscard") return;

    const seat = seatOfPlayer(after.hand.seating, "p0");
    expect(seat).not.toBeNull();
    if (seat === null) return;
    const meldsLen = after.hand.melds[seat].length;
    const ponned = after.hand.melds[seat][meldsLen - 1].tiles[0];

    expect(after.pending.forbiddenDiscards).toHaveLength(1);
    const forbidden = after.pending.forbiddenDiscards[0];
    // 現物喰い替えの対象はポンした牌と同種(赤フラグは無視・種別一致)。
    expect(forbidden.suit).toBe(ponned.suit);
    expect(forbidden.rank).toBe(ponned.rank);
  });

  it("ポンした牌種の打牌は no-op(拒否)、同種以外の打牌は進行する", () => {
    const after = findPonnedState();
    expect(after).not.toBeNull();
    if (after === null || after.hand === null) return;
    if (after.pending?.kind !== "humanDiscard") return;

    const seat = seatOfPlayer(after.hand.seating, "p0");
    if (seat === null) return;
    const meldsLen = after.hand.melds[seat].length;
    const ponned = after.hand.melds[seat][meldsLen - 1].tiles[0];

    // 現物喰い替え(ポンした牌種を切る)は非合法手 → no-op(同一参照を返す)。
    const rejected = discard(after, ponned);
    expect(rejected).toBe(after);
    expect(rejected.pending?.kind).toBe("humanDiscard");
    expect(rejected.hand?.turn).toBe(seat);

    // 同種以外の合法牌を1枚選ぶ(必ず存在する)。
    const legal = after.hand.hands[seat].find(
      (t) => t.suit !== ponned.suit || t.rank !== ponned.rank,
    );
    expect(legal).toBeDefined();
    if (legal === undefined) return;

    // 合法牌の打牌は進行する(no-op ではない=別状態を返す)。
    const progressed = discard(after, legal);
    expect(progressed).not.toBe(after);
  });
});
