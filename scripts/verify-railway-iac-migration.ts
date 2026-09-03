import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generatedIacSourceIsSecretSafe,
  type RailwayIacFilesystemEvidence,
  validateRailwayIacMigrationEvidence,
} from "./railway-iac-migration-contract";

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

function pathStillOwnsFile(
  filePath: string,
  fileStats: ReturnType<typeof fstatSync>,
): boolean {
  const pathStats = lstatSync(filePath);
  return (
    pathStats.isFile() &&
    !pathStats.isSymbolicLink() &&
    hasSameFileIdentity(pathStats, fileStats)
  );
}

export function readBoundedFile(
  filePath: string,
  maxBytes: number,
): Buffer | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return null;

  let fileDescriptor: number | undefined;
  let content: Buffer | null = null;

  try {
    // Open once and inspect that descriptor so a path replacement cannot make
    // the size check and the read refer to different files. O_NOFOLLOW rejects
    // the final symlink atomically where the platform provides it, while the
    // lstat identity checks below keep the same fail-closed behavior elsewhere.
    // O_NONBLOCK also prevents a raced special file such as a FIFO from
    // blocking the verifier.
    fileDescriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const initialStats = fstatSync(fileDescriptor);
    if (
      !isBoundedRegularFile(initialStats, maxBytes) ||
      !pathStillOwnsFile(filePath, initialStats)
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
    const finalStats = fstatSync(fileDescriptor);
    if (
      !isBoundedRegularFile(finalStats, maxBytes) ||
      !hasSameFileIdentity(initialStats, finalStats) ||
      finalStats.size !== initialStats.size ||
      !pathStillOwnsFile(filePath, finalStats)
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

export function readBoundedTextFile(
  filePath: string,
  maxBytes = MAX_GENERATED_IAC_BYTES,
): string | null {
  const content = readBoundedFile(filePath, maxBytes);
  return content === null ? null : content.toString("utf8");
}

export function localFilesystemEvidence(
  rootDirectory = repositoryRoot,
): RailwayIacFilesystemEvidence {
  const generatedPath = resolve(rootDirectory, ".railway/railway.ts");
  const legacyPath = resolve(rootDirectory, "railway.json");
  const generatedSource = readBoundedTextFile(generatedPath);
  const legacySource = readBoundedFile(legacyPath, MAX_LEGACY_CONFIG_BYTES);
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
    legacyRepositoryFilePresent: legacySource !== null,
    legacyRepositoryFileSha256:
      legacySource === null
        ? null
        : createHash("sha256").update(legacySource).digest("hex"),
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
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
