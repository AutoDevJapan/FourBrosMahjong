import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import {
  createGame,
  declareAnkan,
  declareKakan,
  type EngineState,
  type Pending,
} from "./engine";

/**
 * 海底(`hand.wall.remainingLiveTiles === 0`)での暗槓/加槓の禁止(#128)。
 *
 * 海底は嶺上牌の補充ができない(`Wall.drawReplacement` はライブ壁を補填せず海底を
 * 越えて進行してしまう)ため、標準慣行どおりカン(暗槓・加槓)を不可とする。
 *
 * 他家打牌への明槓/ポンは `canHumanCall` の `if (haitei) return false` で既にガード済み。
 * 本テストは自家ツモ番のカン(暗槓・加槓・リーチ後暗槓)を対象に、
 *  - 海底では選択肢(pending)に出さない(`buildHumanPending` / `riichiAnkanTiles` の抑制)、
 *  - 万一直接呼ばれても no-op で拒否する(`declareAnkan` / `declareKakan` の防御ガード)、
 *  - 海底1歩手前(`remainingLiveTiles >= 1`)では従来どおりカンできる(回帰なし)、
 * を検証する。`HandState` は engine 内部型のため、`createGame` 初期局面の可変フィールドを
 * 直接上書きして局面を組み立てる(既存の chankan / riichi-ankan テストと同方針)。
 */

/** ライブ壁を目標枚数まで通常ツモで削る(海底状況の再現)。 */
function drainLiveWallTo(state: EngineState, target: number): void {
  const hand = state.hand;
  if (hand === null) throw new Error("hand should exist");
  while (hand.wall.remainingLiveTiles > target) hand.wall.draw();
}

function humanDiscardPending(overrides: Partial<Pending & object>): Pending {
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

/** 東家(自家 p0)に「1m の暗刻 + ツモ 1m(4枚目)」の暗槓待ち局面を組む。 */
function armAnkan(seed: number, opts: { riichi?: boolean } = {}): EngineState {
  const s = createGame({ seed });
  const hand = s.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");

  // 1m の暗刻(3枚)を手に持ち、4枚目をツモした状態(pool に 1m×4)。
  hand.hands.east = parseTiles("1m 1m 1m 2p 3p 4p 6p 7p 8p 4s 5s 6s");
  hand.melds.east = [];
  hand.drawn = { tile: parseTile("1m"), source: "live" };
  hand.turn = "east";
  hand.riichi.east = opts.riichi ?? false;
  // 他家は非テンパイ(国士暗槓槍槓 #126 が誤発火しないよう固定)。
  hand.hands.south = parseTiles("2m 3m 5m 6m 8m 2s 3s 5s 7s 8s 2p 4p 6p");
  hand.hands.west = parseTiles("2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 1s");

  return {
    ...s,
    pending: humanDiscardPending({
      ankanTiles: [parseTile("1m")],
      locked: opts.riichi ?? false,
    }),
  };
}

/** 東家(自家 p0)に「3p/7p のポン + 手に各4枚目」の加槓待ち局面を組む。 */
function armKakan(seed: number): EngineState {
  const s = createGame({ seed });
  const hand = s.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");

  const pon3p: Meld = {
    type: "pon",
    tiles: parseTiles("3p 3p 3p"),
    concealed: false,
  };
  const pon7p: Meld = {
    type: "pon",
    tiles: parseTiles("7p 7p 7p"),
    concealed: false,
  };
  hand.melds.east = [pon3p, pon7p];
  // pool(= hands + drawn)に加槓の4枚目 3p / 7p を含める。残りは和了にならない雑多牌。
  hand.hands.east = parseTiles("3p 7p 1m 9m 1s 9s 1p");
  hand.drawn = { tile: parseTile("9m"), source: "live" };
  hand.turn = "east";
  // 他家は非テンパイ(3p/7p の槍槓が発火しないよう固定)。
  hand.hands.south = parseTiles("2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 1s");
  hand.hands.west = parseTiles("2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 1s");

  return {
    ...s,
    pending: humanDiscardPending({
      kakanTiles: [parseTile("3p"), parseTile("7p")],
    }),
  };
}

describe("engine: 海底での暗槓禁止(#128)", () => {
  it("海底(remainingLiveTiles===0)では declareAnkan を no-op で拒否する", () => {
    const state = armAnkan(1);
    drainLiveWallTo(state, 0);
    const meldsBefore = state.hand?.melds.east.length ?? -1;

    const after = declareAnkan(state, parseTile("1m"));

    expect(after).toBe(state); // 状態不変(参照一致)
    expect(after.hand?.melds.east.length).toBe(meldsBefore); // 槓は成立していない
    expect(after.hand?.wall.remainingLiveTiles).toBe(0); // 嶺上補充も起きていない
    expect(after.hand?.drawn).not.toBeNull();
  });

  it("リーチ後暗槓(#116 経路)も海底では declareAnkan を no-op で拒否する", () => {
    const state = armAnkan(2, { riichi: true });
    drainLiveWallTo(state, 0);

    const after = declareAnkan(state, parseTile("1m"));

    expect(after).toBe(state);
    expect(after.hand?.melds.east.length).toBe(0);
    expect(after.hand?.wall.remainingLiveTiles).toBe(0);
  });

  it("海底1歩手前(remainingLiveTiles===1)では暗槓が従来どおり成立する", () => {
    const state = armAnkan(3);
    drainLiveWallTo(state, 1);

    const after = declareAnkan(state, parseTile("1m"));

    expect(after).not.toBe(state);
    const melds = after.hand?.melds.east ?? [];
    const kan = melds[melds.length - 1];
    expect(kan?.type).toBe("kan");
    expect(kan?.concealed).toBe(true);
    expect(kan?.tiles).toHaveLength(4);
    expect(after.hand?.drawn?.source).toBe("kanReplacement"); // 嶺上ツモ済み
    expect(after.pending?.kind).toBe("humanDiscard");
  });
});

describe("engine: 海底での加槓禁止(#128)", () => {
  it("海底(remainingLiveTiles===0)では declareKakan を no-op で拒否する", () => {
    const state = armKakan(1);
    drainLiveWallTo(state, 0);

    const after = declareKakan(state, parseTile("3p"));

    expect(after).toBe(state);
    expect(after.hand?.melds.east[0].type).toBe("pon"); // ポンのまま(昇格せず)
    expect(after.hand?.wall.remainingLiveTiles).toBe(0);
  });

  it("海底1歩手前(remainingLiveTiles===1)では加槓が従来どおり成立する", () => {
    const state = armKakan(2);
    drainLiveWallTo(state, 1);

    const after = declareKakan(state, parseTile("3p"));

    expect(after).not.toBe(state);
    expect(after.phase).toBe("playing");
    expect(after.hand?.melds.east[0].type).toBe("kan"); // 3p ポン→槓に昇格
    expect(after.hand?.drawn).not.toBeNull(); // 嶺上ツモ済み
    expect(after.pending?.kind).toBe("humanDiscard");
  });
});

describe("engine: 海底では次のカンを選択肢に出さない(buildHumanPending 抑制・#128)", () => {
  it("加槓成立後に海底へ到達したら、残るポンの加槓を pending に出さない", () => {
    // ライブ 1 枚から 3p 加槓 → 嶺上補充でライブ 0(海底)。
    // 手には 7p ポンの4枚目が残るが、海底のため次の加槓は提示されない。
    const state = armKakan(3);
    drainLiveWallTo(state, 1);

    const after = declareKakan(state, parseTile("3p"));

    expect(after.hand?.wall.remainingLiveTiles).toBe(0); // 海底に到達
    expect(after.pending?.kind).toBe("humanDiscard");
    if (after.pending?.kind !== "humanDiscard") return;
    expect(after.pending.kakanTiles).toHaveLength(0); // 7p 加槓は出さない
    expect(after.pending.ankanTiles).toHaveLength(0);
  });

  it("海底手前(ライブ残あり)なら加槓成立後も次の加槓を pending に出す(回帰確認)", () => {
    // ライブを十分残して 3p 加槓 → 嶺上補充後もライブ >0。7p 加槓が提示される。
    const state = armKakan(4);
    drainLiveWallTo(state, 5);

    const after = declareKakan(state, parseTile("3p"));

    expect(after.hand?.wall.remainingLiveTiles).toBeGreaterThan(0);
    expect(after.pending?.kind).toBe("humanDiscard");
    if (after.pending?.kind !== "humanDiscard") return;
    expect(
      after.pending.kakanTiles.some((t) => sameKind(t, parseTile("7p"))),
    ).toBe(true);
  });
});
