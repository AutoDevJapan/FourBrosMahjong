import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * フォーカスリングの単一起点を守る回帰テスト(#314 / スペック5 5.4.2)。
 *
 * 背景: `@import "tailwindcss"` により Tailwind のユーティリティは `@layer utilities` 内へ
 * 生成される。一方 `globals.css` は `@layer` を使わないため、グローバルな `:focus-visible`
 * 規則は **unlayered(レイヤー外)** に置かれる。CSS カスケードでは通常宣言について
 * unlayered がすべてのレイヤーに優先する(詳細度の比較は行われない)ため、コンポーネント側で
 * `focus-visible:outline-*` を指定しても **outline 系プロパティは一切上書きできず no-op** になる。
 *
 * この構造を知らずに `focus-visible:outline-foreground` 等を書き足すと、
 * 「書いたのに効かない」デッドコードが再び増殖する。本テストはそれを検出する。
 *
 * 実測(#314): 除去前後でライト/ダーク × 4 画面の全フォーカス可能要素 248 サンプルの
 * 計算済み outline を比較し、差分ゼロ・実描画色は常に `--focus-ring`
 * (light `rgb(29,78,216)` / dark `rgb(96,165,250)`)であることを確認済み。
 */

// `new URL(...).pathname` はパーセントエンコーディングを解かないため、リポジトリパスに
// 空白や非 ASCII を含むと壊れる。`vitest.config.ts` と同じく fileURLToPath を使う。
const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * 既知の例外: ファイル単位ではなく**許可するクラス文字列そのもの**を固定する。
 *
 * ThemeToggle はフォーカスを受けるのが内側の `<input type="radio">` である一方、
 * `has-[]` は外側の `<label>` ラッパへ outline を付ける。`<label>` にはグローバル
 * `:focus-visible` がマッチせず競合しないため、この 1 箇所だけは実際に描画される。
 * 結果として input(`--focus-ring` 色)と label(`--foreground` 色)の二重リングになる。
 * 見た目が変わる変更のため #314 では現状維持とし、#327 で扱う。
 *
 * ファイル単位で除外すると、同じファイルへ `has-` の付かない真の no-op を書き足しても
 * 検出できなくなる。そのため許可対象を完全一致の集合として列挙する。
 */
const KNOWN_EXCEPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "components/layout/ThemeToggle.tsx",
    new Set([
      "has-[:focus-visible]:outline",
      "has-[:focus-visible]:outline-2",
      "has-[:focus-visible]:outline-offset-2",
      "has-[:focus-visible]:outline-foreground",
    ]),
  ],
]);

/**
 * `focus-visible:outline…` を検出する。以下の合成形をすべて拾う:
 *  - `dark:` `md:` `group-` `peer-` 等との合成(部分一致)
 *  - `has-[:focus-visible]:outline…`
 *  - 任意プロパティ記法 `focus-visible:[outline…:…]`
 *
 * `g` フラグ付き正規表現を定数で共有すると、`matchAll` は `lastIndex` を書き換えない
 * ものの**読み取りはする**ため、将来誰かが同じ定数へ `.test()` / `.exec()` を使うと
 * 以降の検出が静かに取りこぼす(このテストの存在意義そのものが壊れる)。
 * 毎回新しいインスタンスを返す関数にして、その事故を構造的に排除する。
 */
const outlineUtility = () =>
  /(?:has-\[:)?focus-visible\]?:(?:outline[\w[\]/.-]*|\[outline[\w-]*:[^\]]*\])/g;

/**
 * `focus-visible:ring…` / `shadow…` を検出する。任意プロパティ記法の
 * `focus-visible:[box-shadow:…]` も含める。共有しない理由は上と同じ。
 */
const ringUtility = () =>
  /(?:has-\[:)?focus-visible\]?:(?:(?:ring|shadow)[\w[\]/.-]*|\[box-shadow:[^\]]*\])/g;

/** src 配下の .ts/.tsx を再帰列挙(テストファイル自身は除く)。 */
function sourceFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  // withFileTypes はシンボリックリンクを追わないため、リンクループで無限再帰しない。
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...sourceFiles(join(dir, entry.name), rel));
    } else if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      out.push(rel);
    }
  }
  return out;
}

describe("フォーカスリングの単一起点(#314)", () => {
  const CSS = readFileSync(join(SRC, "app/globals.css"), "utf8");

  it("グローバル :focus-visible が --color-focus-ring を参照して outline を描画する", () => {
    const rule = CSS.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(
      rule,
      "globals.css に :focus-visible 規則が見つからない",
    ).not.toBeNull();
    expect(rule?.[1]).toMatch(
      /outline:\s*2px\s+solid\s+var\(--color-focus-ring\)/,
    );
    expect(rule?.[1]).toMatch(/outline-offset:\s*2px/);
  });

  it("globals.css は @layer を使わない(unlayered 優位が崩れると全画面のリングが変わる)", () => {
    // @layer 宣言を入れるとグローバル規則がレイヤー内へ移り、Tailwind ユーティリティとの
    // 優先関係が逆転する。トークン一本化の前提そのものが壊れるため禁止する。
    expect(CSS).not.toMatch(/@layer\b/);
  });

  it("--color-focus-ring が --focus-ring に橋渡しされている", () => {
    expect(CSS).toMatch(/--color-focus-ring:\s*var\(--focus-ring\)/);
  });

  it("コンポーネントは focus-visible:outline-* を指定しない(no-op のデッドコード)", () => {
    const offenders: string[] = [];
    for (const rel of sourceFiles(SRC)) {
      const allowed = KNOWN_EXCEPTIONS.get(rel);
      const text = readFileSync(join(SRC, rel), "utf8");
      for (const m of text.matchAll(outlineUtility())) {
        if (allowed?.has(m[0])) continue;
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `focus-visible:outline-* はカスケードレイヤーにより no-op です。` +
        `フォーカスリングは globals.css の :focus-visible / --focus-ring に一本化してください。\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("コンポーネントは focus-visible:ring-* / shadow-* でリングを足さない(二重リングになる)", () => {
    // `outline-*` と違い `ring-*` / `shadow-*` は **box-shadow** で描画されるため、
    // グローバル規則の `outline` と競合せず **実際に描画されてしまう**(no-op ではない)。
    // つまりこちらは「デッドコード」ではなく「二重リングによる単一起点の破壊」であり、
    // 上のテストの正規表現(outline 系のみ)では捕捉できないため別途禁止する。
    const offenders: string[] = [];
    for (const rel of sourceFiles(SRC)) {
      const text = readFileSync(join(SRC, rel), "utf8");
      for (const m of text.matchAll(ringUtility())) {
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `focus-visible:ring-* / shadow-* は box-shadow で描画されるためグローバルの ` +
        `outline リングと二重になります。リングは --focus-ring に一本化してください。\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("KNOWN_EXCEPTIONS が陳腐化していない(許可エントリは実在する)", () => {
    // #327 で ThemeToggle の例外が解消された際、許可エントリの削除漏れを検出する。
    const files = sourceFiles(SRC);
    for (const [rel, classes] of KNOWN_EXCEPTIONS) {
      expect(files, `許可エントリのファイルが存在しない: ${rel}`).toContain(
        rel,
      );
      // 部分文字列一致(toContain)では `…:outline` が `…:outline-2` に含まれてしまい
      // 独立に検証できない。offender 検出と同じ正規表現で完全一致の集合を作って突き合わせる。
      const text = readFileSync(join(SRC, rel), "utf8");
      const present = new Set(
        [...text.matchAll(outlineUtility())].map((m) => m[0]),
      );
      for (const cls of classes) {
        expect(
          [...present].sort(),
          `許可エントリ "${cls}" が ${rel} に存在しません。例外が解消されたなら ` +
            `KNOWN_EXCEPTIONS から削除してください(#327)。`,
        ).toContain(cls);
      }
    }
  });
});
