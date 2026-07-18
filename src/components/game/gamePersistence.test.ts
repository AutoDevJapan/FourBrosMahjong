import { describe, expect, it } from "vitest";
import { selectView } from "./gameView";
import {
  applyGameAction,
  type GameJournal,
  loadJournal,
  parseJournal,
  replayJournal,
  saveJournal,
} from "./gamePersistence";

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
