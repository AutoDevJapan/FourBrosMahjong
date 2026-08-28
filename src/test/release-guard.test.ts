import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  CI_PAGE_SIZE,
  CODEQL_CHECK_NAMES,
  hasTrustedCiRun,
  hasTrustedReleaseEvidence,
  MAX_CI_PAGES,
  MAX_CODEQL_CANDIDATES,
  releaseNotesFromChangelog,
  validateReleaseMetadata,
  verifyTagOnMain,
  versionFromTag,
} from "../../.github/scripts/release-guard.mjs";

const SHA = "a".repeat(40);
const metadata = (version = "1.2.3") => ({
  tag: `v${version}`,
  packageJson: JSON.stringify({ version }),
  changelog: `# Changelog\n\n## [${version}] - 2026-08-11\n\n- Released.\n\n## [1.0.0] - 2026-01-01\n\n- Initial.\n`,
});

const trustedRun = {
  id: 101,
  check_suite_id: 201,
  head_sha: SHA,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  path: ".github/workflows/ci.yml@main",
};

const githubActionsApp = {
  id: 15368,
  slug: "github-actions",
  owner: { login: "github" },
};
const gitleaksRun = {
  ...trustedRun,
  id: 102,
  check_suite_id: 202,
  path: ".github/workflows/gitleaks.yml",
};
const codeqlRun = {
  ...trustedRun,
  id: 103,
  check_suite_id: 203,
  event: "dynamic",
  path: "dynamic/github-code-scanning/codeql",
};
const codeqlSuite = {
  id: 203,
  latest_check_runs_count: 2,
  head_sha: SHA,
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  app: githubActionsApp,
};
const codeqlChecks = CODEQL_CHECK_NAMES.map((name, index) => ({
  id: 301 + index,
  name,
  head_sha: SHA,
  status: "completed",
  conclusion: "success",
  app: githubActionsApp,
  check_suite: { id: 203 },
}));

type EvidenceApiOptions = {
  ciRuns?: unknown[];
  gitleaksRuns?: unknown[];
  workflows?: unknown[];
  codeqlRuns?: unknown[];
  suite?: unknown;
  checks?: unknown[];
  checksTotal?: number;
  ciTotal?: number;
  gitleaksTotal?: number;
  workflowsTotal?: number;
  codeqlTotal?: number;
  invalidResponseAt?: string;
  throwAt?: string;
};

const releaseEvidenceApi = (options: EvidenceApiOptions = {}) => {
  const {
    ciRuns = [trustedRun],
    gitleaksRuns = [gitleaksRun],
    workflows = [
      {
        id: 303,
        name: "CodeQL",
        path: "dynamic/github-code-scanning/codeql",
        state: "active",
      },
    ],
    codeqlRuns = [codeqlRun],
    suite = codeqlSuite,
    checks = codeqlChecks,
    checksTotal = checks.length,
    ciTotal = ciRuns.length,
    gitleaksTotal = gitleaksRuns.length,
    workflowsTotal = workflows.length,
    codeqlTotal = codeqlRuns.length,
    invalidResponseAt,
    throwAt,
  } = options;
  return vi.fn(async (path: string) => {
    if (throwAt && path.includes(throwAt)) throw new Error("API 503");
    if (invalidResponseAt && path.includes(invalidResponseAt)) return {};
    if (path.includes("/actions/workflows/ci.yml/runs?"))
      return { total_count: ciTotal, workflow_runs: ciRuns };
    if (path.includes("/actions/workflows/gitleaks.yml/runs?"))
      return { total_count: gitleaksTotal, workflow_runs: gitleaksRuns };
    if (path.includes("/actions/workflows/303/runs?"))
      return { total_count: codeqlTotal, workflow_runs: codeqlRuns };
    if (path.includes("/actions/workflows?"))
      return { total_count: workflowsTotal, workflows };
    if (path.endsWith("/check-suites/203")) return suite;
    if (path.includes("/check-suites/203/check-runs?"))
      return { total_count: checksTotal, check_runs: checks };
    throw new Error(`unexpected API path: ${path}`);
  });
};

describe("release metadata guard (#507)", () => {
  it("keeps the repository's current package version releasable from its documented section", () => {
    const packageJson = readFileSync(
      resolve(process.cwd(), "package.json"),
      "utf8",
    );
    const changelog = readFileSync(
      resolve(process.cwd(), "CHANGELOG.md"),
      "utf8",
    );
    const version = JSON.parse(packageJson).version as string;
    expect(
      validateReleaseMetadata({ tag: `v${version}`, packageJson, changelog }),
    ).toBe(version);
  });

  it.each(["v0.1.0", "v1.2.3", "v1.2.3-rc.1", "v1.2.3-alpha-1"])(
    "accepts the documented tag grammar: %s",
    (tag) => expect(versionFromTag(tag)).toBe(tag.slice(1)),
  );

  it.each([
    "vfoo",
    "v1",
    "v1.2",
    "v01.2.3",
    "v1.02.3",
    "v1.2.03",
    "v1.2.3-01",
    "v1.2.3+build",
    "1.2.3",
    "v1.2.3-",
  ])("rejects ambiguous or unsupported tags: %s", (tag) => {
    expect(() => versionFromTag(tag)).toThrow();
  });

  it("requires package.json and a dated, non-empty CHANGELOG section", () => {
    expect(validateReleaseMetadata(metadata())).toBe("1.2.3");
    expect(() =>
      validateReleaseMetadata({
        ...metadata(),
        packageJson: '{"version":"1.2.4"}',
      }),
    ).toThrow(/package\.json/);
    expect(() =>
      validateReleaseMetadata({
        ...metadata(),
        changelog: "## [1.2.3]\n- no date",
      }),
    ).toThrow(/CHANGELOG/);
    expect(() =>
      validateReleaseMetadata({
        ...metadata(),
        changelog: "## [1.2.3] - 2026-08-11\n\n## [1.0.0] - 2026-01-01\n- old",
      }),
    ).toThrow(/empty/);
  });

  it("uses one parser for validation and the published release body", () => {
    const input = metadata();
    expect(
      releaseNotesFromChangelog({
        version: "1.2.3",
        changelog: input.changelog,
      }),
    ).toBe("- Released.\n");
    expect(() =>
      validateReleaseMetadata({
        ...input,
        changelog:
          "## [1.2.3] - 2026-08-11\n\n[1.2.3]: https://example.test/release\n",
      }),
    ).toThrow(/empty/);
    expect(() =>
      validateReleaseMetadata({
        ...input,
        changelog: "## [1.2.3] - 2026-02-30\n- impossible date\n",
      }),
    ).toThrow(/invalid date/);
    expect(() =>
      validateReleaseMetadata({
        ...input,
        changelog: `${input.changelog}\n## [1.2.3] - 2026-08-12\n- duplicate\n`,
      }),
    ).toThrow(/duplicate/);
  });
});

describe("release ancestry guard (#507)", () => {
  it("refreshes origin/main before checking exact tag ancestry", () => {
    const git = vi.fn(() => "");
    verifyTagOnMain({ sha: SHA, git });
    expect(git.mock.calls).toEqual([
      [
        [
          "fetch",
          "--quiet",
          "--no-tags",
          "origin",
          "+refs/heads/main:refs/remotes/origin/main",
        ],
      ],
      [["merge-base", "--is-ancestor", SHA, "origin/main"]],
    ]);
  });

  it("propagates fetch and non-ancestor failures", () => {
    expect(() =>
      verifyTagOnMain({
        sha: SHA,
        git: () => {
          throw new Error("git failed");
        },
      }),
    ).toThrow("git failed");
  });
});

describe("trusted CI evidence guard (#507)", () => {
  it("accepts only the workflow-specific successful main push for the exact SHA", async () => {
    const api = vi.fn(async () => ({
      total_count: 1,
      workflow_runs: [trustedRun],
    }));
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(true);
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("/actions/workflows/ci.yml/runs?"),
    );
  });

  it("does not trust third-party paths even when a run copies the expected name", async () => {
    const api = vi.fn(async () => ({
      total_count: 3,
      workflow_runs: [
        { ...trustedRun, id: 401, path: ".github/workflows/untrusted.yml" },
        { ...trustedRun, id: 402, path: ".github/workflows/ci.yml@feature" },
        {
          ...trustedRun,
          id: 403,
          name: "lint / typecheck / format / test / build",
          path: ".github/workflows/copied-name.yml",
        },
      ],
    }));
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(false);
  });

  it("validates every received page element before accepting an earlier success", async () => {
    const api = vi.fn(async () => ({
      total_count: 2,
      workflow_runs: [trustedRun, { ...trustedRun, id: 404, path: 123 }],
    }));
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).rejects.toThrow(/workflow-runs response is invalid/);
  });

  it("follows full pages and can find evidence on a later page", async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({
        total_count: CI_PAGE_SIZE + 1,
        workflow_runs: Array.from({ length: CI_PAGE_SIZE }, () => ({
          ...trustedRun,
          head_sha: "b".repeat(40),
        })),
      })
      .mockResolvedValueOnce({
        total_count: CI_PAGE_SIZE + 1,
        workflow_runs: [trustedRun],
      });
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(true);
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1]?.[0]).toContain("page=2");
  });

  it("fails closed for API errors, invalid responses, and an exhausted page cap", async () => {
    await expect(
      hasTrustedCiRun({
        repo: "owner/repo",
        sha: SHA,
        api: async () => {
          throw new Error("503");
        },
      }),
    ).rejects.toThrow("503");
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api: async () => ({}) }),
    ).rejects.toThrow(/invalid/);

    const fullPage = Array.from({ length: CI_PAGE_SIZE }, () => ({
      ...trustedRun,
      head_sha: "b".repeat(40),
    }));
    const api = vi.fn(async () => ({
      total_count: CI_PAGE_SIZE * MAX_CI_PAGES + 1,
      workflow_runs: fullPage,
    }));
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).rejects.toThrow(/pagination safety limit/);
    expect(api).toHaveBeenCalledTimes(MAX_CI_PAGES);
  });
});

describe("trusted release security evidence guard (#748)", () => {
  it("binds exact-SHA CI and gitleaks runs to the default CodeQL workflow suite", async () => {
    const api = releaseEvidenceApi();
    await expect(
      hasTrustedReleaseEvidence({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(true);
    expect(api.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/actions/workflows/gitleaks.yml/runs?"),
        expect.stringContaining("/actions/workflows?"),
        expect.stringContaining("/actions/workflows/303/runs?"),
        "/repos/owner/repo/check-suites/203",
        expect.stringContaining("/check-suites/203/check-runs?"),
      ]),
    );
  });

  it.each([
    [
      "pending gitleaks",
      {
        gitleaksRuns: [
          { ...gitleaksRun, status: "in_progress", conclusion: null },
        ],
      },
    ],
    [
      "failed gitleaks",
      { gitleaksRuns: [{ ...gitleaksRun, conclusion: "failure" }] },
    ],
    [
      "cancelled gitleaks",
      { gitleaksRuns: [{ ...gitleaksRun, conclusion: "cancelled" }] },
    ],
    [
      "wrong-SHA gitleaks",
      { gitleaksRuns: [{ ...gitleaksRun, head_sha: "b".repeat(40) }] },
    ],
    [
      "wrong-path gitleaks",
      {
        gitleaksRuns: [{ ...gitleaksRun, path: ".github/workflows/fake.yml" }],
      },
    ],
    ["missing CodeQL", { codeqlRuns: [] }],
    [
      "pending CodeQL",
      { codeqlRuns: [{ ...codeqlRun, status: "queued", conclusion: null }] },
    ],
    [
      "failed CodeQL",
      { codeqlRuns: [{ ...codeqlRun, conclusion: "failure" }] },
    ],
    [
      "cancelled CodeQL",
      { codeqlRuns: [{ ...codeqlRun, conclusion: "cancelled" }] },
    ],
    [
      "wrong-SHA CodeQL",
      { codeqlRuns: [{ ...codeqlRun, head_sha: "b".repeat(40) }] },
    ],
    ["wrong-event CodeQL", { codeqlRuns: [{ ...codeqlRun, event: "push" }] }],
    [
      "wrong-path CodeQL",
      { codeqlRuns: [{ ...codeqlRun, path: ".github/workflows/codeql.yml" }] },
    ],
    [
      "ref-suffixed CodeQL path",
      { codeqlRuns: [{ ...codeqlRun, path: `${codeqlRun.path}@main` }] },
    ],
    [
      "inactive CodeQL",
      {
        workflows: [
          {
            id: 303,
            path: "dynamic/github-code-scanning/codeql",
            state: "disabled_manually",
          },
        ],
      },
    ],
  ])("rejects %s evidence", async (_name, options) => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi(options),
      }),
    ).resolves.toBe(false);
  });

  it("keeps immutable exact-tree success valid across later failed reruns in either order", async () => {
    const failedRerun = {
      ...gitleaksRun,
      id: gitleaksRun.id + 100,
      conclusion: "failure",
    };
    for (const runs of [
      [gitleaksRun, failedRerun],
      [failedRerun, gitleaksRun],
    ]) {
      await expect(
        hasTrustedReleaseEvidence({
          repo: "owner/repo",
          sha: SHA,
          api: releaseEvidenceApi({ gitleaksRuns: runs }),
        }),
      ).resolves.toBe(true);
    }
  });

  it("keeps a successful CodeQL chain valid across later failed runs in either order", async () => {
    const failedRun = {
      ...codeqlRun,
      id: codeqlRun.id + 100,
      conclusion: "failure",
    };
    for (const runs of [
      [codeqlRun, failedRun],
      [failedRun, codeqlRun],
    ]) {
      await expect(
        hasTrustedReleaseEvidence({
          repo: "owner/repo",
          sha: SHA,
          api: releaseEvidenceApi({ codeqlRuns: runs }),
        }),
      ).resolves.toBe(true);
    }
  });

  it.each([
    [
      "suite app",
      { suite: { ...codeqlSuite, app: { ...githubActionsApp, id: 1 } } },
    ],
    ["suite id", { suite: { ...codeqlSuite, id: 999 } }],
    ["suite branch", { suite: { ...codeqlSuite, head_branch: "feature" } }],
    [
      "suite app owner",
      {
        suite: {
          ...codeqlSuite,
          app: { ...githubActionsApp, owner: { login: "third-party" } },
        },
      },
    ],
    ["suite SHA", { suite: { ...codeqlSuite, head_sha: "b".repeat(40) } }],
    [
      "suite pending",
      { suite: { ...codeqlSuite, status: "in_progress", conclusion: null } },
    ],
    [
      "check app",
      {
        checks: [
          {
            ...codeqlChecks[0],
            app: { ...githubActionsApp, slug: "third-party" },
          },
          codeqlChecks[1],
        ],
      },
    ],
    [
      "check app owner",
      {
        checks: [
          {
            ...codeqlChecks[0],
            app: {
              ...githubActionsApp,
              owner: { login: "third-party" },
            },
          },
          codeqlChecks[1],
        ],
      },
    ],
    [
      "check SHA",
      {
        checks: [
          { ...codeqlChecks[0], head_sha: "b".repeat(40) },
          codeqlChecks[1],
        ],
      },
    ],
    [
      "check suite binding",
      {
        checks: [
          { ...codeqlChecks[0], check_suite: { id: 999 } },
          codeqlChecks[1],
        ],
      },
    ],
    [
      "check failure",
      {
        checks: [
          { ...codeqlChecks[0], conclusion: "failure" },
          codeqlChecks[1],
        ],
      },
    ],
    [
      "check pending",
      {
        checks: [
          { ...codeqlChecks[0], status: "queued", conclusion: null },
          codeqlChecks[1],
        ],
      },
    ],
    [
      "missing category",
      {
        suite: { ...codeqlSuite, latest_check_runs_count: 1 },
        checks: [codeqlChecks[0]],
        checksTotal: 1,
      },
    ],
    [
      "extra category",
      {
        checks: [
          ...codeqlChecks,
          { ...codeqlChecks[0], id: 999, name: "Analyze (python)" },
        ],
        suite: { ...codeqlSuite, latest_check_runs_count: 3 },
        checksTotal: 3,
      },
    ],
    [
      "duplicate category",
      {
        checks: [codeqlChecks[0], { ...codeqlChecks[0], id: 999 }],
        checksTotal: 2,
      },
    ],
  ])("rejects mismatched CodeQL %s", async (_name, options) => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi(options),
      }),
    ).resolves.toBe(false);
  });

  it("can use another completed-success CodeQL chain after a well-formed mismatch", async () => {
    const mismatchedRun = { ...codeqlRun, id: 104, check_suite_id: 204 };
    const baseApi = releaseEvidenceApi({
      codeqlRuns: [mismatchedRun, codeqlRun],
    });
    const api = vi.fn(async (path: string) => {
      if (path.endsWith("/check-suites/204")) {
        return { ...codeqlSuite, id: 204, head_sha: "b".repeat(40) };
      }
      return baseApi(path);
    });
    await expect(
      hasTrustedReleaseEvidence({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(true);
  });

  it("does not fall back to another CodeQL candidate after an API failure", async () => {
    const unavailableRun = { ...codeqlRun, id: 104, check_suite_id: 204 };
    const baseApi = releaseEvidenceApi({
      codeqlRuns: [unavailableRun, codeqlRun],
    });
    const api = vi.fn(async (path: string) => {
      if (path.endsWith("/check-suites/204")) throw new Error("API 503");
      return baseApi(path);
    });
    await expect(
      hasTrustedReleaseEvidence({ repo: "owner/repo", sha: SHA, api }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });

  it("does not fall back after a check-runs API rejection", async () => {
    const unavailableRun = { ...codeqlRun, id: 104, check_suite_id: 204 };
    const baseApi = releaseEvidenceApi({
      codeqlRuns: [unavailableRun, codeqlRun],
    });
    const api = vi.fn(async (path: string) => {
      if (path.endsWith("/check-suites/204")) {
        return { ...codeqlSuite, id: 204 };
      }
      if (path.includes("/check-suites/204/check-runs?")) {
        throw new Error("API 403");
      }
      return baseApi(path);
    });
    await expect(
      hasTrustedReleaseEvidence({ repo: "owner/repo", sha: SHA, api }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });

  it("fails closed for API errors and malformed workflow/check responses", async () => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ throwAt: "/actions/workflows?" }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ invalidResponseAt: "/actions/workflows?" }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ invalidResponseAt: "/check-suites/203" }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ invalidResponseAt: "/check-runs?" }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ checksTotal: 3 }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          suite: { ...codeqlSuite, latest_check_runs_count: 3 },
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });

  it("rejects malformed, truncated, or duplicate workflow inventories", async () => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          workflows: [{ id: 404, path: 123, state: "active" }],
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ workflowsTotal: 2 }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          workflows: [
            {
              id: 303,
              path: "dynamic/github-code-scanning/codeql",
              state: "active",
            },
            {
              id: 304,
              path: "dynamic/github-code-scanning/codeql",
              state: "active",
            },
          ],
        }),
      }),
    ).resolves.toBe(false);
  });

  it("rejects malformed or truncated workflow-run inventories without success", async () => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          gitleaksRuns: [{ ...gitleaksRun, path: 123 }],
        }),
      }),
    ).rejects.toThrow("trusted gitleaks evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          gitleaksRuns: [{ ...gitleaksRun, conclusion: "failure" }],
          gitleaksTotal: 2,
        }),
      }),
    ).rejects.toThrow("trusted gitleaks evidence is unavailable");
  });

  it("rejects a short truncated page before accepting its valid run", async () => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ ciTotal: 2 }),
      }),
    ).rejects.toThrow("trusted CI evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ gitleaksTotal: 2 }),
      }),
    ).rejects.toThrow("trusted gitleaks evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ codeqlTotal: 2 }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });

  it("validates every CodeQL candidate suite ID before joining a valid chain", async () => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          codeqlRuns: [
            codeqlRun,
            { ...codeqlRun, id: 104, check_suite_id: "bad" },
          ],
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });

  it.each([0, -1])("rejects non-positive API identifiers: %s", async (id) => {
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ gitleaksRuns: [{ ...gitleaksRun, id }] }),
      }),
    ).rejects.toThrow("trusted gitleaks evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          workflows: [
            {
              id,
              path: "dynamic/github-code-scanning/codeql",
              state: "active",
            },
          ],
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ suite: { ...codeqlSuite, id } }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          checks: [{ ...codeqlChecks[0], id }, codeqlChecks[1]],
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          checks: [
            { ...codeqlChecks[0], check_suite: { id } },
            codeqlChecks[1],
          ],
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });

  it("returns immediately when the first of more than ten CodeQL candidates is valid", async () => {
    const runs = Array.from(
      { length: MAX_CODEQL_CANDIDATES + 1 },
      (_, index) => ({ ...codeqlRun, id: codeqlRun.id + index }),
    );
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({ codeqlRuns: runs }),
      }),
    ).resolves.toBe(true);
  });

  it("does not request a later CodeQL run page after a valid joined chain", async () => {
    const firstPage = [
      codeqlRun,
      ...Array.from({ length: CI_PAGE_SIZE - 1 }, (_, index) => ({
        ...codeqlRun,
        id: 1000 + index,
        path: ".github/workflows/not-codeql.yml",
      })),
    ];
    const baseApi = releaseEvidenceApi({
      codeqlRuns: firstPage,
      codeqlTotal: CI_PAGE_SIZE + 1,
    });
    const api = vi.fn(async (path: string) => {
      if (
        path.includes("/actions/workflows/303/runs?") &&
        path.includes("page=2")
      ) {
        throw new Error("page 2 must not be requested");
      }
      return baseApi(path);
    });
    await expect(
      hasTrustedReleaseEvidence({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(true);
    expect(
      api.mock.calls.some(
        ([path]) =>
          path.includes("/actions/workflows/303/runs?") &&
          path.includes("page=2"),
      ),
    ).toBe(false);
  });

  it("fails closed before evaluating an eleventh mismatched CodeQL candidate", async () => {
    const mismatches = Array.from(
      { length: MAX_CODEQL_CANDIDATES },
      (_, index) => ({
        ...codeqlRun,
        id: 1000 + index,
        check_suite_id: 3000 + index,
      }),
    );
    const baseApi = releaseEvidenceApi({
      codeqlRuns: [...mismatches, codeqlRun],
    });
    const api = vi.fn(async (path: string) => {
      const match = /\/check-suites\/(3\d{3})$/.exec(path);
      if (match) {
        return {
          ...codeqlSuite,
          id: Number(match[1]),
          head_sha: "b".repeat(40),
        };
      }
      return baseApi(path);
    });
    await expect(
      hasTrustedReleaseEvidence({ repo: "owner/repo", sha: SHA, api }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });

  it("fails closed when workflow or check pagination reaches the safety cap", async () => {
    const irrelevantWorkflows = Array.from(
      { length: CI_PAGE_SIZE },
      (_, index) => ({
        id: 1000 + index,
        path: `.github/workflows/other-${index}.yml`,
        state: "active",
      }),
    );
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          workflows: irrelevantWorkflows,
          workflowsTotal: CI_PAGE_SIZE * MAX_CI_PAGES + 1,
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");

    const fullCheckPage = Array.from({ length: CI_PAGE_SIZE }, (_, index) => ({
      ...codeqlChecks[0],
      id: 1000 + index,
      name: `Analyze (other-${index})`,
    }));
    await expect(
      hasTrustedReleaseEvidence({
        repo: "owner/repo",
        sha: SHA,
        api: releaseEvidenceApi({
          checks: fullCheckPage,
          checksTotal: CI_PAGE_SIZE * MAX_CI_PAGES + 1,
          suite: {
            ...codeqlSuite,
            latest_check_runs_count: CI_PAGE_SIZE * MAX_CI_PAGES + 1,
          },
        }),
      }),
    ).rejects.toThrow("trusted CodeQL evidence is unavailable");
  });
});

describe("release workflow contract (#507)", () => {
  it("keeps write authority behind the read-only guard job", () => {
    const workflow = parse(
      readFileSync(
        resolve(process.cwd(), ".github/workflows/release.yml"),
        "utf8",
      ),
    );
    expect(workflow.permissions).toEqual({
      contents: "read",
      actions: "read",
      checks: "read",
    });
    expect(workflow.permissions).not.toHaveProperty("security-events");
    expect(workflow.jobs.validate.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run: "node .github/scripts/release-guard.mjs",
        }),
      ]),
    );
    expect(workflow.jobs.release.needs).toBe("validate");
    expect(workflow.jobs.release.permissions).toEqual({ contents: "write" });
    const publish = workflow.jobs.release.steps.find(
      (step: { uses?: string }) =>
        step.uses?.startsWith("softprops/action-gh-release@"),
    );
    expect(publish.with.generate_release_notes).toBeUndefined();
    expect(publish.with.body_path).toContain("notes_path");
    const extract = workflow.jobs.release.steps.find(
      (step: { id?: string }) => step.id === "changelog",
    );
    expect(extract.run).toContain("release-guard.mjs --extract-notes");
    expect(extract.run).not.toContain("awk");
  });
});
