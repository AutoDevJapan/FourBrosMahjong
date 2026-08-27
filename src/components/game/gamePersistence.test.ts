import { describe, expect, it, vi } from "vitest";
import { MAX_PLAYER_NAME_LENGTH } from "@/components/settings/playerNames";
import {
  createGame,
  DEFAULT_NAMES,
  declareAnkan,
  declareKakan,
  declareKan,
  declareKita,
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
import { walkToGameEnd } from "./finishedGameFixture";
import {
  applyGameAction,
  GAME_SESSION_KEY,
  type GameJournal,
  LEGACY_GAME_SESSION_KEY,
  loadJournal,
  MAX_JOURNAL_ACTIONS,
  MAX_JOURNAL_BYTES,
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
    const start: GameJournal = {
      version: 3,
      seed: 0,
      names: DEFAULT_NAMES,
      explicitKita: true,
      actions: [],
    };
    const initial = replayJournal(start);
    if (initial.hand?.drawn === null || initial.hand?.drawn === undefined) {
      throw new Error("drawn tile missing");
    }
    const journal: GameJournal = {
      ...start,
      actions: [{ type: "discard", tile: initial.hand.drawn.tile }],
    };
    const expected = applyGameAction(initial, journal.actions[0]);
    expect(selectView(replayJournal(journal))).toEqual(selectView(expected));
  });

  it("リーチ・鳴き・カン・和了を含む操作列を決定的に再生する", () => {
    const seen = new Set<GameJournal["actions"][number]["type"]>();

    // 公開 API が提示する合法手を優先して選ぶ。固定 seed 群なので、操作列も結果も決定的。
    // seed は本戦略のオフライン走査で「target へ到達する」ことを確認して選定している。
    // engine/AI の打牌ロジック変更で到達しなくなった場合は、同一戦略のオフライン走査で
    // 再選定すること(#294 で riichi/ankan/ron の seed を 2/18/34 → 34/9/84 へ再選定)。
    const targets = new Map([
      [1, "kakan"],
      [34, "riichi"],
      [3, "passRon"],
      [10, "kan"],
      [9, "ankan"],
      [84, "ron"],
      [127, "tsumo"],
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
          } else if (pending.canKita) {
            action = { type: "kita" };
            direct = declareKita(direct);
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
              (hand?.drawn && allowed(hand.drawn.tile)
                ? hand.drawn.tile
                : undefined) ??
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
        selectView(
          replayJournal({
            version: 3,
            seed,
            names: DEFAULT_NAMES,
            explicitKita: true,
            actions,
          }),
        ),
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
        "kita",
        "ankan",
        "kakan",
        "passRon",
        "nextRound",
      ]),
    );
  }, 60_000);

  it("保存して読み戻せる", () => {
    const storage = new MemoryStorage();
    const journal: GameJournal = {
      version: 3,
      seed: 42,
      names: DEFAULT_NAMES,
      explicitKita: true,
      actions: [],
    };
    saveJournal(storage, journal);
    expect(loadJournal(storage)).toEqual(journal);
  });

  it.each([
    {
      label: "手牌に存在しない五萬の打牌",
      action: {
        type: "discard",
        tile: { suit: "man", rank: 5, isRed: false },
      },
    },
    { label: "playing中の次局開始", action: { type: "nextRound" } },
  ] as const)("局面上不正な操作を破損として拒否する: $label", ({ action }) => {
    const journal: GameJournal = {
      version: 3,
      seed: 0,
      names: DEFAULT_NAMES,
      explicitKita: true,
      actions: [action],
    };

    expect(() => replayJournal(journal)).toThrow(
      `Invalid game journal action at index 0: ${action.type}`,
    );
  });

  it.each([
    "not-json",
    JSON.stringify({ version: 0, seed: 1, actions: [] }),
    JSON.stringify({ version: 2, seed: -1, names: DEFAULT_NAMES, actions: [] }),
    JSON.stringify({
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [{ type: "discard" }],
    }),
  ])("破損・旧versionを拒否する: %s", (raw) => {
    expect(parseJournal(raw)).toBeNull();
  });

  it("raw上限超過をJSON.parseより前に拒否する", () => {
    const parse = vi.spyOn(JSON, "parse");
    const raw = " ".repeat(MAX_JOURNAL_BYTES / 2 + 1);

    expect(parseJournal(raw)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it("action件数の境界を検証する", () => {
    const action = { type: "tsumogiri" } as const;
    expect(
      parseJournal(
        JSON.stringify({
          version: 2,
          seed: 1,
          names: DEFAULT_NAMES,
          actions: Array(MAX_JOURNAL_ACTIONS).fill(action),
        }),
      ),
    ).not.toBeNull();
    expect(
      parseJournal(
        JSON.stringify({
          version: 2,
          seed: 1,
          names: DEFAULT_NAMES,
          actions: Array(MAX_JOURNAL_ACTIONS + 1).fill(action),
        }),
      ),
    ).toBeNull();
  });

  it("正規の完走journalはリソース上限内で読み戻せる", () => {
    const { journal, state } = walkToGameEnd(0);

    expect(state.phase).toBe("gameEnd");
    expect(journal.actions.length).toBeLessThanOrEqual(MAX_JOURNAL_ACTIONS);
    expect(parseJournal(JSON.stringify(journal))).toEqual(journal);
  });

  it.each([
    { version: 2, seed: 0x1_0000_0000, names: DEFAULT_NAMES, actions: [] },
    {
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [],
      extra: "payload",
    },
    {
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [{ type: "tsumogiri", extra: "payload" }],
    },
    {
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [
        {
          type: "discard",
          tile: { suit: "honor", rank: 8, isRed: false },
        },
      ],
    },
    {
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [
        {
          type: "discard",
          tile: { suit: "honor", rank: 5, isRed: true },
        },
      ],
    },
    {
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [
        {
          type: "discard",
          tile: { suit: "man", rank: 5, isRed: true },
        },
      ],
    },
    {
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [
        {
          type: "discard",
          tile: { suit: "pin", rank: 5, isRed: false },
        },
      ],
    },
    {
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [
        {
          type: "discard",
          tile: { suit: "man", rank: 1, isRed: false, extra: "payload" },
        },
      ],
    },
  ])("domain外または余剰payloadを拒否する: %#", (journal) => {
    expect(parseJournal(JSON.stringify(journal))).toBeNull();
  });

  it("v1の記録は当時の既定名と旧自動ガリを保ったままv3へ移行する (#291/#711)", () => {
    const v1 = { version: 1, seed: 3, actions: [{ type: "tsumogiri" }] };

    expect(parseJournal(JSON.stringify(v1))).toEqual({
      version: 3,
      seed: 3,
      names: ["あなた", "一郎", "二郎", "三郎"],
      explicitKita: false,
      actions: [{ type: "tsumogiri" }],
    });
  });

  it("v1の記録に余剰キーがあれば拒否する (#291)", () => {
    const v1 = {
      version: 1,
      seed: 3,
      actions: [],
      names: ["A", "B", "C", "D"],
    };

    expect(parseJournal(JSON.stringify(v1))).toBeNull();
  });

  it.each([
    { label: "namesが配列でない", names: "粗品" },
    { label: "names要素数が3", names: ["A", "B", "C"] },
    { label: "names要素数が5", names: ["A", "B", "C", "D", "E"] },
    { label: "names要素が文字列でない", names: ["A", 1, "C", "D"] },
    { label: "names要素が空文字", names: ["", "B", "C", "D"] },
    {
      label: "names要素が上限文字数超過",
      names: ["あ".repeat(MAX_PLAYER_NAME_LENGTH + 1), "B", "C", "D"],
    },
  ])("不正な対局者名の記録を拒否する: $label (#291)", ({ names }) => {
    const journal = { version: 2, seed: 1, actions: [], names };

    expect(parseJournal(JSON.stringify(journal))).toBeNull();
  });

  it("12書記素の絵文字名を受け入れる(#484)", () => {
    const emojiName = "😀".repeat(MAX_PLAYER_NAME_LENGTH);
    const journal = {
      version: 2,
      seed: 1,
      actions: [],
      names: [emojiName, "B", "C", "D"],
    };

    expect(parseJournal(JSON.stringify(journal))?.names[0]).toBe(emojiName);
  });

  it("修正前に書かれたlone surrogate入りの記録を拒否せず正規化して再生する(#484)", () => {
    // 修正前は UTF-16 code unit で切り詰めていたため、既存の記録は末尾が半端な
    // サロゲートになり得る。これを拒否すると #484 に当たったユーザーだけが
    // 進行中の半荘を失うので、U+FFFD へ正規化して受け入れる。
    const legacy = "12345678901😀".slice(0, MAX_PLAYER_NAME_LENGTH);
    expect(legacy).toMatch(/[\uD800-\uDFFF]/u);

    const journal = {
      version: 2,
      seed: 1,
      actions: [],
      names: [legacy, "B", "C", "D"],
    };

    expect(parseJournal(JSON.stringify(journal))?.names[0]).toBe(
      "12345678901�",
    );
  });

  it("v2でnamesキーが無い記録は拒否する (#291)", () => {
    expect(
      parseJournal(JSON.stringify({ version: 2, seed: 1, actions: [] })),
    ).toBeNull();
  });

  it("設定した対局者名を保持して読み戻す (#291)", () => {
    const names = ["自分", "龍二", "下ちゃん", "翔生"] as const;
    const journal: GameJournal = {
      version: 3,
      seed: 7,
      names,
      explicitKita: true,
      actions: [],
    };

    expect(parseJournal(JSON.stringify(journal))).toEqual(journal);
    expect(replayJournal(journal).players.map((p) => p.name)).toEqual([
      ...names,
    ]);
  });

  it("破損した旧記録も旧client/rollback用keyから削除しない", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_GAME_SESSION_KEY, "broken");
    expect(loadJournal(storage)).toBeNull();
    expect(storage.getItem(LEGACY_GAME_SESSION_KEY)).toBe("broken");
  });

  it("v1/v2は旧engineの自動ガリ局面・山・操作位置を同一に再生する", () => {
    const seed = 1;
    const fixture = createGame({ seed, explicitKitaPlayerIds: [] });
    const drawn = fixture.hand?.drawn?.tile;
    if (drawn === undefined) throw new Error("legacy draw expected");

    for (const raw of [
      { version: 1, seed, actions: [{ type: "discard", tile: drawn }] },
      {
        version: 2,
        seed,
        names: DEFAULT_NAMES,
        actions: [{ type: "discard", tile: drawn }],
      },
    ]) {
      const journal = parseJournal(JSON.stringify(raw));
      expect(journal?.explicitKita).toBe(false);
      if (journal === null) throw new Error("legacy journal expected");
      const expected = discard(
        createGame({
          seed,
          names: journal.names,
          explicitKitaPlayerIds: [],
        }),
        drawn,
      );
      const replayed = replayJournal(journal);
      expect(selectView(replayed)).toEqual(selectView(expected));
      expect(replayed.hand?.wall.liveWall).toEqual(
        expected.hand?.wall.liveWall,
      );
      expect(replayed.hand?.wall.deadWall).toEqual(
        expected.hand?.wall.deadWall,
      );
      expect(replayed.hand?.kita).toEqual(expected.hand?.kita);
      expect(replayed.pending).toEqual(expected.pending);
    }
  });

  it("旧versionのaction streamへ新しいkita actionを混入できない", () => {
    expect(
      parseJournal(
        JSON.stringify({
          version: 2,
          seed: 1,
          names: DEFAULT_NAMES,
          actions: [{ type: "kita" }],
        }),
      ),
    ).toBeNull();
  });

  it("v3保存は旧keyを上書きせず、旧client相当parserで読める旧記録を保つ", () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({
      version: 2,
      seed: 1,
      names: DEFAULT_NAMES,
      actions: [],
    });
    storage.setItem(LEGACY_GAME_SESSION_KEY, legacy);
    const loadLikeOldClient = () => {
      const raw = storage.getItem(LEGACY_GAME_SESSION_KEY);
      if (raw === null) return null;
      const value = JSON.parse(raw) as { actions?: { type?: string }[] };
      const known = new Set([
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
      ]);
      if (!value.actions?.every((action) => known.has(action.type ?? ""))) {
        storage.removeItem(LEGACY_GAME_SESSION_KEY);
        return null;
      }
      return value;
    };
    expect(loadLikeOldClient()).not.toBeNull();
    const journal: GameJournal = {
      version: 3,
      seed: 1,
      names: DEFAULT_NAMES,
      explicitKita: true,
      actions: [{ type: "kita" }],
    };

    saveJournal(storage, journal);

    expect(storage.getItem(LEGACY_GAME_SESSION_KEY)).toBe(legacy);
    expect(
      JSON.parse(storage.getItem(LEGACY_GAME_SESSION_KEY) ?? "null"),
    ).toEqual(JSON.parse(legacy));
    expect(loadLikeOldClient()).not.toBeNull();
    expect(loadJournal(storage)).toEqual(journal);
  });

  it("v3破損時はv3だけを削除して旧keyへfallbackする", () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({
      version: 2,
      seed: 2,
      names: DEFAULT_NAMES,
      actions: [],
    });
    storage.setItem(GAME_SESSION_KEY, "broken");
    storage.setItem(LEGACY_GAME_SESSION_KEY, legacy);

    expect(loadJournal(storage)).toMatchObject({
      version: 3,
      seed: 2,
      explicitKita: false,
    });
    expect(storage.getItem(GAME_SESSION_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_GAME_SESSION_KEY)).toBe(legacy);
  });

  it("parse可能なv3のreplay失敗でも旧keyを削除・上書きしない", () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({ version: 1, seed: 4, actions: [] });
    storage.setItem(LEGACY_GAME_SESSION_KEY, legacy);
    storage.setItem(
      GAME_SESSION_KEY,
      JSON.stringify({
        version: 3,
        seed: 4,
        names: DEFAULT_NAMES,
        explicitKita: true,
        actions: [
          {
            type: "discard",
            tile: { suit: "man", rank: 5, isRed: false },
          },
        ],
      }),
    );

    const loaded = loadJournal(storage);
    if (loaded === null) throw new Error("v3 journal expected");
    expect(() => replayJournal(loaded)).toThrow("Invalid game journal action");
    expect(storage.getItem(LEGACY_GAME_SESSION_KEY)).toBe(legacy);
  });

  it("v3のatomic setItem失敗でも旧keyを削除・上書きしない", () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({ version: 1, seed: 1, actions: [] });
    storage.setItem(LEGACY_GAME_SESSION_KEY, legacy);
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    saveJournal(storage, {
      version: 3,
      seed: 1,
      names: DEFAULT_NAMES,
      explicitKita: true,
      actions: [],
    });

    expect(storage.getItem(LEGACY_GAME_SESSION_KEY)).toBe(legacy);
    expect(storage.getItem(GAME_SESSION_KEY)).toBeNull();
  });
});
