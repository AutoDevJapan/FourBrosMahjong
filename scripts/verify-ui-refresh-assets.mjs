import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = resolve(
  SCRIPT_DIRECTORY,
  "../documents/assets/ui-refresh/manifest.json",
);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const STABLE_FILENAME = /^[a-z0-9-]+\.png$/;
const SHA_256 = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("asset is not a valid PNG with an IHDR header");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function verifyUiRefreshAssets(manifestPath = DEFAULT_MANIFEST) {
  const absoluteManifest = realpathSync(manifestPath);
  const manifestDirectory = dirname(absoluteManifest);
  const originalsDirectory = realpathSync(
    resolve(manifestDirectory, "originals"),
  );
  const manifest = JSON.parse(readFileSync(absoluteManifest, "utf8"));

  if (!isRecord(manifest) || manifest.version !== 1) {
    throw new Error("manifest version must be 1");
  }
  if (!isRecord(manifest.provenance)) {
    throw new Error("manifest provenance is missing");
  }
  for (const field of [
    "legalRightsHolderVerified",
    "providerAuthorityToLicenseVerified",
    "redistributionPermissionVerifiedIndependently",
  ]) {
    if (manifest.provenance[field] !== false) {
      throw new Error(`provenance.${field} must explicitly be false`);
    }
  }
  if (!isRecord(manifest.usage)) throw new Error("manifest usage is missing");
  for (const field of [
    "runtimeAsset",
    "publicAsset",
    "backgroundImage",
    "sourceAnnotationsAreUiContent",
  ]) {
    if (manifest.usage[field] !== false) {
      throw new Error(`usage.${field} must explicitly be false`);
    }
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 6) {
    throw new Error("manifest must contain exactly 6 assets");
  }

  const ids = new Set();
  const files = new Set();
  const routes = new Set();
  let totalBytes = 0;

  for (const asset of manifest.assets) {
    if (!isRecord(asset)) throw new Error("asset entry must be an object");
    if (typeof asset.id !== "string" || ids.has(asset.id)) {
      throw new Error(`asset id is missing or duplicated: ${String(asset.id)}`);
    }
    if (
      typeof asset.file !== "string" ||
      dirname(asset.file) !== "originals" ||
      !STABLE_FILENAME.test(asset.file.slice("originals/".length)) ||
      files.has(asset.file)
    ) {
      throw new Error(
        `asset file is invalid or duplicated: ${String(asset.file)}`,
      );
    }
    if (typeof asset.route !== "string" || routes.has(asset.route)) {
      throw new Error(
        `asset route is missing or duplicated: ${String(asset.route)}`,
      );
    }
    if (typeof asset.originalFilename !== "string") {
      throw new Error(`asset original filename is missing: ${asset.id}`);
    }
    if (!SHA_256.test(String(asset.sha256))) {
      throw new Error(`asset SHA-256 is invalid: ${asset.id}`);
    }

    const requestedPath = resolve(manifestDirectory, asset.file);
    const actualPath = realpathSync(requestedPath);
    const pathWithinOriginals = relative(originalsDirectory, actualPath);
    if (
      pathWithinOriginals === "" ||
      pathWithinOriginals === ".." ||
      pathWithinOriginals.startsWith(`..${sep}`) ||
      lstatSync(requestedPath).isSymbolicLink() ||
      !lstatSync(requestedPath).isFile()
    ) {
      throw new Error(
        `asset must be a regular file under originals/: ${asset.id}`,
      );
    }

    const buffer = readFileSync(actualPath);
    const dimensions = readPngDimensions(buffer);
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (buffer.length !== asset.bytes) {
      throw new Error(`asset byte count does not match manifest: ${asset.id}`);
    }
    if (
      dimensions.width !== asset.width ||
      dimensions.height !== asset.height
    ) {
      throw new Error(`asset dimensions do not match manifest: ${asset.id}`);
    }
    if (hash !== asset.sha256) {
      throw new Error(`asset SHA-256 does not match manifest: ${asset.id}`);
    }

    ids.add(asset.id);
    files.add(asset.file);
    routes.add(asset.route);
    totalBytes += buffer.length;
  }

  const expectedRoutes = [
    "/",
    "/game",
    "/game/result",
    "/history",
    "/rules",
    "/settings",
  ];
  if (JSON.stringify([...routes].sort()) !== JSON.stringify(expectedRoutes)) {
    throw new Error("manifest routes do not match the six UI refresh screens");
  }

  return { assetCount: manifest.assets.length, totalBytes };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyUiRefreshAssets();
    console.log(
      `verified ${result.assetCount} UI refresh originals (${result.totalBytes} bytes)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
