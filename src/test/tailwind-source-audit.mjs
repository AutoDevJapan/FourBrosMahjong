/**
 * Read-only, locked-compiler audit. Kept in src/test so audit literals cannot
 * themselves become production CSS candidates. No Next build/cache is used.
 * Run: node src/test/tailwind-source-audit.mjs <before-git-ref>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";

const require = createRequire(import.meta.url);
// Resolve the plugin's own locked PostCSS, not an accidentally hoisted version.
const pluginRequire = createRequire(require.resolve("@tailwindcss/postcss"));
const postcss = pluginRequire("postcss");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BOUNDARY_SOURCES = [
  "../../prototypes",
  "../../documents/evidence",
  "../../documents/assets",
  "../../documents/fixtures/railway-pre-cutover.json",
  "../../.godd",
];

/** @param {string} root @param {string} css */
export async function scanCss(root, css) {
  // Real-root audits compare the public source tree. Private job metadata is
  // excluded in both conditions; its directive is tested using owned canaries.
  const isRealRoot = resolve(root) === resolve(ROOT);
  const input = isRealRoot
    ? `${css.trimEnd()}\n@source not "../../.godd";${css.endsWith("\n") ? "\n" : ""}`
    : css;
  const result = await postcss([
    tailwind({ base: root, optimize: false }),
  ]).process(input, { from: resolve(root, "src/app/globals.css") });
  return {
    css: result.css,
    dependencies: [
      ...new Set(
        result.messages
          .filter((message) => message.type === "dependency")
          .map((message) => relative(root, message.file).replaceAll("\\", "/")),
      ),
    ].sort(),
  };
}

/** @param {{css: string, dependencies: string[]}} result */
function summary(result) {
  return {
    bytes: Buffer.byteLength(result.css),
    sha256: createHash("sha256").update(result.css).digest("hex"),
    dependencyCount: result.dependencies.length,
    dependencies: result.dependencies,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const beforeRef = process.argv[2];
  if (!beforeRef || beforeRef.startsWith("-")) {
    throw new Error("Pass the explicit before git ref (for example 2074f2c).");
  }
  const beforeInput = execFileSync(
    "git",
    ["show", `${beforeRef}:src/app/globals.css`],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  const afterInput = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8");
  const before = await scanCss(ROOT, beforeInput);
  const after = await scanCss(ROOT, afterInput);
  const appended = `${beforeInput}\n${BOUNDARY_SOURCES.map((path) => `@source not "${path}";`).join("\n")}`;
  const noFinalLf = await scanCss(ROOT, appended);
  const finalLf = await scanCss(ROOT, `${appended}\n`);
  console.log(
    JSON.stringify(
      {
        beforeRef,
        privateMetadataExcludedInBothScans: true,
        compiler: {
          tailwindPostcss: JSON.parse(
            readFileSync(
              resolve(
                dirname(require.resolve("@tailwindcss/postcss")),
                "../package.json",
              ),
              "utf8",
            ),
          ).version,
          postcss: pluginRequire("postcss/package.json").version,
          optimize: false,
          base: ROOT,
          from: resolve(ROOT, "src/app/globals.css"),
        },
        before: summary(before),
        after: summary(after),
        byteIdentical: before.css === after.css,
        removedDependencies: before.dependencies.filter(
          (path) => !after.dependencies.includes(path),
        ),
        addedDependencies: after.dependencies.filter(
          (path) => !before.dependencies.includes(path),
        ),
        terminalNewlineExperiment: {
          withoutFinalLfBytes: Buffer.byteLength(noFinalLf.css),
          withoutFinalLfEqualsBeforeMinusOneLf:
            before.css.endsWith("\n") &&
            noFinalLf.css === before.css.slice(0, -1),
          withFinalLfBytes: Buffer.byteLength(finalLf.css),
          withFinalLfEqualsBefore: finalLf.css === before.css,
        },
      },
      null,
      2,
    ),
  );
}
