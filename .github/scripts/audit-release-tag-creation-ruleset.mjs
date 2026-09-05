// @ts-check
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGhApiArgv } from "./audit-release-tag-ruleset.mjs";
import {
  EXPECTED_CREATION_RULESET_NAME,
  EXPECTED_CREATION_TAG_PATTERN,
  validateReleaseTagCreationRuleset,
} from "./verify-release-tag-creation-ruleset.mjs";

const DEFAULT_REPOSITORY = "AutoDevJapan/FourBrosMahjong";
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/** @param {unknown} value @returns {value is number} */
function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/**
 * Select the one repository-owned creation-authority ruleset from the list
 * endpoint. Parent rulesets are excluded by the API request as a second
 * boundary; requiring source_type here prevents an inherited ruleset from
 * being mistaken for the repository contract if that request changes.
 *
 * @param {unknown} input
 * @returns {{id: number, name: string, target: string}}
 */
export function selectReleaseTagCreationRuleset(input) {
  if (!Array.isArray(input)) {
    throw new Error("ruleset list response must be an array");
  }

  const matches = input.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const ruleset = /** @type {Record<string, unknown>} */ (entry);
    return (
      ruleset.name === EXPECTED_CREATION_RULESET_NAME &&
      ruleset.target === "tag" &&
      ruleset.source_type === "Repository"
    );
  });

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one repository ${EXPECTED_CREATION_RULESET_NAME} ruleset, found ${matches.length}`,
    );
  }

  const ruleset = /** @type {Record<string, unknown>} */ (matches[0]);
  if (!isPositiveSafeInteger(ruleset.id)) {
    throw new Error("selected creation ruleset id is missing or invalid");
  }

  return {
    id: ruleset.id,
    name: EXPECTED_CREATION_RULESET_NAME,
    target: "tag",
  };
}

/**
 * Parse the owner-approved Release Operators Team ID without accepting a
 * lossy number conversion or an unset environment variable.
 *
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function parseReleaseOperatorsTeamId(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const teamId = Number(trimmed);
  return isPositiveSafeInteger(teamId) ? teamId : undefined;
}

/** @param {string} repository */
function validateRepository(repository) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`repository is invalid: ${repository}`);
  }
  return repository;
}

/** @param {string} path @param {string[]} [options] */
function ghApi(path, options = []) {
  return execFileSync("gh", buildGhApiArgv(path, options), {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  const teamId = parseReleaseOperatorsTeamId(
    String(process.env.RELEASE_OPERATORS_TEAM_ID ?? ""),
  );
  if (teamId === undefined) {
    throw new Error("approved Release Operators Team ID is unresolved");
  }

  const repository = validateRepository(
    String(process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY).trim(),
  );
  const listPath = `repos/${repository}/rulesets?includes_parents=false&per_page=100`;
  const listPages = JSON.parse(ghApi(listPath, ["--paginate", "--slurp"]));
  if (!Array.isArray(listPages)) {
    throw new Error("ruleset list response pages must be an array");
  }
  const selected = selectReleaseTagCreationRuleset(listPages.flat());
  const detail = JSON.parse(
    ghApi(`repos/${repository}/rulesets/${selected.id}`),
  );
  const summary = validateReleaseTagCreationRuleset(detail, teamId);
  console.log(
    `verified ${summary.name} #${summary.id}: ${summary.ruleType} on ${summary.enforcement} ${EXPECTED_CREATION_TAG_PATTERN}; bypass ${summary.bypassActorType} #${summary.bypassActorId} (${summary.bypassMode})`,
  );
  console.log("audit mode: GET only; no ruleset mutation was attempted");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
