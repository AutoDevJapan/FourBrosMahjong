import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  CI_PAGE_SIZE,
  hasTrustedCiRun,
  MAX_CI_PAGES,
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
  head_sha: SHA,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  path: ".github/workflows/ci.yml",
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
});

describe("release ancestry guard (#507)", () => {
  it("refreshes origin/main before checking exact tag ancestry", () => {
    const git = vi.fn(() => "");
    verifyTagOnMain({ sha: SHA, git });
    expect(git.mock.calls).toEqual([
      [["fetch", "--quiet", "--no-tags", "origin", "main"]],
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
    const api = vi.fn(async () => ({ workflow_runs: [trustedRun] }));
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(true);
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("/actions/workflows/ci.yml/runs?"),
    );
  });

  it("does not trust a third-party run or same-name check-shaped data", async () => {
    const api = vi.fn(async () => ({
      workflow_runs: [
        { ...trustedRun, path: ".github/workflows/untrusted.yml" },
        {
          name: "lint / typecheck / format / test / build",
          conclusion: "success",
        },
      ],
    }));
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).resolves.toBe(false);
  });

  it("follows full pages and can find evidence on a later page", async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({
        workflow_runs: Array.from({ length: CI_PAGE_SIZE }, () => ({
          ...trustedRun,
          head_sha: "b".repeat(40),
        })),
      })
      .mockResolvedValueOnce({ workflow_runs: [trustedRun] });
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
    const api = vi.fn(async () => ({ workflow_runs: fullPage }));
    await expect(
      hasTrustedCiRun({ repo: "owner/repo", sha: SHA, api }),
    ).rejects.toThrow(/pagination safety limit/);
    expect(api).toHaveBeenCalledTimes(MAX_CI_PAGES);
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
    expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
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
  });
});
