import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_CREATION_RULESET_NAME = "authorize-release-tag-creation";
export const EXPECTED_CREATION_TAG_PATTERN = "refs/tags/v*";
const EXPECTED_CREATION_RULE_TYPE = "creation";
const EXPECTED_CREATION_BYPASS_MODE = "always";

/** @param {unknown} value */
function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the repository-owned creation-only release-tag ruleset.
 *
 * The expected Team ID is supplied by an already-approved owner decision. It
 * is deliberately required so that any arbitrary Team with an `always`
 * bypass cannot be mistaken for the approved Release Operators Team.
 *
 * @param {unknown} input
 * @param {unknown} expectedTeamId
 * @returns {{id: number, name: string, enforcement: "active", ruleType: "creation", bypassActorType: "Team", bypassActorId: number, bypassMode: "always"}}
 */
export function validateReleaseTagCreationRuleset(input, expectedTeamId) {
  if (!isPositiveSafeInteger(expectedTeamId)) {
    throw new Error("approved Release Operators Team ID is unresolved");
  }
  if (!isPlainObject(input)) {
    throw new Error("ruleset response must be a JSON object");
  }

  const ruleset = /** @type {Record<string, unknown>} */ (input);
  if (ruleset.name !== EXPECTED_CREATION_RULESET_NAME) {
    throw new Error(`unexpected ruleset name: ${String(ruleset.name)}`);
  }
  if (ruleset.source_type !== "Repository") {
    throw new Error(
      `ruleset source must be Repository: ${String(ruleset.source_type)}`,
    );
  }
  if (ruleset.target !== "tag") {
    throw new Error(`ruleset target must be tag: ${String(ruleset.target)}`);
  }
  if (ruleset.enforcement !== "active") {
    throw new Error(
      `creation ruleset enforcement must be active: ${String(ruleset.enforcement)}`,
    );
  }

  const conditions = ruleset.conditions;
  if (!isPlainObject(conditions)) {
    throw new Error("ruleset conditions are missing");
  }
  const refName = conditions.ref_name;
  if (!isPlainObject(refName)) {
    throw new Error("ruleset ref_name condition is missing");
  }
  if (
    !Array.isArray(refName.include) ||
    refName.include.length !== 1 ||
    refName.include[0] !== EXPECTED_CREATION_TAG_PATTERN
  ) {
    throw new Error("ruleset must include exactly the v* tag pattern");
  }
  if (!Array.isArray(refName.exclude) || refName.exclude.length !== 0) {
    throw new Error("ruleset must not exclude any v* tag");
  }

  const rules = ruleset.rules;
  if (
    !Array.isArray(rules) ||
    rules.length !== 1 ||
    !isPlainObject(rules[0]) ||
    rules[0].type !== EXPECTED_CREATION_RULE_TYPE
  ) {
    throw new Error("creation ruleset must contain only the creation rule");
  }

  const bypassActors = ruleset.bypass_actors;
  if (
    !Array.isArray(bypassActors) ||
    bypassActors.length !== 1 ||
    !isPlainObject(bypassActors[0])
  ) {
    throw new Error(
      "creation ruleset must have exactly one Release Operators Team bypass",
    );
  }
  const bypassActor = bypassActors[0];
  if (bypassActor.actor_type !== "Team") {
    throw new Error("creation ruleset bypass must be a Team");
  }
  if (bypassActor.bypass_mode !== EXPECTED_CREATION_BYPASS_MODE) {
    throw new Error("creation ruleset Team bypass must be always");
  }
  if (bypassActor.actor_id !== expectedTeamId) {
    throw new Error("creation ruleset bypass Team is not the approved Team");
  }

  if (!isPositiveSafeInteger(ruleset.id)) {
    throw new Error("ruleset id is missing or invalid");
  }

  return {
    id: ruleset.id,
    name: EXPECTED_CREATION_RULESET_NAME,
    enforcement: "active",
    ruleType: "creation",
    bypassActorType: "Team",
    bypassActorId: expectedTeamId,
    bypassMode: "always",
  };
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

/** @param {string} value */
function parseTeamId(value) {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const teamId = Number(trimmed);
  return isPositiveSafeInteger(teamId) ? teamId : undefined;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const teamId = parseTeamId(
      String(process.env.RELEASE_OPERATORS_TEAM_ID ?? ""),
    );
    const summary = validateReleaseTagCreationRuleset(
      JSON.parse(await readStdin()),
      teamId,
    );
    console.log(
      `verified ${summary.name} #${summary.id}: ${summary.ruleType} on ${summary.enforcement} ${EXPECTED_CREATION_TAG_PATTERN}; bypass ${summary.bypassActorType} #${summary.bypassActorId} (${summary.bypassMode})`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
