export const ONLINE_RUNTIME_PACKAGE_NAME = "@four-bros-mahjong/online-runtime";
const PINNED_NODE_IMAGE =
  /^node:\d+\.\d+\.\d+-[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64}$/;
export const REQUIRED_DOCKERIGNORE_PATTERNS = [
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
export const FORBIDDEN_NESTED_LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "npm-shrinkwrap.json",
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

export interface PackageManifest {
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

function isExactPnpmBootstrapCommand(
  command: string,
  packageManager: string,
): boolean {
  return command === `npm install --global ${packageManager}`;
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

export function dockerfileViolations(
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
    deployCommands.length !== 3 ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(packageManager) ||
    !isExactPnpmBootstrapCommand(deployCommands[0] ?? "", packageManager) ||
    !isExactPnpmCommand(
      deployCommands[1] ?? "",
      runtimePackageName,
      "install",
    ) ||
    !isExactPnpmCommand(
      deployCommands[2] ?? "",
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

export function runtimeWorkspaceViolations(
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
        rootLockDependencies?.[dependency]?.specifier !==
        rootDependencies?.[dependency]
      ) {
        violations.push(
          `lockfile root ${dependency} specifier must equal the root package manifest`,
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

export function nestedLockfileViolations(
  filenames: readonly string[],
): readonly string[] {
  const names = new Set(filenames);
  return FORBIDDEN_NESTED_LOCKFILES.filter((filename) =>
    names.has(filename),
  ).map(
    (filename) => `nested package-manager lockfile is forbidden: ${filename}`,
  );
}

export function knipWorkspaceViolations(value: unknown): readonly string[] {
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

export function dockerignoreViolations(source: string): readonly string[] {
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

export function dockerfileIgnoreOverrideViolations(
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

export function dependabotViolations(value: unknown): readonly string[] {
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
  const githubActionsUpdates = updates.filter(
    (update) => update?.["package-ecosystem"] === "github-actions",
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
  if (githubActionsUpdates.length !== 1) {
    violations.push(
      "Dependabot must contain exactly one GitHub Actions ecosystem entry",
    );
  }
  const dockerUpdate = dockerUpdates[0];
  const npmUpdate = npmUpdates[0];
  const githubActionsUpdate = githubActionsUpdates[0];
  if (
    dockerUpdate?.directory !== "/" ||
    dockerUpdate?.directories !== undefined
  ) {
    violations.push('Dependabot Docker directory must be "/"');
  }
  if (npmUpdate?.directory !== "/" || npmUpdate?.directories !== undefined) {
    violations.push('Dependabot npm directory must be exactly "/"');
  }
  if (
    githubActionsUpdate?.directory !== "/" ||
    githubActionsUpdate?.directories !== undefined
  ) {
    violations.push('Dependabot GitHub Actions directory must be exactly "/"');
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
  if (
    !["daily", "weekly", "monthly"].includes(
      String(githubActionsUpdate?.schedule?.interval),
    )
  ) {
    violations.push(
      "Dependabot GitHub Actions entry must have a supported periodic schedule",
    );
  }
  return violations;
}
