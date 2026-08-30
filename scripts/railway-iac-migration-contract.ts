import ts from "typescript";

const RAILWAY_IAC_EVIDENCE_SCHEMA_VERSION = 1 as const;
const RAILWAY_IAC_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1_000;
const RAILWAY_IAC_EVIDENCE_MAX_FUTURE_SKEW_MS = 30 * 1_000;
const RAILWAY_IAC_MINIMUM_CLI_VERSION = "5.42.1";
const REVIEWED_RAILWAY_SDK_SCHEMA_REVISION =
  "c1b6ea8dd3e815e57257b1f17637e59d31db73b5";
const RAILWAY_LEGACY_KNOWN_CONFIG = Object.freeze({
  builder: "DOCKERFILE",
  dockerfilePath: "Dockerfile",
  startCommand: "pnpm server:start",
  healthcheckPath: "/healthz",
  healthcheckTimeoutSeconds: 60,
  restartPolicyType: "ON_FAILURE",
  restartPolicyMaxRetries: 10,
});

export const RAILWAY_IAC_MIGRATION_REASONS = [
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
  "resource-inventory-mismatch",
  "secret-safety-unverified",
  "target-identity-invalid",
] as const;

type RailwayIacMigrationReason = (typeof RAILWAY_IAC_MIGRATION_REASONS)[number];

export interface RailwayIacMigrationResult {
  schemaVersion: typeof RAILWAY_IAC_EVIDENCE_SCHEMA_VERSION;
  migrationEvidence: "pass" | "hold";
  authorizesMigration: false;
  authorizesApply: false;
  authorizesDeployment: false;
  externalMutationPerformed: false;
  reasons: RailwayIacMigrationReason[];
}

export interface RailwayIacFilesystemEvidence {
  generatedIacPath: string | null;
  generatedIacSha256: string | null;
  generatedIacSecretSafe: boolean | null;
  legacyRepositoryFilePresent: boolean;
  legacyRepositoryFileSha256: string | null;
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

function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  const parsed = match.slice(1, 4).map(Number);
  return parsed.every(Number.isSafeInteger)
    ? (parsed as [number, number, number])
    : null;
}

function versionAtLeast(value: unknown, minimum: string): boolean {
  const actual = parseVersion(value);
  const required = parseVersion(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) {
      return actual[index]! > required[index]!;
    }
  }
  return true;
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
  const importedBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "railway/iac" ||
      clause === undefined ||
      clause.name !== undefined ||
      clause.namedBindings === undefined ||
      !ts.isNamedImports(clause.namedBindings) ||
      clause.namedBindings.elements.length === 0 ||
      clause.namedBindings.elements.some(
        (element) =>
          element.propertyName !== undefined ||
          !allowedImportsAndCalls.has(element.name.text),
      )
    ) {
      return false;
    }
    for (const element of clause.namedBindings.elements) {
      importedBindings.add(element.name.text);
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
  const resourceBindings = new Set<string>();
  const nonResourceBindings = new Set<string>();
  let unsupportedBindingPattern = false;
  const addBindingNames = (
    name: ts.BindingName,
    destination: Set<string>,
  ): void => {
    if (ts.isIdentifier(name)) {
      destination.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        addBindingNames(element.name, destination);
      }
    }
  };
  const collectResourceBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      if (!ts.isIdentifier(node.name)) unsupportedBindingPattern = true;
      const isResourceDeclaration =
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        resourceFactoryNames.has(node.initializer.expression.text) &&
        importedBindings.has(node.initializer.expression.text);
      if (isResourceDeclaration) {
        resourceBindings.add(node.name.text);
      } else {
        addBindingNames(node.name, nonResourceBindings);
      }
    }
    if (ts.isParameter(node)) {
      if (!ts.isIdentifier(node.name)) unsupportedBindingPattern = true;
      addBindingNames(node.name, nonResourceBindings);
    }
    ts.forEachChild(node, collectResourceBindings);
  };
  collectResourceBindings(sourceFile);
  // Destructuring can alias resource.env or ctx.shared without retaining
  // provenance, so reject it instead of attempting incomplete flow analysis.
  if (unsupportedBindingPattern) return false;
  const isResourceBinding = (name: string): boolean =>
    resourceBindings.has(name) && !nonResourceBindings.has(name);
  const resourceEnvOwner = (node: ts.Node): string | null => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isIdentifier(node.expression)
    ) {
      return node.expression.text;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.argumentExpression !== undefined &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "env"
    ) {
      return node.expression.text;
    }
    return null;
  };
  const propertyUsesUnboundEnvironment = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "env") {
      return !(
        ts.isIdentifier(node.expression) &&
        isResourceBinding(node.expression.text)
      );
    }
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      if (argument === undefined) return true;
      if (ts.isStringLiteral(argument) && argument.text === "env") {
        return !(
          ts.isIdentifier(node.expression) &&
          isResourceBinding(node.expression.text)
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
    ts.isIdentifier(node.arguments[0]!) &&
    isResourceBinding(node.arguments[0]!.text) &&
    ts.isStringLiteral(node.arguments[1]!) &&
    isBoundedName(node.arguments[1]!.text);
  const isAllowedVariableValue = (node: ts.Expression): boolean => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      return (
        (node.expression.text === "preserve" && node.arguments.length === 0) ||
        (node.expression.text === "ref" && refCallIsSafe(node))
      );
    }
    if (ts.isPropertyAccessExpression(node)) {
      const owner = node.expression;
      if (!ts.isPropertyAccessExpression(owner)) return false;
      if (
        owner.name.text === "env" &&
        ts.isIdentifier(owner.expression) &&
        isResourceBinding(owner.expression.text)
      ) {
        return true;
      }
      return (
        owner.name.text === "shared" &&
        ts.isIdentifier(owner.expression) &&
        owner.expression.text === "ctx"
      );
    }
    return false;
  };
  const propertyNameText = (name: ts.PropertyName): string | null => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    if (
      ts.isComputedPropertyName(name) &&
      ts.isStringLiteral(name.expression)
    ) {
      return name.expression.text;
    }
    return null;
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
  const isResourceEnvironmentAccess = (node: ts.Node): boolean => {
    const owner = resourceEnvOwner(node);
    if (owner !== null) {
      return isResourceBinding(owner);
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
      ts.isIdentifier(node.expression) &&
      node.expression.text === "ctx"
    ) {
      return true;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "shared" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "ctx"
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
  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
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
      ts.isTaggedTemplateExpression(node)
    ) {
      safe = false;
      return;
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
    if (propertyUsesUnboundEnvironment(node)) {
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
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      safe = false;
      return;
    }
    if (ts.isCallExpression(node)) {
      if (
        !ts.isIdentifier(node.expression) ||
        !allowedImportsAndCalls.has(node.expression.text) ||
        !importedBindings.has(node.expression.text) ||
        (node.expression.text === "preserve" && node.arguments.length !== 0) ||
        (node.expression.text === "ref" && !refCallIsSafe(node))
      ) {
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
      !ts.isStringLiteral(node.name.expression)
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
      safe = node.initializer.properties.every(
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
  if (!filesystem.legacyRepositoryFilePresent)
    reasons.push("legacy-config-missing");

  const cutover = input.ownershipCutover;
  if (
    !hasExactKeys(cutover, CUTOVER_KEYS) ||
    !isFreshTimestamp(cutover.observedAt, safeNowMs) ||
    !targetFieldsMatch(cutover, target) ||
    !isSha256(cutover.evidenceSha256) ||
    !isSha256(cutover.legacyFileSha256) ||
    cutover.legacyFileSha256 !== filesystem.legacyRepositoryFileSha256 ||
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
      "railway config plan --json --detailed-exit-code --file .railway/railway.ts"
  ) {
    reasons.push("parity-plan-target-mismatch");
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
