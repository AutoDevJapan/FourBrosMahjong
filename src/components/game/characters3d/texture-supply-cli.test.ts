import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MODEL_PROFILES } from "./profiles";

const ownedRoots = new Set<string>();
afterEach(async () => {
  for (const root of ownedRoots) {
    await rm(root, { recursive: true, force: true });
    ownedRoots.delete(root);
  }
});

describe("ordinary character review does not bake", () => {
  it.each(["produce-review.ts", "serve-review.ts"])(
    "%s preserves a modified fixed image and rejects it",
    async (entry) => {
      const root = join(
        resolve(process.env.CHARACTER_SUPPLY_TEST_ROOT ?? tmpdir()),
        `fourbros-review-cli-${randomUUID()}`,
      );
      ownedRoots.add(root);
      const sources = join(root, "documents/assets/characters/originals"),
        textures = join(root, "src/components/game/characters3d/textures");
      await mkdir(sources, { recursive: true });
      await mkdir(textures, { recursive: true });
      const names = [];
      for (const id of ["p0", "p1", "p2", "p3"] as const) {
        const source = MODEL_PROFILES[id].source;
        await writeFile(
          join(sources, source),
          await readFile(`documents/assets/characters/originals/${source}`),
        );
        const name = `${id}-reference.jpg`;
        names.push(name);
        await writeFile(
          join(textures, name),
          await readFile(`src/components/game/characters3d/textures/${name}`),
        );
      }
      names.push("provenance.json");
      await writeFile(
        join(textures, "provenance.json"),
        await readFile(
          "src/components/game/characters3d/textures/provenance.json",
        ),
      );
      await writeFile(
        join(textures, "p0-reference.jpg"),
        "changed fixture image",
      );
      const before = await Promise.all(
        names.map((name) => readFile(join(textures, name))),
      );
      const require = createRequire(import.meta.url);
      const cli = resolve(
        require.resolve("tsx/package.json"),
        "../dist/cli.mjs",
      );
      const run = spawnSync(
        process.execPath,
        [
          cli,
          "--tsconfig",
          resolve("tsconfig.json"),
          resolve("src/components/game/characters3d", entry),
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            CHARACTER_REVIEW_OUTPUT: join(root, "review"),
          },
          encoding: "utf8",
          timeout: 15000,
          windowsHide: true,
        },
      );
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("Texture changed: p0");
      expect(
        await Promise.all(names.map((name) => readFile(join(textures, name)))),
      ).toEqual(before);
      await expect(readdir(join(root, "review"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});
