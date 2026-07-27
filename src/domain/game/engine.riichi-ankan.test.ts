import { describe, expect, it } from "vitest";
import { resolveDora } from "@/domain/dora/doraSet";
import { sameKind } from "@/domain/hand/tile-identity";
import { createTile, HONOR, type Suit, type Tile } from "@/domain/tiles/tile";
import {
  canAnkanAfterRiichi,
  createGame,
  declareAnkan,
  declareTsumo,
  type EngineState,
  type Pending,
  seatOfPlayer,
} from "./engine";

/**
 * リーチ後の暗槓(Q18 / #116・ユーザー承認・条件付き許可 / 標準慣行)。
 *
 * リーチ後は原則自動ツモ切りだが、**ツモ牌での暗槓**に限り、暗槓しても
 *  ① 待ち(和了牌の種別集合)が変わらず、
 *  ② その4枚が全ての和了形で門前の暗刻として確定している
 * 場合のみ許可する。送り槓・七対子テンパイでの暗槓は不可。
 *
 * 純関数 `canAnkanAfterRiichi` の判定を決定的に検証し、`declareAnkan` の
 * 実行フロー(嶺上ツモ・新ドラ無し・リンシャン和了・リーチ継続ロック)を結線で検証する。
 */

const isNorth = (tile: Tile): boolean =>
  tile.suit === "honor" && tile.rank === HONOR.NORTH;

describe("canAnkanAfterRiichi(純関数): リーチ後暗槓の許可判定(Q18 / #116)", () => {
  it("待ち・面子構成が変わらない暗刻の4枚目ツモは許可する", () => {
    // 111m(暗刻)+ 234p 567p 234s + 9s 単騎待ち。待ちは {9s} のみ。
    const hand13 = [
      createTile("man", 1),
      createTile("man", 1),
      createTile("man", 1),
      createTile("pin", 2),
      createTile("pin", 3),
      createTile("pin", 4),
      createTile("pin", 5),
      createTile("pin", 6),
      createTile("pin", 7),
      createTile("sou", 2),
      createTile("sou", 3),
      createTile("sou", 4),
      createTile("sou", 9),
    ];
    // 1m は待ちに含まれず、全和了形で 111m は暗刻に確定 → 許可。
    expect(canAnkanAfterRiichi(hand13, createTile("man", 1))).toBe(true);
  });

  it("孤立した字牌の暗刻もツモ4枚目なら許可する(待ち不変)", () => {
    // 東東東(暗刻)+ 234p 567p 234s + 9s 単騎。東は順子を作らず常に暗刻。
    const hand13 = [
      createTile("honor", HONOR.EAST),
      createTile("honor", HONOR.EAST),
      createTile("honor", HONOR.EAST),
      createTile("pin", 2),
      createTile("pin", 3),
      createTile("pin", 4),
      createTile("pin", 5),
      createTile("pin", 6),
      createTile("pin", 7),
      createTile("sou", 2),
      createTile("sou", 3),
      createTile("sou", 4),
      createTile("sou", 9),
    ];
    expect(canAnkanAfterRiichi(hand13, createTile("honor", HONOR.EAST))).toBe(
      true,
    );
  });

  it("送り槓(暗刻が待ちに絡み面子構成が変わる)は拒否する", () => {
    // 111p 23p 456s 789s 22z(南)。多面待ち {1p, 4p, 2z}:
    //  - 22z を雀頭にすると 111p 暗刻 + 23p 待ち(1p/4p)
    //  - 11p を雀頭にすると 123p 順子 + 2z 待ち(→222z)
    // 1p は待ちでもあり、2z 和了形では 1p が暗刻でない(送り槓)→ 拒否。
    const hand13 = [
      createTile("pin", 1),
      createTile("pin", 1),
      createTile("pin", 1),
      createTile("pin", 2),
      createTile("pin", 3),
      createTile("sou", 4),
      createTile("sou", 5),
      createTile("sou", 6),
      createTile("sou", 7),
      createTile("sou", 8),
      createTile("sou", 9),
      createTile("honor", HONOR.SOUTH),
      createTile("honor", HONOR.SOUTH),
    ];
    expect(canAnkanAfterRiichi(hand13, createTile("pin", 1))).toBe(false);
  });

  it("七対子テンパイでは暗槓を拒否する(暗刻が存在しない)", () => {
    // 6対子 + 単騎(9s)= 七対子テンパイ。同種3枚が無く暗槓不可。
    const hand13 = [
      createTile("pin", 1),
      createTile("pin", 1),
      createTile("pin", 2),
      createTile("pin", 2),
      createTile("pin", 3),
      createTile("pin", 3),
      createTile("pin", 4),
      createTile("pin", 4),
      createTile("sou", 5),
      createTile("sou", 5),
      createTile("sou", 6),
      createTile("sou", 6),
      createTile("sou", 9),
    ];
    // どの牌をツモっても同種は最大2枚 → 4枚目にならず暗槓不可。
    expect(canAnkanAfterRiichi(hand13, createTile("pin", 1))).toBe(false);
    expect(canAnkanAfterRiichi(hand13, createTile("sou", 5))).toBe(false);
    expect(canAnkanAfterRiichi(hand13, createTile("sou", 9))).toBe(false);
  });

  it("暗刻でない牌(3枚未満)のツモは暗槓不可", () => {
    const hand13 = [
      createTile("man", 1),
      createTile("man", 1),
      createTile("pin", 2),
      createTile("pin", 3),
      createTile("pin", 4),
      createTile("pin", 5),
      createTile("pin", 6),
      createTile("pin", 7),
      createTile("sou", 2),
      createTile("sou", 3),
      createTile("sou", 4),
      createTile("sou", 8),
      createTile("sou", 9),
    ];
    // 1m は手牌に2枚のみ(ツモで3枚)→ 4枚目にならず暗槓不可。
    expect(canAnkanAfterRiichi(hand13, createTile("man", 1))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 結線(declareAnkan): 嶺上ツモ・新ドラ無し・リンシャン和了・リーチ継続ロック
// ---------------------------------------------------------------------------

/** 3枚連番の順子。 */
const seq = (suit: Suit, r: number): Tile[] => [
  createTile(suit, r),
  createTile(suit, r + 1),
  createTile(suit, r + 2),
];

/** リーチ待ちの humanDiscard Pending(pump が生成する形に一致)を構築する。 */
function riichiPending(
  ankanTiles: readonly Tile[],
  canTsumo: boolean,
): Pending {
  return {
    kind: "humanDiscard",
    canTsumo,
    canRiichi: false,
    riichiTiles: [],
    ankanTiles,
    kakanTiles: [],
    forbiddenDiscards: [],
    locked: true,
  };
}

/**
 * 「リーチ中に暗刻の4枚目(A)をツモし、暗槓後の嶺上牌(T)で単騎和了」する局面を組む。
 * 嶺上牌 T は王牌末尾(`drawReplacement` が pop する牌)を覗いて確定させ、
 * その T に単騎で待つ手牌を、T の種と重ならない面子で構成する。
 */
function setupRinshanWin(): {
  state: EngineState;
  seat: "east" | "south" | "west";
  ankanTile: Tile;
  rinshanTile: Tile;
} | null {
  for (let seed = 1; seed <= 200; seed++) {
    const s0 = createGame({ seed });
    const hand = s0.hand;
    if (hand === null) continue;
    const seat = seatOfPlayer(hand.seating, "p0");
    if (seat === null) continue;

    const dead = hand.wall.deadWall;
    const rinshanTile = dead[dead.length - 1]; // drawReplacement が最初に pop する牌
    if (isNorth(rinshanTile)) continue; // 北は嶺上で自動抜きされるため避ける

    // 暗刻にする字牌 A(北以外・T が字牌なら T と別種)。
    const aRank =
      rinshanTile.suit === "honor" && rinshanTile.rank === HONOR.EAST
        ? HONOR.SOUTH
        : HONOR.EAST;
    const ankanTile = createTile("honor", aRank);

    // T の種を含まない完成3面子(単騎 T の待ちを純粋にする)。
    let filler: Tile[];
    if (rinshanTile.suit === "pin") {
      filler = [...seq("sou", 1), ...seq("sou", 4), ...seq("sou", 7)];
    } else if (rinshanTile.suit === "sou") {
      filler = [...seq("pin", 1), ...seq("pin", 4), ...seq("pin", 7)];
    } else {
      // man / honor
      filler = [...seq("pin", 1), ...seq("pin", 5), ...seq("sou", 1)];
    }

    const hand13 = [ankanTile, ankanTile, ankanTile, ...filler, rinshanTile];
    // 前提: この手はツモ牌 A で合法暗槓、かつ待ちは単騎 T のみ。
    if (!canAnkanAfterRiichi(hand13, ankanTile)) continue;

    hand.hands[seat] = hand13;
    hand.melds[seat] = [];
    hand.riichi[seat] = true;
    hand.turn = seat;
    hand.drawn = ankanTile;
    hand.fromKan = false;

    const state: EngineState = {
      ...s0,
      pending: riichiPending([ankanTile], false),
    };
    return { state, seat, ankanTile, rinshanTile };
  }
  return null;
}

describe("declareAnkan: リーチ後暗槓の結線(Q18 / #116)", () => {
  it("暗槓で暗槓子が晒され嶺上ツモが行われる(新ドラめくりは無し)", () => {
    const setup = setupRinshanWin();
    expect(setup).not.toBeNull();
    if (setup === null) return;
    const { state, seat, ankanTile, rinshanTile } = setup;

    const doraBefore = resolveDora(
      state.hand?.doraSet ?? { count: 1, indicators: [], uraIndicators: [] },
    );

    const s1 = declareAnkan(state, ankanTile);
    expect(s1.hand).not.toBeNull();
    if (s1.hand === null) return;

    // 暗槓子(門前カン・4枚)が晒される。
    const melds = s1.hand.melds[seat];
    const kan = melds[melds.length - 1];
    expect(kan.type).toBe("kan");
    expect(kan.concealed).toBe(true);
    expect(kan.tiles).toHaveLength(4);
    expect(kan.tiles.every((t2) => sameKind(t2, ankanTile))).toBe(true);

    // 嶺上ツモ: fromKan=true、ツモ牌は王牌末尾の嶺上牌 T。
    expect(s1.hand.fromKan).toBe(true);
    expect(s1.hand.drawn).not.toBeNull();
    expect(s1.hand.drawn && sameKind(s1.hand.drawn, rinshanTile)).toBe(true);

    // 四兄弟麻雀は新ドラ(カンドラ)を持たない → ドラ枚数・表示は不変。
    const doraAfter = resolveDora(s1.hand.doraSet);
    expect(doraAfter.omote).toHaveLength(doraBefore.omote.length);
    expect(s1.hand.doraSet).toEqual(state.hand?.doraSet);

    // リーチは継続 → 打牌はロックされたまま。
    expect(s1.pending?.kind).toBe("humanDiscard");
    if (s1.pending?.kind === "humanDiscard") {
      expect(s1.pending.locked).toBe(true);
    }
  });

  it("暗槓後の嶺上牌で単騎和了(リンシャン和了)できる", () => {
    const setup = setupRinshanWin();
    expect(setup).not.toBeNull();
    if (setup === null) return;
    const { state, ankanTile } = setup;
    const stateWithHonba = {
      ...state,
      round: { ...state.round, honba: 2 },
    };

    const s1 = declareAnkan(stateWithHonba, ankanTile);
    // 嶺上ツモが和了牌 → 嶺上開花+リーチでツモ和了が提示される。
    expect(s1.pending?.kind).toBe("humanDiscard");
    if (s1.pending?.kind !== "humanDiscard") return;
    expect(s1.pending.canTsumo).toBe(true);

    const s2 = declareTsumo(s1);
    expect(s2.phase).toBe("roundEnd");
    expect(s2.lastRound?.kind).toBe("win");
    expect(s2.lastRound?.winnerId).toBe("p0");
    expect(s2.lastRound?.riichiWin).toBe(true);
    const detail = s2.lastRound?.winDetails;
    expect(detail).toBeDefined();
    expect(detail?.yaku.map((yaku) => yaku.name)).toContain("嶺上開花");
    expect(detail?.dora.total).toBe(
      (detail?.dora.omote ?? 0) +
        (detail?.dora.ura ?? 0) +
        (detail?.dora.aka ?? 0) +
        (detail?.dora.gari ?? 0),
    );
    expect(detail?.totalHan).toBe(
      (detail?.yakuHan ?? 0) + (detail?.dora.total ?? 0),
    );
    expect(detail?.payments.length).toBeGreaterThan(0);
    expect(detail?.honba).toBe(2);
    expect(
      detail?.payments.reduce((sum, payment) => sum + payment.amount, 0),
    ).toBe((s2.lastRound?.deltas.p0 ?? 0) - (detail?.stickPayout ?? 0));
  });

  it("最終ライブ牌直前の暗槓でも嶺上開花と海底摸月を重複しない(#352)", () => {
    const setup = setupRinshanWin();
    expect(setup).not.toBeNull();
    if (setup === null) return;
    const { state, ankanTile } = setup;
    const hand = state.hand;
    if (hand === null) return;

    // 残り1枚から暗槓すると、王牌補充の結果ライブ牌は0になる。しかし和了牌は
    // 通常ツモの最終牌ではなく嶺上牌なので、海底摸月は成立しない。
    while (hand.wall.remainingLiveTiles > 1) hand.wall.draw();
    const afterKan = declareAnkan(state, ankanTile);
    expect(afterKan.hand?.wall.remainingLiveTiles).toBe(0);
    expect(afterKan.hand?.fromKan).toBe(true);
    expect(afterKan.pending?.kind).toBe("humanDiscard");
    if (afterKan.pending?.kind !== "humanDiscard") return;
    expect(afterKan.pending.canTsumo).toBe(true);

    const won = declareTsumo(afterKan);
    const yakuNames =
      won.lastRound?.winDetails?.yaku.map((yaku) => yaku.name) ?? [];
    expect(yakuNames).toContain("嶺上開花");
    expect(yakuNames).not.toContain("海底摸月");
  });

  it("送り槓(合法暗槓でない牌)の暗槓要求は no-op で拒否する", () => {
    // pump は合法暗槓が無ければ ankanTiles を空で提示する。その状態で
    // 任意の牌の暗槓を要求しても非合法手として拒否される。
    const s0 = createGame({ seed: 1 });
    const hand = s0.hand;
    expect(hand).not.toBeNull();
    if (hand === null) return;
    const seat = seatOfPlayer(hand.seating, "p0");
    if (seat === null) return;

    // 111p が待ち(送り槓)になる多面待ち手。ツモ 1p は暗槓不可。
    hand.hands[seat] = [
      createTile("pin", 1),
      createTile("pin", 1),
      createTile("pin", 1),
      createTile("pin", 2),
      createTile("pin", 3),
      createTile("sou", 4),
      createTile("sou", 5),
      createTile("sou", 6),
      createTile("sou", 7),
      createTile("sou", 8),
      createTile("sou", 9),
      createTile("honor", HONOR.SOUTH),
      createTile("honor", HONOR.SOUTH),
    ];
    hand.riichi[seat] = true;
    hand.turn = seat;
    hand.drawn = createTile("pin", 1);
    hand.fromKan = false;

    // ankanTiles を空(=pump が提示しない)にした状態で暗槓要求 → no-op。
    const state: EngineState = { ...s0, pending: riichiPending([], true) };
    const after = declareAnkan(state, createTile("pin", 1));
    expect(after).toBe(state);
  });
});
