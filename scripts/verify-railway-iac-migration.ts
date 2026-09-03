import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  generatedIacSourceIsSecretSafe,
  type RailwayIacFilesystemEvidence,
  validateRailwayIacMigrationEvidence,
} from "./railway-iac-migration-contract";

const MAX_INPUT_BYTES = 64 * 1_024;
const MAX_GENERATED_IAC_BYTES = 64 * 1_024;
const repositoryRoot = process.cwd();

function readBoundedTextFile(filePath: string): string | null {
  try {
    const fileStats = statSync(filePath);
    if (!fileStats.isFile() || fileStats.size > MAX_GENERATED_IAC_BYTES) {
      return null;
    }
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function localFilesystemEvidence(): RailwayIacFilesystemEvidence {
  const generatedPath = resolve(repositoryRoot, ".railway/railway.ts");
  const legacyPath = resolve(repositoryRoot, "railway.json");
  const legacyExists = existsSync(legacyPath);
  const generatedSource = readBoundedTextFile(generatedPath);
  return {
    generatedIacPath:
      generatedSource === null ? null : ".railway/railway.ts",
    generatedIacSha256: generatedSource !== null
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

void main();
