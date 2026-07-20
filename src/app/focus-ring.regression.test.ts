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
 *
 * **例外は 1 件も許可しない。** #314 の時点では ThemeToggle の `has-[]` バリアントを
 * 既知の例外として許可していた。フォーカスを受けるのは内側の `<input type="radio">` だが
 * `has-[]` は外側の `<label>` へ outline を付けるため、`<label>` にはグローバル
 * `:focus-visible` がマッチせず競合せず、input(`--focus-ring` 色)と
 * label(`--foreground` 色)の**二重リング**として実際に描画されていた。#327 で
 * `has-[]` を削除しリングを input 側のグローバル規則一本へ統一したため、許可リスト
 * そのものを廃止した。空の許可リストを残すと「例外を足してよい場所」に見え、同じ経緯を
 * 繰り返す。新たな例外が必要になった場合は、足す前に spec 5.4.2 の不変条件を見直すこと。
 */

// `new URL(...).pathname` はパーセントエンコーディングを解かないため、リポジトリパスに
// 空白や非 ASCII を含むと壊れる。`vitest.config.ts` と同じく fileURLToPath を使う。
const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * フォーカス系疑似クラスの断片。`focus-visible` だけでなく `focus-within` / `focus` も含める。
 *
 * `has-[:focus-within]:outline-*` は `has-[:focus-visible]:outline-*` と**まったく同じ
 * 二重リング**を生む(outline がラッパに付き、内側の control のグローバルリングと
 * セレクタが競合しない)。#327 で潰した失敗様態の最も近い変種なので、同じガードで塞ぐ。
 */
const FOCUS_PSEUDO = "focus(?:-visible|-within)?";

/**
 * `has-[…:focus…]` のラッパ前置。`has-[:focus-visible]` だけでなく、Tailwind でより
 * 一般的な `has-[input:focus-visible]` / `has-[.peer:focus-visible]` も拾う。
 *
 * これをキャプチャしておき、offender が「ラッパに付くリング(=二重リング)」なのか
 * 「フォーカス要素自身に付く no-op」なのかの仕分けに使う。前置の有無で失敗メッセージが
 * 変わるため、ここを取りこぼすと**誤った診断**を出す(#327 で修正したのと同じ事故)。
 */
const HAS_WRAPPER = "(has-\\[[^\\]]*)?";

/**
 * `focus…:outline…` を検出する。以下の合成形をすべて拾う:
 *  - `dark:` `md:` `group-` `peer-` 等との合成(部分一致)
 *  - `has-[:focus-visible]:outline…` / `has-[input:focus-visible]:outline…`
 *  - `focus-within` / `focus` 版
 *  - 任意プロパティ記法 `focus-visible:[outline…:…]`
 *
 * `g` フラグ付き正規表現を定数で共有すると、`matchAll` は `lastIndex` を書き換えない
 * ものの**読み取りはする**ため、将来誰かが同じ定数へ `.test()` / `.exec()` を使うと
 * 以降の検出が静かに取りこぼす(このテストの存在意義そのものが壊れる)。
 * 毎回新しいインスタンスを返す関数にして、その事故を構造的に排除する。
 */
const outlineUtility = () =>
  new RegExp(
    `${HAS_WRAPPER}\\b${FOCUS_PSEUDO}\\]?:(?:outline[\\w[\\]/.-]*|\\[outline[\\w-]*:[^\\]]*\\])`,
    "g",
  );

/**
 * `focus…:ring…` / `shadow…` を検出する。任意プロパティ記法の
 * `focus-visible:[box-shadow:…]` も含める。共有しない理由は上と同じ。
 */
const ringUtility = () =>
  new RegExp(
    `${HAS_WRAPPER}\\b${FOCUS_PSEUDO}\\]?:(?:(?:ring|shadow)[\\w[\\]/.-]*|\\[box-shadow:[^\\]]*\\])`,
    "g",
  );

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

  /**
   * src 配下を 1 度だけ走査し、`has-[…]` ラッパ由来かどうかで offender を仕分ける。
   *
   * 仕分けはマッチ文字列の前方一致ではなく**キャプチャグループ 1(ラッパ前置)の有無**で
   * 判定する。`has-[input:focus-visible]:outline-2` のようにマッチが `has-` で始まらない
   * 形があり、前方一致では二重リングを no-op と誤診してしまうため。
   */
  function scan(patterns: Array<() => RegExp>): {
    direct: string[];
    wrapper: string[];
  } {
    const direct: string[] = [];
    const wrapper: string[] = [];
    for (const rel of sourceFiles(SRC)) {
      const text = readFileSync(join(SRC, rel), "utf8");
      for (const pattern of patterns) {
        for (const m of text.matchAll(pattern())) {
          (m[1] ? wrapper : direct).push(`${rel}: ${m[0]}`);
        }
      }
    }
    return { direct, wrapper };
  }

  it("コンポーネントは focus-visible:outline-* を指定しない(no-op のデッドコード)", () => {
    const { direct } = scan([outlineUtility]);
    expect(
      direct,
      `focus-visible:outline-* はカスケードレイヤーにより no-op です。` +
        `フォーカスリングは globals.css の :focus-visible / --focus-ring に一本化してください。\n` +
        direct.join("\n"),
    ).toEqual([]);
  });

  it("ラッパ要素に has-[] でリングを足さない(内側のフォーカス要素と二重リングになる / #327)", () => {
    // `has-[:focus-visible]:outline-*` は上の no-op とは**別の失敗様態**である。
    // outline を付ける先が「フォーカスを受ける要素」ではなくラッパのため、グローバル
    // `:focus-visible` とセレクタが競合せず、上書きされずに**実際に描画される**。
    // 結果、内側の control のリング(--focus-ring)とラッパのリングが入れ子で同時に出る。
    // 上の no-op メッセージに混ぜると診断を誤らせる(「効かない」ではなく「効きすぎる」)ため分離する。
    const offenders = scan([outlineUtility, ringUtility]).wrapper;
    expect(
      offenders,
      `has-[] バリアントのリングはラッパ要素に適用されるためグローバル規則と競合せず、` +
        `内側のフォーカス要素のリングと二重に描画されます。リングは --focus-ring 一本に統一してください。\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("コンポーネントは focus-visible:ring-* / shadow-* でリングを足さない(二重リングになる)", () => {
    // `outline-*` と違い `ring-*` / `shadow-*` は **box-shadow** で描画されるため、
    // グローバル規則の `outline` と競合せず **実際に描画されてしまう**(no-op ではない)。
    // つまりこちらは「デッドコード」ではなく「二重リングによる単一起点の破壊」であり、
    // 上のテストの正規表現(outline 系のみ)では捕捉できないため別途禁止する。
    const { direct } = scan([ringUtility]);
    expect(
      direct,
      `focus-visible:ring-* / shadow-* は box-shadow で描画されるためグローバルの ` +
        `outline リングと二重になります。リングは --focus-ring に一本化してください。\n` +
        direct.join("\n"),
    ).toEqual([]);
  });

  it("検出用の正規表現が空振りしていない(ガード自身の健全性)", () => {
    // 上の3テストは「0 件であること」を主張するため、正規表現が壊れて何もマッチ
    // しなくなっても緑のままになる。doc コメントが「拾う」と宣言している分岐ごとに
    // 陽性サンプルを置き、検出器が生きていること**と**仕分けが正しいことを固定する。
    // サンプルは分岐と 1:1 対応させること(分岐を足したらここにも足す)。
    const cases: ReadonlyArray<{
      readonly branch: string;
      readonly input: string;
      readonly match: string;
      readonly wrapper: boolean;
    }> = [
      // --- outline 系 ---
      {
        branch: "素の focus-visible",
        input: "focus-visible:outline-foreground",
        match: "focus-visible:outline-foreground",
        wrapper: false,
      },
      {
        branch: "has-[:…] ラッパ",
        input: "has-[:focus-visible]:outline-2",
        match: "has-[:focus-visible]:outline-2",
        wrapper: true,
      },
      // #327 の実在形。`:outline` 単体(outline-width:1px)も拾えること。
      {
        branch: "has-[:…] ラッパ / 修飾子なし",
        input: "has-[:focus-visible]:outline",
        match: "has-[:focus-visible]:outline",
        wrapper: true,
      },
      // Tailwind でより一般的な書き方。前方一致だと no-op と誤診される形(S2)。
      {
        branch: "has-[要素:…] ラッパ",
        input: "has-[input:focus-visible]:outline-2",
        match: "has-[input:focus-visible]:outline-2",
        wrapper: true,
      },
      {
        branch: "has-[.クラス:…] ラッパ",
        input: "has-[.peer:focus-visible]:outline-foreground",
        match: "has-[.peer:focus-visible]:outline-foreground",
        wrapper: true,
      },
      // #327 と同一の二重リングを生む変種(S1)。
      {
        branch: "focus-within ラッパ",
        input: "has-[:focus-within]:outline-2",
        match: "has-[:focus-within]:outline-2",
        wrapper: true,
      },
      {
        branch: "素の focus-within",
        input: "focus-within:outline-foreground",
        match: "focus-within:outline-foreground",
        wrapper: false,
      },
      {
        branch: "素の focus",
        input: "has-[:focus]:outline-2",
        match: "has-[:focus]:outline-2",
        wrapper: true,
      },
      // doc コメントが宣言している「group-/peer- 等との合成」(部分一致で拾う)。
      {
        branch: "group- との合成",
        input: "group-focus-visible:outline-2",
        match: "focus-visible:outline-2",
        wrapper: false,
      },
      {
        branch: "peer- との合成",
        input: "peer-focus-visible:outline-foreground",
        match: "focus-visible:outline-foreground",
        wrapper: false,
      },
      {
        branch: "dark: との合成 + ラッパ",
        input: "dark:has-[:focus-visible]:outline-2",
        match: "has-[:focus-visible]:outline-2",
        wrapper: true,
      },
      // doc コメントが宣言している「任意プロパティ記法」。
      {
        branch: "任意プロパティ記法",
        input: "focus-visible:[outline:2px_solid_red]",
        match: "focus-visible:[outline:2px_solid_red]",
        wrapper: false,
      },
    ];
    for (const { branch, input, match, wrapper } of cases) {
      const found = [...input.matchAll(outlineUtility())];
      expect(
        found.map((m) => m[0]),
        `分岐「${branch}」が検出されない: ${input}`,
      ).toEqual([match]);
      expect(
        Boolean(found[0][1]),
        `分岐「${branch}」の wrapper 判定が誤り: ${input}`,
      ).toBe(wrapper);
    }

    // --- ring / shadow 系(box-shadow で描画されるため no-op にならない)---
    const ringCases: ReadonlyArray<[string, string, boolean]> = [
      ["focus-visible:ring-2", "focus-visible:ring-2", false],
      [
        "has-[:focus-visible]:shadow-md",
        "has-[:focus-visible]:shadow-md",
        true,
      ],
      [
        "has-[input:focus-within]:ring-2",
        "has-[input:focus-within]:ring-2",
        true,
      ],
      [
        "focus-visible:[box-shadow:0_0_0_2px_red]",
        "focus-visible:[box-shadow:0_0_0_2px_red]",
        false,
      ],
    ];
    for (const [input, match, wrapper] of ringCases) {
      const found = [...input.matchAll(ringUtility())];
      expect(
        found.map((m) => m[0]),
        `ring 分岐が検出されない: ${input}`,
      ).toEqual([match]);
      expect(
        Boolean(found[0][1]),
        `ring 分岐の wrapper 判定が誤り: ${input}`,
      ).toBe(wrapper);
    }
  });
});
