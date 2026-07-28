import { describe, expect, it } from "vitest";
import { DEFAULT_NAMES } from "@/domain/game/engine";
import {
  loadPlayerNames,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_NAMES_STORAGE_KEY,
  type PlayerNames,
  parsePlayerNames,
  resolvePlayerNames,
  sanitizePlayerName,
  savePlayerNames,
} from "./playerNames";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
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

/** setItem が必ず失敗する Storage(プライベートモード・容量超過の再現)。 */
class FailingStorage extends MemoryStorage {
  override setItem(): never {
    throw new DOMException("QuotaExceededError", "QuotaExceededError");
  }
}

describe("sanitizePlayerName", () => {
  it("前後の空白を落として保存する", () => {
    expect(sanitizePlayerName("  粗品  ")).toBe("粗品");
  });

  it("改行・タブを含む連続空白は半角スペース1つへ畳む", () => {
    expect(sanitizePlayerName("前田\n\t 龍二")).toBe("前田 龍二");
  });

  it("上限文字数で切り詰める", () => {
    const long = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 5);
    expect(sanitizePlayerName(long)).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("空文字・空白のみはnull(既定名フォールバック用)", () => {
    expect(sanitizePlayerName("")).toBeNull();
    expect(sanitizePlayerName("   \n ")).toBeNull();
  });
});

describe("resolvePlayerNames", () => {
  it("空欄だけを既定名で埋め、入力済みはそのまま使う", () => {
    expect(resolvePlayerNames(["", "龍二", "  ", "翔生"])).toEqual([
      DEFAULT_NAMES[0],
      "龍二",
      DEFAULT_NAMES[2],
      "翔生",
    ]);
  });

  it("すべて空欄なら既定名に一致する(後方互換)", () => {
    expect(resolvePlayerNames(["", "", "", ""])).toEqual(DEFAULT_NAMES);
  });
});

describe("parsePlayerNames", () => {
  it("保存形式(4要素の文字列配列)を読み戻す", () => {
    expect(parsePlayerNames(JSON.stringify(["A", "B", "C", "D"]))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it.each([
    { label: "JSONとして不正", raw: "{" },
    { label: "配列でない", raw: JSON.stringify({ 0: "A" }) },
    { label: "要素数が足りない", raw: JSON.stringify(["A", "B", "C"]) },
    { label: "要素数が多い", raw: JSON.stringify(["A", "B", "C", "D", "E"]) },
    {
      label: "文字列でない要素を含む",
      raw: JSON.stringify(["A", 1, "C", "D"]),
    },
  ])("想定外の保存値はnullを返す: $label", ({ raw }) => {
    expect(parsePlayerNames(raw)).toBeNull();
  });

  it("保存値が上限超過でも読み出し時に切り詰める", () => {
    const long = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 10);
    const parsed = parsePlayerNames(JSON.stringify([long, "B", "C", "D"]));
    expect(parsed?.[0]).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });
});

describe("loadPlayerNames / savePlayerNames", () => {
  it("保存した名前を読み戻せる", () => {
    const storage = new MemoryStorage();
    const names: PlayerNames = ["自分", "龍二", "下ちゃん", "翔生"];

    expect(savePlayerNames(storage, names)).toBe(true);
    expect(loadPlayerNames(storage)).toEqual(names);
  });

  it("未設定(初回)は既定名を返す", () => {
    expect(loadPlayerNames(new MemoryStorage())).toEqual(DEFAULT_NAMES);
  });

  it("破損した保存値は既定名へフォールバックする", () => {
    const storage = new MemoryStorage();
    storage.setItem(PLAYER_NAMES_STORAGE_KEY, "not json");

    expect(loadPlayerNames(storage)).toEqual(DEFAULT_NAMES);
  });

  it("保存できない環境ではfalseを返し例外を投げない", () => {
    expect(savePlayerNames(new FailingStorage(), DEFAULT_NAMES)).toBe(false);
  });
});
