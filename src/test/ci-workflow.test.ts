import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

type Workflow = {
  jobs?: Record<string, { "timeout-minutes"?: unknown; steps?: Step[] }>;
};

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
