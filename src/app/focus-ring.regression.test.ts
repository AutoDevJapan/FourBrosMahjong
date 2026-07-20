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
      // 検出する形:
      //  - `focus-visible:outline…`(`dark:` `md:` `group-` 等との合成も部分一致で拾う)
      //  - `has-[:focus-visible]:outline…`
      //  - 任意プロパティ記法 `focus-visible:[outline…:…]`
      for (const m of text.matchAll(
        /(?:has-\[:)?focus-visible\]?:(?:outline[\w[\]/.-]*|\[outline[\w-]*:[^\]]*\])/g,
      )) {
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
});
