import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import {
  BOUNDARY_SOURCES,
  isCssExcludedInput,
  scanCss,
} from "../test/tailwind-source-audit.mjs";

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
  // src/test/ はテストしか読まないヘルパ(*.test.ts 以外の名前)を含むためディレクトリごと。
  { label: "テストヘルパディレクトリ", glob: "../test" },
  ...BOUNDARY_SOURCES.map((glob) => ({
    label: "非 runtime 入力 (#1191)",
    glob,
  })),
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
    // ミューテーション実測(#329): これらの除外行(#329 当時は 3 行)を削除して再ビルドすると、Markdown/テスト由来の
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

describe("実 Tailwind compiler が非 runtime 境界を適用する (#1191)", () => {
  const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
  // 存在しない canary は一時 repo 内の出力。実 repo のテスト入力 literal と
  // 区別して組み立てる（#745 の入力 inventory を架空の資産で汚染しない）。
  const excluded = [
    ["prototypes/unity-display/Assets/Canary.cs", 9011],
    [posix.join("documents", "evidence", "unity", "runtime.json"), 9012],
    ["documents/assets/ui-refresh/manifest.json", 9013],
    ["documents/fixtures/railway-pre-cutover.json", 9014],
    [posix.join(".godd", "state", "canary.json"), 9021],
    ["documents/fixtures/railway-readyz-before-iac.json", 9022],
    [posix.join("src", "domain", "game", "__testing__", "canary.ts"), 9023],
    [posix.join("src", "domain", "hand", "__oracle__", "canary.ts"), 9024],
  ] as const;
  const retained = [
    ["src/components/Runtime.tsx", 9015],
    ["documents/fixtures/unity-display-contract.json", 9016],
    // 類似名まで広く消すパターンへの退行も検出する。
    [posix.join("documents", "assets-runtime", "contract.json"), 9017],
    [posix.join("documents", "fixtures", "other-runtime.json"), 9018],
    [posix.join("src", "__testing__-runtime", "contract.ts"), 9025],
  ] as const;

  it("実リポジトリの依存 graph から境界内だけを外し、本番 src / Unity fixture を保持する", async () => {
    const result = await scanCss(ROOT, css);
    expect(result.dependencies).toContain(
      "src/components/prototype/UnityDisplayReference.tsx",
    );
    expect(result.dependencies).toContain(
      "documents/fixtures/unity-display-contract.json",
    );
    expect(result.dependencies.filter(isCssExcludedInput)).toEqual([]);
  });

  it("全 tracked path と正負の canary で compiler 境界と import 境界が一致する", () => {
    const loadConfig = createRequire(import.meta.url);
    const config = loadConfig(join(ROOT, ".dependency-cruiser.cjs"));
    const boundary = config.forbidden.find(
      (rule: { name: string }) =>
        rule.name === "no-runtime-to-css-excluded-inputs",
    );
    expect(boundary?.severity).toBe("error");
    const target = new RegExp(boundary.to.path);
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
    expect(tracked).toContain("src/app/globals.css");
    for (const [path] of excluded) {
      expect(isCssExcludedInput(path), path).toBe(true);
    }
    for (const [path] of retained) {
      expect(isCssExcludedInput(path), path).toBe(false);
    }
    expect(
      [
        ...tracked,
        ...excluded.map(([path]) => path),
        ...retained.map(([path]) => path),
      ].filter((path) => target.test(path) !== isCssExcludedInput(path)),
    ).toEqual([]);
  });

  it("除外先の新規クラスは生成されず、runtime canary は残る（除外削除の正対照も実測）", async () => {
    // 実際の globals.css の指令だけを使う。既存アプリのクラスとの偶然の重複を避け、
    // 一時 repo に隔離する。canary 本体は既に除外済みの本テスト以外へ置かない。
    const directives = css.match(/^@source not .*;$/gm)?.join("\n");
    expect(directives).toBeDefined();
    // Hidden directories may be skipped by automatic discovery. Explicitly
    // include only the owned fixture's metadata so the negative rule is tested.
    const inputs = `@import "tailwindcss";\n@source "../../.godd";\n${directives}\n`;
    const control = BOUNDARY_SOURCES.reduce(
      (input, source) => input.replace(sourceNotPattern(source), ""),
      inputs,
    );
    // Fresh base per compilation: no candidate/scanner cache from the positive
    // control can conceal a missing exclusion in the actual case.
    for (const [input, isControl] of [
      [inputs, false],
      [control, true],
    ] as const) {
      const dir = realpathSync(
        mkdtempSync(join(tmpdir(), "tailwind-boundary-")),
      );
      try {
        symlinkSync(
          join(ROOT, "node_modules"),
          join(dir, "node_modules"),
          process.platform === "win32" ? "junction" : "dir",
        );
        for (const [path, value] of [...excluded, ...retained]) {
          const absolute = join(dir, path);
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(
            absolute,
            JSON.stringify({ className: `z-[${value}]` }),
          );
        }
        mkdirSync(join(dir, "src/app"), { recursive: true });
        writeFileSync(join(dir, "src/app/globals.css"), input);
        const result = await scanCss(dir, input);
        for (const [path, value] of excluded) {
          expect(
            result.dependencies.includes(path),
            `${path}: control=${isControl}`,
          ).toBe(isControl);
          expect(
            result.css.includes(`z-index: ${value};`),
            `${value}: control=${isControl}`,
          ).toBe(isControl);
        }
        for (const [path, value] of retained) {
          expect(result.dependencies).toContain(path);
          expect(result.css).toContain(`z-index: ${value};`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe("作業メタデータは検証ソースへ含めない", () => {
  it("ESLint は仮の metadata path を無視し、通常の src は検査する", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    // isPathIgnored is a config-only lookup: do not create/read job metadata.
    expect(
      await eslint.isPathIgnored(join(ROOT, ".godd/hypothetical-only.cjs")),
    ).toBe(true);
    expect(await eslint.isPathIgnored(join(ROOT, "src/app/page.tsx"))).toBe(
      false,
    );
  }, 60_000);

  it("TypeScript の自動 include から metadata を外す", () => {
    const config = JSON.parse(
      readFileSync(join(ROOT, "tsconfig.json"), "utf8"),
    );
    expect(config.exclude).toContain(".godd");
    expect(config.exclude).toContain("node_modules");
  });
});
