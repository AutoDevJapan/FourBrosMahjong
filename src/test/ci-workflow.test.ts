import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  uses?: string;
  run?: string;
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
 * `actions/cache` で `~/.cache/ms-playwright` を保存する各ステップと、
 * 同じ job でその後に走る `playwright install` が要求するブラウザ集合を対応付ける。
 *
 * 前提(崩れた場合は下の件数アサーションで落ちる): Playwright を使うのは `ci.yml` のみ、
 * キャッシュは `actions/cache@` の一体型ステップ(`restore@`/`save@` 分割ではない)、
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
      if (!step.uses?.startsWith("actions/cache@")) return;
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
