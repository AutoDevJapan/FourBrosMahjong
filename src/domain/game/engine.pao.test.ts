/**
 * パオ(責任払い)の engine→settlement 結線の統合テスト(issue #284)。
 *
 * `pao.ts`(判定)・`win-payment.ts`(点棒移動)は単体テスト済みのため、本ファイルは
 * engine の公開 API(鳴き→和了宣言)を通した結線のみを検証する:
 * - 鳴き受理(`declarePon` / `declareKan` / AI の `applyAiCall`)が
 *   `recordPaoResponsible` で責任者を **和了者席+役満種類** に記録すること。
 * - `settleWin` が役満単位の責任情報を `resolveWinPayment` へ流し、
 *   責任払い(ロン折半 / ツモ全額)と通常役満の配分を分けること。
 * - 責任払いの点棒差分をゼロサムだけに依存せず**明示的に**アサートする。
 *
 * 盤面はスペック3 3.3(パオ)に基づき crafted state で直接組む
 * (`engine.four-kan-abort.test.ts` と同じ手法)。
 */
import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import type { Tile } from "@/domain/tiles/tile";
import {
  createGame,
  declareAnkan,
  declareKan,
  declarePon,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  type Pending,
  type SeatKey,
} from "./engine";

const kan = (notation: string, concealed = true): Meld => ({
  type: "kan",
  tiles: parseTiles(notation),
  concealed,
});

const pon = (tile: Tile): Meld => ({
  type: "pon",
  tiles: [tile, tile, tile],
  concealed: false,
});

/** 和了形・鳴きと無縁の13枚(すべて種類がバラバラ)。 */
const JUNK = "2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 1s";

function discardPending(overrides: Partial<Pending & object> = {}): Pending {
  return {
    kind: "humanDiscard",
    canTsumo: false,
    canRiichi: false,
    riichiTiles: [],
    ankanTiles: [],
    kakanTiles: [],
    forbiddenDiscards: [],
    locked: false,
    ...overrides,
  } as Pending;
}

function reactPending(params: {
  tile: Tile;
  from: SeatKey;
  canRon?: boolean;
  canPon?: boolean;
  canKan?: boolean;
}): Pending {
  return {
    kind: "humanReact",
    tile: params.tile,
    from: params.from,
    canRon: params.canRon ?? false,
    canPon: params.canPon ?? false,
    canKan: params.canKan ?? false,
  };
}

function requireHand(state: EngineState) {
  const hand = state.hand;
  if (!hand) throw new Error("hand required");
  return hand;
}

/**
 * 自家(東=p0)が白・發をポン済みで、3種目の三元牌(中)の打牌を待つ盤面。
 * `discarder` の打牌 7z に対し `declarePon` できる状態を返す。
 */
function armedForThirdDragonPon(seed: number): EngineState {
  const state = createGame({ seed });
  const hand = requireHand(state);
  hand.melds.east = [pon(parseTile("5z")), pon(parseTile("6z"))];
  hand.melds.south = [];
  hand.melds.west = [];
  // ポン後は 1m 1m 1m + 9m 単騎(9m で和了)になる形。
  hand.hands.east = parseTiles("7z 7z 1m 1m 1m 9m");
  hand.hands.south = parseTiles(JUNK);
  hand.hands.west = parseTiles(JUNK);
  hand.pendingDiscard = {
    seat: "south",
    tile: parseTile("7z"),
    haitei: false,
  };
  hand.turn = "south";
  hand.drawn = null;
  return {
    ...state,
    pending: reactPending({
      tile: parseTile("7z"),
      from: "south",
      canPon: true,
    }),
  };
}

describe("engine: パオ(責任払い)の結線(#284 / スペック3 3.3)", () => {
  it("大三元パオ・ロン: 3種目の中を鳴かせた打牌者と放銃者で折半する", () => {
    const armed = armedForThirdDragonPon(11);
    const ponState = declarePon(armed);

    // recordPaoResponsible: 和了者席(east)キーで、中の打牌者(南=p1)を記録。
    expect(ponState.hand?.paoResponsible).toEqual({
      east: { daisangen: "p1" },
    });

    // 西家(p2)の 9m 放銃でロン(親・役満 48,000)。
    const hand = requireHand(ponState);
    hand.pendingDiscard = {
      seat: "west",
      tile: parseTile("9m"),
      haitei: false,
    };
    hand.turn = "west";
    hand.drawn = null;
    const after = declareRon({
      ...ponState,
      pending: reactPending({
        tile: parseTile("9m"),
        from: "west",
        canRon: true,
      }),
    });

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winnerId).toBe("p0");
    expect(
      after.lastRound?.winDetails?.yaku.some((y) => y.name === "大三元"),
    ).toBe(true);
    // 責任払い(ロン): 放銃者(p2)と責任者(p1)で 48,000 を折半。
    expect(after.lastRound?.deltas).toEqual({
      p0: 48000,
      p1: -24000,
      p2: -24000,
      p3: 0,
    });
    expect(after.points).toEqual({
      p0: 83000,
      p1: 11000,
      p2: 11000,
      p3: 35000,
    });
    expect(after.lastRound?.winDetails?.payments).toEqual([
      { name: "一郎", amount: 24000 },
      { name: "二郎", amount: 24000 },
    ]);
  });

  it("大三元パオ・ツモ: 責任者が全額を負担し非責任者は0", () => {
    const armed = armedForThirdDragonPon(12);
    const ponState = declarePon(armed);
    expect(ponState.hand?.paoResponsible).toEqual({
      east: { daisangen: "p1" },
    });

    // 9m をツモって和了(親・役満ツモ 48,000)。責任者の全額負担でトビに
    // ならないよう p1 の持ち点だけ引き上げておく(検証対象は差分のみ)。
    const hand = requireHand(ponState);
    hand.drawn = { tile: parseTile("9m"), source: "live" };
    hand.turn = "east";
    const after = declareTsumo({
      ...ponState,
      points: { ...ponState.points, p1: 60000 },
      pending: discardPending({ canTsumo: true }),
    });

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    // 責任払い(ツモ): 責任者 p1 が全額 48,000。非責任者 p2 の支払いは 0。
    expect(after.lastRound?.deltas).toEqual({
      p0: 48000,
      p1: -48000,
      p2: 0,
      p3: 0,
    });
    expect(after.lastRound?.winDetails?.payments).toEqual([
      { name: "一郎", amount: 48000 },
    ]);
  });

  it("四槓子パオ: 4つ目の大明槓を成立させた打牌者が責任者になり、ツモで全額負担する", () => {
    const state = createGame({ seed: 13 });
    const hand = requireHand(state);
    hand.melds.east = [
      kan("2p 2p 2p 2p"),
      kan("3p 3p 3p 3p"),
      kan("4p 4p 4p 4p", false),
    ];
    hand.melds.south = [];
    hand.melds.west = [];
    hand.hands.east = parseTiles("6s 6s 6s 9p");
    hand.hands.south = parseTiles(JUNK);
    hand.hands.west = parseTiles(JUNK);
    hand.pendingDiscard = {
      seat: "south",
      tile: parseTile("6s"),
      haitei: false,
    };
    hand.turn = "south";
    hand.drawn = null;
    const armed = {
      ...state,
      pending: reactPending({
        tile: parseTile("6s"),
        from: "south",
        canPon: true,
        canKan: true,
      }),
    };

    const kanState = declareKan(armed);
    // 単独4槓は四槓散了にならず続行し、責任者(6s の打牌者=南=p1)を記録する。
    expect(kanState.phase).toBe("playing");
    expect(kanState.hand?.melds.east).toHaveLength(4);
    expect(kanState.hand?.paoResponsible).toEqual({
      east: { suukantsu: "p1" },
    });

    // 嶺上ツモを 9p に差し替えて四槓子をツモ和了(親・役満ツモ 48,000)。
    const kanHand = requireHand(kanState);
    kanHand.drawn = { tile: parseTile("9p"), source: "live" };
    kanHand.turn = "east";
    const after = declareTsumo({
      ...kanState,
      points: { ...kanState.points, p1: 60000 },
      pending: discardPending({ canTsumo: true }),
    });

    expect(after.phase).toBe("roundEnd");
    expect(
      after.lastRound?.winDetails?.yaku.some((y) => y.name === "四槓子"),
    ).toBe(true);
    expect(after.lastRound?.deltas).toEqual({
      p0: 48000,
      p1: -48000,
      p2: 0,
      p3: 0,
    });
  });

  it("複数パオ: 役満種類ごとに異なる責任者を保持し、各単位を個別精算する(#525)", () => {
    const state = createGame({ seed: 17 });
    const hand = requireHand(state);
    // 白・發を槓済み。南家(p1)の中で大三元パオ、続いて
    // 西家(p2)の6sで4つ目の槓=四槓子パオが成立する盤面。
    hand.melds.east = [kan("5z 5z 5z 5z"), kan("6z 6z 6z 6z")];
    hand.melds.south = [];
    hand.melds.west = [];
    hand.hands.east = parseTiles("7z 7z 7z 6s 6s 6s 9p");
    hand.hands.south = parseTiles(JUNK);
    hand.hands.west = parseTiles(JUNK);
    hand.pendingDiscard = {
      seat: "south",
      tile: parseTile("7z"),
      haitei: false,
    };
    hand.turn = "south";
    hand.drawn = null;

    const daisangen = declareKan({
      ...state,
      pending: reactPending({
        tile: parseTile("7z"),
        from: "south",
        canKan: true,
      }),
    });
    // 1つ目のパオは大三元を確定させた南家(p1)。
    expect(daisangen.hand?.paoResponsible).toEqual({
      east: { daisangen: "p1" },
    });

    const daisangenHand = requireHand(daisangen);
    daisangenHand.pendingDiscard = {
      seat: "west",
      tile: parseTile("6s"),
      haitei: false,
    };
    daisangenHand.turn = "west";
    daisangenHand.drawn = null;
    const suukantsu = declareKan({
      ...daisangen,
      pending: reactPending({
        tile: parseTile("6s"),
        from: "west",
        canKan: true,
      }),
    });
    expect(suukantsu.phase).toBe("playing");
    expect(suukantsu.hand?.melds.east).toHaveLength(4);
    // 2つ目のパオでも、先に確定した大三元の責任者を上書きしない。
    expect(suukantsu.hand?.paoResponsible).toEqual({
      east: { daisangen: "p1", suukantsu: "p2" },
    });

    const suukantsuHand = requireHand(suukantsu);
    suukantsuHand.drawn = { tile: parseTile("9p"), source: "kanReplacement" };
    suukantsuHand.turn = "east";
    const after = declareTsumo({
      ...suukantsu,
      // 親ダブル役満(各48,000)を2人の責任者が1単位ずつ負担しても終局処理まで到達させる。
      // 入力点も保存則(140,000)を満たし、支払後にトビにならないようにする。
      points: { p0: 10000, p1: 60000, p2: 60000, p3: 10000 },
      pending: discardPending({ canTsumo: true }),
    });

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.winDetails?.yaku.map((y) => y.name)).toEqual(
      expect.arrayContaining(["大三元", "四槓子"]),
    );
    expect(after.lastRound?.deltas).toEqual({
      p0: 96000,
      p1: -48000,
      p2: -48000,
      p3: 0,
    });
    expect(after.lastRound?.winDetails?.payments).toEqual([
      { name: "一郎", amount: 48000 },
      { name: "二郎", amount: 48000 },
    ]);
    // 祝儀はパオ責任者へ寄せず、和了者以外の3兄弟から各1,000を維持する。
    expect(after.bonus).toEqual({ p0: 3000, p1: -1000, p2: -1000, p3: -1000 });
  });

  it("パオ対象+非対象役満: ツモは対象単位だけ責任払い、非対象単位と本場は通常配分する", () => {
    const armed = armedForThirdDragonPon(18);
    const ponState = declarePon(armed);
    const hand = requireHand(ponState);
    // 三元牌3副露 + 字一色の残り1刻子/雀頭。大三元(パオ対象)と字一色(非対象)の複合。
    hand.hands.east = parseTiles("1z 1z 2z 2z");
    hand.drawn = { tile: parseTile("1z"), source: "live" };
    hand.turn = "east";
    const after = declareTsumo({
      ...ponState,
      round: { ...ponState.round, honba: 2 },
      // 親ダブル役満96,000 + 複合ツモ本場400を受けてもトビにしない。
      points: { p0: 5000, p1: 80000, p2: 45000, p3: 10000 },
      pending: discardPending({ canTsumo: true }),
    });

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.winDetails?.yaku.map((y) => y.name)).toEqual(
      expect.arrayContaining(["大三元", "字一色"]),
    );
    // 大三元: p1 が48,000。字一色: 通常親ツモで p1/p2 が各24,000。
    // 複合時の本場は各200なので p1=72,200、p2=24,200。
    expect(after.lastRound?.deltas).toEqual({
      p0: 96400,
      p1: -72200,
      p2: -24200,
      p3: 0,
    });
    expect(after.bonus).toEqual({ p0: 3000, p1: -1000, p2: -1000, p3: -1000 });
  });

  it("門前完成(暗槓のみ)はパオ無し: 責任者は記録されず通常のツモ配分になる", () => {
    const state = createGame({ seed: 14 });
    const hand = requireHand(state);
    hand.melds.east = [kan("5z 5z 5z 5z"), kan("6z 6z 6z 6z")];
    hand.melds.south = [];
    hand.melds.west = [];
    // 中の暗槓後は 123m + 9m 単騎(四暗刻を併発しない形)。
    hand.hands.east = parseTiles("7z 7z 7z 1m 2m 3m 9m");
    hand.hands.south = parseTiles(JUNK);
    hand.hands.west = parseTiles(JUNK);
    hand.drawn = { tile: parseTile("7z"), source: "live" };
    hand.turn = "east";
    const armed = {
      ...state,
      pending: discardPending({ ankanTiles: [parseTile("7z")] }),
    };

    const kanState = declareAnkan(armed, parseTile("7z"));
    // 暗槓は fromOpponentDiscard ではないため recordPaoResponsible は発火しない。
    expect(kanState.phase).toBe("playing");
    expect(kanState.hand?.paoResponsible).toEqual({});

    // 9m をツモって大三元和了。パオ役満だが責任者未記録 → 通常の親ツモ折半。
    const kanHand = requireHand(kanState);
    kanHand.drawn = { tile: parseTile("9m"), source: "live" };
    const after = declareTsumo({
      ...kanState,
      pending: discardPending({ canTsumo: true }),
    });

    expect(after.phase).toBe("roundEnd");
    expect(
      after.lastRound?.winDetails?.yaku.some((y) => y.name === "大三元"),
    ).toBe(true);
    // 責任払いなし: 在席の子2人(p1・p2)が各 24,000(サンマ親ツモ折半)。
    expect(after.lastRound?.deltas).toEqual({
      p0: 48000,
      p1: -24000,
      p2: -24000,
      p3: 0,
    });
  });

  it("existingMelds の境界: 2種目の三元牌ポンでは発火せず、3種目で発火する", () => {
    const state = createGame({ seed: 15 });
    const hand = requireHand(state);
    hand.melds.east = [pon(parseTile("5z"))];
    hand.melds.south = [];
    hand.melds.west = [];
    hand.hands.east = parseTiles("6z 6z 7z 7z 1m 1m 1m 9m");
    hand.hands.south = parseTiles(JUNK);
    hand.hands.west = parseTiles(JUNK);
    hand.pendingDiscard = {
      seat: "south",
      tile: parseTile("6z"),
      haitei: false,
    };
    hand.turn = "south";
    hand.drawn = null;

    // 2種目(發): 鳴きを加える前の副露は白のみ → パオ不発火。
    const second = declarePon({
      ...state,
      pending: reactPending({
        tile: parseTile("6z"),
        from: "south",
        canPon: true,
      }),
    });
    expect(second.hand?.paoResponsible).toEqual({});

    // 3種目(中)を西家(p2)が打牌 → この鳴きで大三元が確定しパオ発火。
    const secondHand = requireHand(second);
    secondHand.pendingDiscard = {
      seat: "west",
      tile: parseTile("7z"),
      haitei: false,
    };
    secondHand.turn = "west";
    secondHand.drawn = null;
    const third = declarePon({
      ...second,
      pending: reactPending({
        tile: parseTile("7z"),
        from: "west",
        canPon: true,
      }),
    });
    expect(third.hand?.paoResponsible).toEqual({
      east: { daisangen: "p2" },
    });
  });

  it("AIの鳴き経路: 自家が鳴かせた3種目でAI側に責任者が記録され、責任者=放銃者のロンは全額負担になる", () => {
    const state = createGame({ seed: 16 });
    const hand = requireHand(state);
    hand.melds.east = [];
    hand.melds.south = [pon(parseTile("5z")), pon(parseTile("6z"))];
    hand.melds.west = [];
    hand.hands.east = parseTiles(JUNK);
    hand.hands.south = parseTiles("7z 7z 1p 1p 1p 4p 9s");
    hand.hands.west = parseTiles(JUNK);
    hand.drawn = { tile: parseTile("7z"), source: "live" };
    hand.turn = "east";

    // 自家(東=p0)が中を打牌 → 南AIがポン(applyAiCall)し、責任者 p0 を記録。
    const called = discard(
      { ...state, pending: discardPending() },
      parseTile("7z"),
    );
    expect(called.phase).toBe("playing");
    expect(called.hand?.paoResponsible).toEqual({
      south: { daisangen: "p0" },
    });

    // 南家を 4p 単騎テンパイに固定し、自家の 4p 放銃で大三元ロン(子・役満 32,000)。
    // 責任者(p0)=放銃者のため折半ではなく1人で全額負担する。
    const calledHand = requireHand(called);
    calledHand.melds.south = [
      pon(parseTile("5z")),
      pon(parseTile("6z")),
      pon(parseTile("7z")),
    ];
    calledHand.hands.south = parseTiles("1p 1p 1p 4p");
    calledHand.discards.south = [];
    calledHand.hands.east = parseTiles(JUNK);
    calledHand.drawn = { tile: parseTile("4p"), source: "live" };
    calledHand.turn = "east";
    calledHand.pendingDiscard = null;
    const after = discard(
      { ...called, pending: discardPending() },
      parseTile("4p"),
    );

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winnerId).toBe("p1");
    expect(
      after.lastRound?.winDetails?.yaku.some((y) => y.name === "大三元"),
    ).toBe(true);
    expect(after.lastRound?.deltas).toEqual({
      p0: -32000,
      p1: 32000,
      p2: 0,
      p3: 0,
    });
    expect(after.lastRound?.winDetails?.payments).toEqual([
      { name: "あなた", amount: 32000 },
    ]);
  });
});
