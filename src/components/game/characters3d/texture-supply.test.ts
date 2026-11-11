import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bakeCharacterTextures } from "./bake-textures";
import { MODEL_PROFILES } from "./profiles";
import { readCharacterTextureSet } from "./texture-supply";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    link: vi.fn(actual.link),
  };
});

const ids = ["p0", "p1", "p2", "p3"] as const;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const fixtureParent = resolve(
  process.env.CHARACTER_SUPPLY_TEST_ROOT ?? tmpdir(),
);

async function fixture() {
  const root = join(fixtureParent, `fourbros-texture-${randomUUID()}`);
  const sources = join(root, "documents/assets/characters/originals");
  const textures = join(root, "src/components/game/characters3d/textures");
  await mkdir(sources, { recursive: true });
  await mkdir(textures, { recursive: true });
  for (const id of ids) {
    const name = MODEL_PROFILES[id].source;
    await writeFile(
      join(sources, name),
      await readFile(`documents/assets/characters/originals/${name}`),
    );
    await writeFile(
      join(textures, `${id}-reference.jpg`),
      await readFile(
        `src/components/game/characters3d/textures/${id}-reference.jpg`,
      ),
    );
  }
  await writeFile(
    join(textures, "provenance.json"),
    await readFile("src/components/game/characters3d/textures/provenance.json"),
  );
  return { root, sources, textures };
}

async function fingerprint(directory: string) {
  return Promise.all(
    (await readdir(directory))
      .sort()
      .map(async (name) => [name, hash(await readFile(join(directory, name)))]),
  );
}

describe("fixed character texture supply", () => {
  it("reads all four source/texture pairs without rewriting them", async () => {
    const f = await fixture(),
      before = await fingerprint(f.textures);
    const assets = await readCharacterTextureSet(f.root);
    expect([...assets.keys()]).toEqual(ids);
    for (const id of ids) {
      expect(hash(assets.get(id)!.source)).toBe(MODEL_PROFILES[id].sha256);
      expect(assets.get(id)!.texture).toEqual(
        await readFile(join(f.textures, `${id}-reference.jpg`)),
      );
    }
    expect(await fingerprint(f.textures)).toEqual(before);
  });

  it("rejects a later source mismatch without touching the tracked set", async () => {
    const f = await fixture(),
      before = await fingerprint(f.textures);
    await writeFile(
      join(f.sources, MODEL_PROFILES.p1.source),
      "changed source",
    );
    await expect(readCharacterTextureSet(f.root)).rejects.toThrow(
      "Reference changed: p1",
    );
    expect(await fingerprint(f.textures)).toEqual(before);
  });

  it("rejects changed texture bytes and incomplete provenance", async () => {
    const f = await fixture();
    const path = join(f.textures, "p3-reference.jpg"),
      original = await readFile(path);
    await writeFile(path, "changed texture");
    const before = await fingerprint(f.textures);
    await expect(readCharacterTextureSet(f.root)).rejects.toThrow(
      "Texture changed: p3",
    );
    expect(await fingerprint(f.textures)).toEqual(before);
    await writeFile(path, original);
    const manifest = JSON.parse(
      await readFile(join(f.textures, "provenance.json"), "utf8"),
    );
    await writeFile(
      join(f.textures, "provenance.json"),
      JSON.stringify(manifest.slice(0, 3)),
    );
    await expect(readCharacterTextureSet(f.root)).rejects.toThrow(
      "Expected four texture records",
    );
  });

  it("keeps existing source/output bytes when regeneration cannot complete", async () => {
    const f = await fixture(),
      output = join(f.root, "baked");
    const original = await fingerprint(f.textures);
    await writeFile(
      join(f.sources, MODEL_PROFILES.p1.source),
      "changed source",
    );
    await expect(bakeCharacterTextures(output, f.root)).rejects.toThrow(
      "Reference changed: p1",
    );
    expect(await fingerprint(f.textures)).toEqual(original);
    await expect(readdir(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves only an incomplete new output after a later write fails", async () => {
    const f = await fixture(),
      before = await fingerprint(f.textures),
      output = join(f.root, "interrupted");
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(writeFile).mockImplementation(async (...args) => {
      if (args[0] === join(output, "p1-reference.jpg"))
        throw Object.assign(new Error("fixture write failure"), {
          code: "EIO",
        });
      return actual.writeFile(...args);
    });
    try {
      await expect(bakeCharacterTextures(output, f.root)).rejects.toMatchObject(
        { code: "EIO" },
      );
    } finally {
      vi.mocked(writeFile).mockImplementation(actual.writeFile);
    }
    expect(await readdir(output)).toEqual(["p0-reference.jpg"]);
    await expect(
      readFile(join(output, "provenance.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fingerprint(f.textures)).toEqual(before);
  });

  it("never exposes a partial completion manifest after a short failed write", async () => {
    const f = await fixture(),
      before = await fingerprint(f.textures),
      output = join(f.root, "manifest-failure");
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(writeFile).mockImplementation(async (...args) => {
      if (String(args[0]).includes("provenance")) {
        await actual.writeFile(args[0], '[{"', { flag: "wx" });
        throw Object.assign(new Error("fixture partial manifest failure"), {
          code: "EIO",
        });
      }
      return actual.writeFile(...args);
    });
    try {
      await expect(bakeCharacterTextures(output, f.root)).rejects.toMatchObject(
        { code: "EIO" },
      );
    } finally {
      vi.mocked(writeFile).mockImplementation(actual.writeFile);
    }
    expect(
      (await readdir(output)).filter((name) => name.endsWith(".jpg")),
    ).toHaveLength(4);
    await expect(
      readFile(join(output, "provenance.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fingerprint(f.textures)).toEqual(before);
  });

  it("keeps the completed staging manifest private when atomic publication fails", async () => {
    const f = await fixture(),
      before = await fingerprint(f.textures),
      output = join(f.root, "publication-failure");
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error("fixture publication failure"), { code: "EIO" }),
    );
    try {
      await expect(bakeCharacterTextures(output, f.root)).rejects.toMatchObject(
        { code: "EIO" },
      );
    } finally {
      vi.mocked(link).mockImplementation(actual.link);
    }
    const completed = JSON.parse(
      await readFile(join(output, "provenance.complete.json"), "utf8"),
    );
    expect(completed.map((row: { id: string }) => row.id)).toEqual(ids);
    await expect(
      readFile(join(output, "provenance.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fingerprint(f.textures)).toEqual(before);
  });

  it("publishes four textures and their matching manifest only into a new output", async () => {
    const f = await fixture(),
      before = await fingerprint(f.textures),
      output = join(f.root, "baked");
    await bakeCharacterTextures(output, f.root);
    expect((await readdir(output)).sort()).toEqual([
      "p0-reference.jpg",
      "p1-reference.jpg",
      "p2-reference.jpg",
      "p3-reference.jpg",
      "provenance.complete.json",
      "provenance.json",
    ]);
    const manifest = JSON.parse(
      await readFile(join(output, "provenance.json"), "utf8"),
    );
    expect(manifest.map((row: { id: string }) => row.id)).toEqual(ids);
    for (const row of manifest) {
      const bytes = await readFile(join(output, `${row.id}-reference.jpg`));
      expect(hash(bytes)).toBe(row.sha256);
      expect(bytes.length).toBe(row.bytes);
    }
    expect(await fingerprint(f.textures)).toEqual(before);
    const baked = await fingerprint(output);
    await expect(bakeCharacterTextures(output, f.root)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await fingerprint(output)).toEqual(baked);
    expect(await fingerprint(f.textures)).toEqual(before);
  }, 30000);
});
