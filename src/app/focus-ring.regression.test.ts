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

/**
 * 素の(接頭辞なしの)`ring-offset-*` を検出する(#399)。
 *
 * `focus-visible:` 接頭辞なしの `ring-*` は状態表示として正当な用途があるため一律には
 * 禁止できない。ただし **`ring-offset-*` を伴うものだけは別**で、リングが border-box から
 * 2〜4px の帯へ押し出され、グローバルの
 * `:focus-visible { outline: 2px solid …; outline-offset: 2px }` と**同じ帯を奪い合う**。
 * `outline` は外側 `box-shadow` より上に描画されるため、その要素にフォーカスした瞬間に
 * 状態表示のリングが完全に隠れる(#399 の「リーチ可」リング)。
 *
 * 状態表示のリングは `ring-offset` なしの 0〜2px に収め、2〜4px の帯はフォーカスリング専用に空ける。
 */
const ringOffsetUtility = () => /(?<![\w:-])ring-offset-[\w[\]/.-]+/g;

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
      const text = readFileSync(join(SRC, rel), "utf8");
      for (const m of text.matchAll(outlineUtility())) {
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

  it("状態表示のリングは ring-offset-* でフォーカスリングの帯(2〜4px)へ食い込まない(#399)", () => {
    // `focus-visible:` 接頭辞の有無に関わらず、`ring-offset-*` は必ずリングを 2〜4px の
    // 帯へ押し出す。そこはグローバル `:focus-visible` の outline(offset 2px / 幅 2px)が
    // 占める領域で、outline が上に描かれるためフォーカス時に状態表示が完全に消える。
    const offenders: string[] = [];
    for (const rel of sourceFiles(SRC)) {
      const text = readFileSync(join(SRC, rel), "utf8");
      for (const m of text.matchAll(ringOffsetUtility())) {
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `ring-offset-* はリングを 2〜4px の帯へ押し出し、グローバル :focus-visible の ` +
        `outline(offset 2px)と同じ帯を占めます。outline が上に描かれるため、` +
        `フォーカスした瞬間に状態表示のリングが完全に隠れます(#399)。` +
        `状態表示のリングは ring-offset なしの 0〜2px に収めてください。\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
