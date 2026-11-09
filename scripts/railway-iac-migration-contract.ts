import { createHash } from "node:crypto";
import ts from "typescript";
import {
  inspectNamedPartialSource,
  type NamedPartialReason,
  validateNamedPartialEvidence,
} from "./railway-iac-named-partial";
import { parseStrictJson } from "./strictJson";

const RAILWAY_IAC_EVIDENCE_SCHEMA_VERSION = 1 as const;
const RAILWAY_IAC_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1_000;
const RAILWAY_IAC_EVIDENCE_MAX_FUTURE_SKEW_MS = 30 * 1_000;
const RAILWAY_IAC_MINIMUM_CLI_VERSION = "5.42.1";
const REVIEWED_RAILWAY_SDK_SCHEMA_REVISION =
  "c1b6ea8dd3e815e57257b1f17637e59d31db73b5";
export const RAILWAY_LEGACY_FIXTURE_PATH =
  "documents/fixtures/railway-pre-cutover.json";
// SHA-256 of RAILWAY_LEGACY_FIXTURE_PATH. The fixture is the immutable
// pre-cutover artifact; the current root railway.json is a separate target.
export const RAILWAY_LEGACY_FIXTURE_SHA256 =
  "2d772749d488b99e39f2428d80e9f8301214312835bc3d744250ec9d6742d84d";
// This is the last known pre-cutover effective legacy baseline for #742. The
// repository's desired runtime healthcheck is /readyz (#726), but changing the
// checked-in file must not rewrite the external pre-cutover evidence expected
// by the separate IaC ownership-cutover contract.
const RAILWAY_LEGACY_KNOWN_CONFIG = Object.freeze({
  builder: "DOCKERFILE",
  dockerfilePath: "Dockerfile",
  startCommand: "node --import tsx server/start.ts",
  healthcheckPath: "/healthz",
  healthcheckTimeoutSeconds: 60,
  restartPolicyType: "ON_FAILURE",
  restartPolicyMaxRetries: 10,
});
const RAILWAY_CURRENT_KNOWN_CONFIG = Object.freeze({
  builder: "DOCKERFILE",
  dockerfilePath: "Dockerfile",
  startCommand: "node --import tsx server/start.ts",
  healthcheckPath: "/readyz",
  healthcheckTimeoutSeconds: 60,
  restartPolicyType: "ON_FAILURE",
  restartPolicyMaxRetries: 10,
});

export const RAILWAY_IAC_MIGRATION_REASONS = [
  "alternate-legacy-config-present",
  "cli-capability-unverified",
  "clock-invalid",
  "effective-readback-invalid",
  "evidence-order-invalid",
  "evidence-stale",
  "generated-iac-invalid",
  "generated-iac-missing",
  "generated-service-parity-mismatch",
  "invalid-schema",
  "legacy-config-missing",
  "ownership-cutover-unverified",
  "parity-plan-not-clean",
  "parity-plan-target-mismatch",
  "parity-readback-mismatch",
  "pinned-plan-unverified",
  "resource-inventory-mismatch",
  "secret-safety-unverified",
  "target-identity-invalid",
] as const;

type RailwayIacMigrationReason = (typeof RAILWAY_IAC_MIGRATION_REASONS)[number];

export interface RailwayIacMigrationResult {
  schemaVersion: typeof RAILWAY_IAC_EVIDENCE_SCHEMA_VERSION | 2;
  migrationEvidence: "pass" | "hold";
  authorizesMigration: false;
  authorizesApply: false;
  authorizesDeployment: false;
  externalMutationPerformed: false;
  reasons: (RailwayIacMigrationReason | NamedPartialReason)[];
}

export interface RailwayIacFilesystemEvidence {
  generatedIacPath: string | null;
  generatedIacSha256: string | null;
  generatedIacSecretSafe: boolean | null;
  generatedIacSource?: string | null;
  generatedIacTreeSha1?: string | null;
  sdkPackageVersion?: string | null;
  sdkSchemaSha256?: string | null;
  currentRepositoryFilePresent: boolean;
  currentRepositoryFileSha256: string | null;
  currentRepositoryFileContent: string | null;
  legacyTomlFilePresent: boolean;
  legacyFixturePresent: boolean;
  legacyFixtureSha256: string | null;
  legacyFixtureContent: string | null;
}

const ROOT_KEYS = [
  "schemaVersion",
  "capturedAt",
  "cliEvidence",
  "target",
  "inventory",
  "generatedIac",
  "ownershipCutover",
  "preCutoverReadback",
  "parityPlan",
  "effectiveReadback",
] as const;
const CLI_KEYS = [
  "capturedFromHelp",
  "cliVersion",
  "pullSupported",
  "planSupported",
  "planJsonSupported",
  "planOutSupported",
  "detailedExitCodeSupported",
] as const;
const TARGET_KEYS = [
  "projectId",
  "projectName",
  "environmentId",
  "environmentName",
  "serviceId",
  "serviceName",
] as const;
const INVENTORY_KEYS = [
  "observedAt",
  "source",
  "ownershipMode",
  "targetServiceAddress",
  "resourceAddresses",
  "projectId",
  "environmentId",
  "serviceId",
  "serviceName",
  "authorityEvidenceSha256",
] as const;
const GENERATED_KEYS = [
  "path",
  "sha256",
  "generatedBy",
  "resourceAddresses",
  "ownershipMode",
  "cliVersion",
  "sdkPackageVersion",
  "sdkSchemaRevision",
  "compatibilityReviewed",
  "manualSecretReviewCompleted",
  "decryptVariablesUsed",
  "omitPreservedVariablesUsed",
  "targetServiceConfig",
  "targetServiceSource",
] as const;
const CUTOVER_KEYS = [
  "observedAt",
  "method",
  "projectId",
  "environmentId",
  "serviceId",
  "evidenceSha256",
  "legacyFileSha256",
  "configFileSettingCleared",
  "repositoryFileRetained",
  "deleteFilesUsed",
  "nonInteractiveFlagsUsed",
] as const;
const PLAN_KEYS = [
  "capturedAt",
  "sourceSha256",
  "planOutputSha256",
  "pinnedPlanArtifactSha256",
  "pinnedPlanStoredOutsideRepository",
  "cliVersion",
  "invocation",
  "exitCode",
  "projectId",
  "environmentId",
  "serviceId",
  "additions",
  "changes",
  "destructions",
  "unrelatedChanges",
  "variableValuesRedacted",
  "detailedExitCodeUsed",
  "showValuesUsed",
  "decryptVariablesUsed",
] as const;
const CONFIG_KEYS = [
  "builder",
  "dockerfilePath",
  "startCommand",
  "healthcheckPath",
  "healthcheckTimeoutSeconds",
  "replicaCount",
  "restartPolicyType",
  "restartPolicyMaxRetries",
  "overlapSeconds",
  "drainingSeconds",
  "watchPatterns",
] as const;
const READBACK_KEYS = [
  "observedAt",
  "projectId",
  "environmentId",
  "serviceId",
  "source",
  "config",
] as const;
const CONFIG_SOURCE_KEYS = ["repository", "branch", "rootDirectory"] as const;
const READBACK_SOURCE_KEYS = [
  "repository",
  "branch",
  "rootDirectory",
  "revision",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function isOpaqueIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function isBoundedName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[\x20-\x7e]+$/.test(value) &&
    value.trim() === value
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isFullRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[a-fA-F0-9]{40}|[a-f0-9]{64})$/.test(value)
  );
}

type ParsedVersion = {
  core: [number, number, number];
  prerelease: boolean;
};

function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      value,
    );
  if (!match) return null;
  const parsed = match.slice(1, 4).map(Number);
  return parsed.every(Number.isSafeInteger)
    ? {
        core: parsed as [number, number, number],
        prerelease: match[4] !== undefined,
      }
    : null;
}

function versionAtLeast(value: unknown, minimum: string): boolean {
  const actual = parseVersion(value);
  const required = parseVersion(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual.core[index] !== required.core[index]) {
      return actual.core[index]! > required.core[index]!;
    }
  }
  // A prerelease has lower precedence than the matching stable release. The
  // migration contract's minimum is stable, so do not treat 5.42.1-rc.1 as
  // proof that the required 5.42.1 CLI capability is available.
  return required.prerelease || !actual.prerelease;
}

function isFreshTimestamp(value: unknown, nowMs: number): boolean {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    return false;
  }
  return (
    milliseconds <= nowMs + RAILWAY_IAC_EVIDENCE_MAX_FUTURE_SKEW_MS &&
    nowMs - milliseconds <= RAILWAY_IAC_EVIDENCE_MAX_AGE_MS
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isOpaqueIdentifier);
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function configIsValid(value: unknown): value is Record<string, unknown> {
  return (
    hasExactKeys(value, CONFIG_KEYS) &&
    value.builder === "DOCKERFILE" &&
    value.dockerfilePath === "Dockerfile" &&
    isBoundedName(value.startCommand) &&
    typeof value.healthcheckPath === "string" &&
    /^\/[\x21-\x7e]*$/.test(value.healthcheckPath) &&
    Number.isSafeInteger(value.healthcheckTimeoutSeconds) &&
    Number(value.healthcheckTimeoutSeconds) >= 1 &&
    Number(value.healthcheckTimeoutSeconds) <= 600 &&
    Number.isSafeInteger(value.replicaCount) &&
    Number(value.replicaCount) >= 1 &&
    Number(value.replicaCount) <= 100 &&
    ["ON_FAILURE", "ALWAYS", "NEVER"].includes(
      String(value.restartPolicyType),
    ) &&
    Number.isSafeInteger(value.restartPolicyMaxRetries) &&
    Number(value.restartPolicyMaxRetries) >= 0 &&
    Number(value.restartPolicyMaxRetries) <= 100 &&
    Number.isSafeInteger(value.overlapSeconds) &&
    Number(value.overlapSeconds) >= 0 &&
    Number(value.overlapSeconds) <= 600 &&
    Number.isSafeInteger(value.drainingSeconds) &&
    Number(value.drainingSeconds) >= 0 &&
    Number(value.drainingSeconds) <= 600 &&
    Array.isArray(value.watchPatterns) &&
    value.watchPatterns.length <= 100 &&
    value.watchPatterns.every(isOpaqueIdentifier)
  );
}

function configEquals(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return CONFIG_KEYS.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];
    return Array.isArray(leftValue) && Array.isArray(rightValue)
      ? sameStrings(leftValue, rightValue)
      : leftValue === rightValue;
  });
}

const RAILWAY_FILE_KEYS = ["$schema", "build", "deploy"] as const;
const RAILWAY_BUILD_KEYS = ["builder", "dockerfilePath"] as const;
const RAILWAY_DEPLOY_KEYS = [
  "startCommand",
  "healthcheckPath",
  "healthcheckTimeout",
  "restartPolicyType",
  "restartPolicyMaxRetries",
] as const;

type RailwayKnownConfig = {
  builder: string;
  dockerfilePath: string;
  startCommand: string;
  healthcheckPath: string;
  healthcheckTimeoutSeconds: number;
  restartPolicyType: string;
  restartPolicyMaxRetries: number;
};

function sha256(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function railwayJsonContentIsKnown(
  source: string | null,
  expected: RailwayKnownConfig,
): boolean {
  if (source === null || Buffer.byteLength(source, "utf8") > 16 * 1_024)
    return false;

  let parsed: unknown;
  try {
    parsed = parseStrictJson(source);
  } catch {
    return false;
  }
  if (!hasExactKeys(parsed, RAILWAY_FILE_KEYS)) return false;

  const build = parsed.build;
  const deploy = parsed.deploy;
  return (
    parsed.$schema === "https://railway.com/railway.schema.json" &&
    hasExactKeys(build, RAILWAY_BUILD_KEYS) &&
    build.builder === expected.builder &&
    build.dockerfilePath === expected.dockerfilePath &&
    hasExactKeys(deploy, RAILWAY_DEPLOY_KEYS) &&
    deploy.startCommand === expected.startCommand &&
    deploy.healthcheckPath === expected.healthcheckPath &&
    deploy.healthcheckTimeout === expected.healthcheckTimeoutSeconds &&
    deploy.restartPolicyType === expected.restartPolicyType &&
    deploy.restartPolicyMaxRetries === expected.restartPolicyMaxRetries
  );
}

function legacyFixtureContentIsKnown(source: string | null): boolean {
  return railwayJsonContentIsKnown(source, RAILWAY_LEGACY_KNOWN_CONFIG);
}

function currentRepositoryFileContentIsKnown(source: string | null): boolean {
  return railwayJsonContentIsKnown(source, RAILWAY_CURRENT_KNOWN_CONFIG);
}

function legacyKnownFieldsMatch(value: Record<string, unknown>): boolean {
  return Object.entries(RAILWAY_LEGACY_KNOWN_CONFIG).every(
    ([key, expected]) => value[key] === expected,
  );
}

function targetIsValid(value: unknown): value is Record<string, string> {
  return (
    hasExactKeys(value, TARGET_KEYS) &&
    isOpaqueIdentifier(value.projectId) &&
    isBoundedName(value.projectName) &&
    isOpaqueIdentifier(value.environmentId) &&
    value.environmentName === "production" &&
    isOpaqueIdentifier(value.serviceId) &&
    isBoundedName(value.serviceName)
  );
}

function targetFieldsMatch(
  value: Record<string, unknown>,
  target: Record<string, string> | null,
): boolean {
  return (
    target !== null &&
    value.projectId === target.projectId &&
    value.environmentId === target.environmentId &&
    value.serviceId === target.serviceId
  );
}

function configSourceIsValid(value: unknown): value is Record<string, unknown> {
  return (
    hasExactKeys(value, CONFIG_SOURCE_KEYS) &&
    value.repository === "AutoDevJapan/FourBrosMahjong" &&
    value.branch === "main" &&
    value.rootDirectory === null
  );
}

function readbackSourceIsValid(
  value: unknown,
): value is Record<string, unknown> {
  return (
    hasExactKeys(value, READBACK_SOURCE_KEYS) &&
    value.repository === "AutoDevJapan/FourBrosMahjong" &&
    value.branch === "main" &&
    value.rootDirectory === null &&
    isFullRevision(value.revision)
  );
}

function configSourceMatchesReadback(
  configSource: Record<string, unknown>,
  readbackSource: Record<string, unknown>,
): boolean {
  return CONFIG_SOURCE_KEYS.every(
    (key) => configSource[key] === readbackSource[key],
  );
}

export function generatedIacSourceIsSecretSafe(source: string): boolean {
  const secretLikePropertyName =
    /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ALLOWED_ORIGINS)/i;
  if (Buffer.byteLength(source, "utf8") > 256 * 1_024) return false;
  if (
    /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ALLOWED_ORIGINS)\s*:\s*["'`]/i.test(
      source,
    )
  ) {
    return false;
  }
  if (
    /(?:Bearer\s+[A-Za-z0-9._~+/-]{16,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/.test(
      source,
    )
  ) {
    return false;
  }

  const syntaxDiagnostics = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.Latest },
    fileName: "railway.ts",
    reportDiagnostics: true,
  }).diagnostics;
  if (
    syntaxDiagnostics?.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    return false;
  }
  // The current CLI emits a project variable-policy extension absent from the
  // SDK declaration. Its local binding is safe only in the exact literal,
  // target-only authoring shape; general aliases remain rejected below.
  const strictTargetPartial = inspectNamedPartialSource(source) !== null;
  const sourceFile = ts.createSourceFile(
    "railway.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const allowedImportsAndCalls = new Set([
    "bucket",
    "database",
    "define",
    "defineRailway",
    "empty",
    "fn",
    "github",
    "group",
    "image",
    "mongo",
    "mysql",
    "postgres",
    "preserve",
    "project",
    "redis",
    "ref",
    "service",
    "template",
    "volume",
  ]);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "railway/iac" ||
      clause === undefined ||
      clause.isTypeOnly ||
      clause.name !== undefined ||
      clause.namedBindings === undefined ||
      !ts.isNamedImports(clause.namedBindings) ||
      clause.namedBindings.elements.length === 0 ||
      clause.namedBindings.elements.some(
        (element) =>
          element.isTypeOnly ||
          element.propertyName !== undefined ||
          !allowedImportsAndCalls.has(element.name.text),
      )
    ) {
      return false;
    }
  }
  const resourceFactoryNames = new Set([
    "bucket",
    "database",
    "fn",
    "mongo",
    "mysql",
    "postgres",
    "redis",
    "service",
    "volume",
  ]);
  type BindingKind = "import" | "non-resource" | "resource" | "trusted-context";
  type Binding = {
    kind: BindingKind;
    declaration: ts.Node;
  };
  type Scope = {
    parent: Scope | null;
    functionScope: Scope;
    bindings: Map<string, Binding>;
  };
  const createScope = (
    parent: Scope | null,
    isFunctionScope = false,
  ): Scope => {
    const scope = {
      parent,
      functionScope: undefined as unknown as Scope,
      bindings: new Map<string, Binding>(),
    };
    scope.functionScope = isFunctionScope
      ? scope
      : (parent?.functionScope ?? scope);
    return scope;
  };
  const sourceScope = createScope(null, true);
  const scopeAtNode = new Map<ts.Node, Scope>();
  const variableBindings = new Map<ts.VariableDeclaration, Binding>();
  const parameterBindings = new Map<ts.ParameterDeclaration, Binding>();
  const functionLikeNodes: Array<ts.ArrowFunction | ts.FunctionExpression> = [];
  let unsupportedBindingPattern = false;
  const isVarDeclaration = (node: ts.Node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    node.parent.flags === ts.NodeFlags.None;
  const declareBinding = (
    scope: Scope,
    name: string,
    kind: BindingKind,
    declaration: ts.Node,
  ): Binding => {
    const existing = scope.bindings.get(name);
    if (existing !== undefined) {
      const harmlessVarRedeclaration =
        isVarDeclaration(declaration) &&
        declaration.initializer === undefined &&
        (isVarDeclaration(existing.declaration) ||
          ts.isParameter(existing.declaration));
      if (harmlessVarRedeclaration) return existing;
      unsupportedBindingPattern = true;
      return existing;
    }
    const binding: Binding = { kind, declaration };
    scope.bindings.set(name, binding);
    return binding;
  };
  const isSupportedParameter = (node: ts.ParameterDeclaration): boolean =>
    ts.isIdentifier(node.name) &&
    node.dotDotDotToken === undefined &&
    node.initializer === undefined &&
    node.questionToken === undefined;
  function collectParameter(
    node: ts.ParameterDeclaration,
    functionScope: Scope,
  ): void {
    scopeAtNode.set(node, functionScope);
    if (!isSupportedParameter(node)) unsupportedBindingPattern = true;
    if (ts.isIdentifier(node.name)) {
      scopeAtNode.set(node.name, functionScope);
      const binding = declareBinding(
        functionScope,
        node.name.text,
        "non-resource",
        node,
      );
      parameterBindings.set(node, binding);
    }
    ts.forEachChild(node, (child) => {
      if (child === node.name) {
        scopeAtNode.set(child, functionScope);
        return;
      }
      collectScopesAndBindings(child, functionScope);
    });
  }
  function collectFunctionLike(
    node: ts.ArrowFunction | ts.FunctionExpression,
    parentScope: Scope,
  ): void {
    scopeAtNode.set(node, parentScope);
    functionLikeNodes.push(node);
    const functionNameScope =
      ts.isFunctionExpression(node) && node.name !== undefined
        ? createScope(parentScope)
        : parentScope;
    const functionScope = createScope(functionNameScope, true);
    if (ts.isFunctionExpression(node) && node.name !== undefined) {
      scopeAtNode.set(node.name, functionNameScope);
      declareBinding(
        functionNameScope,
        node.name.text,
        "non-resource",
        node.name,
      );
    }
    for (const parameter of node.parameters) {
      collectParameter(parameter, functionScope);
    }
    const parameterNodes = new Set<ts.Node>(node.parameters);
    ts.forEachChild(node, (child) => {
      if (
        (ts.isFunctionExpression(node) && child === node.name) ||
        parameterNodes.has(child)
      ) {
        return;
      }
      collectScopesAndBindings(child, functionScope);
    });
  }
  function collectScopesAndBindings(node: ts.Node, parentScope: Scope): void {
    scopeAtNode.set(node, parentScope);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      collectFunctionLike(node, parentScope);
      return;
    }
    if (ts.isBlock(node) || ts.isCaseBlock(node)) {
      const blockScope = createScope(parentScope);
      scopeAtNode.set(node, blockScope);
      ts.forEachChild(node, (child) =>
        collectScopesAndBindings(child, blockScope),
      );
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      const declarationList = node.parent;
      const isVarDeclaration =
        ts.isVariableDeclarationList(declarationList) &&
        declarationList.flags === ts.NodeFlags.None;
      const declarationScope = isVarDeclaration
        ? parentScope.functionScope
        : parentScope;
      if (!ts.isIdentifier(node.name)) {
        unsupportedBindingPattern = true;
      } else {
        scopeAtNode.set(node.name, parentScope);
        const binding = declareBinding(
          declarationScope,
          node.name.text,
          "non-resource",
          node,
        );
        variableBindings.set(node, binding);
      }
      ts.forEachChild(node, (child) => {
        if (child === node.name) {
          scopeAtNode.set(child, parentScope);
          return;
        }
        collectScopesAndBindings(child, parentScope);
      });
      return;
    }
    if (ts.isParameter(node)) {
      collectParameter(node, parentScope.functionScope);
      return;
    }
    if (ts.isImportDeclaration(node)) return;
    ts.forEachChild(node, (child) =>
      collectScopesAndBindings(child, parentScope),
    );
  }
  scopeAtNode.set(sourceFile, sourceScope);
  for (const statement of sourceFile.statements) {
    collectScopesAndBindings(statement, sourceScope);
  }
  const resolveBinding = (node: ts.Identifier): Binding | null => {
    let scope = scopeAtNode.get(node);
    while (scope !== undefined) {
      const binding = scope.bindings.get(node.text);
      if (binding !== undefined) return binding;
      scope = scope.parent ?? undefined;
    }
    return null;
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause?.namedBindings === undefined) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      declareBinding(sourceScope, element.name.text, "import", element.name);
      scopeAtNode.set(element.name, sourceScope);
    }
  }
  for (const [node, binding] of variableBindings) {
    const initializer = node.initializer;
    if (
      initializer !== undefined &&
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      resourceFactoryNames.has(initializer.expression.text) &&
      resolveBinding(initializer.expression)?.kind === "import"
    ) {
      binding.kind = "resource";
    }
  }
  const isDefineRailwayCallback = (
    node: ts.ArrowFunction | ts.FunctionExpression,
  ): boolean => {
    const call = node.parent;
    return (
      ts.isCallExpression(call) &&
      call.arguments[0] === node &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === "defineRailway" &&
      resolveBinding(call.expression)?.kind === "import"
    );
  };
  for (const callback of functionLikeNodes) {
    if (!isDefineRailwayCallback(callback)) continue;
    if (
      callback.parameters.length > 1 ||
      callback.parameters.some((parameter) => !isSupportedParameter(parameter))
    ) {
      unsupportedBindingPattern = true;
      continue;
    }
    const parameter = callback.parameters[0];
    const binding =
      parameter === undefined ? undefined : parameterBindings.get(parameter);
    if (binding !== undefined) binding.kind = "trusted-context";
  }
  // Destructuring, rest/default parameters, and other unsupported bindings
  // cannot retain resource/context provenance, so reject the whole source.
  if (unsupportedBindingPattern) return false;
  const isResourceBinding = (node: ts.Node): boolean =>
    ts.isIdentifier(node) && resolveBinding(node)?.kind === "resource";
  const isTrustedContextBinding = (node: ts.Node): boolean =>
    ts.isIdentifier(node) && resolveBinding(node)?.kind === "trusted-context";
  const unwrapParenthesizedExpression = (
    node: ts.Expression,
  ): ts.Expression => {
    let current = node;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
  };
  type MemberPath = {
    root: ts.Expression;
    names: string[];
  };
  const memberPath = (node: ts.Expression): MemberPath | null => {
    const names: string[] = [];
    let current: ts.Expression = node;
    while (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)
    ) {
      if (ts.isPropertyAccessExpression(current)) {
        names.unshift(current.name.text);
      } else if (
        current.argumentExpression !== undefined &&
        ts.isStringLiteral(current.argumentExpression)
      ) {
        names.unshift(current.argumentExpression.text);
      } else {
        return null;
      }
      current = current.expression;
    }
    return names.length > 0 ? { root: current, names } : null;
  };
  const memberPathIsBounded = (path: MemberPath | null): path is MemberPath =>
    path !== null &&
    path.names.length > 0 &&
    path.names.every((name) => isBoundedName(name));
  const resourceEnvOwner = (node: ts.Node): Binding | null => {
    if (
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node)
    ) {
      return null;
    }
    const path = memberPath(node);
    if (
      memberPathIsBounded(path) &&
      path.names[0] === "env" &&
      ts.isIdentifier(path.root) &&
      isResourceBinding(path.root)
    ) {
      return resolveBinding(path.root);
    }
    return null;
  };
  const propertyUsesUnboundEnvironment = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "env") {
      return !(
        ts.isIdentifier(node.expression) && isResourceBinding(node.expression)
      );
    }
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      if (argument === undefined) return true;
      if (ts.isStringLiteral(argument) && argument.text === "env") {
        return !(
          ts.isIdentifier(node.expression) && isResourceBinding(node.expression)
        );
      }
      if (!ts.isStringLiteral(argument) && !ts.isNumericLiteral(argument)) {
        return true;
      }
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      propertyUsesUnboundEnvironment(node.expression)
    ) {
      return true;
    }
    return false;
  };
  const refCallIsSafe = (node: ts.CallExpression): boolean =>
    node.arguments.length === 2 &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "ref" &&
    resolveBinding(node.expression)?.kind === "import" &&
    ts.isIdentifier(node.arguments[0]!) &&
    isResourceBinding(node.arguments[0]!) &&
    ts.isStringLiteral(node.arguments[1]!) &&
    isBoundedName(node.arguments[1]!.text);
  const isPreserveCall = (node: ts.CallExpression): boolean =>
    ts.isIdentifier(node.expression) &&
    node.expression.text === "preserve" &&
    resolveBinding(node.expression)?.kind === "import" &&
    node.arguments.length === 0;
  const isAllowedVariableValue = (node: ts.Expression): boolean => {
    const unwrapped = unwrapParenthesizedExpression(node);
    if (
      ts.isCallExpression(unwrapped) &&
      ts.isIdentifier(unwrapped.expression)
    ) {
      return (
        isPreserveCall(unwrapped) ||
        (unwrapped.expression.text === "ref" && refCallIsSafe(unwrapped))
      );
    }
    const path = memberPath(unwrapped);
    if (!memberPathIsBounded(path) || path.names.length < 2) return false;
    if (
      path.names[0] === "env" &&
      ts.isIdentifier(path.root) &&
      isResourceBinding(path.root)
    ) {
      return true;
    }
    return (
      path.names[0] === "shared" &&
      ts.isIdentifier(path.root) &&
      isTrustedContextBinding(path.root)
    );
  };
  const propertyNameText = (name: ts.PropertyName): string | null => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    if (
      ts.isComputedPropertyName(name) &&
      ts.isStringLiteral(name.expression) &&
      isBoundedName(name.expression.text)
    ) {
      return name.expression.text;
    }
    return null;
  };
  const isStaticPrimitiveWithoutString = (node: ts.Expression): boolean => {
    const unwrapped = unwrapParenthesizedExpression(node);
    if (
      ts.isNumericLiteral(unwrapped) ||
      unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
      unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
      unwrapped.kind === ts.SyntaxKind.NullKeyword
    ) {
      return true;
    }
    return (
      ts.isPrefixUnaryExpression(unwrapped) &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(
        unwrapped.operator,
      ) &&
      ts.isNumericLiteral(unwrapParenthesizedExpression(unwrapped.operand))
    );
  };
  const secretLikeValueIsStaticSafe = (node: ts.Expression): boolean => {
    const unwrapped = unwrapParenthesizedExpression(node);
    // Sensitive fields may only receive values whose provenance is explicit.
    // In particular, an Identifier is never safe here: resolving aliases from
    // arbitrary declarations would make a string-only scan fail open.
    return (
      isAllowedVariableValue(unwrapped) ||
      isStaticPrimitiveWithoutString(unwrapped)
    );
  };
  const allowedVariableValueNodes = new Set<ts.Node>();
  const collectAllowedVariableValues = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ["env", "variables"].includes(propertyNameText(node.name) ?? "") &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          isAllowedVariableValue(property.initializer)
        ) {
          allowedVariableValueNodes.add(property.initializer);
        }
      }
    }
    ts.forEachChild(node, collectAllowedVariableValues);
  };
  collectAllowedVariableValues(sourceFile);
  const isWithinAllowedVariableValue = (node: ts.Node): boolean => {
    let current: ts.Node | undefined = node;
    while (current !== undefined) {
      if (allowedVariableValueNodes.has(current)) return true;
      current = current.parent;
    }
    return false;
  };
  const memberExpressionRootedAt = (
    node: ts.Identifier,
  ): ts.Expression | null => {
    let current: ts.Expression = node;
    let parent = current.parent;
    while (
      (ts.isPropertyAccessExpression(parent) ||
        ts.isElementAccessExpression(parent)) &&
      parent.expression === current
    ) {
      current = parent;
      parent = current.parent;
    }
    return current === node ? null : current;
  };
  const isResourceCollectionReference = (node: ts.Identifier): boolean => {
    const array = node.parent;
    if (!ts.isArrayLiteralExpression(array)) return false;
    const property = array.parent;
    return (
      ts.isPropertyAssignment(property) &&
      property.initializer === array &&
      propertyNameText(property.name) === "resources"
    );
  };
  const isResourceEnvironmentAccess = (node: ts.Node): boolean => {
    const owner = resourceEnvOwner(node);
    if (owner !== null) {
      return true;
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      isResourceEnvironmentAccess(node.expression)
    ) {
      return true;
    }
    return false;
  };
  const isSharedNamespaceAccess = (node: ts.Node): boolean => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "shared" &&
      isTrustedContextBinding(node.expression)
    ) {
      return true;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "shared" &&
      isTrustedContextBinding(node.expression)
    ) {
      return true;
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      isSharedNamespaceAccess(node.expression)
    ) {
      return true;
    }
    return false;
  };
  const callExpressionIsAllowed = (node: ts.CallExpression): boolean =>
    ts.isIdentifier(node.expression) &&
    allowedImportsAndCalls.has(node.expression.text) &&
    resolveBinding(node.expression)?.kind === "import" &&
    (node.expression.text !== "preserve" || node.arguments.length === 0) &&
    (node.expression.text !== "ref" || refCallIsSafe(node));
  const isIdentifierDeclarationName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    return (
      (ts.isVariableDeclaration(parent) && parent.name === node) ||
      (ts.isParameter(parent) && parent.name === node) ||
      (ts.isFunctionExpression(parent) && parent.name === node) ||
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      ((ts.isMethodDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent)) &&
        parent.name === node) ||
      (ts.isPropertySignature(parent) && parent.name === node) ||
      (ts.isPropertyDeclaration(parent) && parent.name === node)
    );
  };
  const isIdentifierReferenceAllowed = (node: ts.Identifier): boolean => {
    if (isIdentifierDeclarationName(node)) return true;
    const parent = node.parent;
    if (
      ts.isCallExpression(parent) &&
      parent.expression === node &&
      callExpressionIsAllowed(parent)
    ) {
      return true;
    }
    if (
      strictTargetPartial &&
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === "project" &&
      resolveBinding(parent.expression)?.kind === "import" &&
      parent.arguments[1] === node &&
      resolveBinding(node)?.kind === "non-resource"
    )
      return true;
    if (
      ts.isCallExpression(parent) &&
      parent.expression !== node &&
      parent.arguments[0] === node &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === "ref" &&
      refCallIsSafe(parent) &&
      isResourceBinding(node)
    ) {
      return true;
    }
    if (isResourceBinding(node) && isResourceCollectionReference(node)) {
      return true;
    }
    const member = memberExpressionRootedAt(node);
    return (
      member !== null &&
      isAllowedVariableValue(member) &&
      isWithinAllowedVariableValue(member)
    );
  };
  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (
      node.kind === ts.SyntaxKind.ThisKeyword ||
      node.kind === ts.SyntaxKind.SuperKeyword ||
      ts.isMetaProperty(node)
    ) {
      safe = false;
      return;
    }
    if (
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      (ts.isPrefixUnaryExpression(node) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
          node.operator,
        )) ||
      ts.isPostfixUnaryExpression(node) ||
      ts.isDeleteExpression(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isThrowStatement(node) ||
      ts.isTryStatement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isAwaitExpression(node) ||
      ts.isYieldExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      // A spread can introduce properties or values from an unanalyzed
      // binding, so reject every spread form rather than allowing it to skip
      // the property provenance checks below.
      ts.isSpreadAssignment(node) ||
      ts.isSpreadElement(node)
    ) {
      safe = false;
      return;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (
        !isDefineRailwayCallback(node) ||
        node.parameters.length > 1 ||
        node.parameters.some((parameter) => !isSupportedParameter(parameter))
      ) {
        safe = false;
        return;
      }
    }
    if (ts.isImportDeclaration(node)) {
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      safe = false;
      return;
    }
    if (ts.isImportEqualsDeclaration(node) || ts.isNewExpression(node)) {
      safe = false;
      return;
    }
    if (
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      // Method/accessor names can be computed dynamically, and their values
      // are not among the explicitly approved primitive/reference forms.
      safe = false;
      return;
    }
    if (propertyUsesUnboundEnvironment(node)) {
      safe = false;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      secretLikePropertyName.test(node.name.text) &&
      node.initializer !== undefined &&
      !secretLikeValueIsStaticSafe(node.initializer)
    ) {
      // A raw secret can be hidden in an otherwise unused alias, so checking
      // only the sensitive property assignment is insufficient. Keep the
      // same explicit provenance rule for secret-like variable names before
      // the source can be staged or included in an evidence hash.
      safe = false;
      return;
    }
    if (
      (isResourceEnvironmentAccess(node) || isSharedNamespaceAccess(node)) &&
      !isWithinAllowedVariableValue(node)
    ) {
      safe = false;
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      secretLikePropertyName.test(propertyNameText(node.name) ?? "") &&
      !secretLikeValueIsStaticSafe(node.initializer)
    ) {
      safe = false;
      return;
    }
    if (
      ts.isShorthandPropertyAssignment(node) &&
      secretLikePropertyName.test(node.name.text)
    ) {
      safe = false;
      return;
    }
    if (
      (ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)) &&
      secretLikePropertyName.test(propertyNameText(node.name) ?? "")
    ) {
      safe = false;
      return;
    }
    if (ts.isCallExpression(node)) {
      if (!callExpressionIsAllowed(node)) {
        safe = false;
        return;
      }
    }
    if (
      ts.isIdentifier(node) &&
      ["process", "global", "globalThis", "fetch", "require"].includes(
        node.text,
      )
    ) {
      safe = false;
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      if (
        node.argumentExpression === undefined ||
        !ts.isStringLiteral(node.argumentExpression) ||
        !isBoundedName(node.argumentExpression.text)
      ) {
        safe = false;
        return;
      }
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      node.expression.name.text === "env"
    ) {
      safe = false;
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isComputedPropertyName(node.name) &&
      (!ts.isStringLiteral(node.name.expression) ||
        !isBoundedName(node.name.expression.text))
    ) {
      safe = false;
      return;
    }
    if (
      ts.isShorthandPropertyAssignment(node) &&
      secretLikePropertyName.test(node.name.text)
    ) {
      safe = false;
      return;
    }
    if (
      (ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)) &&
      secretLikePropertyName.test(propertyNameText(node.name) ?? "")
    ) {
      safe = false;
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      ["env", "variables"].includes(propertyNameText(node.name) ?? "")
    ) {
      if (!ts.isObjectLiteralExpression(node.initializer)) {
        safe = false;
        return;
      }
      const unmanaged =
        propertyNameText(node.name) === "variables" &&
        ((ts.isCallExpression(node.parent.parent) &&
          ts.isIdentifier(node.parent.parent.expression) &&
          node.parent.parent.expression.text === "project" &&
          resolveBinding(node.parent.parent.expression)?.kind === "import" &&
          node.parent.parent.arguments[1] === node.parent) ||
          strictTargetPartial) &&
        node.initializer.properties.length === 1 &&
        node.initializer.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) &&
            propertyNameText(property.name) === "managed" &&
            property.initializer.kind === ts.SyntaxKind.FalseKeyword,
        );
      safe =
        unmanaged ||
        node.initializer.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) &&
            isAllowedVariableValue(property.initializer),
        );
      if (!safe) return;
    }
    if (
      ts.isShorthandPropertyAssignment(node) &&
      ["env", "variables"].includes(node.name.text)
    ) {
      safe = false;
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      (node.argumentExpression === undefined ||
        !ts.isStringLiteral(node.argumentExpression) ||
        !isBoundedName(node.argumentExpression.text))
    ) {
      safe = false;
      return;
    }
    if (
      ts.isShorthandPropertyAssignment(node) ||
      (ts.isIdentifier(node) && !isIdentifierReferenceAllowed(node))
    ) {
      safe = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return safe;
}

export function validateRailwayIacMigrationEvidence(
  input: unknown,
  filesystem: RailwayIacFilesystemEvidence,
  nowMs = Date.now(),
): RailwayIacMigrationResult {
  if (isRecord(input) && input.schemaVersion === 2) {
    const result = validateNamedPartialEvidence(
      input,
      filesystem,
      RAILWAY_LEGACY_FIXTURE_SHA256,
      generatedIacSourceIsSecretSafe,
      nowMs,
    );
    if (
      !currentRepositoryFileContentIsKnown(
        filesystem.currentRepositoryFileContent,
      )
    ) {
      return {
        ...result,
        migrationEvidence: "hold",
        reasons: [
          ...new Set([...result.reasons, "legacy-config-missing" as const]),
        ].sort(),
      };
    }
    return result;
  }
  const reasons: RailwayIacMigrationReason[] = [];
  const finish = (): RailwayIacMigrationResult => ({
    schemaVersion: RAILWAY_IAC_EVIDENCE_SCHEMA_VERSION,
    migrationEvidence: reasons.length === 0 ? "pass" : "hold",
    authorizesMigration: false,
    authorizesApply: false,
    authorizesDeployment: false,
    externalMutationPerformed: false,
    reasons: [...new Set(reasons)].sort(),
  });

  if (!Number.isFinite(nowMs) || nowMs < 0) reasons.push("clock-invalid");
  const safeNowMs = Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : 0;
  if (!hasExactKeys(input, ROOT_KEYS) || input.schemaVersion !== 1) {
    reasons.push("invalid-schema");
    return finish();
  }
  if (!isFreshTimestamp(input.capturedAt, safeNowMs))
    reasons.push("evidence-stale");

  const cli = input.cliEvidence;
  const cliVersion =
    isRecord(cli) && typeof cli.cliVersion === "string" ? cli.cliVersion : null;
  if (
    !hasExactKeys(cli, CLI_KEYS) ||
    cli.capturedFromHelp !== true ||
    !versionAtLeast(cli.cliVersion, RAILWAY_IAC_MINIMUM_CLI_VERSION) ||
    cli.pullSupported !== true ||
    cli.planSupported !== true ||
    cli.planJsonSupported !== true ||
    cli.planOutSupported !== true ||
    cli.detailedExitCodeSupported !== true
  ) {
    reasons.push("cli-capability-unverified");
  }

  const target = targetIsValid(input.target) ? input.target : null;
  if (target === null) reasons.push("target-identity-invalid");

  const inventory = input.inventory;
  const inventoryValid =
    hasExactKeys(inventory, INVENTORY_KEYS) &&
    isFreshTimestamp(inventory.observedAt, safeNowMs) &&
    inventory.source === "authorized-railway-config-pull" &&
    inventory.ownershipMode === "full-project" &&
    targetFieldsMatch(inventory, target) &&
    target !== null &&
    inventory.serviceName === target.serviceName &&
    isSha256(inventory.authorityEvidenceSha256) &&
    isOpaqueIdentifier(inventory.targetServiceAddress) &&
    isStringArray(inventory.resourceAddresses) &&
    inventory.resourceAddresses.length > 0 &&
    new Set(inventory.resourceAddresses).size ===
      inventory.resourceAddresses.length &&
    inventory.resourceAddresses.includes(inventory.targetServiceAddress);
  if (!inventoryValid) reasons.push("resource-inventory-mismatch");

  const generated = input.generatedIac;
  const generatedConfig =
    isRecord(generated) && configIsValid(generated.targetServiceConfig)
      ? generated.targetServiceConfig
      : null;
  const generatedSource =
    isRecord(generated) && configSourceIsValid(generated.targetServiceSource)
      ? generated.targetServiceSource
      : null;
  const generatedAddresses =
    isRecord(generated) && isStringArray(generated.resourceAddresses)
      ? generated.resourceAddresses
      : [];
  const inventoryAddresses =
    isRecord(inventory) && isStringArray(inventory.resourceAddresses)
      ? inventory.resourceAddresses
      : [];
  const generatedValid =
    hasExactKeys(generated, GENERATED_KEYS) &&
    generated.path === ".railway/railway.ts" &&
    isSha256(generated.sha256) &&
    generated.generatedBy === "authorized-railway-config-pull" &&
    isStringArray(generated.resourceAddresses) &&
    new Set(generated.resourceAddresses).size ===
      generated.resourceAddresses.length &&
    generated.ownershipMode === "full-project" &&
    versionAtLeast(generated.cliVersion, RAILWAY_IAC_MINIMUM_CLI_VERSION) &&
    parseVersion(generated.sdkPackageVersion) !== null &&
    generated.sdkSchemaRevision === REVIEWED_RAILWAY_SDK_SCHEMA_REVISION &&
    generated.compatibilityReviewed === true &&
    generated.manualSecretReviewCompleted === true &&
    generated.decryptVariablesUsed === false &&
    generated.omitPreservedVariablesUsed === false &&
    generatedConfig !== null &&
    generatedSource !== null;
  if (
    !generatedValid ||
    !inventoryValid ||
    !sameStrings(generatedAddresses, inventoryAddresses)
  ) {
    reasons.push("generated-iac-invalid", "resource-inventory-mismatch");
  }
  if (
    filesystem.generatedIacPath !== ".railway/railway.ts" ||
    filesystem.generatedIacSha256 === null
  ) {
    reasons.push("generated-iac-missing");
  } else if (
    !generatedValid ||
    generated.sha256 !== filesystem.generatedIacSha256
  ) {
    reasons.push("generated-iac-invalid");
  }
  if (
    filesystem.generatedIacSecretSafe !== true ||
    !generatedValid ||
    generated.manualSecretReviewCompleted !== true
  ) {
    reasons.push("secret-safety-unverified");
  }

  const currentRepositoryFileSource = filesystem.currentRepositoryFileContent;
  const currentRepositoryFileSha256 = filesystem.currentRepositoryFileSha256;
  const currentRepositoryFileValid =
    filesystem.currentRepositoryFilePresent === true &&
    typeof currentRepositoryFileSource === "string" &&
    isSha256(currentRepositoryFileSha256) &&
    sha256(currentRepositoryFileSource) === currentRepositoryFileSha256 &&
    currentRepositoryFileContentIsKnown(currentRepositoryFileSource) &&
    currentRepositoryFileSha256 !== RAILWAY_LEGACY_FIXTURE_SHA256;
  const legacyFixtureHashValid =
    filesystem.legacyFixturePresent === true &&
    filesystem.legacyFixtureSha256 === RAILWAY_LEGACY_FIXTURE_SHA256 &&
    typeof filesystem.legacyFixtureContent === "string" &&
    sha256(filesystem.legacyFixtureContent) === filesystem.legacyFixtureSha256;
  const legacyFixtureValid =
    legacyFixtureHashValid &&
    legacyFixtureContentIsKnown(filesystem.legacyFixtureContent);
  if (filesystem.legacyTomlFilePresent !== false)
    reasons.push("alternate-legacy-config-present");
  if (!currentRepositoryFileValid || !legacyFixtureValid)
    reasons.push("legacy-config-missing");

  const cutover = input.ownershipCutover;
  if (
    !hasExactKeys(cutover, CUTOVER_KEYS) ||
    !isFreshTimestamp(cutover.observedAt, safeNowMs) ||
    !targetFieldsMatch(cutover, target) ||
    !isSha256(cutover.evidenceSha256) ||
    !isSha256(cutover.legacyFileSha256) ||
    !currentRepositoryFileValid ||
    !legacyFixtureValid ||
    cutover.legacyFileSha256 !== RAILWAY_LEGACY_FIXTURE_SHA256 ||
    cutover.legacyFileSha256 !== filesystem.legacyFixtureSha256 ||
    cutover.legacyFileSha256 === filesystem.currentRepositoryFileSha256 ||
    cutover.method !== "authorized-manual-clear" ||
    cutover.configFileSettingCleared !== true ||
    cutover.repositoryFileRetained !== true ||
    cutover.deleteFilesUsed !== false ||
    cutover.nonInteractiveFlagsUsed !== false
  ) {
    reasons.push("ownership-cutover-unverified");
  }

  const pre = input.preCutoverReadback;
  const preConfig =
    isRecord(pre) && configIsValid(pre.config) ? pre.config : null;
  const preSource =
    isRecord(pre) && readbackSourceIsValid(pre.source) ? pre.source : null;
  const preValid =
    hasExactKeys(pre, READBACK_KEYS) &&
    isFreshTimestamp(pre.observedAt, safeNowMs) &&
    targetFieldsMatch(pre, target) &&
    preSource !== null &&
    preConfig !== null;
  const effective = input.effectiveReadback;
  const effectiveConfig =
    isRecord(effective) && configIsValid(effective.config)
      ? effective.config
      : null;
  const effectiveSource =
    isRecord(effective) && readbackSourceIsValid(effective.source)
      ? effective.source
      : null;
  const effectiveValid =
    hasExactKeys(effective, READBACK_KEYS) &&
    isFreshTimestamp(effective.observedAt, safeNowMs) &&
    targetFieldsMatch(effective, target) &&
    effectiveSource !== null &&
    effectiveConfig !== null;
  if (!preValid || !effectiveValid) reasons.push("effective-readback-invalid");
  if (
    !preValid ||
    !effectiveValid ||
    preConfig === null ||
    effectiveConfig === null ||
    !configEquals(preConfig, effectiveConfig) ||
    JSON.stringify(preSource) !== JSON.stringify(effectiveSource)
  ) {
    reasons.push("parity-readback-mismatch");
  }
  if (
    generatedConfig === null ||
    generatedSource === null ||
    preSource === null ||
    effectiveSource === null ||
    preConfig === null ||
    effectiveConfig === null ||
    !preValid ||
    !effectiveValid ||
    !configEquals(generatedConfig, preConfig) ||
    !configEquals(generatedConfig, effectiveConfig) ||
    !configSourceMatchesReadback(generatedSource, preSource) ||
    !configSourceMatchesReadback(generatedSource, effectiveSource) ||
    !legacyKnownFieldsMatch(generatedConfig) ||
    !legacyKnownFieldsMatch(preConfig) ||
    !legacyKnownFieldsMatch(effectiveConfig)
  ) {
    reasons.push("generated-service-parity-mismatch");
  }

  const plan = input.parityPlan;
  const planShapeValid = hasExactKeys(plan, PLAN_KEYS);
  if (
    !planShapeValid ||
    !targetFieldsMatch(plan, target) ||
    !isFreshTimestamp(plan.capturedAt, safeNowMs) ||
    !generatedValid ||
    plan.sourceSha256 !== generated.sha256 ||
    !isSha256(plan.planOutputSha256) ||
    plan.cliVersion !== cliVersion ||
    plan.cliVersion !== generated.cliVersion ||
    plan.invocation !==
      "railway config plan --json --detailed-exit-code --file .railway/railway.ts --out <outside-repository>/railway-plan.json"
  ) {
    reasons.push("parity-plan-target-mismatch");
  }
  if (
    !planShapeValid ||
    !isSha256(plan.pinnedPlanArtifactSha256) ||
    plan.pinnedPlanStoredOutsideRepository !== true
  ) {
    reasons.push("pinned-plan-unverified");
  }
  if (
    !planShapeValid ||
    plan.exitCode !== 0 ||
    !isStringArray(plan.additions) ||
    !isStringArray(plan.changes) ||
    !isStringArray(plan.destructions) ||
    !isStringArray(plan.unrelatedChanges) ||
    plan.additions.length !== 0 ||
    plan.changes.length !== 0 ||
    plan.destructions.length !== 0 ||
    plan.unrelatedChanges.length !== 0
  ) {
    reasons.push("parity-plan-not-clean");
  }
  if (
    !planShapeValid ||
    plan.variableValuesRedacted !== true ||
    plan.detailedExitCodeUsed !== true ||
    plan.showValuesUsed !== false ||
    plan.decryptVariablesUsed !== false
  ) {
    reasons.push("secret-safety-unverified");
  }

  if (
    !preValid ||
    !inventoryValid ||
    !hasExactKeys(cutover, CUTOVER_KEYS) ||
    !effectiveValid ||
    !planShapeValid ||
    !isFreshTimestamp(input.capturedAt, safeNowMs) ||
    !(
      Date.parse(String(pre.observedAt)) <
        Date.parse(String(cutover.observedAt)) &&
      Date.parse(String(isRecord(inventory) ? inventory.observedAt : "")) <=
        Date.parse(String(pre.observedAt)) &&
      Date.parse(String(cutover.observedAt)) <=
        Date.parse(String(effective.observedAt)) &&
      Date.parse(String(effective.observedAt)) <=
        Date.parse(String(plan.capturedAt)) &&
      Date.parse(String(plan.capturedAt)) <=
        Date.parse(String(input.capturedAt))
    )
  ) {
    reasons.push("evidence-order-invalid");
  }

  return finish();
}
