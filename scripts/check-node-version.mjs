import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import semver from "semver";

const packageJsonUrl = new URL("../package.json", import.meta.url);

/** @returns {string} */
export function requiredNodeRange() {
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8"));
  const range = packageJson.engines?.node;
  if (typeof range !== "string" || range.length === 0) {
    throw new Error("package.json の engines.node が設定されていません。");
  }
  return range;
}

/**
 * @param {string} version
 * @param {string} [range]
 * @returns {string | null}
 */
export function nodeVersionError(version, range = requiredNodeRange()) {
  if (semver.satisfies(version, range)) return null;
  return [
    `Unsupported Node.js version: v${version}`,
    `package.json requires Node.js ${range}.`,
    "Run `nvm use` or switch to a supported Node.js version before running tests.",
  ].join("\n");
}

/** @param {string} [version] */
export function checkNodeVersion(version = process.versions.node) {
  const message = nodeVersionError(version);
  if (message !== null) throw new Error(message);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    checkNodeVersion();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
