import { readdirSync } from "node:fs";
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
});
