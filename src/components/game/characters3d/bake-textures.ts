/** Rebuild derived review maps; the four source images are never overwritten. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { headTextureRegions, MODEL_PROFILES } from "./profiles";

const require = createRequire(resolve("package.json"));
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
export async function bakeCharacterTextures() {
  const directory = resolve("src/components/game/characters3d/textures");
  await mkdir(directory, { recursive: true });
  const records = [];
  for (const id of ["p0", "p1", "p2", "p3"] as const) {
    const profile = MODEL_PROFILES[id],
      source = resolve("documents/assets/characters/originals", profile.source),
      bytes = await readFile(source);
    if (createHash("sha256").update(bytes).digest("hex") !== profile.sha256)
      throw new Error(`Reference changed: ${id}`);
    const { data, info } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const original = Buffer.from(data);
    // The source has foreground hands over the front jacket in p2/p3. Reuse
    // corresponding unobstructed cloth from the same person's back, explicitly
    // as candidate reconstruction rather than claiming a hidden original.
    const patch =
      id === "p2"
        ? { x: 22, y: 249, w: 70, h: 102 }
        : id === "p3"
          ? { x: 22, y: 297, w: 74, h: 90 }
          : null;
    if (patch)
      for (let y = patch.y; y < patch.y + patch.h; y++)
        for (let x = patch.x; x < patch.x + patch.w; x++) {
          const sy = Math.round(
              (id === "p2" ? 357 : 392) + ((y - patch.y) % 24),
            ),
            sx = Math.round(profile.photo.back - 48 + ((x - patch.x) % 22));
          const dst = (y * info.width + x) * info.channels,
            src = (sy * info.width + sx) * info.channels;
          const edge = Math.min(
            x - patch.x,
            patch.x + patch.w - 1 - x,
            y - patch.y,
            patch.y + patch.h - 1 - y,
          );
          const blend = Math.min(1, edge / 5);
          for (let c = 0; c < 3; c++)
            data[dst + c] = Math.round(
              original[dst + c] * (1 - blend) + original[src + c] * blend,
            );
        }
    // Flood from each view's border. Internal white eyes/teeth/sole are not
    // background. A stable neutral extension avoids row-wise striped edges.
    const centers = [
      profile.photo.front,
      profile.photo.right,
      profile.photo.back,
      profile.photo.left,
    ];
    for (const center of centers) {
      const lo = Math.max(0, Math.round(center - 105)),
        hi = Math.min(info.width - 1, Math.round(center + 105));
      const width = hi - lo + 1,
        height = 790,
        mask = new Uint8Array(width * height),
        queue: number[] = [];
      const push = (x: number, y: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const k = y * width + x;
        if (mask[k]) return;
        const i = ((y + 110) * info.width + x + lo) * info.channels;
        const rgb = [data[i], data[i + 1], data[i + 2]];
        if (Math.min(...rgb) < 120 || Math.max(...rgb) - Math.min(...rgb) > 34)
          return;
        mask[k] = 1;
        queue.push(k);
      };
      for (let y = 0; y < height; y++) {
        push(0, y);
        push(width - 1, y);
      }
      for (let x = 0; x < width; x++) {
        push(x, 0);
        push(x, height - 1);
      }
      for (let head = 0; head < queue.length; head++) {
        const k = queue[head],
          x = k % width,
          y = Math.floor(k / width);
        push(x - 1, y);
        push(x + 1, y);
        push(x, y - 1);
        push(x, y + 1);
      }
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (mask[y * width + x]) {
            const py = y + 110,
              i = (py * info.width + x + lo) * info.channels;
            const faceBottom =
              profile.photo.floor -
              ((profile.height - profile.headLength - 0.025) *
                (profile.photo.floor - profile.photo.top)) /
                profile.height;
            const color =
              py < profile.photo.top + 35
                ? profile.hairColor
                : py < faceBottom + 3
                  ? profile.skinColor
                  : [0.035, 0.038, 0.04];
            for (let c = 0; c < 3; c++)
              data[i + c] = Math.round(color[c] * 255);
          }
    }
    const destination = join(directory, `${id}-reference.jpg`);
    const processed = await sharp(data, { raw: info }).png().toBuffer();
    const sleeveTop = id === "p2" ? 235 : 240,
      sleeveHeight = id === "p2" ? 170 : id === "p3" ? 225 : 210;
    const rightPatch = await sharp(processed)
      .extract({
        left: id === "p2" ? 516 : 512,
        top: sleeveTop,
        width: 40,
        height: sleeveHeight,
      })
      .resize(224, 400)
      .png()
      .toBuffer();
    const leftPatch = await sharp(processed)
      .extract({ left: 1215, top: sleeveTop, width: 40, height: sleeveHeight })
      .resize(224, 400)
      .png()
      .toBuffer();
    const headPatches = [];
    for (const region of headTextureRegions(profile)) {
      const { data: head, info: headInfo } = await sharp(bytes)
        .extract(region.source)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let y = 0; y < headInfo.height; y++) {
        let first = -1,
          last = -1;
        for (let x = 0; x < headInfo.width; x++) {
          const k = (y * headInfo.width + x) * headInfo.channels,
            rgb = [head[k], head[k + 1], head[k + 2]];
          if (
            Math.min(...rgb) < 150 ||
            Math.max(...rgb) - Math.min(...rgb) > 20
          ) {
            if (first < 0) first = x;
            last = x;
          }
        }
        if (first < 0) continue;
        for (let x = 0; x < headInfo.width; x++)
          if (x < first || x > last) {
            const src =
                (y * headInfo.width + (x < first ? first : last)) *
                headInfo.channels,
              dst = (y * headInfo.width + x) * headInfo.channels;
            for (let c = 0; c < 3; c++) head[dst + c] = head[src + c];
          }
      }
      headPatches.push({
        input: await sharp(head, { raw: headInfo })
          .resize(region.atlas.width, region.atlas.height)
          .png()
          .toBuffer(),
        left: region.atlas.left,
        top: region.atlas.top,
      });
    }
    const result = await sharp({
      create: {
        width: 1536,
        height: 1536,
        channels: 3,
        background: { r: 9, g: 10, b: 11 },
      },
    })
      .composite([
        { input: processed, left: 0, top: 0 },
        { input: rightPatch, left: 0, top: 1024 },
        { input: leftPatch, left: 256, top: 1024 },
        ...headPatches,
      ])
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      .toBuffer();
    await writeFile(destination, result);
    records.push({
      id,
      source: profile.source,
      sourceSha256: profile.sha256,
      path: `src/components/game/characters3d/textures/${id}-reference.jpg`,
      sha256: createHash("sha256").update(result).digest("hex"),
      bytes: result.length,
      patch,
      atlas: {
        width: 1536,
        height: 1536,
        sourceRegion: { x: 0, y: 0, width: info.width, height: 1024 },
        sleeves: [
          {
            source: [id === "p2" ? 516 : 512, sleeveTop, 40, sleeveHeight],
            destination: [0, 1024, 224, 400],
          },
          {
            source: [1215, sleeveTop, 40, sleeveHeight],
            destination: [256, 1024, 224, 400],
          },
        ],
        heads: headTextureRegions(profile),
      },
      backgroundFill:
        "border flood; constant skin/hair/cloth extension; candidate extrapolation",
      encoder: sharp.versions.sharp,
    });
  }
  await writeFile(
    join(directory, "provenance.json"),
    JSON.stringify(records, null, 2).replace(
      /\[\s+([\d.,\s-]+)\s+\]/g,
      (_match, numbers: string) =>
        `[${numbers
          .trim()
          .split(/\s*,\s*/)
          .join(", ")}]`,
    ) + "\n",
  );
  return records;
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/bake-textures.ts"))
  void bakeCharacterTextures()
    .then((records) =>
      console.log(
        JSON.stringify(records.map((r) => ({ id: r.id, bytes: r.bytes }))),
      ),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
