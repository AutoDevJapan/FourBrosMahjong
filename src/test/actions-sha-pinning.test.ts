import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOW_DIR = resolve(process.cwd(), ".github/workflows");
const EXPECTED_WORKFLOWS = [
  "ci.yml",
  "gitleaks-version-check.yml",
  "gitleaks.yml",
  "release.yml",
] as const;
const FULL_COMMIT_SHA_REFERENCE = /^[^@\s]+@[0-9a-f]{40}$/;
const DOCKER_DIGEST_REFERENCE = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

type UsesReference = {
  path: string;
  value: unknown;
};

function workflowFilenames(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .sort();
}

function collectUses(value: unknown, path: string[] = []): UsesReference[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectUses(entry, [...path, String(index)]),
    );
  }
  if (value === null || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = [...path, key];
    if (key === "uses") {
      return [{ path: childPath.join("."), value: child }];
    }
    return collectUses(child, childPath);
  });
}

function isImmutableUses(reference: string): boolean {
  // Repository内のaction/reusable workflowは同じcommitから読み込まれるため、
  // GitHubのSHA固定必須policyでも許可される明示的な例外とする。
  if (reference.startsWith("./")) return true;
  return reference.startsWith("docker://")
    ? DOCKER_DIGEST_REFERENCE.test(reference)
    : FULL_COMMIT_SHA_REFERENCE.test(reference);
}

describe("GitHub Actions SHA pinning policy (#663)", () => {
  it("CI・gitleaks・release・version updaterを含む全workflowを検査対象にする", () => {
    expect(workflowFilenames()).toEqual(
      expect.arrayContaining([...EXPECTED_WORKFLOWS]),
    );
  });

  it("外部usesをimmutableな完全SHA、Dockerをdigestで固定する", () => {
    const violations: string[] = [];
    let externalReferenceCount = 0;

    for (const filename of workflowFilenames()) {
      const workflow = parse(
        readFileSync(resolve(WORKFLOW_DIR, filename), "utf8"),
      ) as unknown;
      const references = collectUses(workflow);

      for (const reference of references) {
        if (typeof reference.value !== "string") {
          violations.push(
            `${filename}:${reference.path}: uses must be a string`,
          );
          continue;
        }

        if (reference.value.startsWith("./")) continue;

        externalReferenceCount += 1;
        if (!isImmutableUses(reference.value)) {
          violations.push(`${filename}:${reference.path}: ${reference.value}`);
        }
      }
    }

    expect(externalReferenceCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("local参照を例外とし、外部のtag・branch・式参照を拒否する", () => {
    const sha = "a".repeat(40);
    const digest = "b".repeat(64);

    expect(isImmutableUses("./.github/actions/setup")).toBe(true);
    expect(isImmutableUses("./.github/workflows/reusable.yml")).toBe(true);
    expect(isImmutableUses(`actions/checkout@${sha}`)).toBe(true);
    expect(
      isImmutableUses(`owner/repo/.github/workflows/reusable.yml@${sha}`),
    ).toBe(true);
    expect(isImmutableUses(`docker://alpine@sha256:${digest}`)).toBe(true);

    expect(isImmutableUses("actions/checkout@v7")).toBe(false);
    expect(
      isImmutableUses("owner/repo/.github/workflows/reusable.yml@main"),
    ).toBe(false);
    expect(isImmutableUses("actions/checkout@${{ github.sha }}")).toBe(false);
    expect(isImmutableUses("docker://alpine:latest")).toBe(false);
  });
});
