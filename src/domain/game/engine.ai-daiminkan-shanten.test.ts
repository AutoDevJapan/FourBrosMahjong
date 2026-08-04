import { describe, expect, it } from "vitest";
import { shanten } from "@/domain/game/ai";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import { createGame, discard, type EngineState, type SeatKey } from "./engine";

/**
 * AI の**大明槓**が向聴を悪化させないこと(issue #322)。
 *
 * #304 / PR #320 の向聴悪化ガードは自ツモ番の加槓・暗槓にしか掛かっておらず、大明槓は
 * 「{@link shouldCallMeld} が役牌にしか鳴きを許さないから安全」という前提で見送られていた。
 * この前提は**誤り**で、`shouldCallMeld` が役牌限定なのは**最初の1副露だけ**である
 * (役牌の副露が1つでもあれば以後は任意の牌を鳴く)。よって役牌ポン済みの AI が
 * 順子・塔子に使っている牌を明槓して手を崩す事象は現実に起こる。
 *
 * ## 対案は「鳴かない」ではなく「ポン」
 *
 * `shouldCallMeld` が真の局面でのみ判定するため、鳴くこと自体は既に決まっている。
 * したがって悪化する大明槓は**見送るのではなくポンへ落とす**。4枚目を手牌に残せるぶん
 * ポンが優越しうる、というのが本 issue の要点。
 *
 * ## 実測(4,000半荘 / 自家 p0 も `chooseDiscard` 方策)
 *
 * 大明槓 1,944件のうち **88件 (4.5%) が向聴悪化**、うち **66件はポンならテンパイを
 * 保てた**局面だった(seed 1〜800 では 377件中14件・うち6件)。ガード適用後は大明槓が
 * 1,944→1,858(−86)と概ね悪化件数ぶん減り、ポンが +104 に増える(before/after で局の
 * 進行が変わるため seed 対応は取れず、悪化件数 88 とは厳密一致しない)。
 *
 * フィクスチャ方式は `engine.ai-kan-shanten.test.ts` と同じ(`createGame` の初期局面を
 * 上書きし、自家(東)の打牌で AI(南)に鳴かせる)。**牌保存則は成立しない**点も同じで、
 * アサーションは南の手牌・副露にローカルな性質だけを見る。
 */

/** 自家(東)用の散らばり13枚(和了・テンパイ・国士いずれも不成立)。 */
const EAST_JUNK_13 = "1m 9m 2p 5p 8p 3s 6s 9s 1z 2z 3z 5z 6z";

/** 役牌(白)のポン。これがあると `shouldCallMeld` は以後どの牌でも鳴きを許す。 */
function whitePon(): Meld {
  return { type: "pon", tiles: parseTiles("5z 5z 5z"), concealed: false };
}

/**
 * 席の門前手牌と副露を上書きする。
 *
 * 枚数を明示検証する: 門前は `13 − 3×副露数` 枚でなければならない。これを破ると
 * 鳴き判定時の pool が `14 − 3×副露数` にならず、向聴が誤った前提で評価されて
 * テストが意図しない理由で通る(#303 / #320 で2度起きた事故クラス)。
 */
function setSeatWithMelds(
  state: EngineState,
  seat: SeatKey,
  hand: string,
  melds: readonly Meld[],
): void {
  const h = state.hand;
  if (h === null) throw new Error("no hand");
  const tiles = parseTiles(hand);
  expect(tiles).toHaveLength(13 - 3 * melds.length);
  for (const meld of melds) expect(meld.tiles).toHaveLength(3);
  h.hands[seat] = tiles;
  h.melds[seat] = [...melds];
  h.discards[seat] = [];
}

/**
 * 自家(東)が `drawnTile` を打つ直前の局面を作る。
 *
 * 西も散らばり手で固定する。ロン判定ループは鳴きループより**先に全席を走る**ため、
 * 西が配牌のままだと打牌をロンできてしまい `settleWin` が先に返って、テストが
 * 「鳴きに到達しなかった」という無関係の理由で落ちうる(seed 依存の暗黙前提)。
 */
function armEastDiscard(seed: number, drawnTile: string): EngineState {
  const s = createGame({ seed });
  const hand = s.hand;
  if (hand === null) throw new Error("no hand");
  hand.hands.east = parseTiles(EAST_JUNK_13);
  hand.melds.east = [];
  hand.discards.east = [];
  hand.hands.west = parseTiles(EAST_JUNK_13);
  hand.melds.west = [];
  hand.discards.west = [];
  hand.drawn = { tile: parseTile(drawnTile), source: "live" };
  hand.turn = "east";
  return {
    ...s,
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
  };
}

describe("engine: 向聴を悪化させる大明槓はポンへ落とす(#322)", () => {
  it("順子に使っている牌の明槓でテンパイが崩れる場合はポンに留める", () => {
    // 南: 白ポン + 門前10枚 `5s 5s 5s 4s 6s 123p 9m 1z`。東が 4枚目の 5s を打つ。
    //   明槓: 5s×4 が抜けて `4s 6s 123p 9m 1z`(7枚)→ 4s6s が嵌張のみで対子なし → 1向聴。
    //   ポン : 5s×3 が抜けて `4s 5s 6s 123p 9m 1z`(8枚)→ 456s が残り
    //          白ポン + 5sポン + 456s + 123p の4面子 + 9m/1z の単騎 → 打 9m/1z で 0向聴。
    // ポンが厳密に優越するため、大明槓ではなくポンを選ぶ。
    const state = armEastDiscard(1, "5s");
    setSeatWithMelds(state, "south", "5s 5s 5s 4s 6s 1p 2p 3p 9m 1z", [
      whitePon(),
    ]);

    const after = discard(state, parseTile("5s"));

    const hand = after.hand;
    if (hand === null) throw new Error("hand should exist");
    const melds = hand.melds.south;
    expect(melds).toHaveLength(2);
    // 大明槓ではなくポンになっている(これが #322 の核心)。
    expect(melds[1].type).toBe("pon");
    expect(melds[1].tiles).toHaveLength(3);
    expect(melds[1].concealed).toBe(false);
    // ポン後の打牌まで完了し、テンパイを保っている(7枚 = 13 − 3×2)。
    expect(hand.hands.south).toHaveLength(7);
    expect(shanten(hand.hands.south, 2)).toBe(0);
    // 4枚目は門前に残っている(= ポンが3枚しか消費していない)。#322 で「同種3枚持ちの
    // ままポンへ到達する」経路が初めて実在するようになったことを示す(#325 が扱う経路)。
    //
    // ただし `applyAiCall` の `forbiddenDiscards` は**依然として到達不能**で、#325 の
    // 「喰い替えを禁じる」テストは書けない(修正前コードでも緑になる): ポンへ落とすのは
    // 「4枚目を切った形より厳密に良い打牌が存在する」場合に限られ、`chooseDiscard` は
    // 向聴を最優先するので必ずその牌を選ぶため。実際 `forbiddenDiscards` を空にする
    // ミューテーションを掛けても本テストは落ちない。
    expect(
      hand.hands.south.filter((t) => sameKind(t, parseTile("5s"))),
    ).toHaveLength(1);
  });

  it("向聴を悪化させない大明槓は従来どおり宣言する(過剰抑制しない)", () => {
    // 南: 白ポン + 門前10枚 `1m 1m 1m 2s 3s 5s 6s 9p 2z 3z`。東が 4枚目の 1m を打つ。
    // 1m は独立した暗刻で塔子・順子に絡まないため、明槓してもポン後の最良形と
    // 向聴が変わらない(どちらも 白 + 1m の2面子 + 23s/56s の2塔子)。
    const state = armEastDiscard(1, "1m");
    setSeatWithMelds(state, "south", "1m 1m 1m 2s 3s 5s 6s 9p 2z 3z", [
      whitePon(),
    ]);

    const after = discard(state, parseTile("1m"));

    const hand = after.hand;
    if (hand === null) throw new Error("hand should exist");
    const melds = hand.melds.south;
    expect(melds).toHaveLength(2);
    expect(melds[1].type).toBe("kan");
    expect(melds[1].concealed).toBe(false);
    expect(melds[1].tiles).toHaveLength(4);
  });
});
