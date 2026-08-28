import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPOSITORY_ROOT = process.cwd();
const ONLINE_RUNTIME_PACKAGE_NAME = "@four-bros-mahjong/online-runtime";
const PINNED_NODE_IMAGE =
  /^node:\d+\.\d+\.\d+-[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64}$/;
const REQUIRED_DOCKERIGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  ".npmrc",
  "**/.npmrc",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
  "**/*.test.*",
  "**/*.spec.*",
  "src/test",
  "**/__testing__",
  "**/__oracle__",
  "src/components/game/finishedGameFixture.ts",
] as const;

interface DockerInstruction {
  readonly name: string;
  readonly value: string;
}

interface DockerStage {
  readonly alias: string | null;
  readonly from: DockerInstruction;
  readonly instructions: DockerInstruction[];
}

interface PackageManifest {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly type?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
  readonly packageManager?: unknown;
  readonly [key: string]: unknown;
}

interface DependabotUpdate {
  readonly "package-ecosystem"?: unknown;
  readonly directory?: unknown;
  readonly directories?: unknown;
  readonly schedule?: { readonly interval?: unknown };
}

interface DependabotConfig {
  readonly version?: unknown;
  readonly updates?: unknown;
}

function dockerInstructions(source: string): readonly DockerInstruction[] {
  const logicalLines: string[] = [];
  let continuation = "";

  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (
      continuation.length === 0 &&
      (trimmed.length === 0 || trimmed.startsWith("#"))
    ) {
      continue;
    }
    const continued = trimmed.endsWith("\\");
    const fragment = continued ? trimmed.slice(0, -1).trimEnd() : trimmed;
    continuation =
      continuation.length === 0 ? fragment : `${continuation} ${fragment}`;
    if (continued) continue;
    logicalLines.push(continuation);
    continuation = "";
  }
  if (continuation.length > 0) logicalLines.push(continuation);

  return logicalLines.map((line) => {
    const match = line.match(/^([a-z]+)\s+(.+)$/i);
    if (!match?.[1] || !match[2]) {
      return { name: "INVALID", value: line };
    }
    return { name: match[1].toUpperCase(), value: match[2].trim() };
  });
}

function fromImage(value: string): string | null {
  const tokens = value.split(/\s+/);
  if (tokens[0]?.startsWith("--")) return null;
  const image = tokens.shift();
  if (!image) return null;
  if (tokens.length === 0) return image;
  if (tokens.length === 2 && tokens[0]?.toUpperCase() === "AS" && tokens[1]) {
    return image;
  }
  return null;
}

function isExplicitNonRootUser(value: string): boolean {
  const [user, group, ...extra] = value.split(":");
  if (!user || extra.length > 0) return false;
  const validUser = user === "node" || /^[1-9]\d*$/.test(user);
  const validGroup =
    group === undefined || group === "node" || /^[1-9]\d*$/.test(group);
  return validUser && validGroup;
}

function copyArguments(value: string): readonly string[] | null {
  const withoutFlags = value.replace(/^(?:--[^\s]+\s+)*/, "");
  if (!withoutFlags.startsWith("[")) return withoutFlags.split(/\s+/);
  try {
    const parsed: unknown = JSON.parse(withoutFlags);
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function copyFlags(value: string): readonly string[] {
  const flags: string[] = [];
  for (const token of value.split(/\s+/)) {
    if (!token.startsWith("--")) break;
    flags.push(token);
  }
  return flags;
}

function copyFromStage(value: string): string | null {
  return value.match(/(?:^|\s)--from=([^\s]+)/)?.[1] ?? null;
}

function dockerStages(
  instructions: readonly DockerInstruction[],
): readonly DockerStage[] {
  const stages: DockerStage[] = [];
  for (const instruction of instructions) {
    if (instruction.name === "FROM") {
      const alias = instruction.value.match(/\s+AS\s+([^\s]+)$/i)?.[1] ?? null;
      stages.push({ alias, from: instruction, instructions: [] });
      continue;
    }
    const current = stages.at(-1);
    if (current) {
      current.instructions.push(instruction);
    }
  }
  return stages;
}

function commandSegments(stage: DockerStage): readonly string[] {
  return stage.instructions
    .filter((instruction) => instruction.name === "RUN")
    .flatMap((instruction) =>
      instruction.value.split(/&&|\|\||;/).map((segment) => segment.trim()),
    );
}

function pnpmCommandTokens(command: string): readonly string[] | null {
  const tokens = command.split(/\s+/).filter(Boolean);
  return tokens[0] === "pnpm" ? tokens : null;
}

function isExactPnpmCommand(
  command: string,
  packageName: string,
  operation: "install" | "deploy",
): boolean {
  const tokens = pnpmCommandTokens(command);
  if (!tokens) return false;
  const normalized = tokens.flatMap((token) =>
    token.startsWith("--filter=") ? ["--filter", token.slice(9)] : [token],
  );
  const suffix =
    operation === "install"
      ? ["install", "--prod", "--frozen-lockfile"]
      : ["deploy", "--prod", "/runtime"];
  return (
    JSON.stringify(normalized) ===
    JSON.stringify([
      "pnpm",
      "--filter",
      packageName,
      "--fail-if-no-match",
      ...suffix,
    ])
  );
}

function hasFlag(command: string, flag: string): boolean {
  return command.split(/\s+/).includes(flag);
}

function sameCopy(
  instruction: DockerInstruction | undefined,
  expected: readonly string[],
): boolean {
  return (
    instruction !== undefined &&
    JSON.stringify(copyArguments(instruction.value)) ===
      JSON.stringify(expected)
  );
}

function dockerfileViolations(
  source: string,
  runtimePackageName = ONLINE_RUNTIME_PACKAGE_NAME,
  packageManager = "pnpm@10.33.0",
): readonly string[] {
  const instructions = dockerInstructions(source);
  const stages = dockerStages(instructions);
  const violations: string[] = [];

  if (instructions.some((instruction) => instruction.name === "ADD")) {
    violations.push("Dockerfile must not use ADD");
  }

  const copyInstructions = instructions.filter(
    (instruction) => instruction.name === "COPY",
  );
  for (const instruction of copyInstructions) {
    const args = copyArguments(instruction.value);
    const flags = copyFlags(instruction.value);
    const from = copyFromStage(instruction.value);
    if (
      (from === null && flags.length !== 0) ||
      (from !== null && (flags.length !== 1 || flags[0] !== `--from=${from}`))
    ) {
      violations.push(
        "Dockerfile COPY flags must be absent except for one exact --from",
      );
    }
    if (
      args === null ||
      args.slice(0, -1).some((copySource) => {
        const normalized = copySource.replace(/\/+$/, "");
        return (
          normalized === "." || normalized === "" || /[*?[]/.test(copySource)
        );
      })
    ) {
      violations.push(
        "Dockerfile must not use a broad or wildcard COPY source",
      );
    }
  }

  if (stages.length === 0) {
    violations.push("Dockerfile must contain a FROM instruction");
    return violations;
  }

  const aliases = stages.flatMap((stage) => (stage.alias ? [stage.alias] : []));
  if (new Set(aliases).size !== aliases.length) {
    violations.push("Dockerfile stage aliases must be unique");
  }

  for (const stage of stages) {
    const image = fromImage(stage.from.value);
    if (image === "scratch") continue;
    if (image === null || !PINNED_NODE_IMAGE.test(image)) {
      violations.push(
        `FROM must use a readable Node tag pinned by a lowercase sha256 digest: ${stage.from.value}`,
      );
    }
  }

  const finalStage = stages.at(-1) as DockerStage;
  const finalUser = finalStage.instructions
    .filter((instruction) => instruction.name === "USER")
    .at(-1);
  if (!finalUser || !isExplicitNonRootUser(finalUser.value)) {
    violations.push("the final stage must select an explicit non-root USER");
  }
  if (
    commandSegments(finalStage).some((command) =>
      /\b(?:corepack|npm|pnpm|yarn)\b/.test(command),
    )
  ) {
    violations.push("the final stage must not run a package manager");
  }
  const finalEntrypoints = finalStage.instructions.filter(
    (instruction) => instruction.name === "ENTRYPOINT",
  );
  const finalCommands = finalStage.instructions.filter(
    (instruction) => instruction.name === "CMD",
  );
  let finalCommand: unknown = null;
  try {
    finalCommand = JSON.parse(finalCommands[0]?.value ?? "null");
  } catch {
    // The exact JSON-array check below reports malformed or shell-form CMD.
  }
  if (
    finalEntrypoints.length !== 0 ||
    finalCommands.length !== 1 ||
    JSON.stringify(finalCommand) !==
      JSON.stringify(["node", "--import", "tsx", "server/start.ts"])
  ) {
    violations.push(
      "the final stage must launch the server as the direct Node PID1",
    );
  }

  const finalCopies = finalStage.instructions.filter(
    (instruction) => instruction.name === "COPY",
  );
  const finalExternalCopies = finalCopies.filter(
    (instruction) => copyFromStage(instruction.value) !== null,
  );
  const packageCopy = finalExternalCopies.find((instruction) =>
    sameCopy(instruction, ["/runtime/package.json", "./package.json"]),
  );
  const nodeModulesCopy = finalExternalCopies.find((instruction) =>
    sameCopy(instruction, ["/runtime/node_modules", "./node_modules"]),
  );
  const deployStageAlias = packageCopy
    ? copyFromStage(packageCopy.value)
    : null;
  if (
    !packageCopy ||
    !nodeModulesCopy ||
    deployStageAlias === null ||
    copyFromStage(nodeModulesCopy.value) !== deployStageAlias ||
    finalExternalCopies.length !== 2
  ) {
    violations.push(
      "the final stage must copy only /runtime package.json and node_modules from one deploy stage",
    );
  }

  for (const requiredCopy of [
    ["tsconfig.json", "./"],
    ["server", "./server"],
    ["src", "./src"],
  ]) {
    if (
      !finalCopies.some((instruction) => sameCopy(instruction, requiredCopy))
    ) {
      violations.push(
        `required explicit final-stage COPY is missing: ${requiredCopy.join(" ")}`,
      );
    }
  }

  const allowedFinalCopies = finalCopies.filter(
    (instruction) =>
      instruction === packageCopy ||
      instruction === nodeModulesCopy ||
      sameCopy(instruction, ["tsconfig.json", "./"]) ||
      sameCopy(instruction, ["server", "./server"]) ||
      sameCopy(instruction, ["src", "./src"]),
  );
  if (allowedFinalCopies.length !== finalCopies.length) {
    violations.push("the final stage contains an unexpected COPY instruction");
  }

  const deployStageMatches = stages.filter(
    (stage) => stage.alias === deployStageAlias,
  );
  const deployStage = deployStageMatches[0];
  if (
    deployStageMatches.length !== 1 ||
    !deployStage ||
    stages.indexOf(deployStage) >= stages.length - 1
  ) {
    violations.push(
      "the final stage must consume exactly one preceding deploy stage",
    );
  }
  const deployCommands = deployStage ? commandSegments(deployStage) : [];
  if (
    !deployCommands.some((command) =>
      isExactPnpmCommand(command, runtimePackageName, "install"),
    )
  ) {
    violations.push(
      "the consumed deploy stage must frozen-install only the production runtime workspace",
    );
  }
  if (
    !deployCommands.some((command) =>
      isExactPnpmCommand(command, runtimePackageName, "deploy"),
    )
  ) {
    violations.push(
      "the consumed deploy stage must deploy only the production runtime workspace",
    );
  }
  if (
    deployCommands.some((command) => {
      const tokens = pnpmCommandTokens(command);
      return (
        tokens !== null &&
        tokens.includes("deploy") &&
        hasFlag(command, "--legacy")
      );
    })
  ) {
    violations.push(
      "the consumed deploy stage must use modern workspace deploy",
    );
  }

  const expectedDeployInstructionNames = [
    "ENV",
    "WORKDIR",
    "RUN",
    "COPY",
    "COPY",
    "RUN",
  ];
  const deployCopies =
    deployStage?.instructions.filter(
      (instruction) => instruction.name === "COPY",
    ) ?? [];
  if (
    stages.length !== 2 ||
    deployStage?.alias === null ||
    JSON.stringify(deployStage.instructions.map(({ name }) => name)) !==
      JSON.stringify(expectedDeployInstructionNames) ||
    deployStage.instructions[0]?.value !== "NODE_ENV=production" ||
    deployStage.instructions[1]?.value !== "/app" ||
    deployCommands.length !== 4 ||
    deployCommands[0] !== "corepack enable" ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(packageManager) ||
    deployCommands[1] !== `corepack prepare ${packageManager} --activate` ||
    !isExactPnpmCommand(
      deployCommands[2] ?? "",
      runtimePackageName,
      "install",
    ) ||
    !isExactPnpmCommand(
      deployCommands[3] ?? "",
      runtimePackageName,
      "deploy",
    ) ||
    !sameCopy(deployCopies[0] as DockerInstruction, [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "./",
    ]) ||
    !sameCopy(deployCopies[1] as DockerInstruction, [
      "container/online/package.json",
      "./container/online/package.json",
    ])
  ) {
    violations.push(
      "the dependencies stage must contain only the ordered runtime install and deploy contract",
    );
  }

  const expectedFinalInstructionNames = [
    "ENV",
    "WORKDIR",
    "COPY",
    "COPY",
    "COPY",
    "COPY",
    "COPY",
    "USER",
    "EXPOSE",
    "CMD",
  ];
  if (
    finalStage.alias !== null ||
    JSON.stringify(finalStage.instructions.map(({ name }) => name)) !==
      JSON.stringify(expectedFinalInstructionNames) ||
    finalStage.instructions[0]?.value !== "NODE_ENV=production" ||
    finalStage.instructions[1]?.value !== "/app" ||
    !sameCopy(finalStage.instructions[2] as DockerInstruction, [
      "/runtime/node_modules",
      "./node_modules",
    ]) ||
    !sameCopy(finalStage.instructions[3] as DockerInstruction, [
      "/runtime/package.json",
      "./package.json",
    ]) ||
    !sameCopy(finalStage.instructions[4] as DockerInstruction, [
      "tsconfig.json",
      "./",
    ]) ||
    !sameCopy(finalStage.instructions[5] as DockerInstruction, [
      "server",
      "./server",
    ]) ||
    !sameCopy(finalStage.instructions[6] as DockerInstruction, [
      "src",
      "./src",
    ]) ||
    finalStage.instructions[7]?.value !== "node" ||
    finalStage.instructions[8]?.value !== "8080"
  ) {
    violations.push(
      "the final stage must contain only the exact immutable runtime instructions",
    );
  }
  return violations;
}

function runtimeWorkspaceViolations(
  rootValue: unknown,
  runtimeValue: unknown,
  workspaceValue: unknown,
  lockfileValue: unknown,
): readonly string[] {
  const violations: string[] = [];
  if (rootValue === null || typeof rootValue !== "object") {
    return ["root package manifest must be an object"];
  }
  if (runtimeValue === null || typeof runtimeValue !== "object") {
    return ["container/online/package.json must be an object"];
  }
  const root = rootValue as PackageManifest;
  const runtime = runtimeValue as PackageManifest;
  const rootDependencies = root.dependencies as
    | Record<string, unknown>
    | undefined;
  const runtimeDependencies = runtime.dependencies as
    | Record<string, unknown>
    | undefined;

  if (
    JSON.stringify(Object.keys(runtime).sort()) !==
    JSON.stringify(["dependencies", "name", "private", "type"])
  ) {
    violations.push("runtime package must contain only runtime metadata");
  }

  if (
    runtime.name !== ONLINE_RUNTIME_PACKAGE_NAME ||
    runtime.name === root.name ||
    runtime.private !== true ||
    runtime.type !== "module"
  ) {
    violations.push(
      "runtime package must have the canonical name, private=true, and type=module",
    );
  }
  if (
    !runtimeDependencies ||
    JSON.stringify(Object.keys(runtimeDependencies).sort()) !==
      JSON.stringify(["tsx", "ws"])
  ) {
    violations.push("runtime dependencies must contain exactly tsx and ws");
  } else {
    for (const dependency of ["tsx", "ws"]) {
      if (
        typeof runtimeDependencies[dependency] !== "string" ||
        runtimeDependencies[dependency] !== rootDependencies?.[dependency]
      ) {
        violations.push(
          `runtime ${dependency} specifier must equal the root package specifier`,
        );
      }
    }
  }
  const packages =
    workspaceValue !== null && typeof workspaceValue === "object"
      ? (workspaceValue as { readonly packages?: unknown }).packages
      : undefined;
  const injectWorkspacePackages =
    workspaceValue !== null && typeof workspaceValue === "object"
      ? (workspaceValue as { readonly injectWorkspacePackages?: unknown })
          .injectWorkspacePackages
      : undefined;
  if (
    !Array.isArray(packages) ||
    !packages.some((pattern) =>
      ["container/online", "container/*", "container/**"].includes(
        String(pattern).replace(/^\.\//, "").replace(/\/$/, ""),
      ),
    ) ||
    packages.some((pattern) =>
      ["!container/online", "!container/*", "!container/**"].includes(
        String(pattern).replace(/^\.\//, "").replace(/\/$/, ""),
      ),
    )
  ) {
    violations.push("pnpm workspace must include container/online");
  }
  if (injectWorkspacePackages !== true) {
    violations.push("pnpm workspace must inject workspace packages");
  }

  type LockDependency = {
    readonly specifier?: unknown;
    readonly version?: unknown;
  };
  const lockfile =
    lockfileValue !== null && typeof lockfileValue === "object"
      ? (lockfileValue as {
          readonly importers?: Record<
            string,
            { readonly dependencies?: Record<string, LockDependency> }
          >;
          readonly settings?: Record<string, unknown>;
        })
      : undefined;
  if (lockfile?.settings?.injectWorkspacePackages !== true) {
    violations.push("lockfile must record injectWorkspacePackages=true");
  }
  const lockDependencies =
    lockfile?.importers?.["container/online"]?.dependencies;
  const rootLockDependencies = lockfile?.importers?.["."]?.dependencies;
  if (
    !lockDependencies ||
    JSON.stringify(Object.keys(lockDependencies).sort()) !==
      JSON.stringify(["tsx", "ws"])
  ) {
    violations.push(
      "lockfile runtime importer must contain exactly tsx and ws",
    );
  } else {
    for (const dependency of ["tsx", "ws"]) {
      if (
        lockDependencies[dependency]?.specifier !==
        runtimeDependencies?.[dependency]
      ) {
        violations.push(
          `lockfile runtime ${dependency} specifier must equal its package manifest`,
        );
      }
      if (
        rootLockDependencies?.[dependency]?.version !==
        lockDependencies[dependency]?.version
      ) {
        violations.push(
          `lockfile runtime ${dependency} version must equal the root lock version`,
        );
      }
    }
  }
  return violations;
}

function knipWorkspaceViolations(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") {
    return ["knip config must be an object"];
  }
  const config = value as {
    readonly ignoreDependencies?: unknown;
    readonly workspaces?: unknown;
  };
  const violations: string[] = [];
  if (config.ignoreDependencies !== undefined) {
    violations.push("knip must not ignore dependencies globally");
  }
  if (config.workspaces === null || typeof config.workspaces !== "object") {
    return [...violations, "knip must configure only container/online"];
  }
  const workspaces = config.workspaces as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(workspaces)) !==
    JSON.stringify(["container/online"])
  ) {
    violations.push("knip must configure only container/online");
  }
  const runtimeConfig = workspaces["container/online"];
  if (runtimeConfig === null || typeof runtimeConfig !== "object") {
    violations.push("knip runtime workspace must ignore exactly tsx and ws");
    return violations;
  }
  const runtimeKeys = Object.keys(runtimeConfig as Record<string, unknown>);
  const ignored = (runtimeConfig as { readonly ignoreDependencies?: unknown })
    .ignoreDependencies;
  if (
    JSON.stringify(runtimeKeys) !== JSON.stringify(["ignoreDependencies"]) ||
    !Array.isArray(ignored) ||
    JSON.stringify([...ignored].sort()) !== JSON.stringify(["tsx", "ws"])
  ) {
    violations.push("knip runtime workspace must ignore exactly tsx and ws");
  }
  return violations;
}

function readJsonOrNull(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readYamlOrNull(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function dockerignoreViolations(source: string): readonly string[] {
  const patterns = source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const violations = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => `negated dockerignore rule is forbidden: ${pattern}`);
  const patternSet = new Set(patterns);
  for (const required of REQUIRED_DOCKERIGNORE_PATTERNS) {
    if (!patternSet.has(required)) {
      violations.push(`required dockerignore rule is missing: ${required}`);
    }
  }
  return violations;
}

function dockerfileIgnoreOverrideViolations(
  filenames: readonly string[],
): readonly string[] {
  return filenames
    .filter(
      (filename) =>
        filename !== ".dockerignore" && filename.endsWith(".dockerignore"),
    )
    .map(
      (filename) =>
        `Dockerfile-specific ignore override is forbidden: ${filename}`,
    );
}

function dependabotViolations(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") {
    return ["Dependabot config must be an object"];
  }
  const config = value as DependabotConfig;
  if (config.version !== 2 || !Array.isArray(config.updates)) {
    return ["Dependabot config must use version 2 with an updates array"];
  }
  const updates = config.updates as readonly DependabotUpdate[];
  const dockerUpdates = updates.filter(
    (update) => update?.["package-ecosystem"] === "docker",
  );
  const npmUpdates = updates.filter(
    (update) => update?.["package-ecosystem"] === "npm",
  );
  const violations: string[] = [];
  if (dockerUpdates.length !== 1) {
    violations.push(
      "Dependabot must contain exactly one Docker ecosystem entry",
    );
  }
  if (npmUpdates.length !== 1) {
    violations.push("Dependabot must contain exactly one npm ecosystem entry");
  }
  const dockerUpdate = dockerUpdates[0];
  const npmUpdate = npmUpdates[0];
  if (dockerUpdate?.directory !== "/") {
    violations.push('Dependabot Docker directory must be "/"');
  }
  const npmDirectories = npmUpdate?.directories;
  if (
    !Array.isArray(npmDirectories) ||
    npmUpdate?.directory !== undefined ||
    JSON.stringify([...npmDirectories].sort()) !==
      JSON.stringify(["/", "/container/online"])
  ) {
    violations.push(
      "Dependabot npm directories must contain exactly / and /container/online",
    );
  }
  if (
    !["daily", "weekly", "monthly"].includes(
      String(dockerUpdate?.schedule?.interval),
    )
  ) {
    violations.push(
      "Dependabot Docker entry must have a supported periodic schedule",
    );
  }
  if (
    !["daily", "weekly", "monthly"].includes(
      String(npmUpdate?.schedule?.interval),
    )
  ) {
    violations.push(
      "Dependabot npm entry must have a supported periodic schedule",
    );
  }
  return violations;
}

describe("Docker hardening repository contract (#734)", () => {
  it("pins every non-scratch base and selects a non-root final user", () => {
    const source = readFileSync(resolve(REPOSITORY_ROOT, "Dockerfile"), "utf8");
    const root = readJsonOrNull(
      resolve(REPOSITORY_ROOT, "package.json"),
    ) as PackageManifest | null;
    expect(
      dockerfileViolations(
        source,
        ONLINE_RUNTIME_PACKAGE_NAME,
        String(root?.packageManager),
      ),
    ).toEqual([]);
  });

  it("isolates the online runtime in a minimal pnpm workspace package", () => {
    expect(
      runtimeWorkspaceViolations(
        readJsonOrNull(resolve(REPOSITORY_ROOT, "package.json")),
        readJsonOrNull(
          resolve(REPOSITORY_ROOT, "container/online/package.json"),
        ),
        readYamlOrNull(resolve(REPOSITORY_ROOT, "pnpm-workspace.yaml")),
        readYamlOrNull(resolve(REPOSITORY_ROOT, "pnpm-lock.yaml")),
      ),
    ).toEqual([]);
  });

  it("rejects runtime dependency or workspace drift", () => {
    const root = {
      name: "soshina-majong",
      dependencies: { tsx: "^4.23.12", ws: "^8.21.3" },
    };
    const runtime = {
      name: ONLINE_RUNTIME_PACKAGE_NAME,
      private: true,
      type: "module",
      dependencies: { tsx: "^4.23.12", ws: "^8.21.3" },
    };
    const workspace = {
      injectWorkspacePackages: true,
      packages: ["container/*"],
    };
    const lockfile = {
      settings: { injectWorkspacePackages: true },
      importers: {
        ".": {
          dependencies: {
            tsx: { specifier: "^4.23.12", version: "4.23.12" },
            ws: { specifier: "^8.21.3", version: "8.21.3" },
          },
        },
        "container/online": {
          dependencies: {
            tsx: { specifier: "^4.23.12", version: "4.23.12" },
            ws: { specifier: "^8.21.3", version: "8.21.3" },
          },
        },
      },
    };
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, lockfile),
    ).toEqual([]);
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, dependencies: { ...runtime.dependencies, next: "16" } },
        workspace,
        lockfile,
      ),
    ).toContain("runtime dependencies must contain exactly tsx and ws");
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, dependencies: { ...runtime.dependencies, ws: "^9" } },
        workspace,
        lockfile,
      ),
    ).toContain("runtime ws specifier must equal the root package specifier");
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, private: false },
        workspace,
        lockfile,
      ),
    ).toContain(
      "runtime package must have the canonical name, private=true, and type=module",
    );
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, name: root.name },
        workspace,
        lockfile,
      ),
    ).toContain(
      "runtime package must have the canonical name, private=true, and type=module",
    );
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, devDependencies: {} },
        workspace,
        lockfile,
      ),
    ).toContain("runtime package must contain only runtime metadata");
    for (const extraKey of [
      "scripts",
      "bin",
      "main",
      "exports",
      "packageManager",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      expect(
        runtimeWorkspaceViolations(
          root,
          { ...runtime, [extraKey]: {} },
          workspace,
          lockfile,
        ),
      ).toContain("runtime package must contain only runtime metadata");
    }
    expect(
      runtimeWorkspaceViolations(
        root,
        runtime,
        { injectWorkspacePackages: true, packages: ["src/*"] },
        lockfile,
      ),
    ).toContain("pnpm workspace must include container/online");
    expect(
      runtimeWorkspaceViolations(
        root,
        runtime,
        {
          injectWorkspacePackages: true,
          packages: ["container/*", "!container/online"],
        },
        lockfile,
      ),
    ).toContain("pnpm workspace must include container/online");
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        settings: { injectWorkspacePackages: true },
        importers: {},
      }),
    ).toContain("lockfile runtime importer must contain exactly tsx and ws");
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        settings: { injectWorkspacePackages: true },
        importers: {
          "container/online": {
            dependencies: {
              tsx: { specifier: "^4.23.11" },
              ws: { specifier: "^8.21.3" },
            },
          },
        },
      }),
    ).toContain(
      "lockfile runtime tsx specifier must equal its package manifest",
    );
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        ...lockfile,
        importers: {
          ...lockfile.importers,
          "container/online": {
            dependencies: {
              ...lockfile.importers["container/online"].dependencies,
              ws: { specifier: "^8.21.3", version: "8.20.0" },
            },
          },
        },
      }),
    ).toContain("lockfile runtime ws version must equal the root lock version");
    expect(
      runtimeWorkspaceViolations(
        root,
        runtime,
        { packages: ["container/online"] },
        lockfile,
      ),
    ).toContain("pnpm workspace must inject workspace packages");
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        ...lockfile,
        settings: { injectWorkspacePackages: false },
      }),
    ).toContain("lockfile must record injectWorkspacePackages=true");
  });

  it("keeps the runtime-only knip exception narrow", () => {
    expect(
      knipWorkspaceViolations(
        readJsonOrNull(resolve(REPOSITORY_ROOT, "knip.json")),
      ),
    ).toEqual([]);
  });

  it("rejects global, extra-workspace, or extra-dependency knip ignores", () => {
    const valid = {
      workspaces: {
        "container/online": { ignoreDependencies: ["tsx", "ws"] },
      },
    };
    expect(knipWorkspaceViolations(valid)).toEqual([]);
    expect(
      knipWorkspaceViolations({ ...valid, ignoreDependencies: ["tsx"] }),
    ).toContain("knip must not ignore dependencies globally");
    expect(
      knipWorkspaceViolations({
        workspaces: { ...valid.workspaces, ".": {} },
      }),
    ).toContain("knip must configure only container/online");
    expect(
      knipWorkspaceViolations({
        workspaces: {
          "container/online": {
            ignoreDependencies: ["next", "tsx", "ws"],
          },
        },
      }),
    ).toContain("knip runtime workspace must ignore exactly tsx and ws");
  });

  it("rejects unconsumed deploy stages, broad copies, or root final stages", () => {
    const digest = "a".repeat(64);
    const runtimePackageName = ONLINE_RUNTIME_PACKAGE_NAME;
    const valid = `FROM node:24.15.0-slim@sha256:${digest} AS dependencies
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY container/online/package.json ./container/online/package.json
RUN pnpm --filter ${runtimePackageName} --fail-if-no-match install --prod --frozen-lockfile \
    && pnpm --filter=${runtimePackageName} --fail-if-no-match deploy --prod /runtime
FROM node:24.15.0-slim@sha256:${digest}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /runtime/node_modules ./node_modules
COPY --from=dependencies /runtime/package.json ./package.json
COPY tsconfig.json ./
COPY server ./server
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "server/start.ts"]`;
    expect(dockerfileViolations(valid, runtimePackageName)).toEqual([]);
    const expectViolation = (mutated: string, message: string) => {
      expect(
        dockerfileViolations(mutated, runtimePackageName).join("\n"),
      ).toContain(message);
    };
    expectViolation("FROM node:24.15.0-slim\nUSER node", "FROM must use");
    expectViolation(
      "ARG BASE=node:24.15.0-slim\nFROM ${BASE}\nUSER node",
      "FROM must use",
    );
    expectViolation(
      `FROM --platform=linux/amd64 node:24.15.0-slim@sha256:${digest}\nUSER node`,
      "FROM must use",
    );
    expectViolation(
      `FROM node:24.15.0-slim@sha256:${"a".repeat(63)}\nUSER node`,
      "FROM must use",
    );
    expectViolation(
      `${valid}\nFROM node:24.15.0-slim\nUSER node`,
      "FROM must use",
    );
    for (const mutation of [
      `FROM node:24.15.0-slim@sha256:${digest}`,
      `FROM node:24.15.0-slim@sha256:${digest}\nUSER root`,
      `FROM node:24.15.0-slim@sha256:${digest}\nUSER node\nUSER 0:0`,
    ]) {
      expectViolation(
        mutation,
        "final stage must select an explicit non-root USER",
      );
    }
    expectViolation(`${valid}\nADD . /app`, "Dockerfile must not use ADD");
    for (const copy of [
      "COPY . .",
      "COPY ./ ./",
      'COPY [".", "/app"]',
      "COPY server/* ./server",
    ]) {
      expectViolation(
        `${valid}\n${copy}`,
        "Dockerfile must not use a broad or wildcard COPY source",
      );
    }
    for (const copyFlag of [
      "--chown=node:node",
      "--chmod=0777",
      "--link --chown=node:node",
    ]) {
      expectViolation(
        valid.replace(
          "COPY server ./server",
          `COPY ${copyFlag} server ./server`,
        ),
        "Dockerfile COPY flags must be absent except for one exact --from",
      );
    }
    expectViolation(
      valid.replace(
        "COPY --from=dependencies /runtime/node_modules",
        "COPY --from=dependencies --chown=node:node /runtime/node_modules",
      ),
      "Dockerfile COPY flags must be absent except for one exact --from",
    );
    const installContract =
      "consumed deploy stage must frozen-install only the production runtime workspace";
    expectViolation(valid.replace(" --frozen-lockfile", ""), installContract);
    expectViolation(
      valid.replace(
        `${runtimePackageName} --fail-if-no-match install`,
        `${runtimePackageName} install`,
      ),
      installContract,
    );
    expectViolation(
      valid.replace(`--filter ${runtimePackageName} `, ""),
      installContract,
    );
    expectViolation(
      valid.replace(
        `RUN pnpm --filter ${runtimePackageName} --fail-if-no-match install --prod --frozen-lockfile`,
        `RUN echo "pnpm --filter ${runtimePackageName} --fail-if-no-match install --prod --frozen-lockfile"`,
      ),
      installContract,
    );
    const deployContract =
      "consumed deploy stage must deploy only the production runtime workspace";
    expectViolation(valid.replace("deploy --prod", "deploy"), deployContract);
    expectViolation(
      valid.replace("--fail-if-no-match deploy", "deploy"),
      deployContract,
    );
    expectViolation(
      valid.replace(`--filter=${runtimePackageName} `, ""),
      deployContract,
    );
    expectViolation(valid.replace(" /runtime", " /elsewhere"), deployContract);
    expectViolation(
      valid.replace(
        `pnpm --filter=${runtimePackageName} --fail-if-no-match deploy --prod /runtime`,
        `echo "pnpm --filter=${runtimePackageName} --fail-if-no-match deploy --prod /runtime"`,
      ),
      deployContract,
    );
    expectViolation(
      valid.replace("deploy --prod", "deploy --prod --legacy"),
      "consumed deploy stage must use modern workspace deploy",
    );
    expectViolation(
      valid.replace("COPY server ./server\n", ""),
      "required explicit final-stage COPY is missing: server ./server",
    );
    expectViolation(
      valid.replace(
        "COPY --from=dependencies /runtime/node_modules ./node_modules\nCOPY --from=dependencies /runtime/package.json ./package.json",
        "COPY --from=dependencies /runtime ./",
      ),
      "final stage must copy only /runtime package.json and node_modules from one deploy stage",
    );
    const unconsumedSafeStage = valid
      .replaceAll("--from=dependencies", "--from=unsafe-dependencies")
      .replace(
        `FROM node:24.15.0-slim@sha256:${digest}\n`,
        `FROM node:24.15.0-slim@sha256:${digest} AS unsafe-dependencies\nRUN pnpm install --prod --frozen-lockfile\nFROM node:24.15.0-slim@sha256:${digest}\n`,
      );
    expectViolation(unconsumedSafeStage, deployContract);
    expectViolation(
      valid.replace("USER node", "RUN pnpm install --prod\nUSER node"),
      "final stage must not run a package manager",
    );
    const exactDependenciesContract =
      "dependencies stage must contain only the ordered runtime install and deploy contract";
    expectViolation(
      valid.replace(
        `COPY container/online/package.json ./container/online/package.json\nRUN pnpm --filter ${runtimePackageName}`,
        `COPY container/online/package.json ./container/online/package.json\nRUN echo poisoned >> /runtime/package.json\nRUN pnpm --filter ${runtimePackageName}`,
      ),
      exactDependenciesContract,
    );
    expectViolation(
      valid.replace("USER node", "RUN echo poisoned\nUSER node"),
      "final stage must contain only the exact immutable runtime instructions",
    );
    expect(
      dockerfileViolations(valid, runtimePackageName, "pnpm@10.32.0"),
    ).toContain(
      "the dependencies stage must contain only the ordered runtime install and deploy contract",
    );
    expectViolation(
      valid.replace(
        'CMD ["node", "--import", "tsx", "server/start.ts"]',
        'CMD ["pnpm", "server:start"]',
      ),
      "final stage must launch the server as the direct Node PID1",
    );
    expectViolation(
      valid.replace(
        'CMD ["node", "--import", "tsx", "server/start.ts"]',
        'ENTRYPOINT ["pnpm"]\nCMD ["server:start"]',
      ),
      "final stage must launch the server as the direct Node PID1",
    );
    expectViolation(
      valid.replace(
        `FROM node:24.15.0-slim@sha256:${digest}\nENV NODE_ENV=production`,
        `FROM node:24.15.0-slim@sha256:${digest} AS dependencies\n`,
      ),
      "Dockerfile stage aliases must be unique",
    );
  });

  it("excludes secrets and test-only source files from the build context", () => {
    const source = readFileSync(
      resolve(REPOSITORY_ROOT, ".dockerignore"),
      "utf8",
    );
    expect(dockerignoreViolations(source)).toEqual([]);
  });

  it("rejects every missing required ignore rule or any re-include", () => {
    const valid = REQUIRED_DOCKERIGNORE_PATTERNS.join("\n");
    expect(dockerignoreViolations(valid)).toEqual([]);
    for (const missing of REQUIRED_DOCKERIGNORE_PATTERNS) {
      const mutation = REQUIRED_DOCKERIGNORE_PATTERNS.filter(
        (pattern) => pattern !== missing,
      ).join("\n");
      expect(dockerignoreViolations(mutation)).toContain(
        `required dockerignore rule is missing: ${missing}`,
      );
    }
    expect(dockerignoreViolations(`${valid}\n!nested/.env.local`)).toContain(
      "negated dockerignore rule is forbidden: !nested/.env.local",
    );
    expect(dockerignoreViolations(`${valid}\n!**`)).toContain(
      "negated dockerignore rule is forbidden: !**",
    );
  });

  it("rejects Dockerfile-specific ignore files that override the root policy", () => {
    const rootFiles = readdirSync(REPOSITORY_ROOT);
    expect(dockerfileIgnoreOverrideViolations(rootFiles)).toEqual([]);
    expect(
      dockerfileIgnoreOverrideViolations([
        ".dockerignore",
        "Dockerfile.dockerignore",
      ]),
    ).toEqual([
      "Dockerfile-specific ignore override is forbidden: Dockerfile.dockerignore",
    ]);
    expect(
      dockerfileIgnoreOverrideViolations(["lint.Dockerfile.dockerignore"]),
    ).toEqual([
      "Dockerfile-specific ignore override is forbidden: lint.Dockerfile.dockerignore",
    ]);
  });

  it("covers both pnpm manifests and the root Dockerfile with Dependabot", () => {
    const source = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/dependabot.yml"),
      "utf8",
    );
    expect(dependabotViolations(parse(source))).toEqual([]);
  });

  it("rejects missing, duplicate, misplaced, or incomplete Dependabot updates", () => {
    const dockerUpdate = {
      "package-ecosystem": "docker",
      directory: "/",
      schedule: { interval: "weekly" },
    };
    const npmUpdate = {
      "package-ecosystem": "npm",
      directories: ["/", "/container/online"],
      schedule: { interval: "daily" },
    };
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, dockerUpdate],
      }),
    ).toEqual([]);
    expect(dependabotViolations({ version: 2, updates: [] })).toContain(
      "Dependabot must contain exactly one Docker ecosystem entry",
    );
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, dockerUpdate, dockerUpdate],
      }),
    ).toContain("Dependabot must contain exactly one Docker ecosystem entry");
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, { ...dockerUpdate, directory: "/server" }],
      }),
    ).toContain('Dependabot Docker directory must be "/"');
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, { ...dockerUpdate, schedule: undefined }],
      }),
    ).toContain(
      "Dependabot Docker entry must have a supported periodic schedule",
    );
    expect(
      dependabotViolations({
        version: 2,
        updates: [{ ...npmUpdate, schedule: undefined }, dockerUpdate],
      }),
    ).toContain("Dependabot npm entry must have a supported periodic schedule");
    expect(
      dependabotViolations({
        version: 2,
        updates: [{ ...npmUpdate, directories: ["/"] }, dockerUpdate],
      }),
    ).toContain(
      "Dependabot npm directories must contain exactly / and /container/online",
    );
  });
});
