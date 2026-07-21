import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tailwind v4 のコンテンツ走査除外を守る回帰テスト(#329 / #333)。
 *
 * 背景: Tailwind v4 は `.gitignore` を尊重しつつプロジェクト配下を広範に走査し、**文中の
 * クラス名リテラルもクラス候補として拾う**。そのため「使っていないクラスを説明する文章」自体が
 * そのクラスを CSS に残し続ける循環が起きる(#314 では未使用ユーティリティを 50 個除去したのに
 * 生成 CSS がバイト単位で同一だった)。#329 で `globals.css` に `@source not` を追加し、
 * 実行時に描画されないファイル(Markdown 系 / テスト / e2e)を走査対象から外して解消した。
 *
 * この除外には**2 つの無音デグレ経路**がある。どちらもビルドもテストも通ったまま壊れるため、
 * ソース/設定レベルの不変条件として本テストで固定する(#333)。
 *  1. `@source not` 行そのものが消える/変質する → 死に CSS が再び混入する。
 *  2. Markdown を実行時レンダリングする依存が入る → Markdown 除外が「実使用クラスの欠落」に
 *     転じ、Markdown 内でしか使われないクラスが CSS から静かに消えて視覚デグレになる。
 *
 * 本テストは `.test.ts` 命名のため `@source not "…/*.{test,spec}.{ts,tsx}"` の除外対象であり、
 * ここに書いたクラス名リテラルは CSS に混入しない(この不変条件を自己適用している)。
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * `@source not` の除外パターン。パスはこの CSS ファイル(`src/app/`)からの相対で、
 * リポジトリルート配下を指す。値の照合は空白と引用符(`"`/`'`)の揺れを許容する。
 */
const REQUIRED_EXCLUSIONS: ReadonlyArray<{ label: string; glob: string }> = [
  { label: "Markdown 系(.md / .mdx / .mdc)", glob: "../../**/*.{md,mdx,mdc}" },
  {
    label: "併置テスト(*.test/spec.ts/tsx)",
    glob: "../../**/*.{test,spec}.{ts,tsx}",
  },
  { label: "E2E ディレクトリ", glob: "../../e2e" },
];

/**
 * Markdown を**実行時に**レンダリングし得る依存の名前パターン。
 * これらが直接依存に入ると「本リポジトリは Markdown を実行時描画しない」という
 * `@source not` の Markdown 除外の前提が崩れる。
 *
 * TypeDoc など「ビルド時にドキュメントを生成するだけ」で実行時 DOM を作らないものは
 * 対象外(生成物は `docs/api`、gitignore 済みで走査もされない)。判定は**直接依存のみ**を
 * 見る(推移依存は実行時 className の供給源にならない)。
 *
 * このパターンは**網羅的ではなく、広く使われる代表的なレンダラの許可リスト**である。
 * ここに無い新種のレンダラは素通りしうるが、その場合でも「新たに Markdown 描画依存を
 * 足す」PR は spec 5.4.2 のレビュー対象であり、気付いたら本リストへ追加する運用とする。
 * 語境界(`(?:$|-)`)は `markdownlint`(リンタ=描画しない)や `markedly`(無関係)を
 * 弾きつつ `markdown-it` / `markdown-to-jsx` / `marked-*` を拾うために付けている。
 */
const RUNTIME_MARKDOWN_RENDERERS =
  /^(?:react-markdown|markdown(?:$|-)|marked(?:$|-)|micromark|remark(?:$|-)|remarkable|rehype(?:$|-)|@mdx-js\/|@mdxeditor\/|@next\/mdx|next-mdx|showdown|commonmark|snarkdown)/;

/** `@source not <glob>;` を、空白・引用符の揺れを許して照合する正規表現を作る。 */
function sourceNotPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@source\\s+not\\s+["']${escaped}["']\\s*;`);
}

describe("Tailwind コンテンツ走査の除外(#329 / #333)", () => {
  const CSS = readFileSync(join(SRC, "app/globals.css"), "utf8");

  it("globals.css が非描画ファイルを @source not で除外している(消すと死に CSS が復活する)", () => {
    // ミューテーション実測(#329): この 3 行を削除して再ビルドすると、Markdown/テスト由来の
    // 未使用クラス 15 個(grid-cols-6・focus-visible:outline-foreground 等)が CSS に復活する。
    // つまり本アサーションは「効かなくなったら落ちる」ガードとして機能する。
    const missing = REQUIRED_EXCLUSIONS.filter(
      ({ glob }) => !sourceNotPattern(glob).test(CSS),
    ).map(({ label, glob }) => `${label}: @source not "${glob}"`);
    expect(
      missing,
      "globals.css に以下の @source not 除外が検出できません。これが失われると Markdown/テスト\n" +
        "中のクラス名リテラルが CSS バンドルに混入し、#314 / #329 の循環(デッドコードを説明する\n" +
        "文章がそのデッドコードを生かす)が再発します。除外を消したなら復元し、glob 表記を意図的に\n" +
        "変えた(並べ替え・末尾スラッシュ等)なら本テストの REQUIRED_EXCLUSIONS も合わせて更新して\n" +
        "ください:\n" +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("Markdown を実行時描画する依存が無い(入ると Markdown 除外が無音デグレに転じる)", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const directDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    const offenders = directDeps
      .filter((name) => RUNTIME_MARKDOWN_RENDERERS.test(name))
      .sort();
    expect(
      offenders,
      "Markdown を実行時レンダリングし得る依存が検出されました。\n" +
        '`globals.css` の `@source not "../../**/*.{md,mdx,mdc}"` は「Markdown を実行時描画\n' +
        "しない」前提に依存しています。Markdown をレンダリングするなら、その Markdown 内で\n" +
        "使うクラスが CSS から無音で欠落しないよう、**Markdown 除外を外す**か描画元を走査対象に\n" +
        "含めてください(詳細: spec 5.4.2 / #333)。検出された依存:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
