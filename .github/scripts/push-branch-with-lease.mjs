// @ts-check
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @param {string[]} args @param {string} [cwd] */
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** @param {string} branch */
export function branchRef(branch) {
  if (!branch || branch.startsWith("-")) throw new Error("invalid branch name");
  const ref = `refs/heads/${branch}`;
  git(["check-ref-format", ref]);
  return ref;
}

/** @param {{branch: string, remote?: string, cwd?: string}} input */
export function observeRemoteTip({ branch, remote = "origin", cwd }) {
  const ref = branchRef(branch);
  const output = git(["ls-remote", "--refs", remote, ref], cwd).trim();
  if (!output) return "";
  const lines = output.split("\n");
  const [sha, returnedRef, ...extra] = lines[0].split(/\s+/);
  if (
    lines.length !== 1 ||
    extra.length > 0 ||
    returnedRef !== ref ||
    !/^[0-9a-f]{40}$/.test(sha)
  ) {
    throw new Error("remote branch response is invalid");
  }
  return sha;
}

/**
 * @param {{branch: string, expectedTip: string, remote?: string, cwd?: string}} input
 */
export function pushWithLease({ branch, expectedTip, remote = "origin", cwd }) {
  if (expectedTip && !/^[0-9a-f]{40}$/.test(expectedTip))
    throw new Error("invalid expected remote tip");
  const ref = branchRef(branch);
  git(
    ["push", `--force-with-lease=${ref}:${expectedTip}`, remote, `HEAD:${ref}`],
    cwd,
  );
}

/** @param {{branch: string, remote?: string, cwd?: string}} input */
export function pushBranchWithLease(input) {
  const expectedTip = observeRemoteTip(input);
  pushWithLease({ ...input, expectedTip });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    pushBranchWithLease({ branch: String(process.argv[2] ?? "") });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
