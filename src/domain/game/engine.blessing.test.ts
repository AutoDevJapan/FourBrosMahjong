import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "../hand/notation";
import { blessingForTsumo, createGame, declareTsumo } from "./engine";

const empty = () => ({ east: [], south: [], west: [] });

describe("blessingForTsumo(#185)", () => {
  it("親の初回自摸だけを天和とする", () => {
    expect(blessingForTsumo("east", empty(), false)).toBe("heaven");
    expect(
      blessingForTsumo("east", { ...empty(), east: [{}] as never[] }, false),
    ).toBeUndefined();
  });

  it.each(["south", "west"] as const)("%sの最初の自摸を地和とする", (seat) => {
    expect(blessingForTsumo(seat, empty(), false)).toBe("earth");
  });

  it("最初の自摸でも局中に鳴きがあれば不成立", () => {
    expect(blessingForTsumo("south", empty(), true)).toBeUndefined();
    expect(blessingForTsumo("west", empty(), true)).toBeUndefined();
  });

  it("本人が一度でも打牌した後は不成立", () => {
    // 判定入力は表示用の河ではなく打牌履歴(#395)。
    const discardHistory = { ...empty(), south: [{}] as never[] };
    expect(blessingForTsumo("south", discardHistory, false)).toBeUndefined();
  });

  it("親の初回国士自摸を天和+国士の2倍役満としてGUIスナップショットへ渡す", () => {
    const base = createGame({ seed: 185 });
    if (base.hand === null) throw new Error("hand not started");
    base.hand.hands.east = parseTiles("19m 19p 19s 1234567z");
    base.hand.drawn = parseTile("1m");
    base.hand.melds.east = [];
    base.hand.discards.east = [];
    // 天和の判定ゲートは履歴側(#395)。河だけ空にしても成立しない構成を避ける。
    base.hand.discardHistory.east = [];
    base.hand.callsMade = false;
    const state = {
      ...base,
      pending: {
        kind: "humanDiscard" as const,
        canTsumo: true,
        canRiichi: false,
        riichiTiles: [],
        ankanTiles: [],
        kakanTiles: [],
        forbiddenDiscards: [],
        locked: false,
      },
    };

    const won = declareTsumo(state);
    expect(won.lastRound?.winDetails?.yaku.map((y) => y.name)).toEqual(
      expect.arrayContaining(["天和", "国士無双"]),
    );
    expect(won.lastRound?.winDetails?.yakuman).toBe(2);
  });
});
