/** Run: pnpm exec tsx src/components/game/characters3d/produce-review.ts */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { bakeCharacterTextures } from "./bake-textures";
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { exportCharacterGlb } from "./glb";
import { createCharacterModel } from "./model";
import { type ReviewCamera, renderCharacterReview } from "./review-render";
import type { CharacterClipId } from "./types";

const require = createRequire(resolve("package.json"));
// Reuse Next's installed image encoder. No package installation.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const output = resolve(process.env.CHARACTER_REVIEW_OUTPUT ?? "");
const label = (text: string, w: number, h = 32) =>
  Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f6f7f8"/><text x="12" y="23" font-size="16" font-family="sans-serif" fill="#18212c">${text}</text></svg>`,
  );
async function main() {
  if (!process.env.CHARACTER_REVIEW_OUTPUT)
    throw new Error("Set CHARACTER_REVIEW_OUTPUT to the artifact directory");
  await mkdir(output, { recursive: true });
  await bakeCharacterTextures();
  const manifest: Record<string, unknown> = {
    revision: 6,
    status: "unapproved-candidate",
    delivery: "offline-review-only",
    renderer: "source geometry / CPU raster comparison; not production WebGL",
    models: [],
  };
  const entries = manifest.models as unknown[];
  for (const id of ["p0", "p1", "p2", "p3"] as const) {
    const model = createCharacterModel(id),
      image = sharp(await readFile(model.source.path));
    await writeFile(
      join(output, `${id}.glb`),
      exportCharacterGlb(
        model,
        await readFile(model.materials.find((m) => m.texture)!.texture!),
      ),
    );
    const { data, info } = await sharp(
      await readFile(model.materials.find((m) => m.texture)!.texture!),
    )
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const texture = {
      data,
      width: info.width,
      height: info.height,
      channels: info.channels,
    };
    const h = model.height;
    const views: readonly [string, ReviewCamera][] = [
      [
        "front",
        { eye: [0, h / 2, 4], target: [0, h / 2, 0], height: h + 0.12 },
      ],
      ["side", { eye: [4, h / 2, 0], target: [0, h / 2, 0], height: h + 0.12 }],
      [
        "back",
        { eye: [0, h / 2, -4], target: [0, h / 2, 0], height: h + 0.12 },
      ],
    ];
    const composites: { input: Buffer; left: number; top: number }[] = [];
    const sourceColumns =
      id === "p0" ? [0, 420, 775] : id === "p1" ? [0, 420, 775] : [0, 420, 775];
    for (let j = 0; j < views.length; j++) {
      const [view, camera] = views[j];
      const png = await sharp(
        Buffer.from(
          renderCharacterReview(
            model,
            sampleCharacterPose(model, "standing-reference", 0),
            texture,
            330,
            780,
            camera,
          ),
        ),
        { raw: { width: 330, height: 780, channels: 4 } },
      )
        .png()
        .toBuffer();
      await writeFile(join(output, `${id}-${view}.png`), png);
      const crop = await image
        .clone()
        .extract({ left: sourceColumns[j], top: 110, width: 220, height: 775 })
        .resize(220, 780, { fit: "contain", background: "#ffffff" })
        .png()
        .toBuffer();
      composites.push(
        { input: crop, left: j * 550, top: 72 },
        { input: png, left: j * 550 + 220, top: 72 },
        {
          input: label(`${view}: source | model candidate`, 550),
          left: j * 550,
          top: 36,
        },
      );
    }
    composites.push({
      input: label(`${model.name} / ${id} — UNAPPROVED CANDIDATE`, 1650, 36),
      left: 0,
      top: 0,
    });
    await sharp({
      create: { width: 1650, height: 852, channels: 4, background: "#fff" },
    })
      .composite(composites)
      .png()
      .toFile(join(output, `${id}-comparison.png`));
    const motion: { input: Buffer; left: number; top: number }[] = [];
    const ids: readonly CharacterClipId[] = [
      "seated-idle",
      "bench-idle",
      "declare",
      "call",
      "kita",
      "win-tsumo",
      "win-ron",
    ];
    for (let j = 0; j < ids.length; j++) {
      const clip = ids[j];
      const pose = sampleCharacterPose(
        model,
        clip,
        CHARACTER_CLIPS[clip].duration * 0.4,
      );
      const camera: ReviewCamera = {
        eye: [2.6, 2.3, 4.8],
        target: [0, 0.76, 0.13],
        height: 1.9,
      };
      const png = await sharp(
        Buffer.from(
          renderCharacterReview(model, pose, texture, 300, 410, camera),
        ),
        { raw: { width: 300, height: 410, channels: 4 } },
      )
        .png()
        .toBuffer();
      motion.push(
        { input: label(clip, 300), left: j * 300, top: 36 },
        { input: png, left: j * 300, top: 68 },
      );
    }
    motion.push({
      input: label(
        `${model.name} / ${id} — identical source mesh, sampled clips (CPU raster)`,
        2100,
        36,
      ),
      left: 0,
      top: 0,
    });
    await sharp({
      create: { width: 2100, height: 478, channels: 4, background: "#fff" },
    })
      .composite(motion)
      .png()
      .toFile(join(output, `${id}-clips.png`));
    entries.push({
      id,
      name: model.name,
      source: model.source,
      bounds: model.bounds,
      height: model.height,
      bones: model.bones.map((b) => ({
        name: b.name,
        parent: b.parent,
        pivot: b.pivot,
      })),
      skeletonId: model.skeletonId,
      triangles: model.meshes.reduce(
        (sum, m) => sum + m.vertices.length / 24,
        0,
      ),
      meshBytes: model.meshes.reduce(
        (sum, m) =>
          sum +
          m.vertices.byteLength +
          m.joints.byteLength +
          m.weights.byteLength,
        0,
      ),
      materials: model.materials,
      clips: CHARACTER_CLIPS,
      maximumSkinInfluences: 4,
      actualMaximumSkinInfluences: 4,
      texture: {
        width: info.width,
        height: info.height,
        channels: info.channels,
      },
    });
  }
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const root = resolve(".");
  const collect = async (directory: string): Promise<string[]> => {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await collect(file)));
      else files.push(file);
    }
    return files;
  };
  const files = [
    ...(await collect(resolve("src/components/game/characters3d"))),
    resolve("documents/guides/3d-characters.md"),
    resolve("documents/guides/3d-characters-tsconfig.json"),
  ].sort();
  const hashes = [];
  for (const f of files) {
    const bytes = await readFile(f);
    hashes.push({
      path: relative(root, f).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(
    join(output, "source-hashes.json"),
    JSON.stringify(hashes, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ output, models: entries.length, status: manifest.status }),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
