import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";

/**
 * Playwright はプロジェクトの `testMatch` が 1 件も一致しなくても警告を出さず exit 0 になる。
 * spec のリネーム/移動でブラウザ限定の回帰が静かに消えるのを防ぐため、`testMatch` を持つ
 * 全プロジェクトが実在の spec を指していることを固定する。
 */
const E2E_DIR = resolve(process.cwd(), "e2e");

function specBasenames(): string[] {
  return readdirSync(E2E_DIR, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".spec.ts"))
    .map((entry) => entry.replace(/^.*[/\\]/, ""));
}

/**
 * 現状使うのは `**\/<ファイル名>` 形式のみ。想定外の形は解釈せず落として、
 * 新しいパターンを足したときにこの検査を更新し忘れないようにする。
 */
function matchedSpecBasename(testMatch: unknown): string {
  expect(
    testMatch,
    "testMatch は `**/<ファイル名>.spec.ts` 形式のみ対応する",
  ).toBeTypeOf("string");
  const matched = /^\*\*\/([\w.-]+\.spec\.ts)$/.exec(testMatch as string);
  expect(
    matched,
    `未対応の testMatch 形式: ${String(testMatch)}`,
  ).not.toBeNull();
  return (matched as RegExpExecArray)[1];
}

describe("Playwright projects", () => {
  it("testMatch を持つプロジェクトは実在する spec を指す", () => {
    const scoped = (config.projects ?? []).filter(
      (project) => project.testMatch !== undefined,
    );
    expect(scoped.length).toBeGreaterThanOrEqual(1);

    const available = specBasenames();
    for (const project of scoped) {
      const basename = matchedSpecBasename(project.testMatch);
      expect(
        available,
        `${project.name}: ${basename} が e2e/ に存在しない`,
      ).toContain(basename);
    }
  });

  it("WebKit のモーダル復帰回帰(#369)が失われていない", () => {
    const webkit = (config.projects ?? []).find(
      (project) => project.name === "webkit-modal-focus",
    );
    expect(webkit, "webkit-modal-focus プロジェクトが必要").toBeDefined();
    expect(matchedSpecBasename(webkit?.testMatch)).toBe("modal-focus.spec.ts");
  });

  /**
   * README がローカル導入手順から必要ブラウザを 1 つでも落とすと、その手順どおりに環境を
   * 用意した開発者の `pnpm test:e2e` が「実行ファイルが見つからない」で失敗する(#383 の実害)。
   * `playwright.config.ts` にプロジェクトを足したとき README の更新を忘れないよう固定する。
   */
  it("README のインストール手順が全プロジェクトのブラウザを網羅している", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    // 散文中の言及ではなく、コードブロック内の実行可能なコマンド行だけを見る。
    const installCommands = readme
      .split("\n")
      .filter((line) => /^\s*pnpm exec playwright install\b/.test(line));
    expect(
      installCommands.length,
      "README に `pnpm exec playwright install …` のコマンド行が無い",
    ).toBeGreaterThanOrEqual(1);

    const required = new Set(
      (config.projects ?? []).map(
        (project) =>
          (project.use as { defaultBrowserType?: string } | undefined)
            ?.defaultBrowserType,
      ),
    );
    expect(
      [...required].every((browser) => typeof browser === "string"),
      "プロジェクトの use から defaultBrowserType を解決できない",
    ).toBe(true);

    for (const browser of required) {
      expect(
        installCommands.some((line) => line.includes(browser as string)),
        `README の playwright install 手順に ${browser} が無い(その手順で用意した環境は pnpm test:e2e が失敗する)`,
      ).toBe(true);
    }
  });
});
