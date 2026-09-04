import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generatedIacSourceIsSecretSafe,
  RAILWAY_LEGACY_FIXTURE_PATH,
  type RailwayIacFilesystemEvidence,
  validateRailwayIacMigrationEvidence,
} from "./railway-iac-migration-contract";
import { parseStrictJson } from "./strictJson";

const MAX_INPUT_BYTES = 64 * 1_024;
export const MAX_GENERATED_IAC_BYTES = 64 * 1_024;
export const MAX_LEGACY_CONFIG_BYTES = 64 * 1_024;
const repositoryRoot = process.cwd();

function isBoundedRegularFile(
  fileStats: ReturnType<typeof fstatSync>,
  maxBytes: number,
): boolean {
  return (
    fileStats.isFile() &&
    Number.isSafeInteger(fileStats.size) &&
    fileStats.size >= 0 &&
    fileStats.size <= maxBytes
  );
}

function hasSameFileIdentity(
  firstStats: ReturnType<typeof fstatSync>,
  secondStats: ReturnType<typeof fstatSync>,
): boolean {
  return (
    firstStats.dev === secondStats.dev && firstStats.ino === secondStats.ino
  );
}

function hasStableFileSnapshot(
  firstStats: ReturnType<typeof fstatSync>,
  secondStats: ReturnType<typeof fstatSync>,
): boolean {
  return (
    hasSameFileIdentity(firstStats, secondStats) &&
    firstStats.size === secondStats.size &&
    firstStats.mtimeMs === secondStats.mtimeMs &&
    firstStats.ctimeMs === secondStats.ctimeMs
  );
}

function pathHasNoSymlinkedParents(
  normalizedFilePath: string,
  normalizedRootDirectory = dirname(normalizedFilePath),
): boolean {
  let currentPath = normalizedFilePath;
  const boundaryPath = normalizedRootDirectory;
  while (true) {
    const stats = lstatSync(currentPath);
    if (stats.isSymbolicLink()) return false;
    if (currentPath === boundaryPath) return true;
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) return false;
    currentPath = parentPath;
  }
}

function pathStillOwnsFile(
  normalizedFilePath: string,
  fileStats: ReturnType<typeof fstatSync>,
  normalizedRootDirectory: string,
): boolean {
  if (!pathHasNoSymlinkedParents(normalizedFilePath, normalizedRootDirectory)) {
    return false;
  }
  const pathStats = lstatSync(normalizedFilePath);
  return (
    pathStats.isFile() &&
    !pathStats.isSymbolicLink() &&
    hasSameFileIdentity(pathStats, fileStats)
  );
}

export function readBoundedFile(
  filePath: string,
  maxBytes: number,
  rootDirectory = dirname(filePath),
): Buffer | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return null;

  let fileDescriptor: number | undefined;
  let content: Buffer | null = null;

  try {
    // Resolve before any filesystem operation. Opening the raw path could
    // resolve `..` after a symlink, while the boundary check must inspect this
    // exact normalized path.
    const normalizedFilePath = resolve(filePath);
    const normalizedRootDirectory = resolve(rootDirectory);

    // Open once and inspect that descriptor so a path replacement cannot make
    // the size check and the read refer to different files. O_NOFOLLOW rejects
    // the final symlink atomically where the platform provides it, while the
    // lstat identity checks below keep the same fail-closed behavior elsewhere.
    // O_NONBLOCK also prevents a raced special file such as a FIFO from
    // blocking the verifier.
    fileDescriptor = openSync(
      normalizedFilePath,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const initialStats = fstatSync(fileDescriptor);
    if (
      !isBoundedRegularFile(initialStats, maxBytes) ||
      !pathStillOwnsFile(
        normalizedFilePath,
        initialStats,
        normalizedRootDirectory,
      )
    ) {
      return null;
    }

    content = Buffer.alloc(initialStats.size);
    let bytesRead = 0;
    while (bytesRead < content.length) {
      const chunkSize = readSync(
        fileDescriptor,
        content,
        bytesRead,
        content.length - bytesRead,
        null,
      );
      if (chunkSize === 0) {
        return null;
      }
      bytesRead += chunkSize;
    }

    // A file can grow after fstat(). One extra-byte read and a second fstat()
    // keep that race fail-closed without allocating an unbounded buffer.
    const extraByte = Buffer.alloc(1);
    if (readSync(fileDescriptor, extraByte, 0, 1, null) !== 0) {
      return null;
    }
    const verificationContent = Buffer.alloc(content.length);
    let verificationBytesRead = 0;
    while (verificationBytesRead < verificationContent.length) {
      const chunkSize = readSync(
        fileDescriptor,
        verificationContent,
        verificationBytesRead,
        verificationContent.length - verificationBytesRead,
        0 + verificationBytesRead,
      );
      if (chunkSize === 0) return null;
      verificationBytesRead += chunkSize;
    }
    if (!content.equals(verificationContent)) return null;

    const finalStats = fstatSync(fileDescriptor);
    if (
      !isBoundedRegularFile(finalStats, maxBytes) ||
      !hasStableFileSnapshot(initialStats, finalStats) ||
      !pathStillOwnsFile(
        normalizedFilePath,
        finalStats,
        normalizedRootDirectory,
      )
    ) {
      return null;
    }
  } catch {
    return null;
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // A successful read is not evidence if the descriptor cannot be
        // closed; discard it so close failures remain fail-closed.
        content = null;
      }
    }
  }

  return content;
}

export function isDirectEntrypoint(
  argumentPath = process.argv[1],
  moduleUrl = import.meta.url,
): boolean {
  if (argumentPath === undefined) return false;
  try {
    return (
      realpathSync(resolve(argumentPath)) ===
      realpathSync(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}

export function readBoundedTextFile(
  filePath: string,
  maxBytes = MAX_GENERATED_IAC_BYTES,
  rootDirectory = dirname(filePath),
): string | null {
  const content = readBoundedFile(filePath, maxBytes, rootDirectory);
  return content === null ? null : content.toString("utf8");
}

export function localFilesystemEvidence(
  rootDirectory = repositoryRoot,
): RailwayIacFilesystemEvidence {
  const generatedPath = resolve(rootDirectory, ".railway/railway.ts");
  const currentRepositoryPath = resolve(rootDirectory, "railway.json");
  const legacyFixturePath = resolve(rootDirectory, RAILWAY_LEGACY_FIXTURE_PATH);
  const generatedSource = readBoundedTextFile(
    generatedPath,
    MAX_GENERATED_IAC_BYTES,
    rootDirectory,
  );
  const currentRepositorySource = readBoundedTextFile(
    currentRepositoryPath,
    MAX_LEGACY_CONFIG_BYTES,
    rootDirectory,
  );
  const legacyFixtureSource = readBoundedTextFile(
    legacyFixturePath,
    MAX_LEGACY_CONFIG_BYTES,
    rootDirectory,
  );
  return {
    generatedIacPath: generatedSource === null ? null : ".railway/railway.ts",
    generatedIacSha256:
      generatedSource !== null
        ? createHash("sha256").update(generatedSource).digest("hex")
        : null,
    generatedIacSecretSafe:
      generatedSource === null
        ? null
        : generatedIacSourceIsSecretSafe(generatedSource),
    currentRepositoryFilePresent: currentRepositorySource !== null,
    currentRepositoryFileSha256:
      currentRepositorySource === null
        ? null
        : createHash("sha256").update(currentRepositorySource).digest("hex"),
    currentRepositoryFileContent: currentRepositorySource,
    legacyFixturePresent: legacyFixtureSource !== null,
    legacyFixtureSha256:
      legacyFixtureSource === null
        ? null
        : createHash("sha256").update(legacyFixtureSource).digest("hex"),
    legacyFixtureContent: legacyFixtureSource,
  };
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  let inputTooLarge = false;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) {
      inputTooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }

  let input: unknown = null;
  if (!inputTooLarge) {
    try {
      input = parseStrictJson(Buffer.concat(chunks).toString("utf8"));
    } catch {
      input = null;
    }
  }

  const result = validateRailwayIacMigrationEvidence(
    input,
    localFilesystemEvidence(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.migrationEvidence === "pass" ? 0 : 1;
}

if (isDirectEntrypoint()) {
  void main();
}
