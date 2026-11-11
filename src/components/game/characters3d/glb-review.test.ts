import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CharacterPlayerId } from "@/domain/game/characters";
import { exportCharacterGlb } from "./glb";
import { readCharacterGlb } from "./glb-review";
import { createCharacterModel } from "./model";
import { projectCharacterGeometry } from "./project";

const ids = ["p0", "p1", "p2", "p3"] as const;
interface FixtureJson {
  extras: { playerId: string; source: { sha256: string } };
  images: { uri?: string }[];
  bufferViews: { byteLength: number; byteOffset: number }[];
  nodes: { children?: number[] }[];
  skins: { joints: number[] }[];
  accessors: {
    type: "SCALAR" | "VEC3" | "VEC4";
    count: number;
    bufferView: number;
  }[];
  animations: {
    name: string;
    extras: { loop: boolean | string };
    samplers: { input: number; output: number; interpolation: string }[];
    channels: { sampler: number; target: { node: number; path: string } }[];
  }[];
}
function fixture(id: CharacterPlayerId = "p2") {
  const model = createCharacterModel(id);
  const texture = readFileSync(
    model.materials.find((m) => m.texture)!.texture!,
  );
  return { model, texture, bytes: exportCharacterGlb(model, texture) };
}
function changeJson(bytes: Uint8Array, change: (json: FixtureJson) => void) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    length = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  );
  change(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json)),
    aligned = Math.ceil(encoded.length / 4) * 4;
  const bin = bytes.subarray(20 + length),
    result = new Uint8Array(20 + aligned + bin.length);
  result.set(bytes.subarray(0, 20));
  result.fill(32, 20, 20 + aligned);
  result.set(encoded, 20);
  result.set(bin, 20 + aligned);
  const header = new DataView(result.buffer);
  header.setUint32(8, result.length, true);
  header.setUint32(12, aligned, true);
  return result;
}
function delta(
  a: readonly { vertices: Float32Array }[],
  b: readonly { vertices: Float32Array }[],
) {
  let max = 0;
  for (let m = 0; m < a.length; m++)
    for (let i = 0; i < a[m].vertices.length; i++)
      max = Math.max(max, Math.abs(a[m].vertices[i] - b[m].vertices[i]));
  return max;
}

describe("exported character file consumer", () => {
  it.each(ids)(
    "%s reimports a vertex edit without changing actor, texture, rig or materials",
    (id) => {
      const { model, texture } = fixture(id);
      const meshes = model.meshes.map((mesh, i) => {
        const vertices = Float32Array.from(mesh.vertices);
        if (i === 0) vertices[0] += 0.003;
        return { ...mesh, vertices };
      });
      const bytes = exportCharacterGlb({ ...model, meshes }, texture);
      const loaded = readCharacterGlb(bytes, id);
      expect(loaded.model.id).toBe(id);
      expect(loaded.model.name).toBe(model.name);
      expect(loaded.model.bones.map((b) => b.name)).toEqual(
        model.bones.map((b) => b.name),
      );
      expect(loaded.texture).toEqual(Uint8Array.from(texture));
      for (const [i, mesh] of meshes.entries()) {
        expect(loaded.model.meshes[i].vertices).toEqual(mesh.vertices);
        expect(loaded.model.meshes[i].weights).toEqual(mesh.weights);
        expect(loaded.model.meshes[i].materialId).toBe(mesh.materialId);
      }
      expect(loaded.clips).toHaveLength(13);
      expect(loaded.sample("kita", 0.4).rotations).not.toEqual(
        loaded.sample("kita", 0).rotations,
      );
      expect(loaded.sample("kita", 30).finished).toBe(true);
      expect(loaded.sample("kita", 0.4, true).rotations).toEqual(
        loaded.sample("seated-idle", 0).rotations,
      );
      const before = projectCharacterGeometry(
        loaded.model,
        loaded.sample("kita", 0),
      );
      const after = projectCharacterGeometry(
        loaded.model,
        loaded.sample("kita", 0.4),
      );
      expect(delta(before, after)).toBeGreaterThan(0.02);
      const validated = loaded.sample("kita", 0.4);
      bytes.fill(0);
      expect(loaded.sample("kita", 0.4)).toEqual(validated);
    },
  );

  it("takes clip values from the imported binary rather than source curves", () => {
    const { bytes } = fixture();
    const original = readCharacterGlb(bytes, "p2");
    const frozen = changeJson(bytes, (json) => {
      const clip = json.animations.find((a) => a.name === "kita")!;
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      const bin = 28 + view.getUint32(12, true);
      for (const sampler of clip.samplers) {
        const output = json.accessors[sampler.output],
          width = { VEC4: 4, VEC3: 3, SCALAR: 1 }[
            output.type as "VEC4" | "VEC3" | "SCALAR"
          ];
        const start = bin + json.bufferViews[output.bufferView].byteOffset;
        for (let frame = 1; frame < output.count; frame++)
          for (let k = 0; k < width; k++)
            view.setFloat32(
              start + (frame * width + k) * 4,
              view.getFloat32(start + k * 4, true),
              true,
            );
      }
    });
    const loaded = readCharacterGlb(frozen, "p2");
    expect(original.sample("kita", 0.4).rotations).not.toEqual(
      loaded.sample("kita", 0.4).rotations,
    );
    expect(loaded.sample("kita", 0.4).rotations).toEqual(
      loaded.sample("kita", 0).rotations,
    );
  });

  it.each(ids)(
    "%s accepts a re-exported rest-pivot edit with its matching inverse bind",
    (id) => {
      const { model, texture } = fixture(id);
      const bones = model.bones.map((bone) => {
        if (bone.name !== "forearm.L") return bone;
        const pivot = [
          bone.pivot[0] + 0.001,
          bone.pivot[1],
          bone.pivot[2],
        ] as const;
        const inverseBind = Float32Array.from(bone.inverseBind);
        inverseBind[12] = -pivot[0];
        return { ...bone, pivot, inverseBind };
      });
      const edited = { ...model, bones };
      const loaded = readCharacterGlb(exportCharacterGlb(edited, texture), id);
      const importedBone = loaded.model.bones.find(
        (b) => b.name === "forearm.L",
      )!;
      expect(importedBone.pivot[0]).toBeCloseTo(
        bones.find((b) => b.name === "forearm.L")!.pivot[0],
        6,
      );
      expect(importedBone.pivot[0]).not.toBeCloseTo(
        model.bones.find((b) => b.name === "forearm.L")!.pivot[0],
        4,
      );
      expect(importedBone.inverseBind[12]).toBeCloseTo(
        -importedBone.pivot[0],
        6,
      );
      const pose = loaded.sample("kita", 0.417);
      expect(
        delta(
          projectCharacterGeometry(edited, pose),
          projectCharacterGeometry(loaded.model, pose),
        ),
      ).toBeLessThan(2e-5);
    },
  );

  it.each([
    [
      "wrong source hash",
      (j: FixtureJson) => {
        j.extras.source.sha256 = "a".repeat(64);
      },
    ],
    [
      "wrong joint count",
      (j: FixtureJson) => {
        j.skins[0].joints.pop();
      },
    ],
    [
      "duplicate clip",
      (j: FixtureJson) => {
        j.animations[1].name = j.animations[0].name;
      },
    ],
    [
      "nonboolean loop",
      (j: FixtureJson) => {
        j.animations[0].extras.loop = "true";
      },
    ],
    [
      "foreign actor",
      (j: FixtureJson) => {
        j.extras.playerId = "p0";
      },
    ],
    [
      "external image",
      (j: FixtureJson) => {
        j.images[0].uri = "https://example.test/image.jpg";
      },
    ],
    [
      "out of range view",
      (j: FixtureJson) => {
        j.bufferViews[0].byteLength = 100000000;
      },
    ],
    [
      "cycle",
      (j: FixtureJson) => {
        j.nodes[1].children = [0];
      },
    ],
    [
      "unsupported interpolation",
      (j: FixtureJson) => {
        j.animations[0].samplers[0].interpolation = "CUBICSPLINE";
      },
    ],
    [
      "missing clip",
      (j: FixtureJson) => {
        j.animations.pop();
      },
    ],
    [
      "repeated channel",
      (j: FixtureJson) => {
        j.animations[0].channels[1] = j.animations[0].channels[0];
      },
    ],
  ] as const)("rejects %s before drawing", (_label, change) => {
    const { bytes } = fixture();
    expect(() => readCharacterGlb(changeJson(bytes, change), "p2")).toThrow();
  });
  it("rejects invalid binary and clocks", () => {
    const { bytes } = fixture();
    expect(() =>
      readCharacterGlb(bytes.subarray(0, bytes.length - 1), "p2"),
    ).toThrow();
    const loaded = readCharacterGlb(bytes, "p2");
    expect(() => loaded.sample("kita", NaN)).toThrow();
    expect(() => loaded.sample("kita", -1)).toThrow();
  });
  it("rejects finite inverse-bind matrices that do not invert the exported rest pivots", () => {
    const { bytes } = fixture();
    const header = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    const length = header.getUint32(12, true);
    const json = JSON.parse(
      new TextDecoder().decode(bytes.subarray(20, 20 + length)),
    );
    const a = json.accessors[json.skins[0].inverseBindMatrices];
    const start = 28 + length + json.bufferViews[a.bufferView].byteOffset;
    for (let bone = 0; bone < 19; bone++)
      header.setFloat32(start + (bone * 16 + 5) * 4, 3e38, true);
    expect(() => readCharacterGlb(bytes, "p2")).toThrow(
      "Unsupported character GLB",
    );
  });
  it.each(["POSITION", "NORMAL"] as const)(
    "rejects huge finite morph %s before sampling",
    (semantic) => {
      const { bytes } = fixture();
      const header = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ),
        length = header.getUint32(12, true);
      const json = JSON.parse(
          new TextDecoder().decode(bytes.subarray(20, 20 + length)),
        ),
        bin = 28 + length;
      const primitive = json.meshes[0].primitives.find(
        (p: { targets: { POSITION: number; NORMAL: number }[] }) =>
          json.accessors[p.targets[0][semantic]].bufferView !== undefined,
      );
      const a = json.accessors[primitive.targets[0][semantic]],
        start = bin + json.bufferViews[a.bufferView].byteOffset;
      for (let i = 0; i < a.count * 3; i++)
        header.setFloat32(start + i * 4, 3e38, true);
      for (const clip of json.animations)
        for (const channel of clip.channels) {
          if (channel.target.path !== "weights") continue;
          const w = json.accessors[clip.samplers[channel.sampler].output],
            offset = bin + json.bufferViews[w.bufferView].byteOffset;
          for (let i = 0; i < w.count; i++)
            header.setFloat32(offset + i * 4, 1, true);
        }
      expect(() => readCharacterGlb(bytes, "p2")).toThrow(
        "Unsupported character GLB",
      );
    },
  );
  it("accepts a modest authored morph edit and finite intermediate poses", () => {
    const { model, texture } = fixture();
    const meshes = model.meshes.map((mesh) => {
      if (!mesh.handClosure) return mesh;
      const positions = Float32Array.from(mesh.handClosure.positions);
      positions[0] += 0.001;
      return { ...mesh, handClosure: { ...mesh.handClosure, positions } };
    });
    const imported = readCharacterGlb(
      exportCharacterGlb({ ...model, meshes }, texture),
      "p2",
    );
    for (const seconds of [0, 0.137, 0.417, 0.8, 1.25]) {
      const pose = imported.sample("kita", seconds);
      const actual = projectCharacterGeometry(imported.model, pose);
      const expected = projectCharacterGeometry({ ...model, meshes }, pose);
      expect(actual.every((m) => m.vertices.every(Number.isFinite))).toBe(true);
      expect(delta(actual, expected)).toBeLessThan(2e-5);
    }
    expect(
      imported.model.meshes.find(
        (m) =>
          m.handClosure?.positions[0] ===
          meshes.find((m) => m.handClosure)!.handClosure!.positions[0],
      ),
    ).toBeDefined();
  });
  it.each(ids)(
    "%s keeps the exported bench posture with reduced motion",
    (id) => {
      const { bytes } = fixture(id),
        loaded = readCharacterGlb(bytes, id);
      const bench = loaded.sample("bench-idle", 0);
      expect(loaded.sample("bench-idle", 2, true).rotations).toEqual(
        bench.rotations,
      );
      expect(loaded.sample("bench-idle", 2, true).rootOffset).toEqual(
        bench.rootOffset,
      );
      expect(bench.rotations["upperArm.L"]).not.toEqual(
        loaded.sample("seated-idle", 0).rotations["upperArm.L"],
      );
    },
  );
});
