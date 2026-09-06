import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const STATUS_INDEXES = [
  "CLAUDE.md",
  "README.md",
  "docs/README.md",
  "documents/spec/README.md",
] as const;

function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function unresolvedQuestionIds(): string[] {
  const questions = readRepositoryFile("質問リスト.md");
  const section = questions.match(
    /^## 未回答 \/ 要確認\s*\n([\s\S]*?)^## 解決済み\s*$/mu,
  )?.[1];

  if (!section) {
    throw new Error("質問リスト.md is missing its unresolved-question section");
  }

  return [...section.matchAll(/^### Q(\d+)\./gmu)].map((match) => match[1]);
}

describe("question status documentation", () => {
  it("keeps unresolved status in the canonical question list", () => {
    const unresolvedIds = unresolvedQuestionIds();

    expect(unresolvedIds.length).toBeGreaterThan(0);

    for (const relativePath of STATUS_INDEXES) {
      const document = readRepositoryFile(relativePath);

      expect(document).toContain("質問リスト.md");
      for (const id of unresolvedIds) {
        expect(document).not.toMatch(new RegExp(`Q${id}(?!\\d)`, "u"));
      }
    }
  });

  it("keeps the screen spec aligned with resolved routing decisions", () => {
    const screenSpec = readRepositoryFile(
      "documents/spec/screen-design-and-routing.md",
    );

    expect(screenSpec).toMatch(/Q9〜Q11.*確定済み/u);
    expect(screenSpec).not.toMatch(/Q9〜Q11.*未確定/u);
  });
});
