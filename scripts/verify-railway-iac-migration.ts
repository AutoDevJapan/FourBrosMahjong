import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generatedIacSourceIsSecretSafe,
  RAILWAY_LEGACY_FIXTURE_PATH,
  type RailwayIacFilesystemEvidence,
  validateRailwayIacMigrationEvidence,
} from "./railway-iac-migration-contract";

const MAX_INPUT_BYTES = 64 * 1_024;
const repositoryRoot = process.cwd();

function localFilesystemEvidence(): RailwayIacFilesystemEvidence {
  const generatedPath = resolve(repositoryRoot, ".railway/railway.ts");
  const currentRepositoryPath = resolve(repositoryRoot, "railway.json");
  const legacyFixturePath = resolve(
    repositoryRoot,
    RAILWAY_LEGACY_FIXTURE_PATH,
  );
  const generatedExists = existsSync(generatedPath);
  const currentRepositoryExists = existsSync(currentRepositoryPath);
  const legacyFixtureExists = existsSync(legacyFixturePath);
  const generatedSource = generatedExists
    ? readFileSync(generatedPath, "utf8")
    : null;
  const currentRepositorySource = currentRepositoryExists
    ? (() => {
        try {
          return readFileSync(currentRepositoryPath, "utf8");
        } catch {
          return null;
        }
      })()
    : null;
  const legacyFixtureSource = legacyFixtureExists
    ? (() => {
        try {
          return readFileSync(legacyFixturePath, "utf8");
        } catch {
          return null;
        }
      })()
    : null;
  return {
    generatedIacPath: generatedExists ? ".railway/railway.ts" : null,
    generatedIacSha256: generatedExists
      ? createHash("sha256")
          .update(generatedSource ?? "")
          .digest("hex")
      : null,
    generatedIacSecretSafe:
      generatedSource === null
        ? null
        : generatedIacSourceIsSecretSafe(generatedSource),
    currentRepositoryFilePresent: currentRepositoryExists,
    currentRepositoryFileSha256:
      currentRepositorySource === null
        ? null
        : createHash("sha256")
            .update(currentRepositorySource, "utf8")
            .digest("hex"),
    currentRepositoryFileContent: currentRepositorySource,
    legacyFixturePresent: legacyFixtureExists,
    legacyFixtureSha256:
      legacyFixtureSource === null
        ? null
        : createHash("sha256")
            .update(legacyFixtureSource, "utf8")
            .digest("hex"),
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
