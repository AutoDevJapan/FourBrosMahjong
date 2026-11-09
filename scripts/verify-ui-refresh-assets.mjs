import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = resolve(
  SCRIPT_DIRECTORY,
  "../documents/assets/ui-refresh/manifest.json",
);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CHUNK_OVERHEAD = 12;
const PNG_MAX_CHUNK_LENGTH = 0x7fffffff;
const STABLE_FILENAME = /^[a-z0-9-]+\.png$/;
const SHA_256 = /^[0-9a-f]{64}$/;

const PNG_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidPng() {
  throw new Error("asset is not a structurally valid PNG");
}

function isPngChunkTypeByte(value) {
  return (value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a);
}

function crc32(buffer, start, end) {
  let value = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    value = PNG_CRC32_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function readPngDimensions(buffer) {
  if (
    buffer.length < PNG_SIGNATURE.length ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return invalidPng();
  }

  let cursor = PNG_SIGNATURE.length;
  let width;
  let height;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;

  while (cursor < buffer.length) {
    if (buffer.length - cursor < PNG_CHUNK_OVERHEAD) return invalidPng();

    const chunkLength = buffer.readUInt32BE(cursor);
    if (
      chunkLength > PNG_MAX_CHUNK_LENGTH ||
      chunkLength > buffer.length - cursor - PNG_CHUNK_OVERHEAD
    ) {
      return invalidPng();
    }

    const typeStart = cursor + 4;
    const dataStart = cursor + 8;
    const dataEnd = dataStart + chunkLength;
    const crcStart = dataEnd;
    if (
      !isPngChunkTypeByte(buffer[typeStart]) ||
      !isPngChunkTypeByte(buffer[typeStart + 1]) ||
      !isPngChunkTypeByte(buffer[typeStart + 2]) ||
      !isPngChunkTypeByte(buffer[typeStart + 3]) ||
      // The reserved third chunk-type bit must be uppercase in PNG.
      (buffer[typeStart + 2] & 0x20) !== 0 ||
      crc32(buffer, typeStart, dataEnd) !== buffer.readUInt32BE(crcStart)
    ) {
      return invalidPng();
    }

    const chunkType = buffer.toString("ascii", typeStart, typeStart + 4);
    if (!sawIhdr) {
      if (chunkType !== "IHDR" || chunkLength !== 13) return invalidPng();
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      const validBitDepthAndColorType =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        (colorType === 4 && [8, 16].includes(bitDepth)) ||
        (colorType === 6 && [8, 16].includes(bitDepth));
      if (
        width === 0 ||
        height === 0 ||
        width > PNG_MAX_CHUNK_LENGTH ||
        height > PNG_MAX_CHUNK_LENGTH ||
        !validBitDepthAndColorType ||
        buffer[dataStart + 10] !== 0 ||
        buffer[dataStart + 11] !== 0 ||
        (buffer[dataStart + 12] !== 0 && buffer[dataStart + 12] !== 1)
      ) {
        return invalidPng();
      }
      sawIhdr = true;
    } else if (chunkType === "IHDR") {
      return invalidPng();
    }

    if (chunkType === "IDAT") sawIdat = true;
    if (chunkType === "IEND") {
      if (chunkLength !== 0) return invalidPng();
      sawIend = true;
      cursor = crcStart + 4;
      break;
    }
    cursor = crcStart + 4;
  }

  if (!sawIhdr || !sawIdat || !sawIend || cursor !== buffer.length) {
    return invalidPng();
  }

  return {
    width,
    height,
  };
}

/** Check the recorded provider permission without claiming independent title verification. */
export function verifyUiRefreshProvenance(provenance) {
  if (!isRecord(provenance)) {
    throw new Error("manifest provenance is missing");
  }
  for (const field of [
    "legalRightsHolderVerified",
    "providerAuthorityToLicenseVerified",
    "redistributionPermissionVerifiedIndependently",
    "requestIsRightsOrLicenseEvidence",
    "sha256IsPermissionEvidence",
  ]) {
    if (provenance[field] !== false) {
      throw new Error(`provenance.${field} must explicitly be false`);
    }
  }
  for (const field of [
    "publicDistributionRequiresWrittenRightsConfirmation",
    "commercialUseRequiresWrittenRightsConfirmation",
    "removeOriginalsAndDerivativesIfRightsRemainUnverified",
  ]) {
    if (field in provenance) {
      throw new Error(
        `provenance.${field} is superseded by provider permission`,
      );
    }
  }
  const permission = provenance.providerPermission;
  if (!isRecord(permission)) {
    throw new Error("provenance.providerPermission is missing");
  }
  const permissionFields = {
    grantedBy: "Project provider",
    grantedOn: "2026-11-07",
    scope: "six UI design-reference images and their derived images",
    publicDistribution: true,
    redistribution: true,
    commercialUse: "not-recorded",
    evidence:
      "https://github.com/AutoDevJapan/FourBrosMahjong/issues/1175#issuecomment-6701099933",
    terms: "CREDITS.md#提供元・公開条件",
    coversCodeMitLicense: false,
    transfersRights: false,
    impliesOfficialEndorsement: false,
  };
  if (
    Object.keys(permission).length !== Object.keys(permissionFields).length ||
    Object.keys(permission).some(
      (field) => !Object.hasOwn(permissionFields, field),
    )
  )
    throw new Error("provenance.providerPermission contains unknown fields");
  for (const [field, value] of Object.entries(permissionFields)) {
    if (permission[field] !== value) {
      throw new Error(`provenance.providerPermission.${field} is inconsistent`);
    }
  }
  if (
    provenance.license !==
    "Provider permission for public distribution and redistribution"
  ) {
    throw new Error("provenance.license must describe the provider permission");
  }
  for (const field of ["inclusionRequestRecord", "rightsNotice"]) {
    if (
      typeof provenance[field] !== "string" ||
      provenance[field].trim() === ""
    ) {
      throw new Error(`provenance.${field} must be documented`);
    }
  }
  const expectedNotice =
    "The project provider permitted public distribution and redistribution of these six images and their derived images on 2026-11-07. See CREDITS.md for the provider's terms. This permission is separate from the code's MIT License and does not establish independently verified ownership, a transfer of rights, or official endorsement by any person, programme, or trademark holder.";
  if (provenance.rightsNotice !== expectedNotice)
    throw new Error(
      "provenance.rightsNotice must match the recorded permission scope",
    );
}

export function verifyUiRefreshAssets(manifestPath = DEFAULT_MANIFEST) {
  const manifestStats = lstatSync(manifestPath);
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    throw new Error("manifest must be a non-symlink regular file");
  }
  const absoluteManifest = realpathSync(manifestPath);
  const manifestDirectory = dirname(absoluteManifest);
  const requestedOriginalsDirectory = resolve(manifestDirectory, "originals");
  const originalsDirectoryStats = lstatSync(requestedOriginalsDirectory);
  if (
    originalsDirectoryStats.isSymbolicLink() ||
    !originalsDirectoryStats.isDirectory()
  ) {
    throw new Error("originals/ must be a non-symlink directory");
  }
  const originalsDirectory = realpathSync(requestedOriginalsDirectory);
  const manifest = JSON.parse(readFileSync(absoluteManifest, "utf8"));

  if (!isRecord(manifest) || manifest.version !== 1) {
    throw new Error("manifest version must be 1");
  }
  verifyUiRefreshProvenance(manifest.provenance);
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

    ids.add(asset.id);
    files.add(asset.file);
    routes.add(asset.route);
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

  const expectedInventory = [...files].map((file) => basename(file)).sort();
  const actualInventory = readdirSync(originalsDirectory, {
    withFileTypes: true,
  });
  if (
    actualInventory.some(
      (entry) => entry.isSymbolicLink() || !entry.isFile(),
    ) ||
    JSON.stringify(actualInventory.map((entry) => entry.name).sort()) !==
      JSON.stringify(expectedInventory)
  ) {
    throw new Error(
      "originals/ inventory must exactly match the regular files in the manifest",
    );
  }

  let totalBytes = 0;
  for (const asset of manifest.assets) {
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

    totalBytes += buffer.length;
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
