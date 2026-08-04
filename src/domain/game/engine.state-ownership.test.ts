import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Tile } from "@/domain/tiles/tile";
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
  EngineStateConsumedError,
  type Pending,
  passRon,
  proceedToNextRound,
  seatOfPlayer,
  tsumogiri,
} from "./engine";

/**
 * 公開アクションの **state 所有権契約**(#453 / ADR-0003)を固定する。
 *
 * ## 何を守るテストか
 *
 * engine は `hand` を in-place 更新し、`hand.wall`(`Wall`)・`state.rng`(クロージャ)・
 * `state.ledger`(`SoshiiLedger`)を新旧 state で共有する。つまり公開アクションは
 * **入力 state を破壊する**。これは #453 で「返り値を捨てる投機的な呼び出しが静かに
 * 壊れる」形で顕在化した — 呼び手の state は「リーチ宣言済みフラグは立っているが供託も
 * 点棒も未反映」という、エンジンが本来作らない組み合わせで残る。
 *
 * 採った契約は「**入力は使い捨て**(engine が所有権を取る)」であり、破壊性を消すことでは
 * ない(消すには `Wall`/`Rng`/`SoshiiLedger` の複製が要り、`hand` だけ複製すると
 * 「手牌は元のまま・山だけ進んだ」state ができて牌の保存則が静かに破れる)。代わりに
 * **契約違反を無症状で進行させない**。#453 では違反が「局が終わらない/テストが遅い」
 * という別の症状(500巡以上のツモ切り)に化け、flaky と誤認された。
 *
 * したがって本ファイルが固定するのは次の3点である。
 *
 * 1. 遷移に使った state を再びアクションへ渡すと {@link EngineStateConsumedError} で即死する
 *    (= 呼び手側の壊れた state で進行が続かない)。
 * 2. 非合法手の no-op は**消費しない**(#105 の同一参照契約 / UI の journal 抑止が依存)。
 * 3. 契約は公開アクション**全11本**に一様に掛かっており、新設アクションで掛け忘れない。
 *
 * ## ここで扱わないもの
 *
 * 消費済み state を**読むだけ**のコードは依然として中途半端な値を読む(下の
 * 「#453 の再現」がその値そのものを assert している)。WeakSet で捕まえられるのは
 * 「再びアクションへ渡した」場合だけであり、この残存穴は ADR-0003 の
 * 「この決定で解決しないこと」に明記してある。
 */

/** #453 が再現 seed として挙げる値(自家の初打で `canRiichi` が立つ)。 */
const RIICHI_OFFER_SEED = 782;

function humanDiscardPending(
  state: EngineState,
): Extract<Pending, { kind: "humanDiscard" }> {
  const pending = state.pending;
  if (pending?.kind !== "humanDiscard") {
    throw new Error(`expected humanDiscard, got ${pending?.kind ?? "null"}`);
  }
  return pending;
}

/** 自家の手牌から1枚(打牌の実引数用)。 */
function anyHumanTile(state: EngineState): Tile {
  const hand = state.hand;
  if (hand === null) throw new Error("no hand");
  const seat = seatOfPlayer(hand.seating, "p0");
  if (seat === null) throw new Error("human is on the bench");
  const tile = hand.drawn ?? hand.hands[seat][0];
  if (tile === undefined) throw new Error("empty hand");
  return tile;
}

describe("engine の state 所有権契約(#453)", () => {
  it("返り値を捨てた declareRiichi の後、同じ state で進行を続けようとすると即座に落ちる", () => {
    const state = createGame({ seed: RIICHI_OFFER_SEED });
    const pending = humanDiscardPending(state);
    expect(pending.canRiichi).toBe(true);
    const hand = state.hand;
    if (hand === null) throw new Error("no hand");
    const seat = seatOfPlayer(hand.seating, "p0");
    if (seat === null) throw new Error("human is on the bench");

    const pointsBefore = state.points.p0;
    const sticksBefore = state.riichiSticks;
    const riichiBefore = hand.riichi[seat];
    expect(riichiBefore).toBe(false);

    // #453 の投機的呼び出し: 呼んでみて返り値を**捨てる**。
    declareRiichi(state, pending.riichiTiles[0]);

    // 呼び手側の state に残る不整合(= この契約が必要な理由そのもの)。
    // `hand` は共有参照なのでフラグだけが立ち、供託・点棒は返り値側にしか無い。
    expect(hand.riichi[seat]).toBe(true);
    expect(state.points.p0).toBe(pointsBefore);
    expect(state.riichiSticks).toBe(sticksBefore);

    // 契約: この state はもう進められない。#453 ではここから 500 巡以上ツモ切りが
    // 続いたが、いまは最初の再投入で落ちる。
    expect(() => discard(state, anyHumanTile(state))).toThrow(
      EngineStateConsumedError,
    );
  });

  it("消費済み state を渡すと、どのアクションでもアクション名つきで落ちる", () => {
    const state = createGame({ seed: RIICHI_OFFER_SEED });
    const tile = humanDiscardPending(state).riichiTiles[0];
    // 遷移を1つ起こして `state` を消費する(返り値は使わない = 以降の入力は消費済み)。
    discard(state, anyHumanTile(state));

    // 合法性の判定より**前**にガードが効くこと(局面に依らず一様であること)を、
    // 現局面では非合法なアクションも含めて確認する。
    const calls: readonly [string, () => EngineState][] = [
      ["discard", () => discard(state, tile)],
      ["tsumogiri", () => tsumogiri(state)],
      ["declareRiichi", () => declareRiichi(state, tile)],
      ["declarePon", () => declarePon(state)],
      ["declareKan", () => declareKan(state)],
      ["declareAnkan", () => declareAnkan(state, tile)],
      ["declareKakan", () => declareKakan(state, tile)],
      ["declareTsumo", () => declareTsumo(state)],
      ["declareRon", () => declareRon(state)],
      ["passRon", () => passRon(state)],
      ["proceedToNextRound", () => proceedToNextRound(state)],
    ];
    for (const [name, call] of calls) {
      // 診断性がこの変更の目的なので、どのアクションで落ちたかがメッセージに出ること
      // まで固定する(#453 は「原因追跡に時間が掛かる」ことが実害だった)。
      expect(call, name).toThrow(EngineStateConsumedError);
      expect(call, name).toThrow(new RegExp(`\\b${name}\\(\\)`));
    }
  });

  it("非合法手の no-op は state を消費しない(同一参照を返し、続けて操作できる)", () => {
    const state = createGame({ seed: RIICHI_OFFER_SEED });
    const pending = humanDiscardPending(state);

    // 打牌待ちに対する `passRon` は非合法 = 同一参照の no-op(#105 と同じ契約)。
    expect(passRon(state)).toBe(state);
    // 遷移していないのだから、続けて合法手を通せなければならない。
    // (ここで落ちると UI の「非合法操作を無視して待ち続ける」導線が壊れる。)
    const after = declareRiichi(state, pending.riichiTiles[0]);
    expect(after).not.toBe(state);
  });

  it("返り値だけを使う通常の進行では落ちない(誤検知が無い)", () => {
    let state: EngineState = createGame({ seed: RIICHI_OFFER_SEED });
    // 半荘完走は `engine.termination.test.ts` の担当。ここは「ガードが正常進行を
    // 巻き込まない」ことだけを見るので、局をまたぐ遷移を含む短い走査で足りる。
    for (let step = 0; step < 200 && state.phase !== "gameEnd"; step += 1) {
      if (state.phase === "roundEnd") {
        state = proceedToNextRound(state);
        continue;
      }
      const pending = state.pending;
      if (pending?.kind === "humanReact") {
        state = pending.canRon ? declareRon(state) : passRon(state);
        continue;
      }
      if (pending?.kind === "humanDiscard") {
        if (pending.canTsumo) {
          state = declareTsumo(state);
          continue;
        }
        state = pending.locked
          ? tsumogiri(state)
          : discard(state, anyHumanTile(state));
        continue;
      }
      throw new Error(`stuck: phase=${state.phase}`);
    }
    expect(state.phase).not.toBe("playing");
  });
});

describe("公開アクションの契約適用漏れ(構造ガード)", () => {
  /**
   * 契約は `publicAction` を通したものにしか掛からない。新しい公開アクションを
   * `export function` で足すと、テストは全部通るのに #453 の失敗モードだけが復活する。
   * 挙動テストでは「まだ書かれていないアクション」を守れないため、ソース側で固定する。
   */
  it("公開アクション節の export はすべて publicAction 経由で、名前が一致している", () => {
    const source = readFileSync(
      new URL("./engine.ts", import.meta.url),
      "utf-8",
    );
    const marker = "// 公開アクション(UI から呼ぶ操作)";
    const start = source.indexOf(marker);
    expect(start, "公開アクション節の見出しが見つからない").toBeGreaterThan(0);
    const section = source.slice(start);

    // 節の中に生の `export function` が無いこと(= 契約を迂回した公開アクションが無い)。
    expect(section.match(/^export function /gm)).toBeNull();

    const declared = [
      ...section.matchAll(/^export const (\w+) = publicAction\(\s*"([^"]+)"/gm),
    ];
    // 第1引数の名前は例外メッセージに出る診断情報なので、公開名との一致まで見る。
    for (const [, constName, actionName] of declared) {
      expect(
        actionName,
        `publicAction の名前が公開名と違う: ${constName}`,
      ).toBe(constName);
    }
    expect(declared.map(([, name]) => name).sort()).toEqual(
      [
        "declareAnkan",
        "declareKakan",
        "declareKan",
        "declarePon",
        "declareRiichi",
        "declareRon",
        "declareTsumo",
        "discard",
        "passRon",
        "proceedToNextRound",
        "tsumogiri",
      ].sort(),
    );
  });
});
