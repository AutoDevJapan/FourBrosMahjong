import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

/**
 * Vitest の「静かな失敗」を 2 段で塞ぐ回帰テスト(#381)。
 *
 * 1. `--passWithNoTests` はテストを 1 件も収集しなくても exit 0 にする。`include` グロブの破損・
 *    ディレクトリ移動・プロジェクト定義の typo でテストが丸ごと消えても CI は green のまま通る。
 *    `package.json` の vitest スクリプトから同フラグを排除したことを固定する。
 * 2. ただし **フラグを外すだけでは「片方のプロジェクトだけ 0 件」は検出できない**(実測: component の
 *    `include` だけを壊した設定でも unit の 775 件が通るため run 全体は exit 0)。Vitest がエラーに
 *    するのは run 全体で 1 ファイルも収集できなかった場合のみ。そこで各プロジェクトの `include` が
 *    実在ファイルを指していることを個別に検査する。
 */

/** 各プロジェクトが最低限収集すべきテストファイル数。本検査の目的は「0 件を失敗にする」こと。 */
const MIN_TEST_FILES_PER_PROJECT = 1;

/** `package.json` の `scripts` のうち Vitest を起動するもの。 */
const VITEST_SCRIPTS = [
  "test",
  "test:unit",
  "test:component",
  "test:watch",
  "test:coverage",
] as const;

type ProjectConfig = {
  test?: { name?: string; include?: string[]; pool?: string };
};

function packageScripts(): Record<string, string> {
  const source = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
  return (
    (JSON.parse(source) as { scripts?: Record<string, string> }).scripts ?? {}
  );
}

function projects(): ProjectConfig[] {
  return (config.test?.projects ?? []) as ProjectConfig[];
}

/**
 * `src/**\/*.{test,spec}.ts` 形式の include グロブを正規表現へ変換する。
 *
 * 現状使うのはこの形式のみ。想定外の形は解釈せず落として、新しいパターンを足したときに
 * この検査を更新し忘れないようにする(`playwright-projects.test.ts` と同じ方針)。
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includeToRegExp(include: string): RegExp {
  expect(
    /^[\w./*{},-]+$/.test(include),
    `未対応の include 形式: ${include}`,
  ).toBe(true);

  let pattern = "";
  let cursor = 0;
  while (cursor < include.length) {
    if (include.startsWith("**/", cursor)) {
      pattern += "(?:[^/]+/)*";
      cursor += 3;
      continue;
    }
    const char = include[cursor];
    if (char === "*") {
      pattern += "[^/]*";
      cursor += 1;
      continue;
    }
    if (char === "{") {
      const end = include.indexOf("}", cursor);
      expect(end, `未対応の include 形式: ${include}`).toBeGreaterThan(cursor);
      const alternatives = include.slice(cursor + 1, end).split(",");
      pattern += `(?:${alternatives.map(escapeRegExp).join("|")})`;
      cursor = end + 1;
      continue;
    }
    pattern += escapeRegExp(char);
    cursor += 1;
  }
  return new RegExp(`^${pattern}$`);
}

/** リポジトリ直下からの相対パスで全ファイルを列挙する(`src/` 配下のみ対象)。 */
function repoFiles(): string[] {
  return readdirSync(resolve(process.cwd(), "src"), {
    recursive: true,
    encoding: "utf8",
  }).map((entry) => `src/${entry.replaceAll("\\", "/")}`);
}

describe("Vitest がテスト0件収集を成功として通さない (#381)", () => {
  it("vitest スクリプトが --passWithNoTests を使っていない", () => {
    const scripts = packageScripts();
    for (const name of VITEST_SCRIPTS) {
      const command = scripts[name];
      expect(command, `package.json に ${name} スクリプトが無い`).toBeTypeOf(
        "string",
      );
      expect(
        command,
        `${name}: --passWithNoTests はテスト0件収集を exit 0 にするため使用不可`,
      ).not.toContain("--passWithNoTests");
    }
  });

  it("統合testはproject間のCPU競合を避けるworker上限を持つ", () => {
    const command = packageScripts().test;
    expect(
      command,
      "test: unit/componentのmulti-project実行は既定並列だと重いテストを競合でtimeoutさせるため、統合runはworkerを1に固定する",
    ).toContain("--maxWorkers=1");

    const component = projects().find(
      (project) => project.test?.name === "component",
    );
    expect(
      component?.test?.pool,
      "component: 3 worktree負荷下のfork起動timeoutを避けるためthreads poolを固定する",
    ).toBe("threads");
  });

  it("package.json の --project 名が vitest.config.ts のプロジェクト名と一致する", () => {
    const scripts = packageScripts();
    const defined = projects().map((project) => project.test?.name);
    expect(defined.length).toBeGreaterThanOrEqual(2);

    for (const name of VITEST_SCRIPTS) {
      const matched = /--project\s+(\S+)/.exec(scripts[name] ?? "");
      if (matched === null) continue;
      expect(
        defined,
        `${name}: --project ${matched[1]} が vitest.config.ts に定義されていない`,
      ).toContain(matched[1]);
    }
  });

  it("各プロジェクトの include が実在するテストファイルを指す", () => {
    const files = repoFiles();
    for (const project of projects()) {
      const name = project.test?.name ?? "(no name)";
      const include = project.test?.include ?? [];
      expect(include.length, `${name}: include が空`).toBeGreaterThanOrEqual(1);

      const patterns = include.map(includeToRegExp);
      const matched = files.filter((file) =>
        patterns.some((pattern) => pattern.test(file)),
      );
      expect(
        matched.length,
        `${name}: include ${JSON.stringify(include)} に一致するテストファイルが無い(このプロジェクトだけ 0 件でも run 全体は exit 0 になるため個別に検査する)`,
      ).toBeGreaterThanOrEqual(MIN_TEST_FILES_PER_PROJECT);
    }
  });
});
