import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import { HONOR, type Tile } from "@/domain/tiles/tile";
import {
  createGame,
  declareKita,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  type SeatKey,
  seatOfPlayer,
} from "./engine";

/**
 * 北抜き(ガリ)による嶺上ツモの役判定(issue #396)。
 *
 * `isHaiteiTsumo` は「嶺上補充でライブ牌が 0 になっても海底摸月ではない」と契約して
 * いるが、北抜きの補充経路だけが通常ツモ扱い(嶺上由来として記録されない)ままで、
 * **嶺上牌でのツモに海底摸月(1翻)が誤って付与**されていた。
 *
 * 嶺上開花はカン限定(spec 3.2「槓の嶺上牌で和了」)なので、北抜きの嶺上牌に
 * 付けてはならない。両方を同時に固定する。
 *
 * ## Q33 との関係
 *
 * 「海底(ライブ牌 0)で北を抜けるか / 王牌が 14 → 13 枚に減るのを許すか」は
 * `質問リスト.md` **Q33 が未回答**。そこで主となる回帰テストは
 * **ライブ牌が残っている状態で北を引く**局面(嶺上補充がライブ最後の1枚を吸って
 * `remainingLiveTiles` が 0 になる / 王牌は 14 枚のまま)に置いた。この局面は
 * その境界に依存しない局面に置き、現行挙動を固定する海底ケースも別に持つ。
 */

/** 和了者の副露: 白のポン。これで役(役牌)が必ず1つ付き、非門前になる。 */
function whitePon(): Meld {
  return { type: "pon", tiles: parseTiles("5z 5z 5z"), concealed: false };
}

/**
 * 和了者の副露: 2筒のポン。役牌でないので**役が1つも付かない**(非門前)。
 * 海底摸月が誤付与されるかどうかが「和了できるか」を直接分ける。
 */
function plainPon(): Meld {
  return { type: "pon", tiles: parseTiles("2p 2p 2p"), concealed: false };
}

/**
 * 和了者の門前10枚を「3面子 + `winTile` の単騎待ち」で組む。
 *
 * `456s`(中張牌)を含めるためチャンタ/純チャン/混老頭は付かず、`1p`/`789s` を
 * 含めるため断幺九も付かない。`winTile` が何であっても役は白のみになる。
 */
function tenpaiOn(winTile: Tile): Tile[] {
  return [...parseTiles("123p 456s 789s"), winTile];
}

/** 自家(東)が最初に切る牌。他家のどの手牌とも干渉しない。 */
const EAST_DISCARD = "1z";

/** テンパイしない散らばり手(サンマの萬子は一萬・九萬のみ)。 */
const JUNK_13 = "1m 9m 2p 5p 8p 2s 5s 8s 2z 3z 6z 7z 4p";
const JUNK_13_ALT = "1m 9m 3p 6p 9p 3s 6s 9s 2z 3z 6z 7z 4s";

interface Options {
  /** 自家の打牌時点で残すライブ牌の枚数。 */
  readonly liveTiles: number;
  /** 北を引いて和了する席。`east` は自家(人間)経路。 */
  readonly winner: Extract<SeatKey, "east" | "south">;
  /**
   * 和了者の副露。`"white"` は役牌ポン(必ず役が付く)、`"plain"` は 2筒ポン
   * (役が付かないので、海底摸月の誤付与の有無が和了可否を直接分ける)。
   */
  readonly meld?: "white" | "plain";
}

interface Fixture {
  readonly state: EngineState;
  readonly discardTile: Tile;
  /** 和了者が単騎で待つ牌(= 北を抜いた後に引く嶺上牌)。 */
  readonly winTile: Tile;
  /** 和了者が引くライブ牌(北であること)。 */
  readonly drawnLiveTile: Tile;
}

/**
 * 自家(東)の打牌をきっかけに、`winner` が北を引いて嶺上牌でツモ和了する局面を組む。
 *
 * 打牌後のツモ順は 南 → 西 → 東 なので、南が引くのはライブ壁の先頭、
 * 東が引くのは3枚目。`liveTiles` で「北を引いた時点でライブ壁に補填余地が
 * 残っているか」を作り分ける。
 */
function armKitaWin(seed: number, opts: Options): Fixture {
  const base = createGame({ seed });
  const hand = base.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");
  if (seatOfPlayer(hand.seating, "p0") !== "east") {
    throw new Error("初局の自家は東であることを前提にしたフィクスチャ");
  }

  while (hand.wall.remainingLiveTiles > opts.liveTiles) hand.wall.draw();
  const drawIndex = opts.winner === "south" ? 0 : 2;
  const drawnLiveTile = hand.wall.liveWall[drawIndex];
  if (drawnLiveTile.suit !== "honor" || drawnLiveTile.rank !== HONOR.NORTH) {
    throw new Error(
      `seed=${seed}: ${opts.winner} が引くライブ牌が北であることを前提にしたフィクスチャ`,
    );
  }
  // 北を抜くと王牌末尾(= `drawReplacement` が返す牌)を引く。
  const deadWall = hand.wall.deadWall;
  const winTile = deadWall[deadWall.length - 1];
  if (winTile.suit === "honor" && winTile.rank === HONOR.NORTH) {
    throw new Error(
      `seed=${seed}: 嶺上牌が北では連続抜きになりフィクスチャ不成立`,
    );
  }

  for (const seat of ["east", "south", "west"] as SeatKey[]) {
    hand.melds[seat] = [];
    hand.discards[seat] = [];
    hand.discardHistory[seat] = [];
    hand.riichi[seat] = false;
    hand.riichiMiss[seat] = false;
    hand.tempMiss[seat] = false;
    hand.hands[seat] = parseTiles(seat === "west" ? JUNK_13_ALT : JUNK_13);
  }
  hand.melds[opts.winner] = [opts.meld === "plain" ? plainPon() : whitePon()];
  hand.hands[opts.winner] = tenpaiOn(winTile);
  hand.callsMade = true; // 鳴きが入った局(天和/地和を潰す)

  const discardTile = parseTile(EAST_DISCARD);
  if (sameKind(discardTile, winTile)) {
    throw new Error("自家の打牌が待ち牌と同種ではフィクスチャが成立しない");
  }
  hand.drawn = { tile: discardTile, source: "live" };
  hand.turn = "east";

  return {
    drawnLiveTile,
    winTile,
    discardTile,
    state: {
      ...base,
      pending: {
        kind: "humanDiscard",
        canTsumo: false,
        canRiichi: false,
        riichiTiles: [],
        ankanTiles: [],
        kakanTiles: [],
        forbiddenDiscards: [],
        locked: false,
      },
    },
  };
}

function yakuNames(state: EngineState): string[] {
  return state.lastRound?.winDetails?.yaku.map((y) => y.name) ?? [];
}

/**
 * 北抜き後の嶺上牌を、リーチ後の南家に自動ツモ切りさせる局面を組む。
 * 東家はその牌を待つが、白ポン以外に役を持たせない。
 */
function armKitaReplacementDiscard(meld: "white" | "plain"): Fixture {
  const fixture = armKitaWin(48, {
    liveTiles: 1,
    winner: "south",
    meld: "white",
  });
  const hand = fixture.state.hand;
  if (hand === null) throw new Error("hand should exist");

  hand.melds.east = [meld === "white" ? whitePon() : plainPon()];
  hand.hands.east = tenpaiOn(fixture.winTile);
  hand.melds.south = [];
  hand.hands.south = parseTiles(JUNK_13);
  hand.riichi.south = true;
  hand.doubleRiichi.south = false;
  hand.ippatsu.south = false;
  hand.callsMade = true;

  return fixture;
}

describe("engine: 北抜きの嶺上ツモと海底摸月(#396)", () => {
  it("対照: 通常の海底牌(北でない)をツモしたら海底摸月が付く", () => {
    // 回帰確認: 海底摸月の判定そのものは壊していない。
    const base = createGame({ seed: 1 });
    const hand = base.hand;
    if (hand === null) throw new Error("hand should exist");
    while (hand.wall.remainingLiveTiles > 1) hand.wall.draw();
    const winTile = hand.wall.liveWall[0];
    expect(winTile.suit === "honor" && winTile.rank === HONOR.NORTH).toBe(
      false,
    );

    for (const seat of ["east", "south", "west"] as SeatKey[]) {
      hand.melds[seat] = [];
      hand.discards[seat] = [];
      hand.discardHistory[seat] = [];
      hand.hands[seat] = parseTiles(seat === "west" ? JUNK_13_ALT : JUNK_13);
    }
    hand.melds.south = [whitePon()];
    hand.hands.south = tenpaiOn(winTile);
    hand.callsMade = true;
    const discardTile = parseTile(EAST_DISCARD);
    hand.drawn = { tile: discardTile, source: "live" };
    hand.turn = "east";

    const after = discard(
      {
        ...base,
        pending: {
          kind: "humanDiscard",
          canTsumo: false,
          canRiichi: false,
          riichiTiles: [],
          ankanTiles: [],
          kakanTiles: [],
          forbiddenDiscards: [],
          locked: false,
        },
      },
      discardTile,
    );

    expect(after.lastRound?.kind).toBe("win");
    expect(yakuNames(after)).toContain("海底摸月");
  });

  it("北抜きの嶺上ツモには海底摸月も嶺上開花も付かない(AI / 王牌14枚のまま)", () => {
    // ライブ牌2枚で南が北を引く → 嶺上補充が最後の1枚を吸って海底になるが、
    // 王牌は補填されて14枚のまま。Q33 の裁定に依存しない局面。
    const { state, discardTile, winTile } = armKitaWin(7, {
      liveTiles: 2,
      winner: "south",
    });

    const after = discard(state, discardTile);

    // 前提: 北抜きが起きて南が嶺上牌で和了している(空振り防止)。
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winDetails?.winningTile).toEqual(winTile);
    expect(after.lastRound?.winDetails?.winType).toBe("tsumo");

    const yaku = yakuNames(after);
    // 嶺上牌のツモなので海底摸月ではない(`isHaiteiTsumo` の実装契約)。
    expect(yaku).not.toContain("海底摸月");
    // 嶺上開花は「槓の嶺上牌」限定。北抜きの嶺上牌には付けない(spec 3.2)。
    expect(yaku).not.toContain("嶺上開花");
    // 役自体は成立している(白のポン)。役はこれ1つだけ。
    expect(yaku).toEqual(["役牌(三元牌)"]);
  });

  it("北抜きの嶺上ツモには海底摸月も嶺上開花も付かない(自家 / declareTsumo 経路)", () => {
    // 自家(東)は `buildHumanPending` の役判定と `declareTsumo` の役判定という
    // 別の2経路を通る。ライブ牌4枚から 南→西→東 の順に引き、東が北を引く。
    const { state, discardTile, winTile } = armKitaWin(7, {
      liveTiles: 4,
      winner: "east",
    });

    const beforeKita = discard(state, discardTile);
    expect(beforeKita.pending).toMatchObject({
      kind: "humanDiscard",
      canKita: true,
    });
    const after = declareKita(beforeKita);

    // 前提: 自家の手番に戻り、ツモ和了が提示されている(空振り防止)。
    expect(after.phase).toBe("playing");
    expect(after.pending?.kind).toBe("humanDiscard");
    if (after.pending?.kind !== "humanDiscard") return;
    expect(after.pending.canTsumo).toBe(true);
    expect(after.hand?.drawn?.tile).toEqual(winTile);
    expect(after.hand?.kita.east).toBe(1);

    const won = declareTsumo(after);

    expect(won.lastRound?.kind).toBe("win");
    expect(won.lastRound?.winnerId).toBe("p0");
    const yaku = yakuNames(won);
    expect(yaku).not.toContain("海底摸月");
    expect(yaku).not.toContain("嶺上開花");
    expect(yaku).toEqual(["役牌(三元牌)"]);
  });

  it("役が海底摸月しかない手は、北抜きの嶺上ツモでは和了として提示されない", () => {
    // `buildHumanPending` の役判定(ツモボタンの可否)を直接固定する。
    // 役牌でないポンなので、海底摸月が誤付与されるかどうかが和了可否を分ける。
    const { state, discardTile, winTile } = armKitaWin(7, {
      liveTiles: 4,
      winner: "east",
      meld: "plain",
    });

    const beforeKita = discard(state, discardTile);
    expect(beforeKita.pending).toMatchObject({
      kind: "humanDiscard",
      canKita: true,
    });
    const after = declareKita(beforeKita);

    // 前提: 自家が北を抜いて嶺上牌をツモしている(空振り防止)。
    expect(after.phase).toBe("playing");
    expect(after.pending?.kind).toBe("humanDiscard");
    if (after.pending?.kind !== "humanDiscard") return;
    expect(after.hand?.drawn?.tile).toEqual(winTile);
    expect(after.hand?.kita.east).toBe(1);
    // 待ちは揃っているが役が無いので和了できない。海底摸月が誤って付くと true になる。
    expect(after.pending.canTsumo).toBe(false);
    // 防御的に直接呼んでも和了しない(`declareTsumo` 側の役判定)。
    expect(declareTsumo(after).phase).toBe("playing");
  });

  it("海底ちょうどで北を抜いた嶺上ツモにも海底摸月は付かない(Q33 現行挙動)", () => {
    // ライブ牌1枚で南が北を引く。嶺上補充の補填ができず王牌が 14 → 13 枚に減る。
    // Q33 は未回答だが、現状は補充可能な限り北を抜ける。
    const { state, discardTile, winTile } = armKitaWin(48, {
      liveTiles: 1,
      winner: "south",
    });

    const after = discard(state, discardTile);

    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winDetails?.winningTile).toEqual(winTile);
    const yaku = yakuNames(after);
    expect(yaku).not.toContain("海底摸月");
    expect(yaku).not.toContain("嶺上開花");
    expect(yaku).toEqual(["役牌(三元牌)"]);
  });

  it("北抜き後の嶺上牌の打牌には河底撈魚を付けない", () => {
    // 南がライブ最後の北を引き、嶺上牌をツモ切りする。東はその牌を待つが、
    // 役無しのため、河底撈魚を誤付与したときだけロンが成立する。
    const { state, discardTile } = armKitaReplacementDiscard("plain");

    const after = discard(state, discardTile);

    expect(after.lastRound?.kind).toBe("draw");
  });

  it("北抜き後の嶺上牌へのロンにも河底撈魚を付けない", () => {
    // 白ポンでロン自体は成立させ、`declareRon` が壁残数だけを見て河底を
    // 後付けしないことも固定する。
    const { state, discardTile } = armKitaReplacementDiscard("white");

    const after = discard(state, discardTile);

    expect(after.pending?.kind).toBe("humanReact");
    if (after.pending?.kind !== "humanReact") return;
    expect(after.pending.canRon).toBe(true);

    const won = declareRon(after);
    expect(won.lastRound?.kind).toBe("win");
    expect(yakuNames(won)).toEqual(["役牌(三元牌)"]);
  });
});
