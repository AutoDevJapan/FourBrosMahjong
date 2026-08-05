import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  changedPaths,
  classifyPath,
  DOCUMENTATION_EXCEPTIONS,
  resolveScope,
} from "../../.github/scripts/verification-scope.mjs";
import playwrightConfig from "../../playwright.config";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  id?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

type Workflow = {
  concurrency?: { group?: string; "cancel-in-progress"?: unknown };
  jobs?: Record<string, { "timeout-minutes"?: unknown; steps?: Step[] }>;
};

const WORKFLOW_DIR = resolve(process.cwd(), ".github/workflows");

function workflowFilenames(): string[] {
  // `.yaml` で追加されたワークフローが検査から丸ごと漏れないよう両方を見る。
  return readdirSync(WORKFLOW_DIR).filter(
    (entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"),
  );
}

function readWorkflowFile(filename: string): Workflow {
  return parse(
    readFileSync(resolve(WORKFLOW_DIR, filename), "utf8"),
  ) as Workflow;
}

/** Playwright のブラウザバイナリを置く共有キャッシュパス。 */
const PLAYWRIGHT_CACHE_PATH = "~/.cache/ms-playwright";
/** `playwright install` に名前で渡せるターゲット。増やしたらここへ追加する。 */
const PLAYWRIGHT_BROWSERS = [
  "chromium",
  "firefox",
  "webkit",
  "chrome",
  "msedge",
] as const;

function readWorkflow(): Workflow {
  const source = readFileSync(
    resolve(process.cwd(), ".github/workflows/ci.yml"),
    "utf8",
  );
  return parse(source) as Workflow;
}

/**
 * キャッシュを**書き込む**ステップか(一体型 `actions/cache@` と `actions/cache/save@`)。
 * `actions/cache/restore@` は読み取り専用なのでここには含めない。
 */
function isCacheWritingStep(step: Step): boolean {
  return (
    step.uses?.startsWith("actions/cache@") === true ||
    step.uses?.startsWith("actions/cache/save@") === true
  );
}

/** キャッシュを**読み取る**ステップか(一体型 `actions/cache@` は復元も行う)。 */
function isCacheReadingStep(step: Step): boolean {
  return (
    step.uses?.startsWith("actions/cache@") === true ||
    step.uses?.startsWith("actions/cache/restore@") === true
  );
}

/**
 * `~/.cache/ms-playwright` を復元する各ステップと、同じ job でその後に走る
 * `playwright install` が要求するブラウザ集合を対応付ける。
 *
 * 前提(崩れた場合は下の件数アサーションで落ちる): Playwright を使うのは `ci.yml` のみ、
 * `with.path` は単一行で `~/.cache/ms-playwright` 完全一致。
 */
function playwrightBrowserCaches(workflow: Workflow) {
  const caches: {
    job: string;
    key: string;
    install: string | undefined;
    browsers: string[];
  }[] = [];
  for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
    const steps = definition.steps ?? [];
    steps.forEach((step, index) => {
      if (!isCacheReadingStep(step)) return;
      if (String(step.with?.path ?? "").trim() !== PLAYWRIGHT_CACHE_PATH)
        return;
      const install = steps
        .slice(index + 1)
        .find((later) => later.run?.includes("playwright install"))?.run;
      caches.push({
        job,
        key: String(step.with?.key ?? ""),
        install,
        browsers: PLAYWRIGHT_BROWSERS.filter((browser) =>
          new RegExp(`\\b${browser}\\b`).test(install ?? ""),
        ),
      });
    });
  }
  return caches;
}

describe("CI workflow job timeouts", () => {
  it.each(["ci", "e2e"])("%s job has a bounded timeout", (jobName) => {
    const workflow = readWorkflow();
    const timeout = workflow.jobs?.[jobName]?.["timeout-minutes"];

    expect(timeout, `${jobName} must declare timeout-minutes`).toBeTypeOf(
      "number",
    );
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(60);
  });
});

/**
 * ドキュメント(CLAUDE.md / README / `docs/品質ツール運用方針.md`)が「必須ゲート」と
 * 書いているスクリプトが、実際に CI で実行されていることを固定する。
 *
 * #418 の実態: CI のゲートは `pnpm format:check`(= `biome format .`)だけで、
 * その上位互換である `pnpm check`(= `biome check .` = 整形 + assist)は誰も走らせて
 * いなかった。結果として assist(organizeImports)の違反が 38 件たまり、
 * **ドキュメントに載っているのに main で一度も緑にならないコマンド**が生まれた。
 * ゲートの「実行されているか」は、スクリプト自体のテストでは検出できない。
 */
describe("CI が必須ゲートを実際に実行している (#418)", () => {
  /** `ci` job で実行されていなければならない pnpm スクリプト。 */
  const REQUIRED_GATES = [
    "pnpm lint",
    "pnpm typecheck",
    "pnpm check",
    "pnpm test",
    "pnpm knip",
    "pnpm depcruise",
    "pnpm build",
  ] as const;

  /** `ci` job の全ステップの `run` を 1 本の文字列に連結する。 */
  function ciRunCommands(): string {
    const workflow = readWorkflow();
    const steps = workflow.jobs?.ci?.steps ?? [];
    return steps.map((step) => step.run ?? "").join("\n");
  }

  it.each(REQUIRED_GATES)("ci job が %s を実行している", (gate) => {
    // 単語境界で見る。`pnpm check` が `pnpm check:foo` に化けても検出できるようにする。
    const pattern = new RegExp(`${gate.replace(/\s+/g, "\\s+")}(\\s|$)`, "m");
    expect(
      pattern.test(ciRunCommands()),
      `ci job に ${gate} を実行するステップが無い(必須ゲートが強制されていない)`,
    ).toBe(true);
  });

  it("format:check ではなく上位互換の check をゲートにしている", () => {
    const commands = ciRunCommands();
    expect(
      /pnpm\s+format:check(\s|$)/m.test(commands),
      "pnpm format:check は pnpm check に包含されるため、両方を走らせる必要はない",
    ).toBe(false);
  });
});

describe("production E2E parity gate (#432)", () => {
  it("E2E専用seedを埋め込んだ同じproduction buildで主要導線を検証する", () => {
    const steps = readWorkflow().jobs?.ci?.steps ?? [];
    const build = steps.find((step) => step.run?.trim() === "pnpm build");
    expect(build, "ci job にproduction buildが無い").toBeDefined();
    expect(build?.env?.NEXT_PUBLIC_E2E_SEED_ENABLED).toBe("1");

    const productionE2e = steps.find(
      (step) => step.run?.trim() === "pnpm test:e2e:prod:prebuilt",
    );
    expect(
      productionE2e,
      "prebuilt production成果物に対する主要E2Eがci jobに無い",
    ).toBeDefined();
  });
});

/**
 * 複数 job が同じ `~/.cache/ms-playwright` を異なるブラウザ集合で使うため、キャッシュキーが
 * ブラウザ集合を含まないと、先に保存した job の内容(例: chromium のみ)がキーを占有し、
 * webkit を要求する job は exact hit で保存もスキップされたまま毎回再ダウンロードになる。
 */
describe("Playwright browser cache keys", () => {
  it("インストールするブラウザ集合をキーに含め、job 間で衝突しない", () => {
    const caches = playwrightBrowserCaches(readWorkflow());
    expect(caches.length).toBeGreaterThanOrEqual(2);

    for (const { job, key, install, browsers } of caches) {
      expect(
        install,
        `${job}: キャッシュの後に playwright install ステップが無い`,
      ).toBeTypeOf("string");
      expect(
        browsers,
        `${job}: playwright install がブラウザ名を明示していない(引数なしは全ブラウザ取得になりキーと対応付けられない)`,
      ).not.toEqual([]);
      for (const browser of browsers) {
        expect(
          key,
          `${job}: cache key に ${browser} が含まれていない`,
        ).toContain(browser);
      }
    }

    const keysByBrowserSet = new Map<string, Set<string>>();
    for (const { key, browsers } of caches) {
      const set = keysByBrowserSet.get(key) ?? new Set<string>();
      set.add(browsers.join("+"));
      keysByBrowserSet.set(key, set);
    }
    for (const [key, browserSets] of keysByBrowserSet) {
      expect(
        [...browserSets],
        `cache key ${key} が異なるブラウザ集合で共有されている`,
      ).toHaveLength(1);
    }
  });
});

/**
 * GitHub Actions のキャッシュ予算はリポジトリあたり 10GB で、超過分は LRU で退避される。
 * キャッシュは ref スコープなので、PR ref (`refs/pull/N/merge`) でも無条件に save すると
 * 同一内容が ref の数だけ複製され、数日で予算が一巡して「保存はするが復元前に消える」
 * 恒常ミス状態になる(#380: 実測 11.1GB / 47 件、Playwright ブラウザ取得が毎回 100 秒超)。
 *
 * 既定ブランチ (main) のキャッシュは全ブランチ・全 PR から復元できるため、
 * **保存を main に限定しても復元ヒット率は落とさずに複製だけを止められる**。
 * 以下はその不変条件を固定する回帰テスト。
 */
describe("Actions cache budget (#380)", () => {
  it("キャッシュを保存するステップは既定ブランチ (main) に限定されている", () => {
    const workflow = readWorkflow();
    const writers: { job: string; name: string; if?: string }[] = [];
    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
      for (const step of definition.steps ?? []) {
        if (!isCacheWritingStep(step)) continue;
        writers.push({ job, name: step.name ?? step.uses ?? "", if: step.if });
      }
    }

    expect(
      writers.length,
      "キャッシュ保存ステップが 1 つも無い(復元専用ではヒットしないため設定ミスの可能性が高い)",
    ).toBeGreaterThan(0);

    for (const writer of writers) {
      expect(
        writer.if ?? "",
        `${writer.job} / ${writer.name}: 保存ステップに main 限定の if が無い(PR ref ごとにキャッシュが複製される)`,
      ).toContain("github.ref == 'refs/heads/main'");
    }
  });

  it("setup-node の内蔵キャッシュ (cache:) を使っていない", () => {
    const workflow = readWorkflow();
    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
      for (const step of definition.steps ?? []) {
        if (!step.uses?.startsWith("actions/setup-node@")) continue;
        expect(
          step.with?.cache,
          `${job}: setup-node の cache: は ref スコープで無条件に save するため使用不可(#380)。actions/cache/restore + main 限定 save を使う`,
        ).toBeUndefined();
      }
    }
  });
});

/**
 * Actions の課金は **job 単位で分に切り上げ**られるため、判定 job + gate job を足す構成は
 * 1 run あたり常に +2 分を上乗せする。本リポジトリの job 時間ではその上乗せがスキップの節約を
 * ほぼ食い潰すので、判定は各 job の先頭 step で行い重い step だけを `if:` で落とす (#491)。
 *
 * この形は「job 自体は常に実行され常に成功を報告する」ことが前提であり、そこが崩れると
 * required status check が永久に pending になる。以下はその前提と、
 * 「重い step が確実にゲートされている」ことを固定する。
 */
describe("変更パスによる実行範囲の絞り込み (#491)", () => {
  const SCOPE_STEP_ID = "scope";

  /** 判定 step を持つべき job と、その `SCOPE_JOB` 値。 */
  const SCOPED_JOBS = { ci: "ci", e2e: "e2e" } as const;

  it.each(Object.entries(SCOPED_JOBS))(
    "%s job は先頭で実行範囲を判定する",
    (jobName, scopeJob) => {
      const steps = readWorkflowFile("ci.yml").jobs?.[jobName]?.steps ?? [];
      const scope = steps.find((step) => step.id === SCOPE_STEP_ID);
      expect(
        scope,
        `${jobName}: id: ${SCOPE_STEP_ID} の step が無い`,
      ).toBeDefined();
      expect(scope?.run).toContain(".github/scripts/verification-scope.mjs");
      expect(
        scope?.env?.SCOPE_JOB,
        `${jobName}: SCOPE_JOB が判定スクリプトへ渡されていない`,
      ).toBe(scopeJob);

      // 判定は checkout 直後でなければ、重い step の前に結果が出ない。
      expect(steps.indexOf(scope as Step)).toBe(1);
    },
  );

  it.each(Object.keys(SCOPED_JOBS))(
    "%s job の checkout は判定に必要な履歴を取得している",
    (jobName) => {
      const steps = readWorkflowFile("ci.yml").jobs?.[jobName]?.steps ?? [];
      const checkout = steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      // 浅い clone だと base..head を diff できず、判定が常にフェイルオープンになる。
      // 「安全側に倒れるので気づけない」ため、設定側で固定する。
      expect(
        checkout?.with?.["fetch-depth"],
        `${jobName}: fetch-depth: 0 が無いと merge-base を計算できず判定が常に無効化される`,
      ).toBe(0);
    },
  );

  /**
   * ゲートし忘れた重い step は「常に実行される」= 削減がそのまま無効化される。
   * しかも CI は緑のままなので気づけない。実行コマンドを列挙して漏れを検出する。
   */
  /**
   * 検証コマンドと導入コマンドは**別のゲート**で落とさなければならない。
   * 片方でも受け入れる緩い検査だと、例えば `pnpm test` が `setup` ゲートに化けても
   * 素通りし、マージ後 push で毎回テストが走って削減が静かに消える。
   */
  it.each([
    [
      "verify",
      [
        "pnpm lint",
        "pnpm typecheck",
        "pnpm check",
        "pnpm test",
        "pnpm knip",
        "pnpm depcruise",
        "pnpm build",
        "pnpm test:e2e",
        "pnpm test:e2e:prod:prebuilt",
      ],
    ],
    ["setup", ["pnpm store path"]],
  ] as const)(
    "%s でゲートすべきコマンドが正しいゲートを持つ",
    (gate, commands) => {
      const workflow = readWorkflowFile("ci.yml");
      const seen: string[] = [];
      for (const [jobName, definition] of Object.entries(workflow.jobs ?? {})) {
        for (const step of definition.steps ?? []) {
          const run = step.run?.trim();
          if (!run) continue;
          const matched = commands.find((command) =>
            // `$(pnpm store path --silent)` のようにコマンド置換の中にあっても拾えるよう、
            // 前後の境界は空白だけでなく括弧・引用符も許す。
            new RegExp(
              `(^|[\\s("'])${command.replace(/\s+/g, "\\s+")}([\\s)"']|$)`,
              "m",
            ).test(run),
          );
          if (!matched) continue;
          seen.push(matched);
          expect(
            step.if ?? "",
            `${jobName} / ${step.name}: 「${matched}」は ${gate} でゲートされていなければならない`,
          ).toContain(`steps.scope.outputs.${gate} == 'true'`);
        }
      }
      // 走査が壊れて 0 件になれば、この検査は何も守らない。
      expect(
        seen.length,
        `${gate}: 対象コマンドを 1 つも検出できなかった`,
      ).toBeGreaterThan(0);
    },
  );

  /**
   * 依存とブラウザの導入は「検証する」か「キャッシュがまだ無い」ときだけ必要。
   * マージ後 push でキャッシュが既にヒットしている場合、入れても使わず保存もしないため
   * 丸ごと無駄になる (#491)。
   */
  it("導入コマンドはキャッシュミス時のみ実行される", () => {
    const workflow = readWorkflowFile("ci.yml");
    let checked = 0;
    for (const [jobName, definition] of Object.entries(workflow.jobs ?? {})) {
      for (const step of definition.steps ?? []) {
        const run = step.run?.trim();
        if (!run) continue;
        if (!/pnpm install|playwright install/.test(run)) continue;
        checked += 1;
        expect(
          step.if ?? "",
          `${jobName} / ${step.name}: 検証しない run では cache-hit のときに省略されるべき`,
        ).toMatch(
          /steps\.scope\.outputs\.verify == 'true' \|\| steps\.[\w-]+\.outputs\.cache-hit != 'true'/,
        );
      }
    }
    expect(
      checked,
      "導入コマンドを 1 つも検出できなかった",
    ).toBeGreaterThanOrEqual(3);
  });

  /**
   * `verify` が false でも `setup` は true になりうる (マージ後 push のキャッシュ投入)。
   * 逆に `setup` が false なら依存が入っていないため `verify` も false でなければならない。
   */
  it("setup を伴わない verify は存在しない", () => {
    for (const job of ["ci", "e2e"] as const) {
      for (const postMergeDuplicate of [false, true]) {
        for (const paths of [
          null,
          [],
          ["docs/README.md"],
          ["src/domain/game/engine.test.ts"],
          ["src/domain/hand/yaku.ts"],
          ["e2e/game.spec.ts"],
        ]) {
          const { setup, verify } = resolveScope({
            job,
            paths,
            postMergeDuplicate,
          });
          if (verify) {
            expect(
              setup,
              `${job}: verify=true なのに setup=false (依存が無い状態で検証コマンドが走る)`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

/**
 * 判定ロジックそのものの契約。ここが緩むと「検証すべき変更を検証しない」に直結する。
 */
describe("verification-scope の分類契約 (#491)", () => {
  it.each([
    // [説明, パス, 期待する分類]
    ["仕様書", "documents/spec/game-flow.md", "documentation"],
    ["ルートの md", "CLAUDE.md", "documentation"],
    ["単体テスト", "src/domain/game/engine.test.ts", "unit-test"],
    ["コンポーネントテスト", "src/components/game/Board.test.tsx", "unit-test"],
    [
      "テスト専用 fixture",
      "src/domain/game/__testing__/engine-fixtures.ts",
      "unit-test",
    ],
    ["オラクル", "src/domain/hand/__oracle__/generator.ts", "unit-test"],
    ["E2E spec", "e2e/game.spec.ts", "e2e-asset"],
    ["Playwright 設定", "playwright.config.ts", "e2e-asset"],
    ["出荷コード", "src/domain/hand/yaku.ts", "code"],
    // public/ は定義上そのまま配信される出荷ツリー。拡張子が .md でも文書ではない。
    ["public 配下の md", "public/tiles/CREDITS.md", "code"],
    ["ワークフロー", ".github/workflows/ci.yml", "code"],
    ["ロックファイル", "pnpm-lock.yaml", "code"],
  ])("%s は %s → %s", (_label, path, expected) => {
    expect(classifyPath(path)).toBe(expected);
  });

  /**
   * `e2e/**` の spec は `*.spec.ts` にも一致するため、判定順を間違えると
   * 「E2E spec を変更したのに E2E が走らない」という最悪の取りこぼしになる。
   */
  it("E2E spec は単体テストとして扱われない", () => {
    expect(
      resolveScope({
        job: "e2e",
        paths: ["e2e/game.spec.ts"],
        postMergeDuplicate: false,
      }).verify,
    ).toBe(true);
  });

  it.each([
    ["変更を特定できない", null],
    ["変更が空", []],
  ])("%s ときは全検証を実行する(フェイルオープン)", (_label, paths) => {
    for (const job of ["ci", "e2e"] as const) {
      expect(
        resolveScope({ job, paths, postMergeDuplicate: false }).verify,
        `${job}: 判定不能をスキップ扱いにすると検証の穴が静かに開く`,
      ).toBe(true);
    }
  });

  it("文書のみの変更は ci も e2e も検証しない", () => {
    const paths = ["documents/spec/game-flow.md", "CLAUDE.md"];
    for (const job of ["ci", "e2e"] as const) {
      expect(
        resolveScope({ job, paths, postMergeDuplicate: false }).verify,
      ).toBe(false);
    }
  });

  it("単体テストのみの変更は ci は検証し e2e は検証しない", () => {
    const paths = [
      "src/domain/game/engine.test.ts",
      "documents/spec/game-flow.md",
    ];
    expect(
      resolveScope({ job: "ci", paths, postMergeDuplicate: false }).verify,
    ).toBe(true);
    expect(
      resolveScope({ job: "e2e", paths, postMergeDuplicate: false }).verify,
    ).toBe(false);
  });

  it("マージ後 push は検証せずキャッシュ投入だけを行う", () => {
    for (const job of ["ci", "e2e"] as const) {
      const scope = resolveScope({
        job,
        paths: ["src/domain/hand/yaku.ts"],
        postMergeDuplicate: true,
      });
      expect(scope.verify, `${job}: 同一ツリーは PR 側で検証済み`).toBe(false);
      expect(
        scope.setup,
        `${job}: main が導入を止めると全 PR がキャッシュを復元できなくなる (#380)`,
      ).toBe(true);
    }
  });
});

/**
 * **この検査が本命の安全網**。
 *
 * `docs/**` や `*.md` を一律で「文書」と見なすと、`docs/四兄弟麻雀ルール.md` のように
 * **テストが内容を読んでいるファイル**まで検証対象から外れる。CI は緑のままなので、
 * 「ルール文書を書き換えたのに /rules との整合検査が走らなかった」という失敗は
 * 誰にも気づかれない。除外一覧が実態と一致していることを機械的に固定する。
 */
describe("文書スキップがテストの前提を壊していない (#491)", () => {
  /**
   * テストコードが**どう解決しているかに関係なく**、文字列リテラルとして現れる
   * 「文書扱いになりうるリポジトリ相対パス」を集める。
   *
   * 解決方法で絞ると идиом の取りこぼしが起きる: 本リポジトリには
   * `resolve(process.cwd(), "…")` だけでなく `new URL("…", import.meta.url)` や
   * 独自ヘルパ (`repoPath("…")`) で読むテストが実在し、そのどれかが将来 `.md` を
   * 読み始めた瞬間に「守っているつもりの検査」が黙って素通りする。
   * したがって解決方法を問わず `.md` / `docs/` / `documents/` リテラルを全部拾う。
   */
  function documentaryLiteralsInTests(): string[] {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        // このファイル自身は分類テストの**入力データ**として `.md` リテラルを並べるため
        // 除外する。判定対象はあくまで「他のテストが参照している文書」。
        if (entry.name === "ci-workflow.test.ts") continue;
        for (const match of readFileSync(path, "utf8").matchAll(
          /"([^"\n]*\.md)"/g,
        )) {
          // 相対指定 (`../../docs/x.md`) はリポジトリ相対へ正規化する。
          found.add(match[1].replace(/^(?:\.\.\/)+/, ""));
        }
      }
    };
    // e2e/ のテストも同じ理由で対象にする。
    for (const root of ["src", "e2e"]) walk(resolve(process.cwd(), root));
    return [...found];
  }

  it("テストが読む文書は文書として黙殺されない", () => {
    const literals = documentaryLiteralsInTests();
    // 走査自体が壊れて 0 件になれば、この検査は何も守らなくなる。
    expect(
      literals.length,
      "テストから .md リテラルを 1 件も抽出できなかった(走査が壊れている)",
    ).toBeGreaterThanOrEqual(2);

    for (const path of literals) {
      expect(
        classifyPath(path),
        `${path}: テストが参照しているのに文書として扱われている。` +
          "この変更だけの PR では CI がスキップされ、検証が静かに失われる。" +
          "verification-scope.mjs の DOCUMENTATION_EXCEPTIONS に追加すること",
      ).not.toBe("documentation");
    }
  });

  it("除外一覧に不要な項目が残っていない", () => {
    const literals = new Set(documentaryLiteralsInTests());
    for (const path of DOCUMENTATION_EXCEPTIONS) {
      expect(
        literals.has(path),
        `${path}: どのテストからも参照されていない。除外は検証コスト増に直結するため、不要になったら消す`,
      ).toBe(true);
    }
  });
});

/**
 * Playwright 既定の `"50%"` は 2 コア runner で 1 worker = 完全な直列実行になる。
 * これは「遅いだけで緑」なので、設定が戻っても誰も気づけない。CI 実測で
 * 266s → 243s (1.09 倍) の改善があるため、明示指定が消えないよう固定する (#491)。
 */
describe("CI での Playwright 並列度 (#491)", () => {
  /** `CI` の有無で設定が変わるため、環境変数を差し替えて評価し直す。 */
  async function configWith(ci: string | undefined) {
    if (ci === undefined) vi.stubEnv("CI", "");
    else vi.stubEnv("CI", ci);
    vi.resetModules();
    return (await import("../../playwright.config")).default;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("CI では worker 数を明示している", async () => {
    const config = await configWith("1");
    expect(
      config.workers,
      "CI で workers を明示しないと Playwright 既定の 50% により 2 コア runner では 1 worker になる",
    ).toBeDefined();
    // `"50%"` は既定と同じ = 直列に戻る。パーセント指定なら 100% 以上でなければ意味がない。
    const workers = config.workers;
    if (typeof workers === "string") {
      const percent = Number.parseInt(workers, 10);
      expect(
        percent,
        `workers: "${workers}" は既定 (50%) 以下で、直列実行に逆戻りする`,
      ).toBeGreaterThanOrEqual(100);
    } else {
      expect(workers).toBeGreaterThanOrEqual(2);
    }
  });

  it("ローカルでは Playwright の既定に委ねる", async () => {
    const config = await configWith(undefined);
    expect(
      config.workers,
      "ローカルはマシンによってコア数が異なるため、既定 (50%) に任せる",
    ).toBeUndefined();
  });

  it("並列前提の fullyParallel が維持されている", () => {
    expect(
      playwrightConfig.fullyParallel,
      "fullyParallel を落とすと worker を増やしても直列に戻る",
    ).toBe(true);
  });
});

/**
 * タイムアウトの無い job は、ハングすると既定の 6 時間まで runner を占有し、
 * その間ずっと課金される。全ワークフローの全 job に上限があることを固定する (#491)。
 */
describe("全ワークフローの job にタイムアウトがある (#491)", () => {
  it("timeout-minutes を宣言していない job が無い", () => {
    const filenames = workflowFilenames();
    expect(filenames.length).toBeGreaterThanOrEqual(4);

    for (const filename of filenames) {
      const jobs = readWorkflowFile(filename).jobs ?? {};
      expect(
        Object.keys(jobs).length,
        `${filename}: job を 1 つも解釈できていない`,
      ).toBeGreaterThan(0);
      for (const [jobName, definition] of Object.entries(jobs)) {
        const timeout = definition["timeout-minutes"];
        expect(
          timeout,
          `${filename} / ${jobName}: timeout-minutes が無い(ハング時に既定の6時間 runner を占有する)`,
        ).toBeTypeOf("number");
        expect(timeout).toBeGreaterThan(0);
        expect(timeout).toBeLessThanOrEqual(60);
      }
    }
  });
});

/**
 * リリースは中断すると「タグはあるが Release が無い」中途半端な状態を残すため、
 * CI と違い進行中の実行をキャンセルしてはならない (#491)。
 */
describe("release ワークフローの多重起動制御 (#491)", () => {
  it("タグ単位で直列化し、進行中はキャンセルしない", () => {
    const concurrency = readWorkflowFile("release.yml").concurrency;
    expect(concurrency?.group, "release に concurrency が無い").toContain(
      "github.ref",
    );
    expect(
      concurrency?.["cancel-in-progress"],
      "Release 作成を中断するとタグと Release が乖離する",
    ).toBe(false);
  });
});

/**
 * 変更ファイルの取得は「この PR 自身が持ち込んだ変更」でなければならない。
 *
 * 2 点リーダ (`base..head`) は base 側が進むとその変更まで差分に現れる。本リポジトリは
 * 複数レーンが並行して main へマージするため、2 点だと**文書のみの PR でも他レーンが
 * 変更した出荷コードが混ざり、スキップ判定がほぼ発火しなくなる**。CI は緑のまま
 * 削減効果だけが静かに消えるので、実際の git リポジトリを作って固定する。
 */
describe("変更ファイルの取得範囲 (#491)", () => {
  /** base 側が独自に進んだ状況を再現した一時リポジトリを作る。 */
  function createRepository(): {
    dir: string;
    baseTip: string;
    head: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), "scope-diff-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

    git("init", "--quiet", "--initial-branch", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");

    mkdirSync(join(dir, "docs"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "docs/note.md"), "base\n");
    writeFileSync(join(dir, "src/app.ts"), "base\n");
    git("add", "-A");
    git("commit", "--quiet", "-m", "base");

    // 機能ブランチ: 文書だけを変更する。
    git("checkout", "--quiet", "-b", "feature");
    writeFileSync(join(dir, "docs/note.md"), "changed\n");
    git("commit", "--quiet", "-am", "docs only");
    const head = git("rev-parse", "HEAD");

    // base 側が別レーンのマージで進み、出荷コードが変わる。
    git("checkout", "--quiet", "main");
    writeFileSync(join(dir, "src/app.ts"), "advanced by another lane\n");
    git("commit", "--quiet", "-am", "unrelated code change on base");
    const baseTip = git("rev-parse", "HEAD");

    return { dir, baseTip, head };
  }

  it("base が進んでも、その変更を自分の差分に含めない", () => {
    const { dir, baseTip, head } = createRepository();
    const previous = process.cwd();
    try {
      process.chdir(dir);
      const paths = changedPaths(baseTip, head);
      expect(
        paths,
        "merge-base からの差分 (3 点リーダ) でなければ base 側の変更が混ざる",
      ).toEqual(["docs/note.md"]);

      // 判定結果としても「文書のみ」に落ちること。
      expect(
        resolveScope({ job: "ci", paths, postMergeDuplicate: false }).verify,
        "base 側の出荷コード変更が混ざると、文書のみの PR でもスキップが発火しない",
      ).toBe(false);
    } finally {
      process.chdir(previous);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * git は既定でリネームを検出し、`--name-only` は**移動先のパスだけ**を出力する。
   * そのため `git mv src/foo.ts docs/foo.md` が「文書のみの変更」に化け、
   * **出荷コードが 1 本消えているのに lint も typecheck も test も build も走らないまま
   * required check が緑になる**。フェイルオープンでも救えない (分類は成功していて、
   * ただ間違っているため)。`--no-renames` で移動元も出力させる。
   */
  it("出荷コードを文書へ移動しても、移動元を見落とさない", () => {
    const dir = mkdtempSync(join(tmpdir(), "scope-rename-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    const previous = process.cwd();
    try {
      git("init", "--quiet", "--initial-branch", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "test");
      git("config", "commit.gpgsign", "false");
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "docs"));
      writeFileSync(join(dir, "src/ships.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "docs/note.md"), "note\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      const base = git("rev-parse", "HEAD");

      git("checkout", "--quiet", "-b", "feature");
      git("mv", "src/ships.ts", "docs/ships.md");
      git("commit", "--quiet", "-m", "move shipped module into docs");
      const head = git("rev-parse", "HEAD");

      process.chdir(dir);
      const paths = changedPaths(base, head);
      expect(
        paths,
        "リネーム検出を切らないと移動元 (src/ships.ts) が差分から消える",
      ).toContain("src/ships.ts");
      expect(
        resolveScope({ job: "ci", paths, postMergeDuplicate: false }).verify,
        "出荷コードが消えているのに文書のみと判定され、必須ゲートが何も検証せず緑になる",
      ).toBe(true);
    } finally {
      process.chdir(previous);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["base が全 0 (新規ブランチ)", "0".repeat(40), "a".repeat(40)],
    ["SHA ではない値", "HEAD~1", "HEAD"],
    ["未定義", undefined, undefined],
  ])(
    "%s のときは null を返してフェイルオープンさせる",
    (_label, base, head) => {
      expect(changedPaths(base, head)).toBeNull();
    },
  );

  it("存在しないリビジョンでも例外にせず null を返す", () => {
    // git が失敗しても判定 step 全体を落とさない (落ちると job が赤くなる)。
    expect(changedPaths("0".repeat(39) + "1", "1".repeat(40))).toBeNull();
  });
});
