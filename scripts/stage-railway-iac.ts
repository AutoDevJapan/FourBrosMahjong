import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import ts from "typescript";
import { generatedIacSourceIsSecretSafe } from "./railway-iac-migration-contract";
import { inspectNamedPartialSource } from "./railway-iac-named-partial";
import {
  isDirectEntrypoint,
  MAX_GENERATED_IAC_BYTES,
  readBoundedFile,
} from "./verify-railway-iac-migration";

export const STAGED_RAILWAY_IAC_PATH = ".railway/railway.ts";

type StageFailureReason =
  | "source-argument-invalid"
  | "source-must-be-railway-ts"
  | "source-must-be-outside-repository"
  | "source-not-found-or-unsafe"
  | "source-is-not-utf8"
  | "source-failed-secret-safety-check"
  | "source-is-not-railway-iac"
  | "source-is-not-target-partial"
  | "destination-parent-unsafe"
  | "destination-already-exists"
  | "destination-write-failed";

export type StageRailwayIacResult =
  | {
      readonly ok: true;
      readonly mode: "validated" | "staged";
      readonly bytes: number;
      readonly sha256: string;
    }
  | {
      readonly ok: false;
      readonly reason: StageFailureReason;
    };

type StageRailwayIacOptions = {
  readonly sourcePath: string;
  readonly repositoryRoot: string;
  readonly write: boolean;
};

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function isPathInside(path: string, root: string): boolean {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !pathFromRoot.startsWith(sep))
  );
}

function realpathOrNull(path: string): string | null {
  try {
    return resolve(realpathSync(path));
  } catch {
    return null;
  }
}

function hasRailwayIacDefinition(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    "railway.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let importsDefineRailway = false;
  let callsDefineRailway = false;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineRailway"
    ) {
      callsDefineRailway = true;
    }
    if (!callsDefineRailway) ts.forEachChild(node, visit);
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "railway/iac" &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      importsDefineRailway ||=
        statement.importClause.namedBindings.elements.some(
          (element) =>
            !element.isTypeOnly &&
            element.propertyName === undefined &&
            element.name.text === "defineRailway",
        );
    }
    visit(statement);
  }

  return importsDefineRailway && callsDefineRailway;
}

function destinationDirectoryIsSafe(repositoryRoot: string): "safe" | "unsafe" {
  const directory = resolve(repositoryRoot, ".railway");
  try {
    const stats = lstatSync(directory);
    return stats.isDirectory() && !stats.isSymbolicLink() ? "safe" : "unsafe";
  } catch {
    try {
      mkdirSync(directory, { mode: 0o755 });
      const stats = lstatSync(directory);
      return stats.isDirectory() && !stats.isSymbolicLink() ? "safe" : "unsafe";
    } catch {
      return "unsafe";
    }
  }
}

function writeNewFile(path: string, content: Buffer): boolean {
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    created = true;
    let offset = 0;
    while (offset < content.length) {
      const bytesWritten = writeSync(
        descriptor,
        content,
        offset,
        content.length - offset,
      );
      if (bytesWritten <= 0) throw new Error("write made no progress");
      offset += bytesWritten;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return true;
  } catch {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The operation already failed; preserve the fixed error contract.
      }
    }
    if (created) {
      try {
        unlinkSync(path);
      } catch {
        // Do not reflect filesystem details in the staging result.
      }
    }
    return false;
  }
}

export function stageRailwayIacSource(
  options: StageRailwayIacOptions,
): StageRailwayIacResult {
  if (
    typeof options.sourcePath !== "string" ||
    options.sourcePath.trim() === "" ||
    typeof options.repositoryRoot !== "string" ||
    options.repositoryRoot.trim() === ""
  ) {
    return { ok: false, reason: "source-argument-invalid" };
  }

  const repositoryRoot = realpathOrNull(options.repositoryRoot);
  const sourcePath = resolve(options.sourcePath);
  const sourceRealPath = realpathOrNull(sourcePath);
  if (
    repositoryRoot === null ||
    sourceRealPath === null ||
    (() => {
      try {
        const stats = lstatSync(repositoryRoot);
        return !stats.isDirectory() || stats.isSymbolicLink();
      } catch {
        return true;
      }
    })()
  ) {
    return { ok: false, reason: "source-not-found-or-unsafe" };
  }
  if (isPathInside(sourceRealPath, repositoryRoot)) {
    return { ok: false, reason: "source-must-be-outside-repository" };
  }
  if (!sourceRealPath.endsWith(`${sep}railway.ts`)) {
    return { ok: false, reason: "source-must-be-railway-ts" };
  }

  const content = readBoundedFile(
    sourcePath,
    MAX_GENERATED_IAC_BYTES,
    dirname(sourcePath),
  );
  if (content === null) {
    return { ok: false, reason: "source-not-found-or-unsafe" };
  }

  let source: string;
  try {
    source = UTF8_DECODER.decode(content);
  } catch {
    return { ok: false, reason: "source-is-not-utf8" };
  }
  if (!generatedIacSourceIsSecretSafe(source)) {
    return { ok: false, reason: "source-failed-secret-safety-check" };
  }
  if (!hasRailwayIacDefinition(source)) {
    return { ok: false, reason: "source-is-not-railway-iac" };
  }
  if (inspectNamedPartialSource(source) === null) {
    return { ok: false, reason: "source-is-not-target-partial" };
  }

  const result = {
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  } as const;
  if (!options.write) return { ok: true, mode: "validated", ...result };

  if (destinationDirectoryIsSafe(repositoryRoot) !== "safe") {
    return { ok: false, reason: "destination-parent-unsafe" };
  }
  const destination = resolve(repositoryRoot, STAGED_RAILWAY_IAC_PATH);
  try {
    if (lstatSync(destination)) {
      return { ok: false, reason: "destination-already-exists" };
    }
  } catch {
    // The exclusive create below is the final race-safe existence check.
  }
  if (!writeNewFile(destination, content)) {
    return { ok: false, reason: "destination-write-failed" };
  }
  return { ok: true, mode: "staged", ...result };
}

function parseArguments(
  args: readonly string[],
): { readonly sourcePath: string; readonly write: boolean } | null {
  if (args.length === 1 && args[0] !== undefined) {
    return { sourcePath: args[0], write: false };
  }
  if (args.length === 2 && args[0] === "--write" && args[1] !== undefined) {
    return { sourcePath: args[1], write: true };
  }
  return null;
}

function usage(): string {
  return "usage: pnpm stage:railway:iac [--write] /outside/path/railway.ts";
}

function main(): void {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed === null) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = stageRailwayIacSource({
    ...parsed,
    repositoryRoot,
  });
  if (!result.ok) {
    process.stderr.write(`${result.reason}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectEntrypoint(process.argv[1], import.meta.url)) main();
