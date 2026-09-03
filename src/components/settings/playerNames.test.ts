import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NAMES } from "@/domain/game/engine";
import {
  isValidPlayerName,
  limitPlayerName,
  loadPlayerNames,
  MAX_PLAYER_NAME_CODE_UNITS,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_NAMES_STORAGE_KEY,
  type PlayerNames,
  parsePlayerNames,
  playerNameGraphemes,
  resolvePlayerNames,
  sanitizePlayerName,
  savePlayerNames,
} from "./playerNames";

afterEach(() => vi.unstubAllGlobals());

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

  it("11文字+絵文字を12書記素として保持しサロゲートを分断しない(#484)", () => {
    const value = "12345678901😀";
    expect(sanitizePlayerName(value)).toBe(value);
    expect(sanitizePlayerName(value)).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it("絵文字は見た目の1文字として数え、上限超過分だけを切り詰める(#484)", () => {
    expect(sanitizePlayerName("😀".repeat(MAX_PLAYER_NAME_LENGTH))).toBe(
      "😀".repeat(MAX_PLAYER_NAME_LENGTH),
    );
    expect(sanitizePlayerName("😀".repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBe(
      "😀".repeat(MAX_PLAYER_NAME_LENGTH),
    );
  });

  it("壊れた入力からlone surrogateを出力しない(#484)", () => {
    expect(sanitizePlayerName("名前\uD83D")).toBe("名前�");
    expect(sanitizePlayerName("名前\uD83D")).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it("空文字・空白のみはnull(既定名フォールバック用)", () => {
    expect(sanitizePlayerName("")).toBeNull();
    expect(sanitizePlayerName("   \n ")).toBeNull();
  });

  it.each([
    "\u00AD",
    "\u180E",
    "\u200B",
    "\u200C",
    "\u200D",
    "\u2060",
    "\u2061",
    "\uFEFF",
    "\u202E",
  ])("不可視-onlyの名前(%s)はnullへフォールバックする", (value) => {
    expect(sanitizePlayerName(value)).toBeNull();
  });

  it("可視文字が12書記素上限の外側にある生入力はnullへフォールバックする", () => {
    const raw = ("\u0301 ").repeat(MAX_PLAYER_NAME_LENGTH - 1) + "A";

    expect(sanitizePlayerName(raw)).toBeNull();
  });

  it("Bidi制御文字を除去し、RTL名・ZWJ絵文字・結合文字は保持する", () => {
    expect(sanitizePlayerName("A\u202EB")).toBe("AB");
    expect(sanitizePlayerName("עברית")).toBe("עברית");
    expect(sanitizePlayerName("א\u200Cב")).toBe("א\u200Cב");
    expect(sanitizePlayerName("👨‍👩‍👧‍👦か\u3099\uFE0F")).toBe(
      "👨‍👩‍👧‍👦か\u3099\uFE0F",
    );
    expect(limitPlayerName("A\u2060B")).toBe("AB");
  });
});

describe("playerNameGraphemes", () => {
  it("結合文字とZWJ絵文字をそれぞれ1書記素として数える(#484)", () => {
    const combined = "か\u3099";
    expect(
      playerNameGraphemes(combined.repeat(MAX_PLAYER_NAME_LENGTH)),
    ).toHaveLength(MAX_PLAYER_NAME_LENGTH);
    expect(playerNameGraphemes("👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦"]);
  });

  it("Intl.Segmenter非対応環境でも結合文字・ZWJ・国旗を分断しない(#484)", () => {
    // `Intl` のプロパティは enumerable でないためスプレッドでは複製できない。
    // `Intl` をプロトタイプにして `Segmenter` だけを隠し、他の Intl API は残す。
    vi.stubGlobal(
      "Intl",
      Object.create(Intl, { Segmenter: { value: undefined } }),
    );
    expect(playerNameGraphemes("か\u3099👨‍👩‍👧‍👦🇯🇵")).toEqual([
      "か\u3099",
      "👨‍👩‍👧‍👦",
      "🇯🇵",
    ]);
  });
});

describe("isValidPlayerName", () => {
  it("12書記素の絵文字名を許可し、13書記素目は拒否する(#484)", () => {
    expect(isValidPlayerName("😀".repeat(MAX_PLAYER_NAME_LENGTH))).toBe(true);
    expect(isValidPlayerName("😀".repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBe(
      false,
    );
  });

  it("修正前のcode unit切り詰めが残したlone surrogateを拒否しない(#484)", () => {
    // 修正前の `slice(0, 12)` は絵文字を分断し、保存値に半端なサロゲートを残した。
    // これを不正扱いにすると、`sessionStorage` のジャーナル(進行中の半荘)と
    // `localStorage` の戦績が読み込み時に丸ごと破棄されてしまう。
    const legacy = "12345678901😀".slice(0, MAX_PLAYER_NAME_LENGTH);
    expect(legacy).toMatch(/[\uD800-\uDFFF]/u);
    expect(isValidPlayerName(legacy)).toBe(true);
  });

  it("空文字と上限超過は拒否する", () => {
    expect(isValidPlayerName("")).toBe(false);
    expect(isValidPlayerName("あ".repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBe(
      false,
    );
  });

  it.each(["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF", "A\u202EB"])(
    "不可視/Bidi制御文字を含む生値(%s)は拒否する",
    (value) => {
      expect(isValidPlayerName(value)).toBe(false);
    },
  );

  it("巨大入力は書記素分割へ渡さず code unit 長で拒否する(#484)", () => {
    // 分割コストを払う前に O(1) で弾く防御。上限は 12書記素がどんな構成でも
    // 収まる 12×32 code unit。
    expect(isValidPlayerName("あ".repeat(MAX_PLAYER_NAME_CODE_UNITS))).toBe(
      false, // 書記素数超過で拒否(この経路自体は従来どおり)
    );
    expect(isValidPlayerName("あ".repeat(MAX_PLAYER_NAME_CODE_UNITS + 1))).toBe(
      false,
    );
    // 上限ちょうどの1書記素(結合文字を連ねた Zalgo 相当)は通し、1つ超えたら弾く。
    const oneGrapheme = (units: number) => `あ${"́".repeat(units - 1)}`;
    expect(isValidPlayerName(oneGrapheme(MAX_PLAYER_NAME_CODE_UNITS))).toBe(
      true,
    );
    expect(isValidPlayerName(oneGrapheme(MAX_PLAYER_NAME_CODE_UNITS + 1))).toBe(
      false,
    );
  });
});

describe("limitPlayerName", () => {
  it("巨大な貼り付けは分割前に code unit で切り落とす(#484)", () => {
    const huge = "あ".repeat(100_000);

    expect(limitPlayerName(huge)).toBe("あ".repeat(MAX_PLAYER_NAME_LENGTH));
  });

  it("12書記素を超える単一書記素は上限 code unit で切り詰める(#484)", () => {
    // 1書記素しか無くても、分割へ渡す長さは MAX_PLAYER_NAME_CODE_UNITS までに抑える。
    const zalgo = `あ${"́".repeat(100_000)}`;

    expect(limitPlayerName(zalgo).length).toBeLessThanOrEqual(
      MAX_PLAYER_NAME_CODE_UNITS,
    );
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

  it("重複名を区別せずp0-p3順のまま保持する", () => {
    expect(resolvePlayerNames(["同名", "同名", "同名", "同名"])).toEqual([
      "同名",
      "同名",
      "同名",
      "同名",
    ]);
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
    expect(playerNameGraphemes(parsed?.[0] ?? "")).toHaveLength(
      MAX_PLAYER_NAME_LENGTH,
    );
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
