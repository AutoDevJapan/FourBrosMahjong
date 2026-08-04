import { describe, expect, it } from "vitest";
import {
  appendHistory,
  clearHistory,
  clearHistoryAcrossTabs,
  type HistoryLockManager,
  loadHistory,
  MATCH_HISTORY_KEY,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ENTRIES,
  type MatchHistoryEntry,
  parseHistory,
  persistHistory,
  persistHistoryAcrossTabs,
} from "./matchHistory";

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

/** Web Locks の排他実行を決定的に再現する FIFO lock manager。 */
class SerialLockManager implements HistoryLockManager {
  private tail: Promise<void> = Promise.resolve();

  request<T>(_name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    const result = this.tail.then(callback);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** engine の確定結果と同形の妥当なレコードを生成する。 */
function entry(
  seed: number,
  finishedAt = 1_753_000_000_000,
): MatchHistoryEntry {
  const names = ["一郎", "二郎", "三郎", "四郎"] as const;
  return {
    seed,
    finishedAt,
    players: names.map((name, i) => ({
      name,
      rank: i + 1,
      rawScore: [23_000, 8_000, -11_000, -20_000][i],
      uma: [10_000, 5_000, -5_000, -10_000][i],
      bonus: 0,
      soshiiTotal: [33_000, 13_000, -16_000, -30_000][i],
    })),
  };
}

describe("match history persistence (#293)", () => {
  it("追記した戦績を新しい順に読み戻す", () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1, 100));
    appendHistory(storage, entry(2, 200));

    const entries = loadHistory(storage);
    expect(entries.map((e) => e.seed)).toEqual([2, 1]);
    expect(entries[0]).toEqual(entry(2, 200));
  });

  it("同一seedの半荘は二重保存しない(終局済みジャーナルのリロード再生)", () => {
    const storage = new MemoryStorage();
    expect(persistHistory(storage, entry(7, 100))).toBe("appended");
    expect(persistHistory(storage, entry(7, 999))).toBe("already-exists");

    const entries = loadHistory(storage);
    expect(entries).toHaveLength(1);
    expect(entries[0].finishedAt).toBe(100);
  });

  it("2 writerが同じ旧値から同時追記してもWeb Locks内で再読込し両方を残す(#363)", async () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1, 1));
    const locks = new SerialLockManager();

    const [a, b] = await Promise.all([
      persistHistoryAcrossTabs(storage, entry(2, 2), locks),
      persistHistoryAcrossTabs(storage, entry(3, 3), locks),
    ]);

    expect([a, b]).toEqual(["appended", "appended"]);
    expect(loadHistory(storage).map((item) => item.seed)).toEqual([3, 2, 1]);
  });

  it("writerの到着順が逆でも両方を残し、同一seedは重複排除する(#363)", async () => {
    const storage = new MemoryStorage();
    const locks = new SerialLockManager();

    const [first, duplicate, second] = await Promise.all([
      persistHistoryAcrossTabs(storage, entry(3, 3), locks),
      persistHistoryAcrossTabs(storage, entry(3, 999), locks),
      persistHistoryAcrossTabs(storage, entry(2, 2), locks),
    ]);

    expect([first, duplicate, second]).toEqual([
      "appended",
      "already-exists",
      "appended",
    ]);
    expect(loadHistory(storage).map((item) => item.seed)).toEqual([2, 3]);
  });

  it("Web Locksが利用不能または失敗する場合は書き込まずfailedを返す(#363)", async () => {
    const storage = new MemoryStorage();
    expect(await persistHistoryAcrossTabs(storage, entry(1), null)).toBe(
      "failed",
    );
    expect(loadHistory(storage)).toEqual([]);

    const broken: HistoryLockManager = {
      request: () => Promise.reject(new Error("locks unavailable")),
    };
    expect(await persistHistoryAcrossTabs(storage, entry(2), broken)).toBe(
      "failed",
    );
    expect(loadHistory(storage)).toEqual([]);
  });

  it("上限を超えると最古の記録から破棄する", () => {
    const storage = new MemoryStorage();
    for (let seed = 0; seed < MAX_HISTORY_ENTRIES + 3; seed++) {
      appendHistory(storage, entry(seed, seed));
    }

    const entries = loadHistory(storage);
    expect(entries).toHaveLength(MAX_HISTORY_ENTRIES);
    // 新しい順(seed 降順)で、最古の3件(seed 0〜2)が破棄されている。
    expect(entries[0].seed).toBe(MAX_HISTORY_ENTRIES + 2);
    expect(entries.at(-1)?.seed).toBe(3);
  });

  it("容量不足時は収まる件数まで半減して再試行し、最新結果の保存を優先する", () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1, 100));
    appendHistory(storage, entry(2, 200));
    let calls = 0;
    const flaky: Storage = Object.assign(Object.create(storage), {
      setItem: (key: string, value: string) => {
        calls++;
        // 全件保存(1回目)だけ容量不足で失敗させる。
        if (calls === 1) throw new DOMException("quota", "QuotaExceededError");
        storage.setItem(key, value);
      },
    });

    appendHistory(flaky, entry(3, 300));

    expect(loadHistory(storage).map((e) => e.seed)).toEqual([3]);
  });

  it("容量不足でも収まる件数まで切り詰め、過去の記録を全消ししない", () => {
    const storage = new MemoryStorage();
    for (const seed of [1, 2, 3, 4]) appendHistory(storage, entry(seed, seed));
    // 3件以上の保存だけ容量不足で失敗させる(2件までは収まる環境)。
    const limited: Storage = Object.assign(Object.create(storage), {
      setItem: (key: string, value: string) => {
        const count = (JSON.parse(value) as { entries: unknown[] }).entries
          .length;
        if (count > 2) throw new DOMException("quota", "QuotaExceededError");
        storage.setItem(key, value);
      },
    });

    appendHistory(limited, entry(5, 5));

    // 最新を先頭に、収まる範囲の履歴が残る(1件だけへ切り詰めない)。
    expect(loadHistory(storage).map((e) => e.seed)).toEqual([5, 4]);
  });

  it("読み込み側が受理できない記録は書き込まず、既存の戦績を守る", () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1, 100));
    // `?seed=` 経由では uint32 を超える seed の対局が成立し得る(非production)。
    // これを書き込むと次回読み込みで全体が破損扱いになり、過去の記録ごと消える。
    appendHistory(storage, entry(0x1_0000_0000, 200));

    expect(loadHistory(storage).map((e) => e.seed)).toEqual([1]);
  });

  it("保存が完全に失敗しても例外を漏らさない", () => {
    const broken: Storage = new (class extends MemoryStorage {
      override setItem(): void {
        throw new DOMException("quota", "QuotaExceededError");
      }
    })();
    expect(() => appendHistory(broken, entry(1))).not.toThrow();
    // 追記できていないので false = 購読者への通知は不要(#310)。
    expect(appendHistory(broken, entry(1))).toBe(false);
    expect(persistHistory(broken, entry(1))).toBe("failed");
  });

  it("clearHistoryで保存済み戦績をすべて消去する", () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1));
    clearHistory(storage);

    expect(storage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(loadHistory(storage)).toEqual([]);
  });

  it("追記が先・削除が後なら最終状態は空になる(#482)", async () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1));
    const locks = new SerialLockManager();

    const [written, cleared] = await Promise.all([
      persistHistoryAcrossTabs(storage, entry(2), locks),
      clearHistoryAcrossTabs(storage, locks),
    ]);

    expect(written).toBe("appended");
    expect(cleared).toBe(true);
    expect(loadHistory(storage)).toEqual([]);
  });

  it("削除が先・追記が後なら削除前の履歴は復活しない(#482)", async () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1));
    const locks = new SerialLockManager();

    const [cleared, written] = await Promise.all([
      clearHistoryAcrossTabs(storage, locks),
      persistHistoryAcrossTabs(storage, entry(2), locks),
    ]);

    expect(cleared).toBe(true);
    expect(written).toBe("appended");
    expect(loadHistory(storage).map((item) => item.seed)).toEqual([2]);
  });

  it("削除のlock不在・取得失敗では成功を返さない(#482)", async () => {
    const storage = new MemoryStorage();
    appendHistory(storage, entry(1));
    expect(await clearHistoryAcrossTabs(storage, null)).toBe(false);
    const broken: HistoryLockManager = {
      request: () => Promise.reject(new Error("locks unavailable")),
    };
    expect(await clearHistoryAcrossTabs(storage, broken)).toBe(false);
    expect(loadHistory(storage).map((item) => item.seed)).toEqual([1]);
  });

  it("破損データは読み込み時に空扱いとし、次回のため削除する", () => {
    const storage = new MemoryStorage();
    storage.setItem(MATCH_HISTORY_KEY, '{"version":1,"entries":[{}]}');

    expect(loadHistory(storage)).toEqual([]);
    expect(storage.getItem(MATCH_HISTORY_KEY)).toBeNull();
  });

  it("Storageアクセス自体が失敗する環境では空配列へ退避する", () => {
    const broken: Storage = new (class extends MemoryStorage {
      override getItem(): string {
        throw new DOMException("Storage is disabled", "SecurityError");
      }
    })();
    expect(loadHistory(broken)).toEqual([]);
  });

  describe("parseHistory の厳密検証", () => {
    const valid = () => ({ version: 1, entries: [entry(1)] });

    it("妥当な保存文字列を受理する", () => {
      expect(parseHistory(JSON.stringify(valid()))).toEqual([entry(1)]);
    });

    it("12書記素の名前を受理する(1書記素が複数code unitでも / #484)", () => {
      // 設定側の上限は12**書記素**なので、家族絵文字3つ(33 code unit)や
      // 国旗9つ(36 code unit)は正規の名前として保存・復元できなければならない。
      // ここが code unit 12〜32 の上限だと `persistHistory` が "failed" を返し、
      // その名前を使う限り戦績が一切保存されなくなる。
      for (const name of [
        "👨‍👩‍👧‍👦".repeat(3),
        "🇯🇵".repeat(9),
        "😀".repeat(12),
      ]) {
        const storage = new MemoryStorage();
        const record = {
          ...entry(1),
          players: entry(1).players.map((p) => ({ ...p, name })),
        };

        expect(persistHistory(storage, record), name).toBe("appended");
        expect(loadHistory(storage)[0]?.players[0]?.name).toBe(name);
      }
    });

    it("4人が同名でも受理する(対局者名はユーザー設定で重複可 / #291)", () => {
      const sameNames = {
        version: 1,
        entries: [
          {
            ...entry(1),
            players: entry(1).players.map((p) => ({ ...p, name: "一郎" })),
          },
        ],
      };

      expect(parseHistory(JSON.stringify(sameNames))).not.toBeNull();
    });

    it.each<[string, unknown]>([
      ["JSONでない", "not-json"],
      ["versionが異なる", { ...valid(), version: 2 }],
      ["余分なキーを持つ", { ...valid(), extra: true }],
      ["entriesが配列でない", { version: 1, entries: {} }],
      [
        "件数上限を超える",
        {
          version: 1,
          entries: Array.from({ length: MAX_HISTORY_ENTRIES + 1 }, (_, i) =>
            entry(i),
          ),
        },
      ],
      [
        "seedがuint32範囲外",
        { version: 1, entries: [{ ...entry(1), seed: -1 }] },
      ],
      [
        "finishedAtが整数でない",
        { version: 1, entries: [{ ...entry(1), finishedAt: 1.5 }] },
      ],
      [
        "playersが4人でない",
        {
          version: 1,
          entries: [{ ...entry(1), players: entry(1).players.slice(0, 3) }],
        },
      ],
      [
        "順位が重複する",
        {
          version: 1,
          entries: [
            {
              ...entry(1),
              players: entry(1).players.map((p) => ({ ...p, rank: 1 })),
            },
          ],
        },
      ],
      [
        "プレイヤーに余分なキーを持つ",
        {
          version: 1,
          entries: [
            {
              ...entry(1),
              players: entry(1).players.map((p) => ({ ...p, extra: 1 })),
            },
          ],
        },
      ],
      [
        "数値フィールドが整数でない",
        {
          version: 1,
          entries: [
            {
              ...entry(1),
              players: entry(1).players.map((p) => ({
                ...p,
                soshiiTotal: Number.NaN,
              })),
            },
          ],
        },
      ],
      [
        "名前が空文字列",
        {
          version: 1,
          entries: [
            {
              ...entry(1),
              players: entry(1).players.map((p, i) => ({
                ...p,
                name: i === 0 ? "" : p.name,
              })),
            },
          ],
        },
      ],
      [
        // Number.isSafeInteger は通るが Date では Invalid Date になり、
        // Intl.DateTimeFormat.format が RangeError を投げる値。
        "finishedAtがDateの表現範囲を超える",
        {
          version: 1,
          entries: [{ ...entry(1), finishedAt: Number.MAX_SAFE_INTEGER }],
        },
      ],
      [
        "ソシー合計が内訳の総和と一致しない",
        {
          version: 1,
          entries: [
            {
              ...entry(1),
              players: entry(1).players.map((p, i) =>
                i === 0 ? { ...p, soshiiTotal: p.soshiiTotal + 1 } : p,
              ),
            },
          ],
        },
      ],
    ])("%s 入力を拒否する", (_label, value) => {
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      expect(parseHistory(raw)).toBeNull();
    });

    it("容量上限を超える文字列はparse前に拒否する", () => {
      const huge = `{"version":1,"entries":[]}${" ".repeat(MAX_HISTORY_BYTES)}`;
      expect(parseHistory(huge)).toBeNull();
    });
  });
});
