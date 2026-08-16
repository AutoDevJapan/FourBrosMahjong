// @ts-check
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_RULESET_NAME,
  EXPECTED_TAG_PATTERN,
  validateReleaseTagRuleset,
} from "./verify-release-tag-ruleset.mjs";

const DEFAULT_REPOSITORY = "AutoDevJapan/FourBrosMahjong";
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/**
 * Select the one repository-owned immutable release-tag ruleset from the
 * list endpoint. Parent rulesets are excluded by the API request as a second
 * boundary; requiring source_type here prevents an inherited ruleset from
 * being mistaken for the repository contract if that request changes.
 *
 * @param {unknown} input
 * @returns {{id: number, name: string, target: string}}
 */
export function selectImmutableReleaseTagRuleset(input) {
  if (!Array.isArray(input)) {
    throw new Error("ruleset list response must be an array");
  }

  const matches = input.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const ruleset = /** @type {Record<string, unknown>} */ (entry);
    return (
      ruleset.name === EXPECTED_RULESET_NAME &&
      ruleset.target === "tag" &&
      ruleset.source_type === "Repository"
    );
  });

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one repository ${EXPECTED_RULESET_NAME} ruleset, found ${matches.length}`,
    );
  }

  const ruleset = /** @type {Record<string, unknown>} */ (matches[0]);
  if (typeof ruleset.id !== "number" || !Number.isInteger(ruleset.id)) {
    throw new Error("selected release-tag ruleset id is missing or invalid");
  }

  return {
    id: ruleset.id,
    name: EXPECTED_RULESET_NAME,
    target: "tag",
  };
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
  return execFileSync("gh", ["api", ...options, path], {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  const repository = validateRepository(
    String(process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY).trim(),
  );
  const listPath = `repos/${repository}/rulesets?includes_parents=false&per_page=100`;
  const listPages = JSON.parse(ghApi(listPath, ["--paginate", "--slurp"]));
  const selected = selectImmutableReleaseTagRuleset(listPages.flat());
  const detail = JSON.parse(
    ghApi(`repos/${repository}/rulesets/${selected.id}`),
  );
  const summary = validateReleaseTagRuleset(detail);
  console.log(
    `verified ${summary.name} #${summary.id}: ${summary.ruleTypes.join(", ")} on ${summary.enforcement} ${EXPECTED_TAG_PATTERN}`,
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
