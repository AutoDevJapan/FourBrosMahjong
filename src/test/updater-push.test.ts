import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  observeRemoteTip,
  pushBranchWithLease,
  pushWithLease,
} from "../../.github/scripts/push-branch-with-lease.mjs";

const roots: string[] = [];
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "updater-lease-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  git(root, "init", "--bare", remote);
  git(root, "init", "-b", "main", seed);
  git(seed, "config", "user.name", "test");
  git(seed, "config", "user.email", "test@example.com");
  writeFileSync(join(seed, "state"), "base\n");
  git(seed, "add", "state");
  git(seed, "commit", "-m", "base");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "origin", "main");
  return { root, remote, seed };
}

function clone(remote: string, path: string) {
  git("/", "clone", "--branch", "main", remote, path);
  git(path, "config", "user.name", "test");
  git(path, "config", "user.email", "test@example.com");
  return path;
}

function commit(cwd: string, value: string) {
  writeFileSync(join(cwd, "state"), `${value}\n`);
  git(cwd, "add", "state");
  git(cwd, "commit", "-m", value);
  return git(cwd, "rev-parse", "HEAD");
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("updater branch lease integration", () => {
  it("creates an absent branch and updates an exactly observed existing tip", () => {
    const { root, remote } = fixture();
    const worker = clone(remote, join(root, "worker"));
    const first = commit(worker, "first");
    pushBranchWithLease({ branch: "chore/update", remote, cwd: worker });
    expect(
      git(root, "--git-dir", remote, "rev-parse", "refs/heads/chore/update"),
    ).toBe(first);

    const second = commit(worker, "second");
    pushBranchWithLease({ branch: "chore/update", remote, cwd: worker });
    expect(
      git(root, "--git-dir", remote, "rev-parse", "refs/heads/chore/update"),
    ).toBe(second);
  });

  it("rejects an update when the remote changes after observation", () => {
    const { root, remote } = fixture();
    const worker = clone(remote, join(root, "worker"));
    commit(worker, "worker-one");
    pushBranchWithLease({ branch: "chore/update", remote, cwd: worker });
    const observed = observeRemoteTip({
      branch: "chore/update",
      remote,
      cwd: worker,
    });

    const rival = clone(remote, join(root, "rival"));
    git(rival, "checkout", "-b", "chore/update", observed);
    const rivalTip = commit(rival, "rival");
    git(rival, "push", "origin", "HEAD:refs/heads/chore/update");
    commit(worker, "worker-two");

    expect(() =>
      pushWithLease({
        branch: "chore/update",
        expectedTip: observed,
        remote,
        cwd: worker,
      }),
    ).toThrow();
    expect(
      git(root, "--git-dir", remote, "rev-parse", "refs/heads/chore/update"),
    ).toBe(rivalTip);
  });
});
