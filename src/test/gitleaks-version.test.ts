import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GITLEAKS_ARCHIVE_MAX_BYTES,
  GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES,
} from "../../.github/scripts/gitleaks-release.mjs";
import { versionFromGitleaksReleaseTag } from "../../.github/scripts/gitleaks-version.mjs";

const GITLEAKS_WORKFLOW = resolve(
  process.cwd(),
  ".github/workflows/gitleaks.yml",
);

describe("gitleaks upstream release metadata", () => {
  it.each([
    ["v8.30.1", "8.30.1"],
    ["v0.0.0", "0.0.0"],
    ["v10.2.345", "10.2.345"],
  ])("accepts a canonical stable release tag: %s", (tag, version) => {
    expect(versionFromGitleaksReleaseTag(tag)).toBe(version);
  });

  it.each([
    "8.30.1",
    "v8.30",
    "v08.30.1",
    "v8.030.1",
    "v8.30.01",
    "v8.30.1-rc.1",
    "v8.30.1+build",
    "v8.30.1/../../main",
    "v8.30.1&echo pwned",
    "v8.30.1\nneeds_update=false",
    "",
  ])("rejects unsafe or unsupported metadata: %j", (tag) => {
    expect(() => versionFromGitleaksReleaseTag(tag)).toThrow(/invalid/);
  });
});

describe("gitleaks binary integrity gate", () => {
  it("does not allow a missing archive entry to pass verification", () => {
    const workflow = readFileSync(GITLEAKS_WORKFLOW, "utf8");

    expect(workflow).not.toContain("--ignore-missing");
    expect(workflow).toContain("sha256sum --check --strict -");
    expect(workflow).toContain(
      "checksum manifest must contain exactly one entry",
    );

    const downloads = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("curl "));
    expect(downloads).toHaveLength(2);
    expect(downloads[0]).toContain(
      `--connect-timeout 10 --max-time 60 --max-filesize ${GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES}`,
    );
    expect(downloads[1]).toContain(
      `--connect-timeout 10 --max-time 60 --max-filesize ${GITLEAKS_ARCHIVE_MAX_BYTES}`,
    );
  });
});
