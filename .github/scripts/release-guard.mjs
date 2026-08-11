// @ts-check
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const GITHUB_API_TIMEOUT_MS = 15_000;
export const CI_PAGE_SIZE = 100;
export const MAX_CI_PAGES = 10;

// SemVer 2.0.0 without build metadata. Release tags are immutable public
// identifiers here, so two tags that differ only by +build metadata are not
// accepted. Numeric identifiers must not contain leading zeroes.
export const RELEASE_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** @param {string} tag */
export function versionFromTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) throw new Error(`release tag is not an allowed SemVer: ${tag}`);
  return tag.slice(1);
}

/**
 * Validate the repository-owned release metadata before consulting remote
 * evidence. A dated, non-empty CHANGELOG section is mandatory; falling back to
 * generated notes would otherwise hide a typo or an unfinished release.
 * @param {{tag: string, packageJson: string, changelog: string}} input
 */
export function validateReleaseMetadata({ tag, packageJson, changelog }) {
  const version = versionFromTag(tag);
  let packageVersion;
  try {
    packageVersion = JSON.parse(packageJson)?.version;
  } catch {
    throw new Error("package.json is not valid JSON");
  }
  if (packageVersion !== version) {
    throw new Error(
      `tag version ${version} does not match package.json version ${String(packageVersion)}`,
    );
  }

  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(
    `^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`,
    "m",
  );
  const headingMatch = heading.exec(changelog);
  if (!headingMatch) {
    throw new Error(`CHANGELOG has no dated section for ${version}`);
  }
  const bodyStart = headingMatch.index + headingMatch[0].length;
  const nextHeading = changelog.slice(bodyStart).search(/^## /m);
  const body = changelog.slice(
    bodyStart,
    nextHeading < 0 ? undefined : bodyStart + nextHeading,
  );
  if (!body.trim())
    throw new Error(`CHANGELOG section for ${version} is empty`);
  return version;
}

/**
 * Require a successful push run of this repository's ci.yml on main for the
 * exact tagged SHA. Querying the workflow-specific endpoint avoids trusting a
 * third-party check merely because it copied a job/check name.
 *
 * Every full page is followed. If the safety cap is reached without observing
 * a short final page, evidence is incomplete and release fails closed.
 * @param {{repo: string, sha: string, api: (path: string) => Promise<unknown>}} input
 */
export async function hasTrustedCiRun({ repo, sha, api }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo))
    throw new Error("repository is unresolved");
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("tag SHA is unresolved");
  for (let page = 1; page <= MAX_CI_PAGES; page += 1) {
    const query = new URLSearchParams({
      branch: "main",
      event: "push",
      status: "completed",
      head_sha: sha,
      per_page: String(CI_PAGE_SIZE),
      page: String(page),
    });
    const response = /** @type {any} */ (
      await api(
        `/repos/${repo}/actions/workflows/ci.yml/runs?${query.toString()}`,
      )
    );
    if (!Array.isArray(response?.workflow_runs)) {
      throw new Error("GitHub workflow-runs response is invalid");
    }
    const runs = response.workflow_runs;
    if (
      runs.some(
        (/** @type {any} */ run) =>
          run?.head_sha === sha &&
          run?.head_branch === "main" &&
          run?.event === "push" &&
          run?.status === "completed" &&
          run?.conclusion === "success" &&
          run?.path === ".github/workflows/ci.yml",
      )
    ) {
      return true;
    }
    if (runs.length < CI_PAGE_SIZE) return false;
  }
  throw new Error("trusted CI evidence exceeded pagination safety limit");
}

/** @param {string} path */
export async function githubApi(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not available");
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${path} -> ${response.status}`);
  return response.json();
}

/** @param {string[]} args */
export function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    timeout: GITHUB_API_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** @param {{sha: string, git: (args: string[]) => string}} input */
export function verifyTagOnMain({ sha, git }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("tag SHA is unresolved");
  git(["fetch", "--quiet", "--no-tags", "origin", "main"]);
  git(["merge-base", "--is-ancestor", sha, "origin/main"]);
}

async function main() {
  const tag = String(process.env.RELEASE_TAG ?? "");
  const sha = String(process.env.RELEASE_SHA ?? "");
  const repo = String(process.env.GITHUB_REPOSITORY ?? "");
  validateReleaseMetadata({
    tag,
    packageJson: readFileSync("package.json", "utf8"),
    changelog: readFileSync("CHANGELOG.md", "utf8"),
  });

  // Refresh the authoritative remote branch rather than trusting a possibly
  // stale checkout ref, then prove the tagged commit is already on main.
  verifyTagOnMain({ sha, git: runGit });

  if (!(await hasTrustedCiRun({ repo, sha, api: githubApi }))) {
    throw new Error("no successful trusted CI push run exists for tagged SHA");
  }
  console.log(`release guard passed for ${tag} (${sha})`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
