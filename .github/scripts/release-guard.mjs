// @ts-check
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const GITHUB_API_TIMEOUT_MS = 15_000;
/** Maximum GitHub API response bytes retained before JSON parsing. */
export const GITHUB_API_RESPONSE_MAX_BYTES = 1 * 1024 * 1024;
export const CI_PAGE_SIZE = 100;
export const MAX_CI_PAGES = 10;
export const MAX_CODEQL_CANDIDATES = 10;
export const GITHUB_ACTIONS_APP = Object.freeze({
  id: 15368,
  slug: "github-actions",
  owner: "github",
});
export const CODEQL_WORKFLOW_PATH = "dynamic/github-code-scanning/codeql";
export const CODEQL_CHECK_NAMES = Object.freeze([
  "Analyze (actions)",
  "Analyze (javascript-typescript)",
]);

/** @param {unknown} value */
function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

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
 * Keep a tag update from reaching the release publisher even if the external
 * immutable-tag ruleset is misconfigured or temporarily bypassed. Re-running
 * the same workflow after a validation failure keeps the original push event,
 * so a legitimate retry still has `created=true`.
 *
 * @param {{tagCreated: string}} input
 */
export function validateReleaseTagCreation({ tagCreated }) {
  if (tagCreated !== "true") {
    throw new Error("release trigger must create a new tag");
  }
}

/**
 * Return the exact body published for a release. Validation and release.yml
 * share this parser so a section cannot pass the guard but publish an empty or
 * different body.
 * @param {{version: string, changelog: string}} input
 */
export function releaseNotesFromChangelog({ version, changelog }) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(
    `^## \\[${escaped}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`,
    "gm",
  );
  const matches = [...changelog.matchAll(heading)];
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `CHANGELOG has no dated section for ${version}`
        : `CHANGELOG has duplicate dated sections for ${version}`,
    );
  }
  const match = matches[0];
  const date = match[1];
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`CHANGELOG section for ${version} has an invalid date`);
  }
  const bodyStart = (match.index ?? 0) + match[0].length;
  const remainder = changelog.slice(bodyStart);
  const terminator = remainder.search(/^(?:## \[|\[.+\]:)/m);
  const body = remainder.slice(0, terminator < 0 ? undefined : terminator);
  if (!body.trim())
    throw new Error(`CHANGELOG section for ${version} is empty`);
  return body.trim() + "\n";
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

  releaseNotesFromChangelog({ version, changelog });
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
  return hasTrustedWorkflowEvidence({
    repo,
    sha,
    api,
    workflow: "ci.yml",
    path: ".github/workflows/ci.yml",
    event: "push",
    allowRefSuffix: true,
  });
}

/**
 * Require at least one completed-success run for an exact workflow/SHA. When
 * an evaluator is supplied, a successful run is evidence only if its joined
 * suite/check chain also passes. Successful evidence returns immediately;
 * absent evidence requires a complete, internally consistent pagination set.
 *
 * @param {{repo: string, sha: string, api: (path: string) => Promise<unknown>, workflow: string | number, path: string, event: string, allowRefSuffix: boolean, evaluate?: (run: any) => Promise<boolean>, candidateLimit?: number}} input
 */
async function hasTrustedWorkflowEvidence({
  repo,
  sha,
  api,
  workflow,
  path,
  event,
  allowRefSuffix,
  evaluate,
  candidateLimit,
}) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo))
    throw new Error("repository is unresolved");
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("tag SHA is unresolved");
  let totalCount = null;
  let collectedCount = 0;
  let candidateCount = 0;
  for (let page = 1; page <= MAX_CI_PAGES; page += 1) {
    const query = new URLSearchParams({
      branch: "main",
      event,
      head_sha: sha,
      per_page: String(CI_PAGE_SIZE),
      page: String(page),
    });
    const response = /** @type {any} */ (
      await api(
        `/repos/${repo}/actions/workflows/${encodeURIComponent(String(workflow))}/runs?${query.toString()}`,
      )
    );
    if (
      !Array.isArray(response?.workflow_runs) ||
      !Number.isSafeInteger(response?.total_count) ||
      response.total_count < 0
    ) {
      throw new Error("GitHub workflow-runs response is invalid");
    }
    totalCount ??= response.total_count;
    if (totalCount !== response.total_count) {
      throw new Error("GitHub workflow-runs total is inconsistent");
    }
    const runs = response.workflow_runs;
    collectedCount += runs.length;
    if (collectedCount > totalCount) {
      throw new Error("GitHub workflow-runs total is inconsistent");
    }
    /** @type {any[]} */
    const pageCandidates = [];
    for (const run of runs) {
      if (
        !run ||
        typeof run !== "object" ||
        !isPositiveSafeInteger(run.id) ||
        typeof run.head_sha !== "string" ||
        typeof run.head_branch !== "string" ||
        typeof run.event !== "string" ||
        typeof run.path !== "string" ||
        typeof run.status !== "string" ||
        (run.conclusion !== null && typeof run.conclusion !== "string")
      ) {
        throw new Error("GitHub workflow-runs response is invalid");
      }
      const allowedPath = new RegExp(
        `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${allowRefSuffix ? "(?:@(?:refs/heads/)?main)?" : ""}$`,
      );
      if (
        run.head_sha === sha &&
        run.head_branch === "main" &&
        run.event === event &&
        allowedPath.test(run.path) &&
        run.status === "completed" &&
        run.conclusion === "success"
      ) {
        pageCandidates.push(run);
      }
    }
    if (collectedCount !== totalCount && runs.length < CI_PAGE_SIZE) {
      throw new Error("GitHub workflow-runs total is inconsistent");
    }
    if (
      evaluate &&
      pageCandidates.some(
        (candidate) => !isPositiveSafeInteger(candidate.check_suite_id),
      )
    ) {
      throw new Error("GitHub workflow-runs response is invalid");
    }
    if (!evaluate && pageCandidates.length > 0) return true;
    for (const run of pageCandidates) {
      candidateCount += 1;
      if (candidateLimit !== undefined && candidateCount > candidateLimit) {
        throw new Error(
          "trusted CodeQL evidence exceeded candidate safety limit",
        );
      }
      if (await evaluate?.(run)) return true;
    }
    if (collectedCount === totalCount) return false;
  }
  throw new Error("trusted workflow evidence exceeded pagination safety limit");
}

/** @param {unknown} app */
function isGitHubActionsApp(app) {
  const value = /** @type {any} */ (app);
  return (
    value?.id === GITHUB_ACTIONS_APP.id &&
    value?.slug === GITHUB_ACTIONS_APP.slug &&
    value?.owner?.login === GITHUB_ACTIONS_APP.owner
  );
}

/**
 * Resolve GitHub's repository-owned default CodeQL workflow by exact dynamic
 * path. The numeric workflow ID is repository-local and therefore discovered,
 * not hard-coded.
 * @param {{repo: string, api: (path: string) => Promise<unknown>}} input
 */
async function resolveCodeqlWorkflowId({ repo, api }) {
  /** @type {any[]} */
  const matches = [];
  let totalCount = null;
  let collectedCount = 0;
  for (let page = 1; page <= MAX_CI_PAGES; page += 1) {
    const query = new URLSearchParams({
      per_page: String(CI_PAGE_SIZE),
      page: String(page),
    });
    const response = /** @type {any} */ (
      await api(`/repos/${repo}/actions/workflows?${query.toString()}`)
    );
    if (
      !Array.isArray(response?.workflows) ||
      !Number.isSafeInteger(response?.total_count) ||
      response.total_count < 0
    ) {
      throw new Error("GitHub workflows response is invalid");
    }
    totalCount ??= response.total_count;
    if (totalCount !== response.total_count) {
      throw new Error("GitHub workflows total is inconsistent");
    }
    collectedCount += response.workflows.length;
    if (collectedCount > totalCount) {
      throw new Error("GitHub workflows total is inconsistent");
    }
    for (const workflow of response.workflows) {
      if (
        !workflow ||
        typeof workflow !== "object" ||
        !isPositiveSafeInteger(workflow.id) ||
        typeof workflow.path !== "string" ||
        typeof workflow.state !== "string"
      ) {
        throw new Error("GitHub workflows response is invalid");
      }
      if (workflow?.path === CODEQL_WORKFLOW_PATH) matches.push(workflow);
    }
    if (collectedCount === totalCount) {
      if (matches.length !== 1) return null;
      const [workflow] = matches;
      return workflow.state === "active" ? workflow.id : null;
    }
    if (response.workflows.length < CI_PAGE_SIZE) {
      throw new Error("GitHub workflows total is inconsistent");
    }
  }
  throw new Error("trusted workflow list exceeded pagination safety limit");
}

/**
 * Bind CodeQL's successful dynamic workflow run to its exact GitHub Actions
 * check suite and expected language/category jobs.
 * @param {{repo: string, sha: string, api: (path: string) => Promise<unknown>, run: any}} input
 */
async function hasTrustedCodeqlChecks({ repo, sha, api, run }) {
  if (!isPositiveSafeInteger(run?.check_suite_id)) {
    throw new Error("GitHub workflow-runs response is invalid");
  }
  const suiteId = run.check_suite_id;
  const suite = /** @type {any} */ (
    await api(`/repos/${repo}/check-suites/${suiteId}`)
  );
  if (
    !suite ||
    typeof suite !== "object" ||
    !isPositiveSafeInteger(suite.id) ||
    !Number.isSafeInteger(suite.latest_check_runs_count) ||
    suite.latest_check_runs_count < 0 ||
    typeof suite.head_sha !== "string" ||
    typeof suite.head_branch !== "string" ||
    typeof suite.status !== "string" ||
    (suite.conclusion !== null && typeof suite.conclusion !== "string") ||
    !isPositiveSafeInteger(suite.app?.id) ||
    typeof suite.app?.slug !== "string" ||
    typeof suite.app?.owner?.login !== "string"
  ) {
    throw new Error("GitHub check-suite response is invalid");
  }
  if (
    suite?.id !== suiteId ||
    suite?.head_sha !== sha ||
    suite?.head_branch !== "main" ||
    suite?.status !== "completed" ||
    suite?.conclusion !== "success" ||
    !isGitHubActionsApp(suite?.app)
  ) {
    return false;
  }

  /** @type {any[]} */
  const checks = [];
  let totalCount = null;
  for (let page = 1; page <= MAX_CI_PAGES; page += 1) {
    const query = new URLSearchParams({
      filter: "latest",
      per_page: String(CI_PAGE_SIZE),
      page: String(page),
    });
    const response = /** @type {any} */ (
      await api(
        `/repos/${repo}/check-suites/${suiteId}/check-runs?${query.toString()}`,
      )
    );
    if (
      !Array.isArray(response?.check_runs) ||
      !Number.isSafeInteger(response?.total_count) ||
      response.total_count < 0
    ) {
      throw new Error("GitHub check-runs response is invalid");
    }
    totalCount ??= response.total_count;
    if (totalCount !== response.total_count) {
      throw new Error("GitHub check-runs response is inconsistent");
    }
    checks.push(...response.check_runs);
    if (checks.length > totalCount) {
      throw new Error("GitHub check-runs total is inconsistent");
    }
    if (checks.length === totalCount) break;
    if (response.check_runs.length < CI_PAGE_SIZE) {
      throw new Error("GitHub check-runs total is inconsistent");
    }
    if (page === MAX_CI_PAGES) {
      throw new Error(
        "trusted check evidence exceeded pagination safety limit",
      );
    }
  }
  if (checks.length !== totalCount) {
    throw new Error("GitHub check-runs total is inconsistent");
  }
  for (const check of checks) {
    if (
      !check ||
      typeof check !== "object" ||
      !isPositiveSafeInteger(check.id) ||
      typeof check.name !== "string" ||
      typeof check.head_sha !== "string" ||
      typeof check.status !== "string" ||
      (check.conclusion !== null && typeof check.conclusion !== "string") ||
      !isPositiveSafeInteger(check.app?.id) ||
      typeof check.app?.slug !== "string" ||
      typeof check.app?.owner?.login !== "string" ||
      !isPositiveSafeInteger(check.check_suite?.id)
    ) {
      throw new Error("GitHub check-runs response is invalid");
    }
  }
  if (suite.latest_check_runs_count !== totalCount) {
    throw new Error("GitHub check-suite total is inconsistent");
  }
  const names = checks.map((check) => check?.name).sort();
  const expectedNames = [...CODEQL_CHECK_NAMES].sort();
  if (
    names.length !== expectedNames.length ||
    names.some((name, index) => name !== expectedNames[index])
  ) {
    return false;
  }
  return checks.every(
    (check) =>
      check?.check_suite?.id === suiteId &&
      check?.head_sha === sha &&
      check?.status === "completed" &&
      check?.conclusion === "success" &&
      isGitHubActionsApp(check?.app),
  );
}

/**
 * Require exact-SHA success from CI, gitleaks, and GitHub default CodeQL.
 * Missing, pending, failed, malformed, or unavailable evidence fails closed.
 * @param {{repo: string, sha: string, api: (path: string) => Promise<unknown>}} input
 */
export async function hasTrustedReleaseEvidence({ repo, sha, api }) {
  let ciTrusted;
  try {
    ciTrusted = await hasTrustedCiRun({ repo, sha, api });
  } catch {
    throw new Error("trusted CI evidence is unavailable");
  }
  if (!ciTrusted) return false;

  let gitleaksTrusted;
  try {
    gitleaksTrusted = await hasTrustedWorkflowEvidence({
      repo,
      sha,
      api,
      workflow: "gitleaks.yml",
      path: ".github/workflows/gitleaks.yml",
      event: "push",
      allowRefSuffix: true,
    });
  } catch {
    throw new Error("trusted gitleaks evidence is unavailable");
  }
  if (!gitleaksTrusted) {
    return false;
  }

  try {
    const codeqlWorkflowId = await resolveCodeqlWorkflowId({ repo, api });
    if (codeqlWorkflowId === null) return false;
    return await hasTrustedWorkflowEvidence({
      repo,
      sha,
      api,
      workflow: codeqlWorkflowId,
      path: CODEQL_WORKFLOW_PATH,
      event: "dynamic",
      allowRefSuffix: false,
      candidateLimit: MAX_CODEQL_CANDIDATES,
      evaluate: (run) => hasTrustedCodeqlChecks({ repo, sha, api, run }),
    });
  } catch {
    throw new Error("trusted CodeQL evidence is unavailable");
  }
}

/** @param {Response} response */
async function cancelResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // Keep the original API failure as the useful fail-closed diagnostic.
  }
}

/**
 * Read a GitHub API JSON response with a fixed byte budget. Response.json()
 * buffers an unbounded body before parsing, which is unsafe for endpoints that
 * can contain attacker-controlled fields such as patch text.
 * @param {Response} response
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function readBoundedApiResponse(response, path) {
  let contentLength;
  try {
    contentLength = response.headers?.get?.("content-length");
  } catch {
    await cancelResponseBody(response);
    throw new Error(`GitHub API ${path} response body is invalid`);
  }
  if (contentLength !== null && contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > GITHUB_API_RESPONSE_MAX_BYTES
    ) {
      await cancelResponseBody(response);
      throw new Error(
        `GitHub API ${path} response body is too large or invalid`,
      );
    }
  }

  if (!response.body)
    throw new Error(`GitHub API ${path} response body is unavailable`);

  let reader;
  try {
    reader = response.body.getReader();
  } catch {
    await cancelResponseBody(response);
    throw new Error(`GitHub API ${path} response body is unavailable`);
  }
  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalBytes = 0;
  let bodyError = "is invalid";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error();
      totalBytes += value.byteLength;
      if (totalBytes > GITHUB_API_RESPONSE_MAX_BYTES) {
        bodyError = "is too large";
        throw new Error();
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // Preserve the fixed body diagnostic if stream cancellation fails.
    }
    throw new Error(`GitHub API ${path} response body ${bodyError}`);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Preserve the body diagnostic if the stream is already released.
    }
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error(`GitHub API ${path} response body is invalid`);
  }
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
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`GitHub API ${path} -> ${response.status}`);
  }
  return readBoundedApiResponse(response, path);
}

/**
 * Capture the current main commit through the read-only GitHub API, then prove
 * the tagged SHA is its exact merge base. This keeps checkout credentials out
 * of git config without trusting a remote-tracking ref after checkout.
 * @param {{repo: string, sha: string, api: (path: string) => Promise<unknown>}} input
 */
export async function verifyTagOnMain({ repo, sha, api }) {
  try {
    const repoMatch = /^([^/\s]+)\/([^/\s]+)$/.exec(repo);
    const owner = repoMatch?.[1] ?? "";
    const name = repoMatch?.[2] ?? "";
    if (
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(name) ||
      name === "." ||
      name === ".." ||
      !/^[0-9a-f]{40}$/.test(sha)
    ) {
      throw new Error();
    }
    const repoPath = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const ref = /** @type {any} */ (
      await api(`/repos/${repoPath}/git/ref/heads/main`)
    );
    const mainSha = ref?.object?.sha;
    if (
      ref?.ref !== "refs/heads/main" ||
      ref?.object?.type !== "commit" ||
      !/^[0-9a-f]{40}$/.test(mainSha)
    ) {
      throw new Error();
    }
    const comparison = /** @type {any} */ (
      await api(
        `/repos/${repoPath}/compare/${sha}...${mainSha}?page=2&per_page=1`,
      )
    );
    const statusMatches =
      (comparison?.status === "identical" &&
        comparison?.ahead_by === 0 &&
        mainSha === sha) ||
      (comparison?.status === "ahead" &&
        comparison?.ahead_by > 0 &&
        mainSha !== sha);
    if (
      !statusMatches ||
      !Number.isSafeInteger(comparison?.ahead_by) ||
      comparison.ahead_by < 0 ||
      !Number.isSafeInteger(comparison?.behind_by) ||
      comparison.behind_by !== 0 ||
      !Number.isSafeInteger(comparison?.total_commits) ||
      comparison.total_commits !== comparison.ahead_by ||
      comparison?.base_commit?.sha !== sha ||
      comparison?.merge_base_commit?.sha !== sha
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("release ancestry evidence is unavailable");
  }
}

async function main() {
  const tag = String(process.env.RELEASE_TAG ?? "");
  const sha = String(process.env.RELEASE_SHA ?? "");
  const tagCreated = String(process.env.RELEASE_TAG_CREATED ?? "");
  const repo = String(process.env.GITHUB_REPOSITORY ?? "");
  validateReleaseTagCreation({ tagCreated });
  validateReleaseMetadata({
    tag,
    packageJson: readFileSync("package.json", "utf8"),
    changelog: readFileSync("CHANGELOG.md", "utf8"),
  });

  await verifyTagOnMain({ repo, sha, api: githubApi });

  if (!(await hasTrustedReleaseEvidence({ repo, sha, api: githubApi }))) {
    throw new Error(
      "no successful trusted CI, gitleaks, and CodeQL evidence exists for tagged SHA",
    );
  }
  console.log(`release guard passed for ${tag} (${sha})`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "--extract-notes") {
    try {
      const version = versionFromTag(`v${String(process.argv[3] ?? "")}`);
      process.stdout.write(
        releaseNotesFromChangelog({
          version,
          changelog: readFileSync("CHANGELOG.md", "utf8"),
        }),
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    main().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
