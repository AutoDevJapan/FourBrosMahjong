// @ts-check
import { pathToFileURL } from "node:url";

// gitleaks の安定版 release tag。branch名・sed置換・GITHUB_OUTPUTへ渡す前に、
// upstream metadataをこの安全な文字集合へ縮退させる。
const GITLEAKS_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** @param {string} tag */
export function versionFromGitleaksReleaseTag(tag) {
  if (!GITLEAKS_RELEASE_TAG.test(tag)) {
    throw new Error(`gitleaks release tag is invalid: ${JSON.stringify(tag)}`);
  }
  return tag.slice(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.stdout.write(versionFromGitleaksReleaseTag(process.argv[2] ?? ""));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
