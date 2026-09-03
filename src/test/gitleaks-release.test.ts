import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  GITLEAKS_ARCHIVE_MAX_BYTES,
  GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES,
  GITLEAKS_RELEASE_FETCH_TIMEOUT_MS,
  GITLEAKS_RELEASE_METADATA_MAX_BYTES,
  gitleaksArchiveName,
  gitleaksChecksumAssetName,
  gitleaksReleaseDownloadBaseUrl,
  parseGitleaksChecksumManifest,
  readPinnedGitleaksWorkflow,
  resolveGitleaksRelease,
  sha256Hex,
  updatePinnedGitleaksWorkflow,
  validateGitleaksReleaseMetadata,
  verifyPinnedGitleaksArchive,
} from "../../.github/scripts/gitleaks-release.mjs";

const GITLEAKS_WORKFLOW = resolve(
  process.cwd(),
  ".github/workflows/gitleaks.yml",
);
const GITLEAKS_RELEASE_SCRIPT = resolve(
  process.cwd(),
  ".github/scripts/gitleaks-release.mjs",
);
const ARCHIVE = gitleaksArchiveName("8.30.1");
const CANDIDATE_CHECKSUM_ASSET = gitleaksChecksumAssetName("8.31.0");
const PINNED_SHA256 =
  "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb";

function releaseFixture(version = "8.31.0") {
  const archive = gitleaksArchiveName(version);
  const checksumAsset = gitleaksChecksumAssetName(version);
  const baseUrl = gitleaksReleaseDownloadBaseUrl(version);
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: archive,
        browser_download_url: `${baseUrl}/${archive}`,
      },
      {
        name: checksumAsset,
        browser_download_url: `${baseUrl}/${checksumAsset}`,
      },
    ],
  };
}

describe("gitleaks checksum manifest", () => {
  it("accepts the single canonical linux/x64 entry in sha256sum formats", () => {
    const digest = "A".repeat(64);
    expect(
      parseGitleaksChecksumManifest(
        `${digest}  gitleaks_other.tar.gz\n${digest} *${ARCHIVE}\r\n`,
        ARCHIVE,
      ),
    ).toBe(digest.toLowerCase());
  });

  it.each([
    ["missing", `${"0".repeat(64)}  gitleaks_other.tar.gz`],
    [
      "duplicate",
      `${"0".repeat(64)}  ${ARCHIVE}\n${"1".repeat(64)}  ${ARCHIVE}`,
    ],
    ["invalid digest", `not-a-digest  ${ARCHIVE}`],
  ])("rejects a %s target manifest", (_label, manifest) => {
    expect(() => parseGitleaksChecksumManifest(manifest, ARCHIVE)).toThrow();
  });
});

describe("gitleaks release metadata and updater verification", () => {
  it("requires a canonical stable tag and exactly one linux/x64 archive", () => {
    const release = releaseFixture();
    expect(validateGitleaksReleaseMetadata(release)).toMatchObject({
      version: "8.31.0",
      archive: "gitleaks_8.31.0_linux_x64.tar.gz",
      archiveUrl:
        "https://github.com/gitleaks/gitleaks/releases/download/v8.31.0/gitleaks_8.31.0_linux_x64.tar.gz",
    });

    expect(() =>
      validateGitleaksReleaseMetadata({ ...release, tag_name: "main" }),
    ).toThrow(/invalid/);
    expect(() =>
      validateGitleaksReleaseMetadata({
        ...release,
        assets: [...release.assets, release.assets[0]],
      }),
    ).toThrow(/exactly one asset/);
    expect(() =>
      validateGitleaksReleaseMetadata({
        ...release,
        assets: release.assets.slice(1),
      }),
    ).toThrow(/exactly one asset/);
    expect(() =>
      validateGitleaksReleaseMetadata({
        ...release,
        assets: release.assets.map((asset) =>
          asset.name === gitleaksArchiveName("8.31.0")
            ? { ...asset, browser_download_url: "https://example.test/archive" }
            : asset,
        ),
      }),
    ).toThrow(/not canonical/);
  });

  it("downloads both assets and derives the candidate hash from archive bytes", async () => {
    const release = releaseFixture();
    const archiveBytes = Buffer.from("reviewed candidate archive");
    const digest = sha256Hex(archiveBytes);
    const calls: Array<{ url: string; signal: unknown }> = [];
    const resolved = await resolveGitleaksRelease(release, {
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, signal: init?.signal });
        if (url.endsWith(CANDIDATE_CHECKSUM_ASSET)) {
          return new Response(`${digest}  ${gitleaksArchiveName("8.31.0")}\n`);
        }
        return new Response(archiveBytes);
      },
    });

    expect(resolved.archiveSha256).toBe(digest);
    expect(calls).toHaveLength(2);
    expect(calls.map(({ url }) => url)).toContain(resolved.archiveUrl);
    expect(calls.map(({ url }) => url)).toContain(resolved.checksumUrl);
    expect(calls[1]?.signal).toBe(calls[0]?.signal);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(GITLEAKS_RELEASE_FETCH_TIMEOUT_MS).toBe(60_000);
  });

  it.each([
    ["declared archive response", "archive", GITLEAKS_ARCHIVE_MAX_BYTES + 1],
    [
      "declared checksum response",
      "checksum",
      GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES + 1,
    ],
  ])(
    "rejects a %s before buffering it",
    async (_label, target, declaredLength) => {
      const release = releaseFixture();
      const cancel = vi.fn().mockResolvedValue(undefined);
      const oversized = {
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(declaredLength) }),
        body: { cancel },
      } as unknown as Response;

      await expect(
        resolveGitleaksRelease(release, {
          fetchImpl: async (input) => {
            const url = String(input);
            if (
              (target === "archive" &&
                url.endsWith(CANDIDATE_CHECKSUM_ASSET)) ||
              (target === "checksum" && !url.endsWith(CANDIDATE_CHECKSUM_ASSET))
            ) {
              return new Response("small response");
            }
            return oversized;
          },
        }),
      ).rejects.toThrow(/too large/);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("cancels a chunked checksum response when it crosses the byte bound", async () => {
    const release = releaseFixture();
    const cancel = vi.fn().mockResolvedValue(undefined);
    let reads = 0;
    const reader = {
      read: vi.fn(async () => {
        reads += 1;
        if (reads === 1) {
          return {
            done: false,
            value: new Uint8Array(GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES),
          };
        }
        if (reads === 2) return { done: false, value: new Uint8Array(1) };
        return { done: true, value: undefined };
      }),
      cancel,
      releaseLock: vi.fn(),
    };
    const oversized = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;

    await expect(
      resolveGitleaksRelease(release, {
        fetchImpl: async (input) =>
          String(input).endsWith(CANDIDATE_CHECKSUM_ASSET)
            ? oversized
            : new Response(Buffer.from("small archive")),
      }),
    ).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("aborts a sibling download when one response exceeds its bound", async () => {
    const release = releaseFixture();
    const signals: Array<AbortSignal | null | undefined> = [];
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reader = {
      read: vi.fn(() => new Promise(() => {})),
      cancel,
      releaseLock: vi.fn(),
    };
    const oversized = {
      ok: true,
      status: 200,
      headers: new Headers({
        "content-length": String(GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES + 1),
      }),
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Response;
    const stalled = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;

    await expect(
      resolveGitleaksRelease(release, {
        fetchImpl: async (input, init) => {
          signals.push(init?.signal);
          return String(input).endsWith(CANDIDATE_CHECKSUM_ASSET)
            ? oversized
            : stalled;
        },
      }),
    ).rejects.toThrow(/too large/);

    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).toHaveProperty("aborted", true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects oversized release metadata before parsing it", () => {
    const result = spawnSync(
      process.execPath,
      [GITLEAKS_RELEASE_SCRIPT, "--resolve-release"],
      {
        input: "x".repeat(GITLEAKS_RELEASE_METADATA_MAX_BYTES + 1),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release metadata input is too large");
  });

  it("does not create an update candidate when download verification fails", async () => {
    const release = releaseFixture();
    await expect(
      resolveGitleaksRelease(release, {
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
      }),
    ).rejects.toThrow(/download failed/);
  });

  it("does not create an update candidate when archive and manifest disagree", async () => {
    const release = releaseFixture();
    await expect(
      resolveGitleaksRelease(release, {
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.endsWith(CANDIDATE_CHECKSUM_ASSET)) {
            return new Response(
              `${"0".repeat(64)}  ${gitleaksArchiveName("8.31.0")}\n`,
            );
          }
          return new Response(Buffer.from("different archive"));
        },
      }),
    ).rejects.toThrow(/does not match upstream checksum/);
  });

  it("rejects a coordinated archive and remote-manifest replacement against the old pin", () => {
    const oldArchive = Buffer.from("old approved archive");
    const replacement = Buffer.from("replacement archive");
    const replacementSha256 = sha256Hex(replacement);
    expect(() =>
      verifyPinnedGitleaksArchive({
        archive: replacement,
        pinnedSha256: sha256Hex(oldArchive),
        archiveName: ARCHIVE,
        checksumManifest: `${replacementSha256}  ${ARCHIVE}\n`,
      }),
    ).toThrow(/repository pin/);
  });
});

describe("gitleaks workflow pin contract", () => {
  it("stores the review-approved digest and uses it as the runtime root", () => {
    const source = readFileSync(GITLEAKS_WORKFLOW, "utf8");
    expect(readPinnedGitleaksWorkflow(source)).toEqual({
      version: "8.30.1",
      archive: ARCHIVE,
      sha256: PINNED_SHA256,
    });
    expect(source).toContain("GITLEAKS_ARCHIVE_SHA256:");
    expect(source).toContain(
      'printf \'%s  %s\\n\' "${GITLEAKS_ARCHIVE_SHA256}" "${archive}" | sha256sum --check --strict -',
    );
    expect(source).toContain("remote_hash");
    expect(source).toContain("auxiliary consistency");
  });

  it("updates version and hash atomically and rejects one-sided changes", () => {
    const oldSha256 = "a".repeat(64);
    const nextSha256 = "b".repeat(64);
    const source = `env:\n  GITLEAKS_VERSION: "8.30.1"\n  GITLEAKS_ARCHIVE_SHA256: "${oldSha256}"\n`;
    const updated = updatePinnedGitleaksWorkflow(source, {
      currentVersion: "8.30.1",
      currentSha256: oldSha256,
      nextVersion: "8.31.0",
      nextSha256,
    });

    expect(readPinnedGitleaksWorkflow(updated)).toEqual({
      version: "8.31.0",
      archive: "gitleaks_8.31.0_linux_x64.tar.gz",
      sha256: nextSha256,
    });
    expect(() =>
      updatePinnedGitleaksWorkflow(source, {
        currentVersion: "8.30.1",
        currentSha256: oldSha256,
        nextVersion: "8.31.0",
        nextSha256: oldSha256,
      }),
    ).toThrow(/both change/);
    expect(() =>
      updatePinnedGitleaksWorkflow(source, {
        currentVersion: "8.30.1",
        currentSha256: oldSha256,
        nextVersion: "8.30.1",
        nextSha256,
      }),
    ).toThrow(/both change/);
  });
});
