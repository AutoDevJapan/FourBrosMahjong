import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
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
const repositoryRoot = process.cwd();

export function readBoundedTextFile(filePath: string): string | null {
  let fileDescriptor: number | undefined;

  try {
    // Open once and inspect that descriptor so a path replacement cannot make
    // the size check and the read refer to different files. O_NONBLOCK also
    // prevents a raced special file such as a FIFO from blocking the verifier.
    fileDescriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    const fileStats = fstatSync(fileDescriptor);
    if (!fileStats.isFile() || fileStats.size > MAX_GENERATED_IAC_BYTES) {
      return null;
    }

    const content = Buffer.alloc(fileStats.size);
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
    if (!finalStats.isFile() || finalStats.size !== fileStats.size) {
      return null;
    }

    return content.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // The read result is already fail-closed if closing the descriptor
        // itself fails.
      }
    }
  }
}

export function localFilesystemEvidence(
  rootDirectory = repositoryRoot,
): RailwayIacFilesystemEvidence {
  const generatedPath = resolve(rootDirectory, ".railway/railway.ts");
  const legacyPath = resolve(rootDirectory, "railway.json");
  const legacyExists = existsSync(legacyPath);
  const generatedSource = readBoundedTextFile(generatedPath);
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
    legacyRepositoryFilePresent: legacyExists,
    legacyRepositoryFileSha256: legacyExists
      ? createHash("sha256").update(readFileSync(legacyPath)).digest("hex")
      : null,
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
