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
  passRon,
  proceedToNextRound,
  seatOfPlayer,
  tsumogiri,
} from "@/domain/game/engine";
import {
  applyGameAction,
  type GameJournal,
  loadJournal,
  parseJournal,
  replayJournal,
  saveJournal,
} from "./gamePersistence";
import { selectView } from "./gameView";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("game persistence journal", () => {
  it("seedと操作列からWall/RNGを含む同一局面を復元する", () => {
    const start: GameJournal = { version: 1, seed: 0, actions: [] };
    const initial = replayJournal(start);
    if (initial.hand?.drawn === null || initial.hand?.drawn === undefined) {
      throw new Error("drawn tile missing");
    }
    const journal: GameJournal = {
      ...start,
      actions: [{ type: "discard", tile: initial.hand.drawn }],
    };
    const expected = applyGameAction(initial, journal.actions[0]);
    expect(selectView(replayJournal(journal))).toEqual(selectView(expected));
  });

  it("リーチ・鳴き・カン・和了を含む操作列を決定的に再生する", () => {
    const seen = new Set<GameJournal["actions"][number]["type"]>();

    // 公開 API が提示する合法手を優先して選ぶ。固定 seed 群なので、操作列も結果も決定的。
    const targets = new Map([
      [1, "kakan"],
      [2, "riichi"],
      [3, "passRon"],
      [10, "kan"],
      [18, "ankan"],
      [34, "ron"],
      [146, "tsumo"],
      [342, "tsumogiri"],
    ] as const);
    for (const [seed, target] of targets) {
      let direct = createGame({ seed });
      const actions: GameJournal["actions"][number][] = [];
      for (let guard = 0; guard < 8000 && direct.phase !== "gameEnd"; guard++) {
        let action: GameJournal["actions"][number];
        if (direct.phase === "roundEnd") {
          action = { type: "nextRound" };
          direct = proceedToNextRound(direct);
        } else if (direct.pending?.kind === "humanReact") {
          if (direct.pending.canRon) {
            action = { type: "ron" };
            direct = declareRon(direct);
          } else if (seed % 3 === 0) {
            action = { type: "passRon" };
            direct = passRon(direct);
          } else if (direct.pending.canKan && seed % 5 === 0) {
            action = { type: "kan" };
            direct = declareKan(direct);
          } else if (direct.pending.canPon) {
            action = { type: "pon" };
            direct = declarePon(direct);
          } else {
            action = { type: "passRon" };
            direct = passRon(direct);
          }
        } else if (direct.pending?.kind === "humanDiscard") {
          const pending = direct.pending;
          if (pending.canTsumo) {
            action = { type: "tsumo" };
            direct = declareTsumo(direct);
          } else if (pending.locked) {
            action = { type: "tsumogiri" };
            direct = tsumogiri(direct);
          } else if (pending.canRiichi && seed % 2 === 0) {
            action = { type: "riichi", tile: pending.riichiTiles[0] };
            direct = declareRiichi(direct, action.tile);
          } else if (pending.kakanTiles.length > 0) {
            action = { type: "kakan", tile: pending.kakanTiles[0] };
            direct = declareKakan(direct, action.tile);
          } else if (pending.ankanTiles.length > 0) {
            action = { type: "ankan", tile: pending.ankanTiles[0] };
            direct = declareAnkan(direct, action.tile);
          } else if (pending.canRiichi) {
            action = { type: "riichi", tile: pending.riichiTiles[0] };
            direct = declareRiichi(direct, action.tile);
          } else {
            const hand = direct.hand;
            const seat = hand ? seatOfPlayer(hand.seating, "p0") : null;
            const forbidden = pending.forbiddenDiscards;
            const allowed = (tile: { suit: string; rank: number }) =>
              !forbidden.some(
                (f) => f.suit === tile.suit && f.rank === tile.rank,
              );
            const tile =
              (hand?.drawn && allowed(hand.drawn) ? hand.drawn : undefined) ??
              (hand && seat ? hand.hands[seat].find(allowed) : undefined);
            if (!tile) throw new Error(`seed=${seed}: 打牌可能な牌がない`);
            action = { type: "discard", tile };
            direct = discard(direct, tile);
          }
        } else {
          throw new Error(`seed=${seed}: 予期しない局面 ${direct.phase}`);
        }
        actions.push(action);
        seen.add(action.type);
        if (action.type === target) break;
      }

      expect(
        actions.some((action) => action.type === target),
        `seed=${seed}: ${target} に到達`,
      ).toBe(true);
      expect(
        selectView(replayJournal({ version: 1, seed, actions })),
        `seed=${seed}`,
      ).toEqual(selectView(direct));
    }

    expect(seen).toEqual(
      new Set([
        "discard",
        "tsumogiri",
        "riichi",
        "tsumo",
        "ron",
        "pon",
        "kan",
        "ankan",
        "kakan",
        "passRon",
        "nextRound",
      ]),
    );
  }, 60_000);

  it("保存して読み戻せる", () => {
    const storage = new MemoryStorage();
    const journal: GameJournal = { version: 1, seed: 42, actions: [] };
    saveJournal(storage, journal);
    expect(loadJournal(storage)).toEqual(journal);
  });

  it.each([
    "not-json",
    JSON.stringify({ version: 0, seed: 1, actions: [] }),
    JSON.stringify({ version: 1, seed: -1, actions: [] }),
    JSON.stringify({ version: 1, seed: 1, actions: [{ type: "discard" }] }),
  ])("破損・旧versionを拒否する: %s", (raw) => {
    expect(parseJournal(raw)).toBeNull();
  });

  it("破損記録はload時に削除する", () => {
    const storage = new MemoryStorage();
    storage.setItem("four-bros-mahjong.game.v1", "broken");
    expect(loadJournal(storage)).toBeNull();
    expect(storage.length).toBe(0);
  });
});
