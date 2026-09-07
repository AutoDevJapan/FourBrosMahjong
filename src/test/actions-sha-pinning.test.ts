import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPOSITORY_ROOT = process.cwd();
const EXPECTED_WORKFLOWS = [
  "ci.yml",
  "gitleaks-version-bump.yml",
  "gitleaks-version-check.yml",
  "gitleaks.yml",
  "release.yml",
] as const;
const FULL_COMMIT_SHA_REFERENCE = /^[^@\s]+@[0-9a-f]{40}$/;
const DOCKER_DIGEST_REFERENCE = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

type UsesReference = {
  kind: "job" | "step";
  path: string;
  trustedWorkspace?: boolean;
  value: unknown;
};

type AuditResult = {
  externalReferenceCount: number;
  localReferenceCount: number;
  violations: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function workflowFilenames(repositoryRoot: string): string[] {
  return readdirSync(resolve(repositoryRoot, ".github/workflows"))
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .sort();
}

function isTrustedCheckout(step: Record<string, unknown>): boolean {
  if (
    typeof step.uses !== "string" ||
    !/^actions\/checkout@[0-9a-f]{40}$/.test(step.uses)
  ) {
    return false;
  }
  const checkoutWith = isRecord(step.with) ? step.with : {};
  if (
    checkoutWith.repository !== undefined ||
    checkoutWith.path !== undefined
  ) {
    return false;
  }
  const checkoutRef = checkoutWith.ref;
  return checkoutRef === undefined || checkoutRef === "${{ github.sha }}";
}

/** GitHubのworkflow schema上、実行可能な `uses` が置ける位置だけを返す。 */
function collectWorkflowUses(workflow: unknown): UsesReference[] {
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) return [];

  return Object.entries(workflow.jobs).flatMap(([jobName, value]) => {
    if (!isRecord(value)) return [];
    const references: UsesReference[] = [];
    if (Object.hasOwn(value, "uses")) {
      references.push({
        kind: "job",
        path: `jobs.${jobName}.uses`,
        value: value.uses,
      });
    }
    if (!Array.isArray(value.steps)) return references;

    let trustedWorkspace = false;
    value.steps.forEach((step, index) => {
      if (!isRecord(step)) return;
      if (
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/checkout@")
      ) {
        trustedWorkspace = isTrustedCheckout(step);
      }
      if (!Object.hasOwn(step, "uses")) return;
      references.push({
        kind: "step",
        path: `jobs.${jobName}.steps.${index}.uses`,
        trustedWorkspace,
        value: step.uses,
      });
    });
    return references;
  });
}

/** Composite Actionのschema上、実行可能な `uses` が置ける位置だけを返す。 */
function collectCompositeActionUses(
  action: unknown,
  trustedWorkspace: boolean,
): UsesReference[] {
  if (!isRecord(action) || !isRecord(action.runs)) return [];
  if (action.runs.using !== "composite" || !Array.isArray(action.runs.steps)) {
    return [];
  }

  let currentTrustedWorkspace = trustedWorkspace;
  return action.runs.steps.flatMap((step, index) => {
    if (!isRecord(step) || !Object.hasOwn(step, "uses")) return [];
    if (
      typeof step.uses === "string" &&
      step.uses.startsWith("actions/checkout@")
    ) {
      currentTrustedWorkspace = isTrustedCheckout(step);
    }
    return [
      {
        kind: "step" as const,
        path: `runs.steps.${index}.uses`,
        trustedWorkspace: currentTrustedWorkspace,
        value: step.uses,
      },
    ];
  });
}

function isImmutableExternalUses(reference: string): boolean {
  return reference.startsWith("docker://")
    ? DOCKER_DIGEST_REFERENCE.test(reference)
    : FULL_COMMIT_SHA_REFERENCE.test(reference);
}

function auditActionReferences(repositoryRoot: string): AuditResult {
  const root = realpathSync(repositoryRoot);
  const workflowDirectory = resolve(root, ".github/workflows");
  const violations: string[] = [];
  const visitedWorkflows = new Set<string>();
  const activeWorkflows = new Set<string>();
  const visitedActions = new Set<string>();
  const activeActions = new Set<string>();
  let externalReferenceCount = 0;
  let localReferenceCount = 0;

  const displayPath = (path: string) =>
    relative(root, path).replaceAll(sep, "/");
  const resolveLocal = (
    sourceFile: string,
    reference: UsesReference,
  ): string | undefined => {
    const requested = resolve(root, String(reference.value));
    const requestedRelative = relative(root, requested);
    if (
      requestedRelative === "" ||
      requestedRelative === ".." ||
      requestedRelative.startsWith(`..${sep}`)
    ) {
      violations.push(
        `${displayPath(sourceFile)}:${reference.path}: local reference escapes repository`,
      );
      return undefined;
    }
    if (!existsSync(requested)) {
      violations.push(
        `${displayPath(sourceFile)}:${reference.path}: local reference does not exist: ${reference.value}`,
      );
      return undefined;
    }

    const target = realpathSync(requested);
    const targetRelative = relative(root, target);
    if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`)) {
      violations.push(
        `${displayPath(sourceFile)}:${reference.path}: local reference resolves outside repository`,
      );
      return undefined;
    }
    return target;
  };

  const inspectWorkflow = (workflowFile: string) => {
    if (!statSync(workflowFile).isFile()) {
      violations.push(
        `${displayPath(workflowFile)}: local reusable workflow must be a file`,
      );
      return;
    }
    if (activeWorkflows.has(workflowFile)) {
      violations.push(`${displayPath(workflowFile)}: local workflow cycle`);
      return;
    }
    if (visitedWorkflows.has(workflowFile)) return;

    activeWorkflows.add(workflowFile);
    try {
      const workflow = parse(readFileSync(workflowFile, "utf8")) as unknown;
      inspectReferences(workflowFile, collectWorkflowUses(workflow));
    } catch (error) {
      violations.push(
        `${displayPath(workflowFile)}: cannot parse workflow: ${String(error)}`,
      );
    } finally {
      activeWorkflows.delete(workflowFile);
      visitedWorkflows.add(workflowFile);
    }
  };

  const inspectAction = (
    actionDirectory: string,
    sourceFile: string,
    sourcePath: string,
    trustedWorkspace: boolean,
  ) => {
    if (!statSync(actionDirectory).isDirectory()) {
      violations.push(
        `${displayPath(sourceFile)}:${sourcePath}: local action must reference a directory`,
      );
      return;
    }
    const manifests = ["action.yml", "action.yaml"]
      .map((filename) => resolve(actionDirectory, filename))
      .filter(existsSync);
    if (manifests.length !== 1) {
      violations.push(
        `${displayPath(sourceFile)}:${sourcePath}: local action must contain exactly one action.yml or action.yaml`,
      );
      return;
    }

    const manifest = realpathSync(manifests[0] as string);
    if (activeActions.has(manifest)) {
      violations.push(`${displayPath(manifest)}: local action cycle`);
      return;
    }
    if (visitedActions.has(manifest)) return;

    activeActions.add(manifest);
    try {
      const action = parse(readFileSync(manifest, "utf8")) as unknown;
      inspectReferences(
        manifest,
        collectCompositeActionUses(action, trustedWorkspace),
      );
    } catch (error) {
      violations.push(
        `${displayPath(manifest)}: cannot parse action manifest: ${String(error)}`,
      );
    } finally {
      activeActions.delete(manifest);
      visitedActions.add(manifest);
    }
  };

  const inspectReferences = (
    sourceFile: string,
    references: UsesReference[],
  ) => {
    for (const reference of references) {
      if (typeof reference.value !== "string") {
        violations.push(
          `${displayPath(sourceFile)}:${reference.path}: uses must be a string`,
        );
        continue;
      }
      if (!reference.value.startsWith("./")) {
        externalReferenceCount += 1;
        if (!isImmutableExternalUses(reference.value)) {
          violations.push(
            `${displayPath(sourceFile)}:${reference.path}: ${reference.value}`,
          );
        }
        continue;
      }

      localReferenceCount += 1;
      if (reference.kind === "step" && reference.trustedWorkspace !== true) {
        violations.push(
          `${displayPath(sourceFile)}:${reference.path}: local action requires a preceding SHA-pinned checkout with no ref override or ref github.sha`,
        );
      }
      const target = resolveLocal(sourceFile, reference);
      if (target === undefined) continue;
      if (reference.kind === "job") inspectWorkflow(target);
      else {
        inspectAction(
          target,
          sourceFile,
          reference.path,
          reference.trustedWorkspace === true,
        );
      }
    }
  };

  for (const filename of workflowFilenames(root)) {
    inspectWorkflow(resolve(workflowDirectory, filename));
  }

  return {
    externalReferenceCount,
    localReferenceCount,
    violations,
  };
}

const temporaryRepositories: string[] = [];

function fixtureRepository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "actions-policy-"));
  temporaryRepositories.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const target = resolve(root, path);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

afterEach(() => {
  while (temporaryRepositories.length > 0) {
    rmSync(temporaryRepositories.pop() as string, { recursive: true });
  }
});

describe("GitHub Actions SHA pinning policy (#663)", () => {
  it("CI・gitleaks・release・version updaterの全外部参照を完全SHAで固定する", () => {
    // Keep the inventory explicit so a newly added workflow cannot silently
    // bypass the reviewed #663 coverage. Adding a workflow must update this
    // list and its expected reference count in the same change.
    expect(workflowFilenames(REPOSITORY_ROOT)).toEqual([...EXPECTED_WORKFLOWS]);
    expect(auditActionReferences(REPOSITORY_ROOT)).toEqual({
      externalReferenceCount: 20,
      localReferenceCount: 0,
      violations: [],
    });
  });

  it("env・with・コメント・block string内のusesを実行参照と誤認しない", () => {
    const sha = "a".repeat(40);
    const digest = "b".repeat(64);
    const root = fixtureRepository({
      ".github/workflows/fixture.yml": `
jobs:
  verify:
    env:
      uses: actions/env-only@main
    steps:
      - name: Fixture
        uses: actions/checkout@${sha}
        with:
          uses: actions/input-only@v1
        env:
          uses: actions/step-env-only@v1
      - run: |
          # uses: actions/comment-only@v1
          echo "uses: actions/block-string-only@v1"
      - uses: docker://alpine@sha256:${digest}
`,
    });

    expect(auditActionReferences(root)).toEqual({
      externalReferenceCount: 2,
      localReferenceCount: 0,
      violations: [],
    });
  });

  it("local reusable workflowを再帰走査して外部参照を検査する", () => {
    const root = fixtureRepository({
      ".github/workflows/caller.yml": `
jobs:
  call:
    uses: ./.github/workflows/reusable.yml
`,
      ".github/workflows/reusable.yml": `
on:
  workflow_call:
jobs:
  verify:
    steps:
      - uses: actions/setup-node@main
`,
    });

    expect(auditActionReferences(root)).toEqual({
      externalReferenceCount: 1,
      localReferenceCount: 1,
      violations: [
        ".github/workflows/reusable.yml:jobs.verify.steps.0.uses: actions/setup-node@main",
      ],
    });
  });

  it("trusted checkout後のlocal compositeを再帰走査してunpinned参照を拒否する", () => {
    const sha = "a".repeat(40);
    const root = fixtureRepository({
      ".github/workflows/fixture.yml": `
jobs:
  verify:
    steps:
      - uses: actions/checkout@${sha}
      - uses: ./.github/actions/outer
`,
      ".github/actions/outer/action.yml": `
runs:
  using: composite
  steps:
    - uses: ./.github/actions/inner
`,
      ".github/actions/inner/action.yaml": `
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v7
`,
    });

    expect(auditActionReferences(root)).toMatchObject({
      externalReferenceCount: 2,
      localReferenceCount: 2,
      violations: [
        ".github/actions/inner/action.yaml:runs.steps.0.uses: actions/setup-node@v7",
      ],
    });
  });

  it("untrusted ref checkout・存在しないlocal action・循環をfail closedにする", () => {
    const sha = "a".repeat(40);
    const untrusted = fixtureRepository({
      ".github/workflows/fixture.yml": `
jobs:
  verify:
    steps:
      - uses: actions/checkout@${sha}
        with:
          ref: \${{ github.event.inputs.ref }}
      - uses: ./.github/actions/example
`,
      ".github/actions/example/action.yml": `
runs:
  using: composite
  steps: []
`,
    });
    expect(auditActionReferences(untrusted).violations).toEqual([
      ".github/workflows/fixture.yml:jobs.verify.steps.1.uses: local action requires a preceding SHA-pinned checkout with no ref override or ref github.sha",
    ]);

    const missing = fixtureRepository({
      ".github/workflows/fixture.yml": `
jobs:
  verify:
    steps:
      - uses: actions/checkout@${sha}
      - uses: ./.github/actions/missing
`,
    });
    expect(auditActionReferences(missing).violations).toEqual([
      ".github/workflows/fixture.yml:jobs.verify.steps.1.uses: local reference does not exist: ./.github/actions/missing",
    ]);

    const cycle = fixtureRepository({
      ".github/workflows/fixture.yml": `
jobs:
  verify:
    steps:
      - uses: actions/checkout@${sha}
      - uses: ./.github/actions/a
`,
      ".github/actions/a/action.yml": `
runs:
  using: composite
  steps:
    - uses: ./.github/actions/b
`,
      ".github/actions/b/action.yml": `
runs:
  using: composite
  steps:
    - uses: ./.github/actions/a
`,
    });
    expect(auditActionReferences(cycle).violations).toEqual([
      ".github/actions/a/action.yml: local action cycle",
    ]);
  });

  it("composite内のuntrusted checkout後のlocal actionを拒否する", () => {
    const sha = "a".repeat(40);
    const root = fixtureRepository({
      ".github/workflows/fixture.yml": `
jobs:
  verify:
    steps:
      - uses: actions/checkout@${sha}
      - uses: ./.github/actions/outer
`,
      ".github/actions/outer/action.yml": `
runs:
  using: composite
  steps:
    - uses: actions/checkout@${sha}
      with:
        ref: \${{ github.event.inputs.ref }}
    - uses: ./.github/actions/inner
`,
      ".github/actions/inner/action.yml": `
runs:
  using: composite
  steps: []
`,
    });

    expect(auditActionReferences(root)).toMatchObject({
      externalReferenceCount: 2,
      localReferenceCount: 2,
      violations: [
        ".github/actions/outer/action.yml:runs.steps.1.uses: local action requires a preceding SHA-pinned checkout with no ref override or ref github.sha",
      ],
    });
  });
});
