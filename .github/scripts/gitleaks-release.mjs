// @ts-check
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { versionFromGitleaksReleaseTag } from "./gitleaks-version.mjs";

const GITLEAKS_RELEASE_DOWNLOAD_ROOT =
  "https://github.com/gitleaks/gitleaks/releases/download";
const GITLEAKS_RELEASE_PAGE_ROOT =
  "https://github.com/gitleaks/gitleaks/releases/tag";
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

/** Abort a stalled upstream request before the updater consumes the whole job. */
export const GITLEAKS_RELEASE_FETCH_TIMEOUT_MS = 60_000;
/** Bound the release JSON piped from `gh api` before parsing it. */
export const GITLEAKS_RELEASE_METADATA_MAX_BYTES = 1 * 1024 * 1024;
/** Checksum manifests are text metadata and should stay small. */
export const GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES = 1 * 1024 * 1024;
/** Allow room for a future binary while bounding untrusted archive input. */
export const GITLEAKS_ARCHIVE_MAX_BYTES = 128 * 1024 * 1024;

/** @typedef {{name?: unknown, browser_download_url?: unknown}} GitleaksAsset */
/** @typedef {{tag_name?: unknown, draft?: unknown, prerelease?: unknown, assets?: unknown}} GitleaksRelease */

/** @param {unknown} value @param {string} label */
function assertString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

/** @param {string} version */
function canonicalVersion(version) {
  const value = assertString(version, "gitleaks version");
  return versionFromGitleaksReleaseTag(`v${value}`);
}

/** @param {string} digest @param {string} label */
function assertSha256(digest, label) {
  const value = assertString(digest, label);
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a 64-character SHA-256 digest`);
  }
  return value.toLowerCase();
}

/** @param {string} version */
export function gitleaksArchiveName(version) {
  return `gitleaks_${canonicalVersion(version)}_linux_x64.tar.gz`;
}

/** @param {string} version */
export function gitleaksChecksumAssetName(version) {
  return `gitleaks_${canonicalVersion(version)}_checksums.txt`;
}

/** @param {string} version */
export function gitleaksReleaseDownloadBaseUrl(version) {
  return `${GITLEAKS_RELEASE_DOWNLOAD_ROOT}/v${canonicalVersion(version)}`;
}

/** @param {string} version */
export function gitleaksReleasePageUrl(version) {
  return `${GITLEAKS_RELEASE_PAGE_ROOT}/v${canonicalVersion(version)}`;
}

/**
 * Parse a sha256sum-compatible release manifest. Every non-empty line must be
 * a valid digest/filename pair so malformed or duplicate entries cannot be
 * silently ignored.
 *
 * @param {string} manifest
 * @param {string} archiveName
 */
export function parseGitleaksChecksumManifest(manifest, archiveName) {
  const target = assertString(archiveName, "archive name");
  const entries = [];
  const names = new Set();

  for (const [index, rawLine] of assertString(manifest, "checksum manifest")
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (line === "") continue;

    const match = line.match(/^([0-9a-f]{64})\s+\*?(\S+)$/i);
    if (!match) {
      throw new Error(
        `checksum manifest line ${index + 1} is not a valid SHA-256 entry`,
      );
    }
    const [, digest, name] = match;
    if (names.has(name)) {
      throw new Error(`checksum manifest contains duplicate entry for ${name}`);
    }
    names.add(name);
    entries.push({ name, sha256: digest.toLowerCase() });
  }

  const matches = entries.filter((entry) => entry.name === target);
  if (matches.length !== 1) {
    throw new Error(
      `checksum manifest must contain exactly one entry for ${target}`,
    );
  }
  return matches[0].sha256;
}

/** @param {unknown} release @param {string} name */
function canonicalReleaseAsset(release, name) {
  if (!release || typeof release !== "object") {
    throw new Error("gitleaks release metadata must be an object");
  }
  const releaseRecord = /** @type {GitleaksRelease} */ (release);
  const assets = releaseRecord.assets;
  if (!Array.isArray(assets)) {
    throw new Error("gitleaks release metadata has no assets array");
  }
  const matches = assets.filter(
    (asset) =>
      asset &&
      typeof asset === "object" &&
      /** @type {GitleaksAsset} */ (asset).name === name,
  );
  if (matches.length !== 1) {
    throw new Error(
      `gitleaks release must contain exactly one asset named ${name}`,
    );
  }
  const asset = /** @type {GitleaksAsset} */ (matches[0]);
  const url = asset.browser_download_url;
  if (typeof url !== "string") {
    throw new Error(`gitleaks asset ${name} has no browser download URL`);
  }
  return { name, url };
}

/**
 * Validate the immutable shape we expect from the canonical gitleaks release.
 * The returned URLs are reconstructed from the validated tag and asset names;
 * arbitrary upstream metadata is never passed into shell code.
 *
 * @param {unknown} release
 */
export function validateGitleaksReleaseMetadata(release) {
  if (!release || typeof release !== "object") {
    throw new Error("gitleaks release metadata must be an object");
  }
  const releaseRecord = /** @type {GitleaksRelease} */ (release);
  const tag = releaseRecord.tag_name;
  const version = versionFromGitleaksReleaseTag(
    assertString(tag, "release tag"),
  );
  if (releaseRecord.draft === true || releaseRecord.prerelease === true) {
    throw new Error(
      `gitleaks release ${tag} is not a stable published release`,
    );
  }

  const archive = gitleaksArchiveName(version);
  const checksumAsset = gitleaksChecksumAssetName(version);
  const baseUrl = gitleaksReleaseDownloadBaseUrl(version);
  const archiveAsset = canonicalReleaseAsset(release, archive);
  const checksum = canonicalReleaseAsset(release, checksumAsset);
  const expectedArchiveUrl = `${baseUrl}/${archive}`;
  const expectedChecksumUrl = `${baseUrl}/${checksumAsset}`;
  if (archiveAsset.url !== expectedArchiveUrl) {
    throw new Error(`gitleaks archive URL is not canonical for ${archive}`);
  }
  if (checksum.url !== expectedChecksumUrl) {
    throw new Error(
      `gitleaks checksum URL is not canonical for ${checksumAsset}`,
    );
  }

  return {
    version,
    tag,
    archive,
    checksumAsset,
    archiveUrl: expectedArchiveUrl,
    checksumUrl: expectedChecksumUrl,
    upstreamUrl: gitleaksReleasePageUrl(version),
  };
}

/** @param {string|Uint8Array|ArrayBuffer} input */
export function sha256Hex(input) {
  const hashInput = input instanceof ArrayBuffer ? Buffer.from(input) : input;
  return createHash("sha256").update(hashInput).digest("hex");
}

/**
 * Verify a downloaded archive against the repository pin. The remote manifest
 * is checked only as an auxiliary consistency signal after the local pin has
 * authenticated the bytes.
 *
 * @param {{archive: string|Uint8Array|ArrayBuffer, pinnedSha256: string, archiveName?: string, checksumManifest?: string}} input
 */
export function verifyPinnedGitleaksArchive(input) {
  const pinnedSha256 = assertSha256(input.pinnedSha256, "pinned SHA-256");
  const actualSha256 = sha256Hex(input.archive);
  if (actualSha256 !== pinnedSha256) {
    throw new Error(
      `downloaded gitleaks archive SHA-256 ${actualSha256} does not match repository pin ${pinnedSha256}`,
    );
  }

  let upstreamSha256;
  if (input.checksumManifest !== undefined) {
    if (input.archiveName === undefined) {
      throw new Error(
        "archive name is required when checking a checksum manifest",
      );
    }
    upstreamSha256 = parseGitleaksChecksumManifest(
      input.checksumManifest,
      input.archiveName,
    );
    if (upstreamSha256 !== pinnedSha256) {
      throw new Error(
        `upstream checksum ${upstreamSha256} does not match repository pin ${pinnedSha256}`,
      );
    }
  }

  return { actualSha256, pinnedSha256, upstreamSha256 };
}

/** @param {Response | undefined} response */
async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Preserve the original response or stream failure.
  }
}

/** @param {Response} response @param {string} url */
async function requireResponse(response, url) {
  if (!response?.ok) {
    await cancelResponseBody(response);
    throw new Error(`download failed for ${url}: HTTP ${response?.status}`);
  }
  return response;
}

/**
 * Read a release response with a fixed byte budget. `Response.text()` and
 * `Response.arrayBuffer()` buffer the complete upstream body before the
 * checksum is checked, so a malformed release could otherwise exhaust the
 * updater runner before verification runs.
 *
 * @param {Response} response
 * @param {string} url
 * @param {number} maxBytes
 * @param {AbortSignal} [signal]
 * @returns {Promise<Buffer>}
 */
async function readBoundedResponse(response, url, maxBytes, signal) {
  await requireResponse(response, url);

  let contentLength;
  try {
    contentLength = response.headers?.get?.("content-length");
  } catch {
    await cancelResponseBody(response);
    throw new Error(`download response headers are invalid for ${url}`);
  }
  if (contentLength !== null && contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maxBytes
    ) {
      await cancelResponseBody(response);
      throw new Error(`download response is too large or invalid for ${url}`);
    }
  }

  if (!response.body) {
    throw new Error(`download response body is unavailable for ${url}`);
  }

  let reader;
  try {
    reader = response.body.getReader();
  } catch {
    await cancelResponseBody(response);
    throw new Error(`download response body is unavailable for ${url}`);
  }

  let readerCancelled = false;
  const cancelReader = async () => {
    if (readerCancelled) return;
    readerCancelled = true;
    try {
      await reader.cancel?.();
    } catch {
      // Preserve the original response or stream failure.
    }
  };
  let abortListener;
  const abortPromise =
    signal === undefined
      ? null
      : new Promise((_, reject) => {
          abortListener = () => {
            void cancelReader();
            reject(new Error(`download aborted for ${url}`));
          };
          if (signal.aborted) abortListener();
          else signal.addEventListener("abort", abortListener, { once: true });
        });

  const readChunk = () => {
    const read = reader.read();
    return abortPromise === null ? read : Promise.race([read, abortPromise]);
  };

  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readChunk();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error(`download response body is invalid for ${url}`);
      }
      totalBytes += value.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
        throw new Error(`download response is too large for ${url}`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await cancelReader();
    throw error;
  } finally {
    if (signal !== undefined && abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
    }
    try {
      reader.releaseLock();
    } catch {
      // Preserve the original response or stream failure.
    }
  }

  return Buffer.concat(chunks, totalBytes);
}

/**
 * Download and verify the canonical release assets for the updater. The
 * updater computes the candidate hash from the archive bytes and requires it
 * to agree with the remote manifest before it can create a PR.
 *
 * @param {unknown} release
 * @param {{fetchImpl?: typeof fetch}} [options]
 */
export async function resolveGitleaksRelease(release, options = {}) {
  const metadata = validateGitleaksReleaseMetadata(release);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable for gitleaks release verification");
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(GITLEAKS_RELEASE_FETCH_TIMEOUT_MS),
  ]);
  /** @type {Promise<Response>[]} */
  let fetches = [];
  /** @type {Promise<Buffer>[]} */
  let reads = [];
  try {
    /** @param {string} url @returns {Promise<Response>} */
    const fetchResponse = (url) =>
      Promise.resolve()
        .then(() => fetchImpl(url, { signal }))
        // Reject non-2xx responses as soon as either fetch resolves, rather
        // than waiting for the sibling network operation to finish.
        .then((response) => requireResponse(response, url));
    fetches = [
      fetchResponse(metadata.checksumUrl),
      fetchResponse(metadata.archiveUrl),
    ];
    const [checksumResponse, archiveResponse] = await Promise.all(fetches);
    reads = [
      readBoundedResponse(
        checksumResponse,
        metadata.checksumUrl,
        GITLEAKS_CHECKSUM_MANIFEST_MAX_BYTES,
        signal,
      ),
      readBoundedResponse(
        archiveResponse,
        metadata.archiveUrl,
        GITLEAKS_ARCHIVE_MAX_BYTES,
        signal,
      ),
    ];
    const [checksumBytes, archiveBytes] = await Promise.all(reads);
    const checksumText = checksumBytes.toString("utf8");
    const manifestSha256 = parseGitleaksChecksumManifest(
      checksumText,
      metadata.archive,
    );
    const archiveSha256 = sha256Hex(archiveBytes);
    if (archiveSha256 !== manifestSha256) {
      throw new Error(
        `downloaded gitleaks archive SHA-256 ${archiveSha256} does not match upstream checksum ${manifestSha256}`,
      );
    }

    return { ...metadata, archiveSha256 };
  } catch (error) {
    // Stop the sibling fetch/body immediately; Promise.all already attached
    // rejection handlers, so late abort errors cannot become unhandled noise.
    controller.abort();
    void Promise.allSettled([...fetches, ...reads]);
    throw error;
  }
}

/** @param {string} source @param {string} key */
function readWorkflowValue(source, key) {
  const pattern = new RegExp(`^[ \\t]*${key}:[ \\t]*"([^"]+)"[ \\t]*$`, "gm");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`workflow must contain exactly one ${key} entry`);
  }
  return matches[0][1];
}

/** @param {string} source */
export function readPinnedGitleaksWorkflow(source) {
  const version = canonicalVersion(
    readWorkflowValue(source, "GITLEAKS_VERSION"),
  );
  const sha256 = assertSha256(
    readWorkflowValue(source, "GITLEAKS_ARCHIVE_SHA256"),
    "workflow archive SHA-256",
  );
  return { version, archive: gitleaksArchiveName(version), sha256 };
}

/** @param {string} source @param {string} key @param {string} oldValue @param {string} newValue */
function replaceWorkflowValue(source, key, oldValue, newValue) {
  const pattern = new RegExp(
    `^([ \\t]*${key}:[ \\t]*")${oldValue}("[ \\t]*)$`,
    "gm",
  );
  let replacements = 0;
  const replaced = source.replace(pattern, (_match, prefix, suffix) => {
    replacements += 1;
    return `${prefix}${newValue}${suffix}`;
  });
  if (replacements !== 1) {
    throw new Error(`workflow ${key} entry did not match exactly once`);
  }
  return replaced;
}

/**
 * Replace the version and digest as one validated pair. A version-only or
 * hash-only update is deliberately rejected so a generated PR cannot leave
 * the archive name and integrity root out of sync.
 *
 * @param {string} source
 * @param {{currentVersion: string, currentSha256: string, nextVersion: string, nextSha256: string}} input
 */
export function updatePinnedGitleaksWorkflow(source, input) {
  const current = readPinnedGitleaksWorkflow(source);
  const currentVersion = canonicalVersion(input.currentVersion);
  const currentSha256 = assertSha256(input.currentSha256, "current SHA-256");
  const nextVersion = canonicalVersion(input.nextVersion);
  const nextSha256 = assertSha256(input.nextSha256, "next SHA-256");

  if (current.version !== currentVersion || current.sha256 !== currentSha256) {
    throw new Error("workflow pin changed before the updater could replace it");
  }
  if (currentVersion === nextVersion || currentSha256 === nextSha256) {
    throw new Error(
      "gitleaks version and archive SHA-256 must both change in the same update",
    );
  }

  const replacedVersion = replaceWorkflowValue(
    source,
    "GITLEAKS_VERSION",
    currentVersion,
    nextVersion,
  );
  const replacedPair = replaceWorkflowValue(
    replacedVersion,
    "GITLEAKS_ARCHIVE_SHA256",
    currentSha256,
    nextSha256,
  );
  const next = readPinnedGitleaksWorkflow(replacedPair);
  if (next.version !== nextVersion || next.sha256 !== nextSha256) {
    throw new Error("updated workflow pin could not be verified");
  }
  return replacedPair;
}

/** @param {string} input */
function outputLines(input) {
  return `${input.trimEnd()}\n`;
}

/** @param {string} input */
async function readStdin(input = "") {
  if (input !== "") {
    if (
      Buffer.byteLength(input, "utf8") > GITLEAKS_RELEASE_METADATA_MAX_BYTES
    ) {
      throw new Error("release metadata input is too large");
    }
    return input;
  }
  return new Promise((resolve, reject) => {
    let source = "";
    let totalBytes = 0;
    let settled = false;
    /** @param {unknown} error */
    const fail = (error) => {
      if (settled) return;
      settled = true;
      process.stdin.destroy();
      reject(error);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      if (settled) return;
      totalBytes += Buffer.byteLength(chunk, "utf8");
      if (totalBytes > GITLEAKS_RELEASE_METADATA_MAX_BYTES) {
        fail(new Error("release metadata input is too large"));
        return;
      }
      source += chunk;
    });
    process.stdin.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(source);
    });
    process.stdin.on("error", fail);
  });
}

/**
 * @param {{version: string, archive: string, archiveSha256: string, archiveUrl: string, upstreamUrl: string}} resolved
 */
function latestOutput(resolved) {
  return [
    `latest_version=${resolved.version}`,
    `latest_archive=${resolved.archive}`,
    `latest_archive_sha256=${resolved.archiveSha256}`,
    `latest_archive_url=${resolved.archiveUrl}`,
    `latest_upstream_url=${resolved.upstreamUrl}`,
  ].join("\n");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--read-pinned") {
    const source = readFileSync(args[0], "utf8");
    const pinned = readPinnedGitleaksWorkflow(source);
    process.stdout.write(
      outputLines(
        [
          `current_version=${pinned.version}`,
          `current_archive=${pinned.archive}`,
          `current_sha256=${pinned.sha256}`,
        ].join("\n"),
      ),
    );
    return;
  }
  if (command === "--resolve-release") {
    const release = JSON.parse(await readStdin());
    const resolved = await resolveGitleaksRelease(release);
    process.stdout.write(outputLines(latestOutput(resolved)));
    return;
  }
  if (command === "--update-pinned" && args.length === 5) {
    const [
      workflowPath,
      currentVersion,
      currentSha256,
      nextVersion,
      nextSha256,
    ] = args;
    const source = readFileSync(workflowPath, "utf8");
    const updated = updatePinnedGitleaksWorkflow(source, {
      currentVersion,
      currentSha256,
      nextVersion,
      nextSha256,
    });
    writeFileSync(workflowPath, updated, "utf8");
    return;
  }
  throw new Error(
    "usage: gitleaks-release.mjs --read-pinned <workflow> | --resolve-release | --update-pinned <workflow> <current-version> <current-sha256> <next-version> <next-sha256>",
  );
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
