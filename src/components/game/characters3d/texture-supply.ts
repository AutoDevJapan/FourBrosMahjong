/** Offline review inputs. Reading a candidate never regenerates its textures. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MODEL_PROFILES } from "./profiles";

export const CHARACTER_TEXTURE_IDS = ["p0", "p1", "p2", "p3"] as const;
type Id = (typeof CHARACTER_TEXTURE_IDS)[number];
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** Retain the verified bytes for the encoder and review consumers. */
export async function readCharacterSources(root = resolve(".")) {
  const sources = new Map<Id, Buffer>();
  for (const id of CHARACTER_TEXTURE_IDS) {
    const profile = MODEL_PROFILES[id];
    const bytes = await readFile(
      resolve(root, "documents/assets/characters/originals", profile.source),
    );
    if (hash(bytes) !== profile.sha256)
      throw new Error(`Reference changed: ${id}`);
    sources.set(id, bytes);
  }
  return sources;
}

export async function readCharacterTextureSet(root = resolve(".")) {
  const records: unknown = JSON.parse(
    await readFile(
      resolve(
        root,
        "src/components/game/characters3d/textures/provenance.json",
      ),
      "utf8",
    ),
  );
  if (
    !Array.isArray(records) ||
    records.length !== CHARACTER_TEXTURE_IDS.length
  )
    throw new Error("Expected four texture records");
  const sources = await readCharacterSources(root);
  const assets = new Map<
    Id,
    { readonly source: Buffer; readonly texture: Buffer }
  >();
  for (const [index, id] of CHARACTER_TEXTURE_IDS.entries()) {
    const record = records[index];
    const path = `src/components/game/characters3d/textures/${id}-reference.jpg`;
    const profile = MODEL_PROFILES[id];
    if (
      !record ||
      record.id !== id ||
      record.source !== profile.source ||
      record.sourceSha256 !== profile.sha256 ||
      record.path !== path ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256) ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes <= 0
    )
      throw new Error(`Invalid texture record: ${id}`);
    const texture = await readFile(resolve(root, path));
    if (texture.length !== record.bytes || hash(texture) !== record.sha256)
      throw new Error(`Texture changed: ${id}`);
    assets.set(id, { source: sources.get(id)!, texture });
  }
  return assets;
}
