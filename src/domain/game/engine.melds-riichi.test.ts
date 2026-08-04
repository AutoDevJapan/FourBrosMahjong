import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
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
  type SeatKey,
  seatOfPlayer,
  tsumogiri,
} from "./engine";

/**
 * 鳴き(ポン/カン)・リーチ・裏ドラ・一発の結線検証(#97 / スペック2 2.2・2.4)。
 *
 * 盤面は seed 固定の乱数で決まるため、個別牌姿を直接組み立てず「提示された合法手を
 * 積極的に選ぶ単一方策」で半荘を完走させ、不変条件で正しさを担保する。固定 seed 列の
 * 実測では riichi / pon / ankan / kakan を踏む一方、ron / tsumo / 大明槓は踏まない。
 * 大明槓は `canKan` なら `canPon` でもあり、この方策がポンを先に選ぶため構造的に
 * 到達しない。ron / tsumo はこの配牌群では提示されないため、本テストの保証対象外。
 *
 * 公開アクション全11種の保存則は、方策を `kanFirst` / `passive` / `riichiFirst` にも
 * 分けて未踏経路を明示的に落とす `engine.pot-invariant.test.ts` が担う(issue #458)。
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

/** 提示された合法手を積極的に選び、1半荘を完走させる単一方策。 */
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

/** #450 で確認した、自家の第一打に `canRiichi` が提示される固定 seed。 */
const RIICHI_OFFER_SEED = 782;

/**
 * 非0供託からリーチを宣言できる決定的局面を組む。
 *
 * ライブ壁を0枚にすることで、宣言牌の処理後に `pump` が他家のツモ・リーチ・和了を
 * 挟まず即流局する。したがって返り値はリーチ宣言自身の差分だけを保持する。
 */
function armDeterministicRiichi(): {
  state: EngineState;
  declarationTile: ReturnType<typeof parseTile>;
  seat: SeatKey;
} {
  const state = createGame({ seed: 1 });
  const hand = state.hand;
  if (hand === null) throw new Error("initial hand should exist");
  const seat = seatOfPlayer(hand.seating, "p0");
  if (seat !== "east") throw new Error("initial human seat should be east");

  while (hand.wall.remainingLiveTiles > 0) hand.wall.draw();

  hand.hands.east = parseTiles("123p 456p 789p 123s 5s");
  // 流局時のノーテン罰符で点棒差分を汚さないよう、3家とも同じテンパイ形にする。
  hand.hands.south = parseTiles("123p 456p 789p 123s 5s");
  hand.hands.west = parseTiles("123p 456p 789p 123s 5s");
  for (const current of ["east", "south", "west"] as SeatKey[]) {
    hand.melds[current] = [];
    hand.discards[current] = [];
    hand.discardHistory[current] = [];
    hand.riichi[current] = false;
    hand.doubleRiichi[current] = false;
    hand.riichiMiss[current] = false;
    hand.tempMiss[current] = false;
  }
  const declarationTile = parseTile("9s");
  hand.drawn = declarationTile;
  hand.turn = seat;

  return {
    declarationTile,
    seat,
    state: {
      ...state,
      riichiSticks: 2,
      pending: {
        kind: "humanDiscard",
        canTsumo: false,
        canRiichi: true,
        riichiTiles: [declarationTile],
        ankanTiles: [],
        kakanTiles: [],
        forbiddenDiscards: [],
        locked: false,
      },
    },
  };
}

describe("engine: 鳴き・リーチ・裏ドラ・一発(#97)", () => {
  it("積極的に鳴く単一方策でも半荘は完走し、供託込みでゼロサムを保つ", () => {
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
    // この固定 seed 列で実際に踏むと明記した4経路を個別に固定する。合算では片方が
    // 0になっても通るため、docblock と実測カバレッジの乖離を検出できない(issue #458)。
    expect(tally.riichi, "riichi が未踏").toBeGreaterThan(0);
    expect(tally.pon, "pon が未踏").toBeGreaterThan(0);
    expect(tally.ankan, "ankan が未踏").toBeGreaterThan(0);
    expect(tally.kakan, "kakan が未踏").toBeGreaterThan(0);
  });

  it("固定 seed の実配牌でエンジンがリーチを提示する", () => {
    const state = createGame({ seed: RIICHI_OFFER_SEED });
    expect(state.pending?.kind).toBe("humanDiscard");
    if (state.pending?.kind !== "humanDiscard") return;
    expect(state.pending.canRiichi).toBe(true);
    expect(state.pending.riichiTiles.length).toBeGreaterThan(0);
  });

  it("非0供託からのリーチ宣言で供託+1・点棒-1,000・フラグ設定を保つ", () => {
    const { state, declarationTile, seat } = armDeterministicRiichi();
    const beforeSticks = state.riichiSticks;
    const beforePoints = state.points.p0;

    const after = declareRiichi(state, declarationTile);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("draw");
    expect(after.riichiSticks).toBe(beforeSticks + 1);
    expect(after.points.p0).toBe(beforePoints - 1000);
    expect(after.hand?.riichi[seat]).toBe(true);
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
