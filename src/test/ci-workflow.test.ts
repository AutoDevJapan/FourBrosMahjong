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
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  CHECK_RUN_EVIDENCE_MAX_LOOKUPS,
  CHECK_RUN_EVIDENCE_TIMEOUT_MS,
  changedPaths,
  changedPathsFromApi,
  classifyPath,
  DOCUMENTATION_EXCEPTIONS,
  EVIDENCE_IO_TIMEOUT_MS,
  GITHUB_API_RESPONSE_MAX_BYTES,
  githubApi,
  PRODUCTION_INPUT_PATHS,
  protectedPushBranch,
  resolveChangedPaths,
  resolvePostMergeEvidence,
  resolveScope,
  TEST_INPUT_DIRECTORIES,
  TEST_INPUT_PATHS,
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
  on?: Record<string, unknown>;
  concurrency?: { group?: string; "cancel-in-progress"?: unknown };
  permissions?: Record<string, string>;
  jobs?: Record<
    string,
    {
      name?: string;
      if?: string;
      needs?: string | string[];
      outputs?: Record<string, string>;
      "timeout-minutes"?: unknown;
      container?: { image?: string; options?: string };
      permissions?: Record<string, string>;
      env?: Record<string, string>;
      steps?: Step[];
    }
  >;
};

const WORKFLOW_DIR = resolve(process.cwd(), ".github/workflows");
const E2E_DIR = resolve(process.cwd(), "e2e");

/**
 * #554 の prebuilt production E2E は、配布物でしか見えない差分を優先して検証する。
 * 既存のPWA/状態復元/モーダル回帰に加え、headers・metadata・axe契約を同じ build で走らせる。
 */
const PRODUCTION_E2E_SPECS = [
  "e2e/pwa-offline.spec.ts",
  "e2e/persistence.spec.ts",
  "e2e/modal-focus.spec.ts",
  "e2e/security-headers.spec.ts",
  "e2e/metadata.spec.ts",
  "e2e/a11y.spec.ts",
] as const;

/**
 * production prebuilt の時間・環境依存を意図して含めない spec。
 * これらは通常のdev E2Eで検証し、production側へ追加するときは上の契約を更新する。
 */
const PRODUCTION_E2E_EXCLUDED_SPECS = [
  "e2e/game.spec.ts",
  "e2e/history.spec.ts",
  "e2e/home.spec.ts",
  "e2e/internal-navigation.spec.ts",
  "e2e/mobile-touch-targets.spec.ts",
  "e2e/non-text-contrast.spec.ts",
  "e2e/online-host-controls.spec.ts",
  "e2e/online-host-handoff.spec.ts",
  "e2e/online-room-sharing.spec.ts",
  "e2e/online-lobby.spec.ts",
  "e2e/player-names.spec.ts",
  // resultのproduction/offline parityはpwa-offline.spec.tsが担い、platform別VRTはdev E2Eで行う。
  "e2e/result.spec.ts",
  "e2e/rules-navigation.spec.ts",
  "e2e/unity-display-reference.spec.ts",
  // settingsのproduction/offline parityはpwa-offline.spec.tsが担い、platform別VRTはdev E2Eで行う。
  "e2e/settings.spec.ts",
  // 44px判定ヘルパの許容幅を固定するメタスペック(#1168)。production成果物固有の差分は無い。
  "e2e/touch-target-tolerance.spec.ts",
] as const;

function readPackageJson(): { scripts?: Record<string, string> } {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
}

function e2eSpecPaths(): string[] {
  return readdirSync(E2E_DIR, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".spec.ts"))
    .map((entry) => `e2e/${entry.replaceAll("\\", "/")}`)
    .sort();
}

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

const ALLOWED_WRITE_PERMISSION_JOBS = {
  "gitleaks-version-bump.yml/open-bump-pr": {
    contents: "write",
    "pull-requests": "write",
    actions: "write",
  },
  "release.yml/release": {
    contents: "write",
  },
} as const;

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

type WorkflowRunConclusion = "success" | "failure" | "cancelled" | "timed_out";

type RepositoryPayload = {
  full_name?: string;
};

type WorkflowRunPayload = {
  conclusion?: WorkflowRunConclusion;
  head_branch?: string;
  head_repository?: RepositoryPayload;
};

type WorkflowRunEvent = {
  workflow_run?: WorkflowRunPayload;
  repository?: RepositoryPayload;
};

type WorkflowRunFixture = {
  label: string;
  event?: WorkflowRunEvent;
  compareResult: "success" | "failure" | "skipped";
  needsUpdate: boolean;
  expectedTrigger: boolean;
  expectedCompare: boolean;
  expectedWrite: boolean;
};

const GITLEAKS_REPOSITORY = "AutoDevJapan/FourBrosMahjong";

const WORKFLOW_RUN_FIXTURES: WorkflowRunFixture[] = [
  {
    label: "same-repository main success with an update",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: true,
    expectedWrite: true,
  },
  {
    label: "same-repository main success without an update",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: false,
    expectedTrigger: true,
    expectedCompare: true,
    expectedWrite: false,
  },
  {
    label: "same-repository non-main success",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "feature/actor-controlled",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: false,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "fork main success",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: { full_name: "untrusted-fork/FourBrosMahjong" },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "same-repository main failure",
    event: {
      workflow_run: {
        conclusion: "failure",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "same-repository main cancelled",
    event: {
      workflow_run: {
        conclusion: "cancelled",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "same-repository main timed out",
    event: {
      workflow_run: {
        conclusion: "timed_out",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "workflow_run payload is missing",
    event: {
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: false,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "workflow_run payload is undefined",
    event: {
      workflow_run: undefined,
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: false,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "event payload is undefined",
    event: undefined,
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: false,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "head_repository payload is missing",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "head_repository payload is undefined",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: undefined,
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "repository payload is missing",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "repository payload is undefined",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: undefined,
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "head_branch payload is missing",
    event: {
      workflow_run: {
        conclusion: "success",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: false,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "conclusion payload is undefined",
    event: {
      workflow_run: {
        conclusion: undefined,
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "success",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: false,
    expectedWrite: false,
  },
  {
    label: "event guard passes but compare job failed",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "failure",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: true,
    expectedWrite: false,
  },
  {
    label: "event guard passes but compare job was skipped",
    event: {
      workflow_run: {
        conclusion: "success",
        head_branch: "main",
        head_repository: { full_name: GITLEAKS_REPOSITORY },
      },
      repository: { full_name: GITLEAKS_REPOSITORY },
    },
    compareResult: "skipped",
    needsUpdate: true,
    expectedTrigger: true,
    expectedCompare: true,
    expectedWrite: false,
  },
];

type GuardTerm =
  | "github.event.workflow_run.conclusion == 'success'"
  | "github.event.workflow_run.head_branch == 'main'"
  | "github.event.workflow_run.head_repository.full_name == github.repository";

const WORKFLOW_RUN_GUARDS: Record<
  GuardTerm,
  (fixture: WorkflowRunFixture) => boolean
> = {
  "github.event.workflow_run.conclusion == 'success'": (fixture) =>
    fixture.event?.workflow_run?.conclusion === "success",
  "github.event.workflow_run.head_branch == 'main'": (fixture) =>
    fixture.event?.workflow_run?.head_branch === "main",
  "github.event.workflow_run.head_repository.full_name == github.repository": (
    fixture,
  ) => {
    const headRepository =
      fixture.event?.workflow_run?.head_repository?.full_name;
    const repository = fixture.event?.repository?.full_name;
    return (
      headRepository !== undefined &&
      repository !== undefined &&
      headRepository === repository
    );
  },
};

function normalizeWorkflowExpression(expression: string): string {
  return expression
    .replace(/^\s*\$\{\{\s*/, "")
    .replace(/\s*\}\}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readCompareGuard(compareIf: string | undefined): GuardTerm[] {
  expect(compareIf, "compare jobにworkflow_runのguardが無い").toBeTypeOf(
    "string",
  );

  const terms = normalizeWorkflowExpression(compareIf ?? "")
    .split(/\s*&&\s*/)
    .map((term) => term.trim())
    .filter(Boolean);
  const expectedTerms = Object.keys(WORKFLOW_RUN_GUARDS) as GuardTerm[];

  expect(
    terms,
    "compare jobのguardは既知のworkflow_run条件を&&で全て指定しなければならない",
  ).toHaveLength(expectedTerms.length);
  expect(
    new Set(terms),
    "compare jobのguardに重複した条件がある",
  ).toHaveProperty("size", expectedTerms.length);
  for (const term of terms) {
    expect(
      WORKFLOW_RUN_GUARDS[term as GuardTerm],
      `compare jobのguardに未知の条件があります: ${term}`,
    ).toBeTypeOf("function");
  }
  expect([...terms].sort()).toEqual([...expectedTerms].sort());

  return terms as GuardTerm[];
}

function evaluateCompareGuard(
  compareIf: string | undefined,
  fixture: WorkflowRunFixture,
): boolean {
  return readCompareGuard(compareIf).every((term) =>
    WORKFLOW_RUN_GUARDS[term](fixture),
  );
}

function evaluateWorkflowRunBranchFilter(
  branches: unknown,
  fixture: WorkflowRunFixture,
): boolean {
  expect(branches, "workflow_run triggerにmain branch filterが無い").toEqual([
    "main",
  ]);
  return fixture.event?.workflow_run?.head_branch === "main";
}

function evaluateWritePath(
  compareIf: string | undefined,
  openIf: string | undefined,
  fixture: WorkflowRunFixture,
): boolean {
  const comparePassed = evaluateCompareGuard(compareIf, fixture);
  expect(openIf, "open-bump-pr jobにneeds_update gateが無い").toBeTypeOf(
    "string",
  );
  const openTerms = normalizeWorkflowExpression(openIf ?? "")
    .split(/\s*&&\s*/)
    .map((term) => term.trim())
    .filter(Boolean);
  const needsUpdateTerm = "needs.compare.outputs.needs_update == 'true'";
  const needsResultTerm = "needs.compare.result == 'success'";
  expect(openTerms).toContain(needsUpdateTerm);
  expect(openTerms).toContain(needsResultTerm);
  expect(openTerms).toHaveLength(Object.keys(WORKFLOW_RUN_GUARDS).length + 2);
  const eventTerms = openTerms.filter(
    (term) => term !== needsUpdateTerm && term !== needsResultTerm,
  );
  expect(
    eventTerms.sort(),
    "write jobにもcompareと同じevent guardを要求する",
  ).toEqual((Object.keys(WORKFLOW_RUN_GUARDS) as GuardTerm[]).sort());
  for (const term of eventTerms) {
    expect(
      WORKFLOW_RUN_GUARDS[term as GuardTerm],
      `write jobのguardに未知の条件があります: ${term}`,
    ).toBeTypeOf("function");
  }

  return (
    comparePassed &&
    fixture.compareResult === "success" &&
    eventTerms.every((term) =>
      WORKFLOW_RUN_GUARDS[term as GuardTerm](fixture),
    ) &&
    fixture.needsUpdate
  );
}

describe("GITHUB_TOKEN 生成PRのrequired checks", () => {
  it("release tag・asset・archive hashをoutputやbranchへ渡す前に検証する", () => {
    const updater = readWorkflowFile("gitleaks-version-check.yml");
    const compare = updater.jobs?.["check-version"]?.steps?.find(
      (step) => step.id === "compare",
    );
    expect(compare?.run).toContain("gitleaks-release.mjs --read-pinned");
    expect(compare?.run).toContain("gitleaks-release.mjs --resolve-release");
    expect(compare?.run).toContain("latest_archive_sha256");
    expect(compare?.run).toContain("needs_update=true");
    expect(compare?.run).not.toContain("latest_tag#v");
  });

  it("manual dispatchはread-only main検査に限定し、write処理をtrusted workflowへ分離する", () => {
    const check = readWorkflowFile("gitleaks-version-check.yml");
    expect(check.on).toHaveProperty("workflow_dispatch");
    expect(check.on).toHaveProperty("schedule");
    expect(check.concurrency).toEqual({
      group: "${{ github.workflow }}",
      "cancel-in-progress": true,
    });
    expect(check.permissions).toEqual({ contents: "read" });
    expect(check.jobs?.["open-bump-pr"]).toBeUndefined();

    const bump = readWorkflowFile("gitleaks-version-bump.yml");
    const workflowRun = bump.on?.workflow_run as
      | {
          workflows?: unknown;
          types?: unknown;
          branches?: unknown;
        }
      | undefined;
    expect(workflowRun).toEqual({
      workflows: ["gitleaks-version-check"],
      types: ["completed"],
      branches: ["main"],
    });
    expect(bump.permissions).toEqual({ contents: "read" });

    const compareJob = bump.jobs?.compare;
    const openJob = bump.jobs?.["open-bump-pr"];
    expect(compareJob, "read-only compare jobが無い").toBeDefined();
    expect(openJob, "write jobが無い").toBeDefined();
    expect(compareJob?.needs).toBeUndefined();
    expect(openJob?.needs).toBe("compare");
    expect(compareJob?.permissions).toEqual({ contents: "read" });
    expect(openJob?.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
      actions: "write",
    });

    const compareOutputKeys = [
      "current_version",
      "current_archive",
      "current_sha256",
      "latest_version",
      "latest_archive",
      "latest_archive_sha256",
      "latest_archive_url",
      "latest_upstream_url",
      "needs_update",
    ];
    for (const key of compareOutputKeys) {
      expect(
        compareJob?.outputs?.[key],
        `compare jobの${key} outputが無い`,
      ).toBe(`\${{ steps.compare.outputs.${key} }}`);
    }

    const checkCheckout = check.jobs?.["check-version"]?.steps?.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkCheckout?.with?.ref).toBe("refs/heads/main");

    const compareCheckout = compareJob?.steps?.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(compareCheckout?.with?.ref).toBe("refs/heads/main");
    const bumpCheckout = openJob?.steps?.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(bumpCheckout?.with?.ref).toBe("refs/heads/main");

    const compareCommands = (compareJob?.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");
    expect(compareCommands).not.toMatch(
      /(?:git\s+(?:push|checkout\s+-b)|gh\s+(?:workflow\s+run|pr\s+create)|--update-pinned)/,
    );
  });

  it.each(WORKFLOW_RUN_FIXTURES)(
    "$label: 実際のcompare guardからwrite経路到達可否を評価する",
    (fixture) => {
      const bump = readWorkflowFile("gitleaks-version-bump.yml");
      const compareJob = bump.jobs?.compare;
      const openJob = bump.jobs?.["open-bump-pr"];
      const workflowRun = bump.on?.workflow_run as
        | { branches?: unknown }
        | undefined;

      expect(
        evaluateWorkflowRunBranchFilter(workflowRun?.branches, fixture),
        `${fixture.label}: trigger-level branch filterの評価が想定外`,
      ).toBe(fixture.expectedTrigger);
      expect(
        evaluateCompareGuard(compareJob?.if, fixture),
        `${fixture.label}: compare jobのguard評価が想定外`,
      ).toBe(fixture.expectedCompare);
      expect(
        evaluateWritePath(compareJob?.if, openJob?.if, fixture),
        `${fixture.label}: write経路の到達可否が想定外`,
      ).toBe(fixture.expectedWrite);
    },
  );

  it("compare guardは未知の条件・欠落・余計な条件を受け入れない", () => {
    const trustedGuard = Object.keys(WORKFLOW_RUN_GUARDS).join(" && ");
    const fixture = WORKFLOW_RUN_FIXTURES[0];

    expect(() => readCompareGuard(undefined)).toThrow();
    expect(() =>
      readCompareGuard(`${trustedGuard} && github.actor == 'attacker'`),
    ).toThrow();
    expect(() =>
      evaluateCompareGuard(
        trustedGuard.replace(
          "github.event.workflow_run.head_branch == 'main'",
          "github.event.workflow_run.head_branch == 'release'",
        ),
        fixture,
      ),
    ).toThrow();
    expect(() =>
      evaluateCompareGuard(trustedGuard.replace(" && ", " || "), fixture),
    ).toThrow();
  });

  it("version bump workflowはdispatch可能なgitleaksとCIを同じheadで起動する", () => {
    expect(readWorkflowFile("ci.yml").on).toHaveProperty("workflow_dispatch");
    expect(readWorkflowFile("gitleaks.yml").on).toHaveProperty(
      "workflow_dispatch",
    );

    const updater = readWorkflowFile("gitleaks-version-bump.yml");
    const trigger = updater.jobs?.["open-bump-pr"]?.steps?.find((step) =>
      step.run?.includes("gh workflow run"),
    );
    expect(trigger, "自動PRにrequired checksを作るstepが無い").toBeDefined();
    const dispatchLines =
      trigger?.run
        ?.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("gh workflow run")) ?? [];
    expect(dispatchLines).toEqual([
      'gh workflow run gitleaks.yml --ref "$BRANCH"',
      'gh workflow run ci.yml --ref "$BRANCH"',
    ]);
  });

  it("workflow_dispatchは同じrefのpush CIをキャンセルしない", () => {
    expect(readWorkflowFile("ci.yml").concurrency?.group).toContain(
      "github.event_name",
    );
  });

  it("更新branchをshell本文へ直接展開せずenv経由で引用する", () => {
    const updater = readWorkflowFile("gitleaks-version-bump.yml");
    const openJob = updater.jobs?.["open-bump-pr"];
    const branchSteps = openJob?.steps?.filter((step) =>
      step.run?.includes("$BRANCH"),
    );
    expect(branchSteps).toHaveLength(3);
    for (const step of branchSteps ?? []) {
      expect(step.env?.BRANCH).toBe("${{ steps.existing.outputs.branch }}");
      expect(step.run).not.toContain("${{ steps.existing.outputs.branch }}");
    }
    expect(openJob?.steps?.map((step) => step.run).join("\n")).not.toContain(
      "${{ steps.existing.outputs.branch }}",
    );

    const expectedNeedsOutputs: Record<string, string> = {
      LATEST_VERSION: "latest_version",
      CURRENT_VERSION: "current_version",
      CURRENT_ARCHIVE: "current_archive",
      CURRENT_SHA256: "current_sha256",
      LATEST_ARCHIVE: "latest_archive",
      LATEST_ARCHIVE_SHA256: "latest_archive_sha256",
      LATEST_ARCHIVE_URL: "latest_archive_url",
      LATEST_UPSTREAM_URL: "latest_upstream_url",
    };
    for (const [name, output] of Object.entries(expectedNeedsOutputs)) {
      expect(openJob?.env?.[name], `${name}のjob envが無い`).toBe(
        `\${{ needs.compare.outputs.${output} }}`,
      );
    }
    expect(openJob?.steps?.map((step) => step.run).join("\n")).not.toContain(
      "steps.compare.outputs",
    );
  });
});

describe("GITHUB_TOKEN の既定権限境界 (#934)", () => {
  it("全workflowをread-onlyにし、write権限を許可済みjobだけに限定する", () => {
    const observedWriteJobs: Record<string, Record<string, string>> = {};
    const filenames = workflowFilenames().sort();

    expect(filenames, "workflowが1つも見つからない").not.toEqual([]);

    for (const filename of filenames) {
      const workflow = readWorkflowFile(filename);
      const workflowPermissions = workflow.permissions ?? {};

      expect(
        workflow.permissions,
        `${filename}: workflow-level permissions が無い(write-allの既定値に戻る可能性がある)`,
      ).toBeDefined();
      for (const [scope, level] of Object.entries(workflowPermissions)) {
        expect(
          ["read", "none"],
          `${filename}: workflow-level ${scope} はread/noneに限定する`,
        ).toContain(level);
      }

      for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
        const permissions = job.permissions ?? {};
        for (const [scope, level] of Object.entries(permissions)) {
          expect(
            ["read", "write", "none"],
            `${filename}/${jobName}: ${scope} のpermission値が不正`,
          ).toContain(level);
        }

        const writePermissions = Object.fromEntries(
          Object.entries(permissions).filter(([, level]) => level === "write"),
        );
        if (Object.keys(writePermissions).length === 0) continue;

        const key = `${filename}/${jobName}`;
        const expected =
          ALLOWED_WRITE_PERMISSION_JOBS[
            key as keyof typeof ALLOWED_WRITE_PERMISSION_JOBS
          ];
        expect(
          expected,
          `${key}: write権限は明示的にレビュー済みのjobだけが持てる`,
        ).toBeDefined();
        expect(permissions, `${key}: write権限はjob単位で最小化する`).toEqual(
          expected,
        );
        observedWriteJobs[key] = writePermissions;
      }
    }

    expect(observedWriteJobs).toEqual(ALLOWED_WRITE_PERMISSION_JOBS);
  });
});

describe("gitleaks workflow concurrency", () => {
  it("manual dispatch on main does not cancel a required push scan", () => {
    const concurrency = readWorkflowFile("gitleaks.yml").concurrency;
    expect(concurrency?.group).toContain("github.event_name");
    expect(concurrency?.group).toContain("github.ref");
    expect(concurrency?.["cancel-in-progress"]).toBe(true);
  });
});

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
    "pnpm run docs --emit none",
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

  it("prebuilt production E2Eの対象とdev専用除外を明示する(#554)", () => {
    const command = readPackageJson().scripts?.["test:e2e:prod:prebuilt"];
    expect(command, "production prebuilt E2E scriptが無い").toBeTypeOf(
      "string",
    );

    const selected = command?.match(/e2e\/[\w./-]+\.spec\.ts/g) ?? [];
    expect(selected).toEqual(PRODUCTION_E2E_SPECS);

    const classified = [
      ...PRODUCTION_E2E_SPECS,
      ...PRODUCTION_E2E_EXCLUDED_SPECS,
    ].sort();
    expect(classified).toEqual(e2eSpecPaths());
  });
});

describe("Playwright E2E provisioned environment (#557)", () => {
  it("uses a pinned Playwright image with Chromium and WebKit already provisioned", () => {
    const job = readWorkflow().jobs?.e2e;
    const image = job?.container?.image ?? "";
    const steps = job?.steps ?? [];

    expect(image).toBe(
      "mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac",
    );
    expect(job?.container?.options).toContain("--ipc=host");
    expect(job?.container?.options).toContain("--init");
    expect(steps.some((step) => step.run?.includes("playwright install"))).toBe(
      false,
    );
    expect(
      steps.some((step) => step.with?.path === PLAYWRIGHT_CACHE_PATH),
    ).toBe(false);

    const provisionCheck = steps.find(
      (step) => step.name === "Verify Playwright browsers are provisioned",
    );
    expect(provisionCheck?.if).toBe("steps.scope.outputs.verify == 'true'");
    expect(provisionCheck?.run).toContain(
      "/ms-playwright/chromium-*/chrome-linux64/chrome",
    );
    expect(provisionCheck?.run).toContain("/ms-playwright/webkit-*/pw_run.sh");
  });
});

/**
 * ローカルのproduction E2E jobは `~/.cache/ms-playwright` を使う。E2E jobは
 * #557 の公式Playwright imageにブラウザを固定しているため、ここでは残るキャッシュが
 * 要求するブラウザ集合と衝突しないことを確認する。
 */
describe("Playwright browser cache keys", () => {
  it("インストールするブラウザ集合をキーに含め、job 間で衝突しない", () => {
    const caches = playwrightBrowserCaches(readWorkflow());
    expect(caches.length).toBeGreaterThanOrEqual(1);

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

  it("E2E scopeは最初のGit操作前にworkspace限定のsafe.directoryを設定する", () => {
    const steps = readWorkflowFile("ci.yml").jobs?.e2e?.steps ?? [];
    const scope = steps.find((step) => step.id === SCOPE_STEP_ID);
    const safeDirectoryCommand =
      'git config --global --add safe.directory "$GITHUB_WORKSPACE"';
    const resolverCommand = "node .github/scripts/verification-scope.mjs";

    expect(scope, "e2e: scope stepが無い").toBeDefined();
    expect(scope?.run?.trim()).toBe(
      `${safeDirectoryCommand}\n${resolverCommand}`,
    );

    const safeDirectoryCommands = steps
      .map((step) => step.run?.trim() ?? "")
      .filter((run) => run.includes("safe.directory"));
    expect(safeDirectoryCommands).toEqual([
      `${safeDirectoryCommand}\n${resolverCommand}`,
      'git -c safe.directory="$GITHUB_WORKSPACE" sparse-checkout disable',
    ]);
    expect(safeDirectoryCommands.join("\n")).not.toMatch(
      /safe\.directory\s*=\s*\*/,
    );
  });

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

  it.each(Object.keys(SCOPED_JOBS))(
    "%s job はscope中だけsparseにし、検証前に完全なworktreeへ戻す",
    (jobName) => {
      const steps = readWorkflowFile("ci.yml").jobs?.[jobName]?.steps ?? [];
      const checkout = steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(checkout?.with?.filter, `${jobName}: blob filter が無い`).toBe(
        "blob:none",
      );
      expect(checkout?.with?.["sparse-checkout-cone-mode"]).toBe(false);
      const sparsePaths = String(checkout?.with?.["sparse-checkout"] ?? "")
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean);
      expect(sparsePaths).toEqual(
        expect.arrayContaining([
          "/.github/scripts/verification-scope.mjs",
          "/.npmrc",
          "/.nvmrc",
          "/package.json",
          "/pnpm-lock.yaml",
          "/pnpm-workspace.yaml",
        ]),
      );

      const expectedMaterializeCommand =
        jobName === "e2e"
          ? 'git -c safe.directory="$GITHUB_WORKSPACE" sparse-checkout disable'
          : "git sparse-checkout disable";
      const materialize = steps.find(
        (step) => step.run?.trim() === expectedMaterializeCommand,
      );
      expect(
        materialize,
        `${jobName}: 完全worktree復元stepが無い`,
      ).toBeDefined();
      expect(materialize?.if).toBe("steps.scope.outputs.setup == 'true'");
      expect(steps.indexOf(materialize as Step)).toBeGreaterThan(
        steps.findIndex((step) => step.id === SCOPE_STEP_ID),
      );
      expect(steps.indexOf(materialize as Step)).toBeLessThan(
        steps.findIndex((step) => step.run?.includes("pnpm install")),
      );
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
    ["quality", ["pnpm lint", "pnpm typecheck", "pnpm check", "pnpm test"]],
    [
      "production",
      [
        "pnpm knip",
        "pnpm depcruise",
        "pnpm run docs --emit none",
        "pnpm build",
        "pnpm test:e2e:prod:prebuilt",
      ],
    ],
    ["verify", ["pnpm test:e2e"]],
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
   * ホストrunner上で残るブラウザ導入は「検証する」か「キャッシュがまだ無い」ときだけ必要。
   * E2E jobのChromium/WebKit導入は #557 の公式Playwright imageへ移し、apt経路を持たない。
   */
  it("ブラウザの導入はキャッシュミス時のみ実行される", () => {
    const workflow = readWorkflowFile("ci.yml");
    let checked = 0;
    for (const [jobName, definition] of Object.entries(workflow.jobs ?? {})) {
      for (const step of definition.steps ?? []) {
        if (!step.run?.includes("playwright install")) continue;
        checked += 1;
        expect(
          step.if ?? "",
          `${jobName} / ${step.name}: setup しない run ではブラウザ導入も実行してはならない`,
        ).toMatch(/^steps\.scope\.outputs\.browser == 'true' && \(/);
        expect(
          step.if ?? "",
          `${jobName} / ${step.name}: 検証するかcache missの場合だけ導入すべき`,
        ).toMatch(
          /steps\.scope\.outputs\.production == 'true' \|\| steps\.[\w-]+\.outputs\.cache-hit != 'true'/,
        );
      }
    }
    expect(checked, "playwright install を 1 つも検出できなかった").toBe(1);
  });

  /**
   * `pnpm exec playwright install` は node_modules を必要とする。
   * `pnpm install` にブラウザ側より狭い条件を付けると、「pnpm キャッシュはヒットしたが
   * Playwright キャッシュは外れた」(2 つのキャッシュは同じキーでも LRU で独立に退避
   * されうる: #380) の組み合わせで **node_modules 無しに playwright install が走って落ちる**。
   * 実際にこの条件を入れかけたため、順序の前提をテストで固定する。
   */
  it("playwright install が走りうる場面では必ず依存が導入されている", () => {
    const workflow = readWorkflowFile("ci.yml");
    for (const [jobName, definition] of Object.entries(workflow.jobs ?? {})) {
      const steps = definition.steps ?? [];
      const browserInstall = steps.find((step) =>
        step.run?.includes("playwright install"),
      );
      if (!browserInstall) continue;
      const dependencyInstall = steps.find((step) =>
        step.run?.includes("pnpm install"),
      );
      expect(
        dependencyInstall,
        `${jobName}: playwright install の前に pnpm install が無い`,
      ).toBeDefined();
      // 依存の導入は `setup` 全体で走らなければならない。ブラウザ側と同じ
      // cache-hit 条件を付けると、キャッシュが片方だけ外れたときに破綻する。
      expect(
        dependencyInstall?.if ?? "",
        `${jobName}: pnpm install はブラウザ側より狭い条件にしてはならない(node_modules 無しで playwright install が走る)`,
      ).toBe("steps.scope.outputs.setup == 'true'");
    }
  });

  /**
   * `verify` が false でも `setup` は ci job だけ true になりうる
   * (main のマージ後 push で共有キャッシュを投入するため)。
   * E2E job は Playwright 固定イメージを使いキャッシュを書き込まないため、
   * verify=false のとき setup も false でなければならない (#569)。
   */
  it("setup を伴わない検証・cache seed は存在しない", () => {
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
          const scope = resolveScope({
            job,
            paths,
            postMergeDuplicate,
          });
          if (scope.quality || scope.production || scope.browser) {
            expect(
              scope.setup,
              `${job}: setup=false のまま検証またはcache seedを実行してはならない`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("main のマージ後でも E2E は不要な setup を行わない (#569)", () => {
    expect(
      resolveScope({
        job: "ci",
        paths: [".github/scripts/verification-scope.mjs"],
        postMergeDuplicate: true,
        seedCaches: true,
      }),
    ).toEqual({
      setup: true,
      verify: false,
      quality: false,
      production: false,
      browser: true,
    });
    expect(
      resolveScope({
        job: "e2e",
        paths: [".github/scripts/verification-scope.mjs"],
        postMergeDuplicate: true,
        seedCaches: true,
      }),
    ).toEqual({
      setup: false,
      verify: false,
      quality: false,
      production: false,
      browser: false,
    });
  });
});

describe("test-only quality scope (#758)", () => {
  it("unit-test-only は品質検証を維持し production 検証を省略する", () => {
    expect(
      resolveScope({
        job: "ci",
        paths: ["server/roomManager.drain.test.ts"],
        postMergeDuplicate: false,
      }),
    ).toEqual({
      setup: true,
      verify: true,
      quality: true,
      production: false,
      browser: false,
    });
    expect(
      resolveScope({
        job: "e2e",
        paths: ["server/roomManager.drain.test.ts"],
        postMergeDuplicate: false,
      }),
    ).toEqual({
      setup: false,
      verify: false,
      quality: false,
      production: false,
      browser: false,
    });
  });

  it("test と出荷コードの混在は full verification に戻る", () => {
    const paths = ["server/roomManager.drain.test.ts", "server/roomManager.ts"];
    expect(
      resolveScope({
        job: "ci",
        paths,
        postMergeDuplicate: false,
      }),
    ).toEqual({
      setup: true,
      verify: true,
      quality: true,
      production: true,
      browser: true,
    });
    expect(
      resolveScope({ job: "e2e", paths, postMergeDuplicate: false }).verify,
    ).toBe(true);
  });

  it("変更を特定できない場合は全検証へ fail-open で戻る", () => {
    expect(
      resolveScope({ job: "ci", paths: null, postMergeDuplicate: false }),
    ).toEqual({
      setup: true,
      verify: true,
      quality: true,
      production: true,
      browser: true,
    });
    expect(
      resolveScope({ job: "e2e", paths: null, postMergeDuplicate: false })
        .verify,
    ).toBe(true);
  });

  it("検証済みmainのexact-tree reuseは検証せず共有cacheだけseedする", () => {
    expect(
      resolveScope({
        job: "ci",
        paths: ["server/roomManager.ts"],
        postMergeDuplicate: true,
        seedCaches: true,
      }),
    ).toEqual({
      setup: true,
      verify: false,
      quality: false,
      production: false,
      browser: true,
    });
  });
});

/**
 * 判定ロジックそのものの契約。ここが緩むと「検証すべき変更を検証しない」に直結する。
 */
describe("verification-scope の分類契約 (#491)", () => {
  it.each([
    // [説明, パス, 期待する分類]
    ["仕様書", "documents/spec/game-flow.md", "documentation"],
    ["質問ステータス索引", "CLAUDE.md", "unit-test"],
    [
      "immutable pre-cutover fixture",
      "documents/fixtures/railway-pre-cutover.json",
      "unit-test",
    ],
    [
      "archived readiness Config as Code fixture",
      "documents/fixtures/railway-readyz-before-iac.json",
      "unit-test",
    ],
    [
      "Unity display contract fixture",
      "documents/fixtures/unity-display-contract.json",
      "code",
    ],
    ["単体テスト", "src/domain/game/engine.test.ts", "unit-test"],
    ["コンポーネントテスト", "src/components/game/Board.test.tsx", "unit-test"],
    [
      "テスト専用 fixture",
      "src/domain/game/__testing__/engine-fixtures.ts",
      "unit-test",
    ],
    ["テスト共有ヘルパ", "src/test/webLocksStub.ts", "unit-test"],
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
    const paths = ["documents/spec/game-flow.md"];
    for (const job of ["ci", "e2e"] as const) {
      expect(
        resolveScope({ job, paths, postMergeDuplicate: false }).verify,
      ).toBe(false);
    }
  });

  it("単体テストのみの変更は ci は検証し e2e は検証しない", () => {
    const paths = ["src/test/webLocksStub.ts", "documents/spec/game-flow.md"];
    expect(
      resolveScope({ job: "ci", paths, postMergeDuplicate: false }).verify,
    ).toBe(true);
    expect(
      resolveScope({ job: "e2e", paths, postMergeDuplicate: false }).verify,
    ).toBe(false);
  });

  it("main のマージ後 push は検証せず ci だけ共有キャッシュを投入する", () => {
    for (const job of ["ci", "e2e"] as const) {
      const scope = resolveScope({
        job,
        paths: ["src/domain/hand/yaku.ts"],
        postMergeDuplicate: true,
        seedCaches: true,
      });
      expect(scope.verify, `${job}: 同一ツリーは PR 側で検証済み`).toBe(false);
      expect(
        scope.setup,
        `${job}: main の共有キャッシュ投入は ci job だけが行う (#380, #569)`,
      ).toBe(job === "ci");
    }
  });

  it("dev / stg の検証済み昇格 push は保存不能なsetupを行わない", () => {
    for (const job of ["ci", "e2e"] as const) {
      expect(
        resolveScope({
          job,
          paths: ["src/domain/hand/yaku.ts"],
          postMergeDuplicate: true,
          seedCaches: false,
        }),
      ).toEqual({
        setup: false,
        verify: false,
        quality: false,
        production: false,
        browser: false,
      });
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
describe("テスト入力資産をdocs-onlyで黙殺しない (#745)", () => {
  /** Static imports from shipped modules must never inherit a test-only scope. */
  function productionDocumentImports(): string[] {
    const found = new Set<string>();
    const root = process.cwd();
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          walk(file);
          continue;
        }
        const path = relative(root, file).replaceAll(sep, "/");
        if (!/\.[cm]?[jt]sx?$/.test(file) || classifyPath(path) !== "code")
          continue;
        const source = ts.createSourceFile(
          file,
          readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const visit = (node: ts.Node) => {
          const specifier =
            ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
              ? node.moduleSpecifier
              : ts.isCallExpression(node) &&
                  (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                    (ts.isIdentifier(node.expression) &&
                      node.expression.text === "require"))
                ? node.arguments[0]
                : undefined;
          if (specifier && ts.isStringLiteralLike(specifier)) {
            const input = specifier.text;
            const absolute = input.startsWith(".")
              ? resolve(dirname(file), input)
              : input.startsWith("@/")
                ? resolve(root, "src", input.slice(2))
                : null;
            if (absolute) {
              const inputPath = relative(root, absolute).replaceAll(sep, "/");
              if (/^(?:docs|documents|prototypes)\//.test(inputPath))
                found.add(inputPath);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    for (const directory of ["src", "server"]) walk(resolve(root, directory));
    return [...found];
  }

  /**
   * テストコードがどう解決しているかに関係なく、文字列リテラルとして現れる
   * リポジトリ相対の docs/documents/README/CHANGELOG 入力を集める。テストが
   * importする検証契約モジュールに入力パス定数がある場合は、そのモジュールも
   * 明示的に走査する。
   *
   * `resolve(process.cwd(), "…")`、`readFileSync("…")`、`new URL("…", import.meta.url)`、
   * JSON import、ディレクトリコピーのどれかへ限定すると、新しい参照形式を追加した
   * 瞬間に検査が黙って素通りするため、構文ではなくパス文字列を横断的に拾う。
   */
  function testInputLiterals(): string[] {
    const found = new Set<string>();
    const repositoryRoot = resolve(process.cwd());
    const sourcePath = (file: string, literal: string) => {
      const normalized = literal.replaceAll("\\", "/");
      const absolute = normalized.startsWith(".")
        ? resolve(dirname(file), normalized)
        : resolve(repositoryRoot, normalized);
      const relativePath = relative(repositoryRoot, absolute).replaceAll(
        sep,
        "/",
      );
      return relativePath && !relativePath.startsWith("..")
        ? relativePath.replace(/\/$/, "")
        : null;
    };
    const collect = (file: string) => {
      const source = readFileSync(file, "utf8");
      // Blender's test composes README.md from a named repository-root path.
      // Collect that actual reference instead of hard-coding an unused exception.
      const roots = new Map(
        [
          ...source.matchAll(
            /\bconst\s+(\w+)\s*=\s*resolve\(\s*process\.cwd\(\)\s*,\s*["']((?:docs|documents|prototypes)\/[^"']+)["']\s*,?\s*\)/g,
          ),
        ].map((match) => [match[1], match[2]]),
      );
      for (const match of source.matchAll(
        /\bresolve\(\s*(\w+)\s*,\s*["']([^"']+\.md)["']\s*\)/g,
      )) {
        const directory = roots.get(match[1]);
        if (!directory) continue;
        const path = sourcePath(file, `${directory}/${match[2]}`);
        if (path) found.add(path);
      }
      for (const match of source.matchAll(/(["'])([^"'\\\n]+)\1/g)) {
        const literal = match[2];
        if (
          !/(^|\/)(?:docs|documents)\//.test(literal) &&
          !/^(?:CLAUDE|README|CHANGELOG|質問リスト)\.md$/.test(literal)
        )
          continue;
        const path = sourcePath(file, literal);
        if (path) found.add(path);
      }
    };
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(file);
          continue;
        }
        if (!/(?:\.test|\.spec)\.(?:[cm]?ts|tsx|js|mjs)$/.test(entry.name))
          continue;
        // このファイル自身は分類テストの入力データとしてパスを並べるため除外する。
        // 判定対象はあくまで「他のテストが参照している入力資産」。
        if (entry.name === "ci-workflow.test.ts") continue;
        collect(file);
      }
    };
    // server/ のrunbook、src/ のJSON import、e2e/ のfixtureを同じ検査対象にする。
    for (const root of ["server", "src", "e2e"])
      walk(resolve(repositoryRoot, root));
    // railway-iac-migration.test.ts が import する契約モジュールのfixture定数も検査する。
    collect(
      resolve(repositoryRoot, "scripts/railway-iac-migration-contract.ts"),
    );
    return [...found];
  }

  it("production moduleがimportする文書ツリーの資産は全検証する", () => {
    const inputs = productionDocumentImports();
    expect(inputs).toContain("documents/fixtures/unity-display-contract.json");
    expect(new Set(PRODUCTION_INPUT_PATHS)).toEqual(new Set(inputs));
    for (const path of inputs) {
      expect(classifyPath(path), `${path}: 出荷moduleの入力を省略しない`).toBe(
        "code",
      );
      expect(
        resolveScope({ job: "ci", paths: [path], postMergeDuplicate: false }),
      ).toMatchObject({ quality: true, production: true, browser: true });
      expect(
        resolveScope({ job: "e2e", paths: [path], postMergeDuplicate: false })
          .verify,
      ).toBe(true);
    }
  });

  it("server/src/e2eの入力はunit-test、出荷moduleとの共有入力はcodeに分類する", () => {
    const literals = testInputLiterals();
    const productionInputs = new Set(productionDocumentImports());
    // 走査自体が壊れて 0 件になれば、この検査は何も守らなくなる。
    expect(
      literals.length,
      "テストからdocs/documents/README/CHANGELOG入力を1件も抽出できなかった(走査が壊れている)",
    ).toBeGreaterThanOrEqual(6);

    expect(literals).toEqual(
      expect.arrayContaining([
        "documents/guides/railway-online-deploy-runbook.md",
        "documents/assets/ui-refresh/manifest.json",
        "documents/assets/ui-refresh",
        "documents/fixtures/railway-pre-cutover.json",
        "prototypes/blender/README.md",
        "documents/fixtures/railway-readyz-before-iac.json",
      ]),
    );

    for (const path of literals) {
      expect(
        classifyPath(path),
        `${path}: 実際のconsumerに必要な検証scopeへ分類されていない。`,
      ).toBe(productionInputs.has(path) ? "code" : "unit-test");
    }
  });

  it("テスト入力一覧・ディレクトリに不要な項目が残っていない", () => {
    const literals = new Set(testInputLiterals());
    for (const path of TEST_INPUT_PATHS) {
      expect(
        literals.has(path),
        `${path}: どのテストからも参照されていない。入力一覧は検証コスト増に直結するため、不要になったら消す`,
      ).toBe(true);
    }
    for (const directory of TEST_INPUT_DIRECTORIES) {
      expect(
        literals.has(directory),
        `${directory}: ディレクトリ依存がテストから検出されていない`,
      ).toBe(true);
    }
    // 旧export名も残しているため、互換配列が意図せず別物にならないよう固定する。
    expect(DOCUMENTATION_EXCEPTIONS).toEqual(TEST_INPUT_PATHS);
  });

  it.each([
    "documents/guides/railway-online-deploy-runbook.md",
    "documents/assets/ui-refresh/manifest.json",
    "documents/assets/ui-refresh/originals/lobby.png",
    "documents/assets/ui-refresh/originals/new-reference.png",
    "documents/fixtures/railway-pre-cutover.json",
    "documents/fixtures/railway-readyz-before-iac.json",
    "README.md",
    "CHANGELOG.md",
    "docs/四兄弟麻雀ルール.md",
    "prototypes/blender/README.md",
  ])("%sの変更はqualityだけを実行しE2Eを起動しない", (path) => {
    expect(
      resolveScope({ job: "ci", paths: [path], postMergeDuplicate: false }),
    ).toEqual({
      setup: true,
      verify: true,
      quality: true,
      production: false,
      browser: false,
    });
    expect(
      resolveScope({ job: "e2e", paths: [path], postMergeDuplicate: false }),
    ).toEqual({
      setup: false,
      verify: false,
      quality: false,
      production: false,
      browser: false,
    });
  });

  it("test inputとproduction codeの混在はfail-openで全検証する", () => {
    expect(
      resolveScope({
        job: "ci",
        paths: [
          "documents/assets/ui-refresh/manifest.json",
          "src/app/page.tsx",
        ],
        postMergeDuplicate: false,
      }),
    ).toEqual({
      setup: true,
      verify: true,
      quality: true,
      production: true,
      browser: true,
    });
    expect(
      resolveScope({
        job: "e2e",
        paths: [
          "documents/assets/ui-refresh/originals/lobby.png",
          "src/app/page.tsx",
        ],
        postMergeDuplicate: false,
      }).verify,
    ).toBe(true);
  });

  it.each([
    "documents/fixtures/unity-display-contract.json",
    "src/app/prototype/unity-display/page.tsx",
    "public/tiles/CREDITS.md",
    "e2e/unity-display-reference.spec.ts",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "prototypes/unity-display/Assets/Scripts/DisplayContract.cs",
    "prototypes/unknown-new-input.bin",
  ])("Blender READMEと%sの混在は全検証を維持する", (path) => {
    const paths = ["prototypes/blender/README.md", path];
    expect(
      resolveScope({ job: "ci", paths, postMergeDuplicate: false }),
    ).toEqual({
      setup: true,
      verify: true,
      quality: true,
      production: true,
      browser: true,
    });
    expect(
      resolveScope({ job: "e2e", paths, postMergeDuplicate: false }).verify,
    ).toBe(true);
  });
});

/**
 * Playwright 既定の `"50%"` は 2 コア runner で 1 worker = 完全な直列実行になる。
 * CI の実測改善を維持しつつ、localのマシン依存な既定値がNext dev serverとの競合で
 * timeoutを起こさないよう、CI/local双方のworker契約を明示して固定する (#491, #1026)。
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

  it("ローカルでは2 workerに上限を固定する", async () => {
    const config = await configWith(undefined);
    expect(
      config.workers,
      "ローカルのworker数をマシン依存の既定値に任せるとE2E専用dev serverと競合する",
    ).toBe(2);
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
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

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
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
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

describe("container の変更パス判定 API fallback (#567)", () => {
  const REPO = "AutoDevJapan/FourBrosMahjong";
  const BASE = "a".repeat(40);
  const HEAD = "b".repeat(40);

  it("local git が解決できないとき Compare API の一覧へ切り替える", async () => {
    const api = vi.fn(async (path: string) => {
      expect(path).toBe(
        `/repos/${REPO}/compare/${BASE}...${HEAD}?per_page=100&page=1`,
      );
      return { files: [{ filename: "src/domain/game/engine.ts" }] };
    });

    await expect(
      resolveChangedPaths({
        repo: REPO,
        baseSha: BASE,
        headSha: HEAD,
        local: () => null,
        api,
      }),
    ).resolves.toEqual({
      paths: ["src/domain/game/engine.ts"],
      source: "github-api",
    });
  });

  it("local git が解決できるとき API を余分に呼ばない", async () => {
    const api = vi.fn();
    await expect(
      resolveChangedPaths({
        repo: REPO,
        baseSha: BASE,
        headSha: HEAD,
        local: () => ["docs/only.md"],
        api,
      }),
    ).resolves.toEqual({ paths: ["docs/only.md"], source: "git" });
    expect(api).not.toHaveBeenCalled();
  });

  it("rename は旧パスと新パスをどちらも分類対象にする", async () => {
    await expect(
      changedPathsFromApi({
        repo: REPO,
        baseSha: BASE,
        headSha: HEAD,
        api: async () => ({
          files: [
            {
              filename: "docs/ships.md",
              previous_filename: "src/ships.ts",
              status: "renamed",
            },
          ],
        }),
      }),
    ).resolves.toEqual(["docs/ships.md", "src/ships.ts"]);
  });

  it.each([
    [
      "API が失敗",
      async () => {
        throw new Error("network");
      },
    ],
    ["レスポンスが不正", async () => ({ files: "not-an-array" })],
    ["ファイル要素が不正", async () => ({ files: [{}] })],
  ])("%s は unresolved のまま fail-open する", async (_label, api) => {
    await expect(
      changedPathsFromApi({
        repo: REPO,
        baseSha: BASE,
        headSha: HEAD,
        api,
      }),
    ).resolves.toBeNull();
  });

  it("Compare API の 300 件上限に達したら完全性を保証せず fail-open する", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/generated-${index}.ts`,
    }));
    await expect(
      changedPathsFromApi({
        repo: REPO,
        baseSha: BASE,
        headSha: HEAD,
        api: async () => ({ files: fullPage }),
      }),
    ).resolves.toBeNull();
  });
});

/**
 * マージ後 push のスキップは「`main` に着地するツリーは直前に PR の checks が緑にした
 * ツリーと一致する」という前提に立つ。その前提は branch protection が支えているが、
 * **設定は後から緩められる**。緩んだ瞬間、未検証のコミットが `main` に入っても CI は
 * 緑のまま素通りする — 誰も気づけない失敗になる (#496)。
 *
 * そこでガードは branch protection の *設定* ではなく **検証済みであることの証拠** を見る。
 * 以下はその証拠が 1 つでも欠けたらスキップしないこと(フェイルセーフ)を固定する。
 */
describe("マージ後 push のスキップ前提を実行時に検証する (#496)", () => {
  const REPO = "AutoDevJapan/FourBrosMahjong";
  const SHA = "a".repeat(40);
  const BEFORE = "b".repeat(40);
  const HEAD = "c".repeat(40);
  const TREE = "e".repeat(40);
  const OTHER_TREE = "f".repeat(40);
  const CHECK = "lint / typecheck / format / test / build";

  it.each([
    ["main", "refs/heads/main", "main"],
    ["dev", "refs/heads/dev", "dev"],
    ["stg", "refs/heads/stg", "stg"],
  ])("%s への push は証拠検証の対象になる", (_name, ref, expected) => {
    expect(protectedPushBranch("push", ref)).toBe(expected);
  });

  it.each([
    ["PR", "pull_request", "refs/pull/1/merge"],
    ["未知の branch", "push", "refs/heads/feature/test"],
    ["tag", "push", "refs/tags/v1.0.0"],
  ])("%s は証拠検証の対象外", (_name, event, ref) => {
    expect(protectedPushBranch(event, ref)).toBeNull();
  });

  /** すべての証拠が揃った状態。各テストはここから 1 つだけ壊す。 */
  function happyPath(
    overrides: {
      pulls?: unknown;
      checkRuns?: unknown;
      workflowRun?: unknown;
      workflowRuns?: Record<string, unknown>;
      commit?: unknown;
      landedCommit?: unknown;
      comparison?: unknown;
      apiError?: string;
      trees?: Record<string, string>;
    } = {},
  ) {
    const pulls = overrides.pulls ?? [
      {
        number: 492,
        merged_at: "2026-08-05T18:33:23Z",
        merge_commit_sha: SHA,
        base: { ref: "main" },
        head: { sha: HEAD },
      },
    ];
    const checkRuns = overrides.checkRuns ?? {
      check_runs: [
        {
          name: CHECK,
          conclusion: "success",
          app: { slug: "github-actions" },
          details_url: "https://github.com/owner/repo/actions/runs/123/job/456",
        },
        { name: "gitleaks", conclusion: "success" },
      ],
    };
    const workflowRun = overrides.workflowRun ?? {
      event: "pull_request",
      path: ".github/workflows/ci.yml",
      head_sha: HEAD,
      conclusion: "success",
    };
    const trees = overrides.trees ?? { [SHA]: TREE, [HEAD]: TREE };
    const candidateHead = Array.isArray(pulls)
      ? (pulls[0] as { head?: { sha?: unknown } })?.head?.sha
      : undefined;
    const defaultHead =
      typeof candidateHead === "string" ? candidateHead : HEAD;
    const commit = overrides.commit ?? {
      sha: defaultHead,
      tree: { sha: trees[defaultHead] ?? TREE },
    };
    const comparison = overrides.comparison ?? { status: "ahead" };

    const api = async (path: string) => {
      if (overrides.apiError && path.includes(overrides.apiError)) {
        throw new Error("boom");
      }
      if (path.endsWith("/pulls")) return pulls;
      if (path.includes("/check-runs?")) return checkRuns;
      const runId = path.match(/\/actions\/runs\/(\d+)$/)?.[1];
      if (runId) return overrides.workflowRuns?.[runId] ?? workflowRun;
      const commitSha = path.match(/\/git\/commits\/([^/]+)$/)?.[1];
      if (commitSha) {
        if (commitSha === defaultHead) return commit;
        return (
          overrides.landedCommit ?? {
            sha: commitSha,
            tree: { sha: trees[commitSha] ?? TREE },
          }
        );
      }
      if (path.includes("/compare/")) return comparison;
      throw new Error(`unexpected path ${path}`);
    };
    return { api };
  }

  const call = (
    overrides: Parameters<typeof happyPath>[0] = {},
    input: Partial<{
      forced: boolean;
      before: string;
      sha: string;
      branch: "main" | "dev" | "stg";
    }> = {},
  ) =>
    resolvePostMergeEvidence({
      repo: REPO,
      sha: input.sha ?? SHA,
      before: input.before ?? BEFORE,
      forced: input.forced ?? false,
      branch: input.branch ?? "main",
      checkName: CHECK,
      ...happyPath(overrides),
    });

  it("証拠がすべて揃えばスキップを許す", async () => {
    const result = await call();
    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
  });

  it("PR #519型の履歴が分岐したmain→dev昇格を祖先比較とtreeの一致で許可する", async () => {
    const merge = "545e1e05517bee2c526c07596b3fbe7b1b7be56f";
    const devBefore = "b9a05e53894113613342e9b0cfabe55b8c20df5b";
    const mainHead = "85efd840ef6c23183a80ad6dd20f6dfb38b09527";
    const result = await call(
      {
        pulls: [
          {
            number: 519,
            merged_at: "2026-08-11T18:03:49Z",
            merge_commit_sha: merge,
            base: { ref: "dev" },
            head: {
              ref: "main",
              sha: mainHead,
              repo: { full_name: REPO },
            },
          },
        ],
        workflowRun: {
          event: "pull_request",
          path: ".github/workflows/ci.yml",
          head_sha: mainHead,
          conclusion: "success",
        },
        trees: { [merge]: TREE, [mainHead]: TREE },
      },
      { sha: merge, before: devBefore, branch: "dev" },
    );
    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
  });

  it("devへの任意feature PRは昇格証拠として扱わない", async () => {
    const result = await call(
      {
        pulls: [
          {
            number: 520,
            merged_at: "2026-08-11T18:10:00Z",
            merge_commit_sha: SHA,
            base: { ref: "dev" },
            head: {
              ref: "feature/arbitrary",
              sha: HEAD,
              repo: { full_name: REPO },
            },
          },
        ],
      },
      { branch: "dev" },
    );
    expect(result).toEqual({
      skip: false,
      reason: "no-merged-pull-request",
    });
  });

  it("履歴が分岐したdev→stg昇格も親とtreeの一致で許可する", async () => {
    const result = await call(
      {
        pulls: [
          {
            number: 521,
            merged_at: "2026-08-11T19:00:00Z",
            merge_commit_sha: SHA,
            base: { ref: "stg" },
            head: { ref: "dev", sha: HEAD, repo: { full_name: REPO } },
          },
        ],
      },
      { branch: "stg" },
    );
    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
  });

  it("昇格先tipが着地commitの祖先でなければ拒否する", async () => {
    const result = await call(
      {
        pulls: [
          {
            number: 519,
            merged_at: "2026-08-11T18:03:49Z",
            merge_commit_sha: SHA,
            base: { ref: "dev" },
            head: { ref: "main", sha: HEAD, repo: { full_name: REPO } },
          },
        ],
        comparison: { status: "behind" },
      },
      { branch: "dev" },
    );
    expect(result).toEqual({
      skip: false,
      reason: "base-not-ancestor-of-landed-commit",
    });
  });

  it("一親のfast-forward/rebase昇格も祖先比較とtreeの一致で許可する", async () => {
    const result = await call(
      {
        pulls: [
          {
            number: 522,
            merged_at: "2026-08-14T16:30:35Z",
            merge_commit_sha: SHA,
            base: { ref: "dev" },
            head: { ref: "main", sha: HEAD, repo: { full_name: REPO } },
          },
        ],
        comparison: { status: "ahead" },
      },
      { branch: "dev" },
    );
    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
  });

  it("昇格先の祖先比較APIが失敗したらスキップしない", async () => {
    const result = await call(
      {
        apiError: "/compare/",
        pulls: [
          {
            number: 523,
            merged_at: "2026-08-14T16:30:35Z",
            merge_commit_sha: SHA,
            base: { ref: "dev" },
            head: { ref: "main", sha: HEAD, repo: { full_name: REPO } },
          },
        ],
      },
      { branch: "dev" },
    );
    expect(result).toEqual({
      skip: false,
      reason: "landed-ancestor-api-failed",
    });
  });

  it("同名のpush checkが共存しても成功したPR checkを証拠にする", async () => {
    const result = await call({
      checkRuns: {
        check_runs: [
          {
            name: CHECK,
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/123/job/1",
          },
          {
            name: CHECK,
            conclusion: "failure",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/456/job/2",
          },
        ],
      },
      workflowRuns: {
        "123": {
          event: "pull_request",
          path: ".github/workflows/ci.yml",
          head_sha: HEAD,
          conclusion: "success",
        },
        "456": {
          event: "push",
          path: ".github/workflows/ci.yml",
          head_sha: HEAD,
          conclusion: "failure",
        },
      },
    });
    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
  });

  it("成功したPR checkを見つけたら後続の同名runを照会しない", async () => {
    const paths: string[] = [];
    const dependencies = happyPath({
      apiError: "/actions/runs/456",
      checkRuns: {
        check_runs: [
          {
            name: CHECK,
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/123/job/1",
          },
          {
            name: CHECK,
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/456/job/2",
          },
        ],
      },
    });
    const result = await resolvePostMergeEvidence({
      repo: REPO,
      sha: SHA,
      before: BEFORE,
      forced: false,
      branch: "main",
      checkName: CHECK,
      api: async (path) => {
        paths.push(path);
        return dependencies.api(path);
      },
    });

    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
    expect(paths).not.toContain(`/repos/${REPO}/actions/runs/456`);
  });

  it("同じActions run IDは一度だけ照会し、重複checkの成功判定は保持する", async () => {
    const paths: string[] = [];
    const dependencies = happyPath({
      checkRuns: {
        check_runs: [
          {
            name: CHECK,
            conclusion: "failure",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/123/job/1",
          },
          {
            name: CHECK,
            conclusion: "success",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/123/job/2",
          },
        ],
      },
    });
    const result = await resolvePostMergeEvidence({
      repo: REPO,
      sha: SHA,
      before: BEFORE,
      forced: false,
      branch: "main",
      checkName: CHECK,
      api: async (path) => {
        paths.push(path);
        return dependencies.api(path);
      },
    });

    expect(result.skip).toBe(true);
    expect(
      paths.filter((path) => path === `/repos/${REPO}/actions/runs/123`),
    ).toHaveLength(1);
  });

  it("Actions run照会の件数上限を超えた未確認証拠はスキップに使わない", async () => {
    const paths: string[] = [];
    const dependencies = happyPath({
      checkRuns: {
        check_runs: Array.from(
          { length: CHECK_RUN_EVIDENCE_MAX_LOOKUPS + 1 },
          (_, index) => ({
            name: CHECK,
            conclusion: "failure",
            app: { slug: "github-actions" },
            details_url: `https://github.com/o/r/actions/runs/${1000 + index}/job/1`,
          }),
        ),
      },
      workflowRun: {
        event: "push",
        path: ".github/workflows/ci.yml",
        head_sha: HEAD,
        conclusion: "failure",
      },
    });
    const result = await resolvePostMergeEvidence({
      repo: REPO,
      sha: SHA,
      before: BEFORE,
      forced: false,
      branch: "main",
      checkName: CHECK,
      api: async (path) => {
        paths.push(path);
        return dependencies.api(path);
      },
    });

    expect(result).toEqual({
      skip: false,
      reason: "own-check-run-not-successful",
    });
    expect(
      paths.filter((path) => /\/actions\/runs\/\d+$/.test(path)),
    ).toHaveLength(CHECK_RUN_EVIDENCE_MAX_LOOKUPS);
  });

  it("Actions run照会の累積timeoutで応答しないAPIをfail-closedする", async () => {
    vi.useFakeTimers();
    try {
      const dependencies = happyPath();
      const resultPromise = resolvePostMergeEvidence({
        repo: REPO,
        sha: SHA,
        before: BEFORE,
        forced: false,
        branch: "main",
        checkName: CHECK,
        api: async (path) => {
          if (path === `/repos/${REPO}/actions/runs/123`)
            return new Promise(() => {});
          return dependencies.api(path);
        },
      });

      await vi.advanceTimersByTimeAsync(CHECK_RUN_EVIDENCE_TIMEOUT_MS);
      await expect(resultPromise).resolves.toEqual({
        skip: false,
        reason: "check-runs-api-failed",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      "force push",
      {} as Parameters<typeof happyPath>[0],
      { forced: true },
      "forced-push",
    ],
    [
      "before が全 0 (ブランチ新規作成)",
      {},
      { before: "0".repeat(40) },
      "base-sha-unresolved",
    ],
    ["sha が解決できない", {}, { sha: "not-a-sha" }, "head-sha-unresolved"],
    [
      "PR 一覧 API が失敗 (権限不足を含む)",
      { apiError: "/pulls" },
      {},
      "pulls-api-failed",
    ],
    [
      "PR 一覧が配列でない",
      { pulls: { message: "Not Found" } },
      {},
      "pulls-response-invalid",
    ],
    ["直 push (紐づく PR が無い)", { pulls: [] }, {}, "no-merged-pull-request"],
    [
      "PR が未マージ",
      {
        pulls: [
          {
            number: 1,
            merged_at: null,
            merge_commit_sha: SHA,
            base: { ref: "main" },
            head: { sha: HEAD },
          },
        ],
      },
      {},
      "no-merged-pull-request",
    ],
    [
      "別の commit のマージ (merge_commit_sha 不一致)",
      {
        pulls: [
          {
            number: 1,
            merged_at: "x",
            merge_commit_sha: "d".repeat(40),
            base: { ref: "main" },
            head: { sha: HEAD },
          },
        ],
      },
      {},
      "no-merged-pull-request",
    ],
    [
      "base が main でない PR",
      {
        pulls: [
          {
            number: 1,
            merged_at: "x",
            merge_commit_sha: SHA,
            base: { ref: "dev" },
            head: { sha: HEAD },
          },
        ],
      },
      {},
      "no-merged-pull-request",
    ],
    [
      "check-runs API が失敗",
      { apiError: "/check-runs" },
      {},
      "check-runs-api-failed",
    ],
    [
      "workflow run API が timeout / 失敗",
      { apiError: "/actions/runs" },
      {},
      "check-runs-api-failed",
    ],
    [
      "check-runs の形が不正",
      { checkRuns: {} },
      {},
      "check-runs-response-invalid",
    ],
    [
      "この job の check run が存在しない",
      {
        checkRuns: {
          check_runs: [{ name: "gitleaks", conclusion: "success" }],
        },
      },
      {},
      "own-check-run-missing",
    ],
    [
      "この job の check run が失敗している",
      {
        checkRuns: {
          check_runs: [
            {
              name: CHECK,
              conclusion: "failure",
              app: { slug: "github-actions" },
            },
          ],
        },
      },
      {},
      "own-check-run-not-successful",
    ],
    [
      "この job の check run が未完了",
      {
        checkRuns: {
          check_runs: [
            {
              name: CHECK,
              conclusion: null,
              app: { slug: "github-actions" },
            },
          ],
        },
      },
      {},
      "own-check-run-not-successful",
    ],
    [
      "PR head commit API が失敗",
      { apiError: "/git/commits/" },
      {},
      "pull-head-commit-api-failed",
    ],
    [
      "PR head commit の形が不正",
      { commit: { sha: HEAD } },
      {},
      "pull-head-commit-invalid",
    ],
    [
      "着地 commit API が失敗",
      { apiError: `/git/commits/${SHA}` },
      {},
      "landed-commit-api-failed",
    ],
    [
      "着地 commit の形が不正",
      { landedCommit: { sha: SHA } },
      {},
      "landed-commit-invalid",
    ],
    [
      "main ancestry compare API が失敗",
      { apiError: "/compare/" },
      {},
      "base-ancestor-api-failed",
    ],
    [
      "陳腐化した PR (before が PR head の祖先でない)",
      { comparison: { status: "behind" } },
      {},
      "base-not-ancestor-of-pull-head",
    ],
    [
      "着地したツリーが検証済みツリーと違う",
      { trees: { [SHA]: OTHER_TREE, [HEAD]: TREE } },
      {},
      "tree-mismatch",
    ],
  ])(
    "%s のときはスキップせず全ゲートを実行する",
    async (_label, overrides, input, reason) => {
      const result = await call(overrides, input);
      expect(
        result,
        "確認できなかった前提を「安全」と読み替えてはいけない",
      ).toEqual({ skip: false, reason });
    },
  );

  it("eligible なPR checkが失敗だけならスキップしない", async () => {
    const result = await call({
      checkRuns: {
        check_runs: [
          {
            name: CHECK,
            conclusion: "failure",
            app: { slug: "github-actions" },
            details_url: "https://github.com/o/r/actions/runs/123/job/1",
          },
        ],
      },
      workflowRun: {
        event: "pull_request",
        path: ".github/workflows/ci.yml",
        head_sha: HEAD,
        conclusion: "failure",
      },
    });
    expect(result.skip).toBe(false);
    expect(result.reason).toBe("own-check-run-not-successful");
  });

  it.each([
    [
      "別 App の同名 check",
      {
        checkRuns: {
          check_runs: [
            {
              name: CHECK,
              conclusion: "success",
              app: { slug: "third-party" },
              details_url: "https://github.com/o/r/actions/runs/123/job/1",
            },
          ],
        },
      },
    ],
    [
      "別 workflow",
      {
        workflowRun: {
          event: "pull_request",
          path: ".github/workflows/other.yml",
          head_sha: HEAD,
          conclusion: "success",
        },
      },
    ],
    [
      "push event",
      {
        workflowRun: {
          event: "push",
          path: ".github/workflows/ci.yml",
          head_sha: HEAD,
          conclusion: "success",
        },
      },
    ],
    [
      "別 head",
      {
        workflowRun: {
          event: "pull_request",
          path: ".github/workflows/ci.yml",
          head_sha: "d".repeat(40),
          conclusion: "success",
        },
      },
    ],
  ])("%s の成功は当 job の証拠として扱わない", async (_label, overrides) => {
    expect(await call(overrides)).toEqual({
      skip: false,
      reason: "own-check-run-not-successful",
    });
  });

  it("check-runs を 100 件要求し pagination による見落としを防ぐ", async () => {
    const paths: string[] = [];
    const dependencies = happyPath();
    await resolvePostMergeEvidence({
      repo: REPO,
      sha: SHA,
      before: BEFORE,
      forced: false,
      branch: "main",
      checkName: CHECK,
      api: async (path) => {
        paths.push(path);
        return dependencies.api(path);
      },
    });
    expect(paths).toContain(`/repos/${REPO}/git/commits/${HEAD}`);
    expect(paths).toContain(`/repos/${REPO}/git/commits/${SHA}`);
    expect(paths).toContain(
      `/repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`,
    );
    expect(paths).toContain(`/repos/${REPO}/compare/${BEFORE}...${HEAD}`);
  });

  it("昇格の祖先関係もCompare APIで確認し、ローカルgitのcommit形状に依存しない", async () => {
    const paths: string[] = [];
    const dependencies = happyPath({
      pulls: [
        {
          number: 519,
          merged_at: "2026-08-14T16:30:35Z",
          merge_commit_sha: SHA,
          base: { ref: "dev" },
          head: { ref: "main", sha: HEAD, repo: { full_name: REPO } },
        },
      ],
    });
    const result = await resolvePostMergeEvidence({
      repo: REPO,
      sha: SHA,
      before: BEFORE,
      forced: false,
      branch: "dev",
      checkName: CHECK,
      api: async (path) => {
        paths.push(path);
        return dependencies.api(path);
      },
    });
    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
    expect(paths).toContain(`/repos/${REPO}/compare/${BEFORE}...${SHA}`);
  });

  it("着地 tree は commit API で検証し、ローカル git の tree 解決に依存しない", async () => {
    const dependencies = happyPath();
    const result = await resolvePostMergeEvidence({
      repo: REPO,
      sha: SHA,
      before: BEFORE,
      forced: false,
      branch: "main",
      checkName: CHECK,
      api: dependencies.api,
    });
    expect(result).toEqual({
      skip: true,
      reason: "verified-by-merged-pull-request",
    });
  });
});

describe("マージ後証拠の外部 I/O timeout (#496)", () => {
  it("GitHub API fetch に短い AbortSignal timeout を渡す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    const timeoutMock = vi.fn().mockReturnValue({ aborted: false });
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("AbortSignal", { timeout: timeoutMock });
    try {
      await githubApi("/test");
      expect(timeoutMock).toHaveBeenCalledWith(EVIDENCE_IO_TIMEOUT_MS);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(
        timeoutMock.mock.results[0]?.value,
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("GitHub API の非2xx本文をcancelし、変更パス判定はfail-openする", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      body: { cancel },
    });
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        resolveChangedPaths({
          repo: "AutoDevJapan/FourBrosMahjong",
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          local: () => null,
          api: githubApi,
        }),
      ).resolves.toEqual({ paths: null, source: "unresolved" });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it.each([
    [
      "上限超過",
      `{"files":[{"filename":"src/app.ts","patch":"${"x".repeat(GITHUB_API_RESPONSE_MAX_BYTES)}"}]}`,
    ],
    ["不正JSON", '{"files":'],
  ])(
    "Compare API fallbackの%s本文は全検証側へfail-openする",
    async (_label, body) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(body, { status: 200 }));
      vi.stubEnv("GITHUB_TOKEN", "test-token");
      vi.stubGlobal("fetch", fetchMock);
      try {
        await expect(
          resolveChangedPaths({
            repo: "AutoDevJapan/FourBrosMahjong",
            baseSha: "a".repeat(40),
            headSha: "b".repeat(40),
            local: () => null,
            api: githubApi,
          }),
        ).resolves.toEqual({ paths: null, source: "unresolved" });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    },
  );
});

/**
 * ガードは「**この job 自身**の check が PR で緑だったか」を見る。job の `name` と
 * `SCOPE_CHECK_NAME` がずれると、存在しない check 名を探して常に
 * `own-check-run-missing` になる = ガードは安全側に倒れるが、削減が丸ごと消える。
 * 静かに効果だけ失う変更なので設定側で固定する (#496)。
 */
describe("ガードが参照する check 名が job 名と一致する (#496)", () => {
  it("証拠 API は read-only の必要権限だけを持つ", () => {
    expect(readWorkflowFile("ci.yml").permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
      checks: "read",
      actions: "read",
    });
  });

  it("SCOPE_CHECK_NAME は job の name と完全一致する", () => {
    const workflow = readWorkflowFile("ci.yml");
    let checked = 0;
    for (const [jobName, definition] of Object.entries(workflow.jobs ?? {})) {
      const scope = (definition.steps ?? []).find(
        (step) => step.id === "scope",
      );
      if (!scope) continue;
      checked += 1;
      expect(
        scope.env?.SCOPE_CHECK_NAME,
        `${jobName}: SCOPE_CHECK_NAME が job の name と一致していない`,
      ).toBe(definition.name);
      // トークンが無ければ API を呼べず、ガードは常にフェイルセーフ側へ倒れる。
      expect(
        scope.env?.GITHUB_TOKEN,
        `${jobName}: GITHUB_TOKEN が渡されていないとガードが常に失敗する`,
      ).toBeTypeOf("string");
      expect(
        scope.env?.SCOPE_FORCED,
        `${jobName}: force push を検知できない`,
      ).toBeTypeOf("string");
    }
    expect(checked, "scope step を持つ job が無い").toBe(2);
  });

  it("ガードに必要な read 権限が付与されている", () => {
    const workflow = readWorkflowFile("ci.yml") as {
      permissions?: Record<string, string>;
    };
    const permissions = workflow.permissions ?? {};
    // PR の紐づけと check run の結果を読むために必要。
    expect(permissions["pull-requests"]).toBe("read");
    expect(permissions.checks).toBe("read");
    // 昇格した権限は要らない設計であることを固定する。
    for (const [scope, level] of Object.entries(permissions)) {
      expect(level, `${scope}: write 権限は不要なはず`).toBe("read");
    }
  });
});

/**
 * 上のテストは API を差し替えて分岐を網羅するが、**実際に発行する API の組み合わせが
 * 意図どおり動くか**は検証していない。マージ後は PR head ref が消えることがあるため、
 * ephemeral ref や checkout の commit 形状に依存せず、landed / PR head の commit API の
 * tree と compare API で証拠を確認する。本物のリポジトリで squash マージを再現して
 * 固定する (#496)。
 */
describe("マージ後ガードの API 操作が実物で動く (#496)", () => {
  type Repo = {
    dir: string;
    landed: string;
    pullHead: string;
    before: string;
    stale: boolean;
    cleanup: () => void;
  };

  /**
   * `origin` を持つ実リポジトリを作り、squash マージ相当の履歴を用意する。
   * @param stale `true` なら PR が古い main のまま取り込まれた(= strict を外した)状況にする。
   */
  function createMergedRepository(stale: boolean): Repo {
    const root = mkdtempSync(join(tmpdir(), "postmerge-"));
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    // git の進捗・警告出力はテストログのノイズにしかならないので捨てる。
    const quiet = {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    } satisfies Parameters<typeof execFileSync>[2];
    const run = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, ...quiet }).trim();

    execFileSync(
      "git",
      ["init", "--quiet", "--bare", "-b", "main", origin],
      quiet,
    );
    execFileSync("git", ["clone", "--quiet", origin, work], quiet);
    run(work, "config", "user.email", "test@example.com");
    run(work, "config", "user.name", "test");
    run(work, "config", "commit.gpgsign", "false");

    writeFileSync(join(work, "a.txt"), "base\n");
    run(work, "add", "-A");
    run(work, "commit", "--quiet", "-m", "base");
    run(work, "push", "--quiet", "origin", "main");

    // PR ブランチ: base を取り込んだ状態で 1 コミット。
    run(work, "checkout", "--quiet", "-b", "feature");
    writeFileSync(join(work, "b.txt"), "feature\n");
    run(work, "add", "-A");
    run(work, "commit", "--quiet", "-m", "feature");
    const pullHead = run(work, "rev-parse", "HEAD");
    run(work, "checkout", "--quiet", "main");
    if (stale) {
      // main が独自に進む = PR は古い main のまま(strict を外した状況)。
      writeFileSync(join(work, "c.txt"), "advanced on main\n");
      run(work, "add", "-A");
      run(work, "commit", "--quiet", "-m", "advance main");
    }
    const before = run(work, "rev-parse", "HEAD");

    // squash マージ相当: feature のツリーをそのまま main の上に載せる。
    run(work, "merge", "--quiet", "--squash", "feature");
    run(work, "commit", "--quiet", "-m", "squash merge (#492)");
    const landed = run(work, "rev-parse", "HEAD");
    run(work, "push", "--quiet", "origin", "main");

    return {
      dir: work,
      landed,
      pullHead,
      before,
      stale,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  }

  function apiFor(repo: Repo, checkName: string) {
    return async (path: string) => {
      if (path.endsWith("/pulls"))
        return [
          {
            number: 492,
            merged_at: "2026-08-05T18:33:23Z",
            merge_commit_sha: repo.landed,
            base: { ref: "main" },
            head: { sha: repo.pullHead },
          },
        ];
      if (path.includes("/check-runs?"))
        return {
          check_runs: [
            {
              name: checkName,
              conclusion: "success",
              app: { slug: "github-actions" },
              details_url: "https://github.com/o/r/actions/runs/123/job/456",
            },
          ],
        };
      if (path.endsWith("/actions/runs/123"))
        return {
          event: "pull_request",
          path: ".github/workflows/ci.yml",
          head_sha: repo.pullHead,
          conclusion: "success",
        };
      if (path.endsWith(`/git/commits/${repo.landed}`))
        return {
          sha: repo.landed,
          tree: {
            sha: execFileSync("git", ["rev-parse", `${repo.landed}^{tree}`], {
              cwd: repo.dir,
              encoding: "utf8",
            }).trim(),
          },
        };
      if (path.endsWith(`/git/commits/${repo.pullHead}`))
        return {
          sha: repo.pullHead,
          tree: {
            sha: execFileSync("git", ["rev-parse", `${repo.pullHead}^{tree}`], {
              cwd: repo.dir,
              encoding: "utf8",
            }).trim(),
          },
        };
      if (path.includes(`/compare/${repo.before}...${repo.pullHead}`))
        return { status: repo.stale ? "behind" : "ahead" };
      throw new Error(`unexpected ${path}`);
    };
  }

  const CHECK = "lint / typecheck / format / test / build";

  it("PR head ref が消えていても commit API の証拠で squash マージをスキップする", async () => {
    const repo = createMergedRepository(false);
    try {
      const result = await resolvePostMergeEvidence({
        repo: "owner/name",
        sha: repo.landed,
        before: repo.before,
        forced: false,
        branch: "main",
        checkName: CHECK,
        api: apiFor(repo, CHECK),
      });
      expect(result).toEqual({
        skip: true,
        reason: "verified-by-merged-pull-request",
      });
    } finally {
      repo.cleanup();
    }
  });

  it("陳腐化した PR のマージはスキップしない", async () => {
    // main が進んだ後に古い PR を入れた状況。PR の CI が緑にしたツリーと
    // 実際に着地したツリーは別物であり、着地内容は誰も検証していない。
    const repo = createMergedRepository(true);
    try {
      const result = await resolvePostMergeEvidence({
        repo: "owner/name",
        sha: repo.landed,
        before: repo.before,
        forced: false,
        branch: "main",
        checkName: CHECK,
        api: apiFor(repo, CHECK),
      });
      expect(result.skip, "未検証のツリーが検証されずに素通りする").toBe(false);
      expect(result.reason).toBe("base-not-ancestor-of-pull-head");
    } finally {
      repo.cleanup();
    }
  });
});
