import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RULESET_NAME = "protect-existing-release-tags";
const EXPECTED_TAG_PATTERN = "refs/tags/v*";
const EXPECTED_RULE_TYPES = ["deletion", "non_fast_forward", "update"];

/**
 * Validate the live JSON returned by GET /repos/{owner}/{repo}/rulesets/{id}.
 *
 * This deliberately checks only the immutable-tag ruleset. Creation authority
 * is a separate ruleset and must not be silently folded into this bypass-free
 * protection boundary.
 *
 * @param {unknown} input
 * @returns {{id: number, name: string, enforcement: string, ruleTypes: string[]}}
 */
export function validateReleaseTagRuleset(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("ruleset response must be a JSON object");
  }

  const ruleset = /** @type {Record<string, unknown>} */ (input);
  if (ruleset.name !== EXPECTED_RULESET_NAME) {
    throw new Error(`unexpected ruleset name: ${String(ruleset.name)}`);
  }
  if (ruleset.target !== "tag") {
    throw new Error(`ruleset target must be tag: ${String(ruleset.target)}`);
  }
  if (ruleset.enforcement !== "active") {
    throw new Error(
      `ruleset enforcement must be active: ${String(ruleset.enforcement)}`,
    );
  }

  const conditions = ruleset.conditions;
  if (!conditions || typeof conditions !== "object") {
    throw new Error("ruleset conditions are missing");
  }
  const refName = /** @type {Record<string, unknown>} */ (conditions).ref_name;
  if (!refName || typeof refName !== "object") {
    throw new Error("ruleset ref_name condition is missing");
  }
  const include = /** @type {Record<string, unknown>} */ (refName).include;
  const exclude = /** @type {Record<string, unknown>} */ (refName).exclude;
  if (!Array.isArray(include) || !include.includes(EXPECTED_TAG_PATTERN)) {
    throw new Error("ruleset must include exactly the v* tag pattern");
  }
  if (!Array.isArray(exclude) || exclude.length !== 0) {
    throw new Error("ruleset must not exclude any v* tag");
  }

  const bypassActors = ruleset.bypass_actors;
  if (!Array.isArray(bypassActors) || bypassActors.length !== 0) {
    throw new Error("immutable release-tag ruleset must have no bypass actors");
  }
  if (
    "current_user_can_bypass" in ruleset &&
    ruleset.current_user_can_bypass !== "never"
  ) {
    throw new Error(
      `current user must not bypass immutable tags: ${String(ruleset.current_user_can_bypass)}`,
    );
  }

  const rules = ruleset.rules;
  if (!Array.isArray(rules)) {
    throw new Error("ruleset rules are missing");
  }
  const ruleTypes = rules.map((rule) => {
    if (!rule || typeof rule !== "object") return undefined;
    return /** @type {Record<string, unknown>} */ (rule).type;
  });
  if (ruleTypes.some((type) => typeof type !== "string")) {
    throw new Error("ruleset contains a rule without a type");
  }
  const sortedRuleTypes = /** @type {string[]} */ (ruleTypes).toSorted();
  if (JSON.stringify(sortedRuleTypes) !== JSON.stringify(EXPECTED_RULE_TYPES)) {
    throw new Error(
      `ruleset rules must be update, deletion, non_fast_forward: ${sortedRuleTypes.join(",")}`,
    );
  }

  if (typeof ruleset.id !== "number" || !Number.isInteger(ruleset.id)) {
    throw new Error("ruleset id is missing or invalid");
  }

  return {
    id: ruleset.id,
    name: EXPECTED_RULESET_NAME,
    enforcement: "active",
    ruleTypes: sortedRuleTypes,
  };
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const summary = validateReleaseTagRuleset(JSON.parse(await readStdin()));
    console.log(
      `verified ${summary.name} #${summary.id}: ${summary.ruleTypes.join(", ")} on ${summary.enforcement} ${EXPECTED_TAG_PATTERN}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
