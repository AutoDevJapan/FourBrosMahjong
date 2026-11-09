import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { type CharacterCue, createCharacterController } from "./controller";
import { exportCharacterGlb, quaternionConventionCheck } from "./glb";
import { createCharacterModel } from "./model";
import { projectCharacterGeometry } from "./project";
import { socketPosition } from "./rig";
import { type CharacterModel, CLIP_IDS } from "./types";

// Literal independent identity oracle, not copied from the geometry profiles.
const EXPECTED = [
  [
    "p0",
    "粗悪品",
    "red",
    1.8,
    "ef6c81eb0ce02dbc5227d3320f61c760527214eea1ecd8e7e42cd88dbb4aebbf",
  ],
  [
    "p1",
    "竜二",
    "blue",
    1.75,
    "5a02f954603f5b211fd8f670e2f8e503bccc3a8d7a926be58ed46015514101bf",
  ],
  [
    "p2",
    "マサキ",
    "yellow",
    1.75,
    "ce218809a3ec175d875228e807332a2190d82f3b76cf81e744a2073759b05b0c",
  ],
  [
    "p3",
    "糸瓜",
    "green",
    1.75,
    "bcdad1e1faf55e6aab426d7b372e947d13d45c30de887f6d7956eaa6dd78aca5",
  ],
] as const;
const models = EXPECTED.map(([id]) => createCharacterModel(id));
function frame(
  revision = 0,
  mode: "live" | "restore" = "live",
  generation = 1,
  bench = "p3",
): DisplayEnvelope {
  return {
    sessionId: "game-a",
    generation,
    revision,
    mode,
    snapshot: {
      slots: ["p0", "p1", "p2", "p3"].map((playerId, i) => ({
        playerId,
        name: `renamed-${i}`,
        position: ["self", "left", "across", "right"][i],
        kind: playerId === bench ? "bench" : "seated",
      })),
    },
  } as DisplayEnvelope;
}
const cue = (
  revision = 1,
  extra: Partial<CharacterCue> = {},
): CharacterCue => ({
  id: "a",
  actorId: "p1",
  kind: "riichi",
  sessionId: "game-a",
  generation: 1,
  revision,
  roundKey: "round-1",
  ...extra,
});

describe("source-bound four-character candidates", () => {
  it.each(EXPECTED)(
    "%s preserves literal identity, source and metric scale",
    (id, name, _color, height, sha) => {
      const model = models.find((m) => m.id === id)!;
      expect(model.name).toBe(name);
      expect(model.height).toBe(height);
      expect(model.source.sha256).toBe(sha);
      expect(
        createHash("sha256")
          .update(readFileSync(model.source.path))
          .digest("hex"),
      ).toBe(sha);
      expect(model.bounds.min[1]).toBeCloseTo(0, 6);
      expect(model.bounds.max[1]).toBeGreaterThan(height - 0.035);
      expect(model.bounds.max[1]).toBeLessThan(height + 0.025);
      expect(model.name.includes("(")).toBe(false);
      expect(model.status).toBe("unapproved-candidate");
    },
  );
  it("contains four different position/normal meshes independently of UV/color", () => {
    const hashes = models.map((m) => {
      const h = createHash("sha256");
      for (const mesh of m.meshes)
        for (let i = 0; i < mesh.vertices.length; i += 8)
          h.update(new Uint8Array(mesh.vertices.slice(i, i + 6).buffer));
      return h.digest("hex");
    });
    expect(new Set(hashes).size).toBe(4);
    expect(models[2].bounds.max[0] - models[2].bounds.min[0]).toBeGreaterThan(
      models[0].bounds.max[0] - models[0].bounds.min[0],
    );
  });
  it.each(models)(
    "$id has finite triangles, UVs, normals and normalized valid skin",
    (model) => {
      let count = 0;
      for (const mesh of model.meshes) {
        expect(mesh.vertices.length % 24).toBe(0);
        count += mesh.vertices.length / 24;
        expect(mesh.joints.length).toBe(mesh.vertices.length / 2);
        expect(mesh.weights.length).toBe(mesh.joints.length);
        for (let i = 0; i < mesh.vertices.length / 8; i++) {
          const v = mesh.vertices.subarray(i * 8, i * 8 + 8);
          expect([...v].every(Number.isFinite)).toBe(true);
          expect(Math.hypot(v[3], v[4], v[5])).toBeCloseTo(1, 4);
          expect(v[6]).toBeGreaterThanOrEqual(0);
          expect(v[6]).toBeLessThanOrEqual(1);
          expect(v[7]).toBeGreaterThanOrEqual(0);
          expect(v[7]).toBeLessThanOrEqual(1);
          const weights = mesh.weights.subarray(i * 4, i * 4 + 4);
          expect([...weights].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
          expect([...weights].every((w) => w >= 0 && w <= 1)).toBe(true);
          expect(
            [...mesh.joints.subarray(i * 4, i * 4 + 4)].every(
              (j) => j < model.bones.length,
            ),
          ).toBe(true);
        }
      }
      expect(count).toBeGreaterThan(3000);
      expect(count).toBeLessThanOrEqual(12000);
      expect(model.bones).toHaveLength(19);
      expect(new Set(model.bones.map((b) => b.name)).size).toBe(19);
      expect(model.bones.every((b, i) => b.parent < i)).toBe(true);
    },
  );
  it.each(models)(
    "$id bind pose reproduces authored positions and UVs",
    (model) => {
      const posed = projectCharacterGeometry(
        model,
        sampleCharacterPose(model, "standing-reference", 0),
      );
      let error = 0;
      for (let m = 0; m < posed.length; m++)
        for (let i = 0; i < posed[m].vertices.length; i++)
          error = Math.max(
            error,
            Math.abs(posed[m].vertices[i] - model.meshes[m].vertices[i]),
          );
      expect(error).toBeLessThan(5e-7);
    },
  );
});

describe("rig and clips", () => {
  it.each(models)(
    "$id loops and one-shots keep foot contacts and return to idle",
    (model) => {
      const rest = sampleCharacterPose(model, "seated-idle", 0);
      for (const id of CLIP_IDS.filter((id) => id !== "standing-reference")) {
        const spec = CHARACTER_CLIPS[id];
        for (const t of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
          const pose = sampleCharacterPose(model, id, spec.duration * t);
          for (const foot of ["left-foot", "right-foot"]) {
            const p = socketPosition(model, pose, foot);
            expect(Math.abs(p[1]), `${id} ${foot} ground`).toBeLessThan(0.006);
            expect(p.every(Number.isFinite)).toBe(true);
          }
        }
        if (spec.loop) {
          expect(sampleCharacterPose(model, id, 0)).toEqual(
            sampleCharacterPose(model, id, spec.duration),
          );
        } else {
          const end = sampleCharacterPose(model, id, spec.duration);
          expect(end.finished).toBe(true);
          expect(end.rotations).toEqual(rest.rotations);
          expect(
            sampleCharacterPose(model, id, spec.duration * 0.4).rotations,
          ).not.toEqual(rest.rotations);
          expect(
            sampleCharacterPose(model, id, spec.duration * 0.4, true).rotations,
          ).toEqual(rest.rotations);
        }
      }
    },
  );
  it.each(models)(
    "$id deforms real geometry through every reaction",
    (model) => {
      for (const id of [
        "declare",
        "call",
        "kita",
        "win-tsumo",
        "win-ron",
      ] as const) {
        const a = projectCharacterGeometry(
            model,
            sampleCharacterPose(model, id, 0),
          ),
          b = projectCharacterGeometry(
            model,
            sampleCharacterPose(model, id, CHARACTER_CLIPS[id].duration * 0.4),
          );
        let changed = 0;
        for (let m = 0; m < a.length; m++)
          for (let i = 0; i < a[m].vertices.length; i += 8)
            if (
              Math.hypot(
                ...[0, 1, 2].map(
                  (k) => a[m].vertices[i + k] - b[m].vertices[i + k],
                ),
              ) > 0.002
            )
              changed++;
        expect(changed, `${id} real skin deformation`).toBeGreaterThan(100);
        expect(
          b.every((mesh) => [...mesh.vertices].every(Number.isFinite)),
        ).toBe(true);
      }
    },
  );
  it("rejects invalid clock and unknown model instead of emitting NaNs", () => {
    expect(() => sampleCharacterPose(models[0], "declare", NaN)).toThrow();
    expect(() => sampleCharacterPose(models[0], "declare", -1)).toThrow();
    expect(() => createCharacterModel("p9" as CharacterModel["id"])).toThrow();
  });
});

describe("committed cue controller", () => {
  it("suppresses cues on an initial live frame and on a later restore", () => {
    const c = createCharacterController();
    c.publish(frame(1), [cue(1, { id: "initial-live" })], "round-1", 0);
    expect(c.sample(0.1).every((a) => a.pose.clipId.endsWith("idle"))).toBe(
      true,
    );
    c.publish(frame(2), [cue(2, { id: "current" })], "round-1", 1);
    expect(c.sample(1.1).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "declare",
    );
    c.publish(
      frame(3, "restore"),
      [cue(3, { id: "restored" })],
      "round-1",
      1.2,
    );
    expect(c.sample(1.2).every((a) => a.pose.clipId.endsWith("idle"))).toBe(
      true,
    );
  });
  it("samples every item of a twelve-cue actor queue in its supplied order", () => {
    const c = createCharacterController();
    c.publish(frame(), [], "round-1", 0);
    const kinds = [
      "draw",
      "discard",
      "kita",
      "riichi",
      "draw",
      "discard",
      "kita",
      "riichi",
      "draw",
      "discard",
      "kita",
      "riichi",
    ] as const;
    const oracle = {
      draw: { clip: "draw", duration: 0.9 },
      discard: { clip: "discard", duration: 0.85 },
      kita: { clip: "kita", duration: 1.25 },
      riichi: { clip: "declare", duration: 1.35 },
    } as const;
    c.publish(
      frame(1),
      kinds.map((kind, i) => cue(1, { id: `ordered-${i}`, kind })),
      "round-1",
      1,
    );
    const rate = kinds.reduce((sum, k) => sum + oracle[k].duration, 0) / 4;
    let at = 1;
    for (const kind of kinds) {
      const entry = oracle[kind];
      expect(
        c.sample(at + 0.01).find((a) => a.playerId === "p1")?.pose.clipId,
      ).toBe(entry.clip);
      at += entry.duration / rate;
    }
    expect(c.sample(5.01).every((a) => a.pose.clipId.endsWith("idle"))).toBe(
      true,
    );
  });
  it("suppresses first/restore/history/repeated revisions and never uses display names", () => {
    const c = createCharacterController();
    c.publish(frame(0, "restore"), [cue(0, { id: "history" })], "round-1", 0);
    expect(c.sample(0).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "seated-idle",
    );
    c.publish(frame(1), [cue(), cue()], "round-1", 1);
    expect(c.sample(1.4).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "declare",
    );
    expect(c.publish(frame(1), [cue()], "round-1", 2)).toBe("unchanged");
    expect(c.sample(3).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "seated-idle",
    );
    c.publish(frame(2), [cue(1), cue(2)], "round-1", 4);
    expect(c.sample(4).every((a) => a.pose.clipId !== "declare")).toBe(true);
    expect(c.publish(frame(1), [cue()], "round-1", 5)).toBe("stale");
    c.dispose();
    c.dispose();
    expect(c.sample(6)).toEqual([]);
    expect(c.publish(frame(3), [], "round-1", 6)).toBe("closed");
  });
  it("resets on rounds, generations, restore and bench changes", () => {
    const c = createCharacterController();
    c.publish(frame(), [], "round-1", 0);
    c.publish(frame(1), [cue()], "round-1", 1);
    c.publish(
      frame(2),
      [cue(2, { id: "deal-2", kind: "deal", roundKey: "round-2" })],
      "round-2",
      1.1,
    );
    expect(c.sample(1.1).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "deal",
    );
    c.publish(
      frame(3, "live", 1, "p1"),
      [cue(3, { roundKey: "round-2" })],
      "round-2",
      1.2,
    );
    expect(c.sample(1.2).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "bench-idle",
    );
    c.publish(
      frame(0, "restore", 2),
      [cue(0, { generation: 2 })],
      "round-1",
      2,
    );
    expect(c.sample(2).every((a) => a.pose.clipId !== "declare")).toBe(true);
    expect(c.publish(frame(4, "live", 1), [], "round-1", 3)).toBe("stale");
  });
  it("preserves each actor's ordered CPU cues and converges on the next commit", () => {
    const c = createCharacterController();
    c.publish(frame(0, "restore"), [], "round-1", 0);
    c.publish(
      frame(1),
      [
        cue(1, { id: "draw-1", kind: "draw" }),
        cue(1, { id: "discard-1", kind: "discard" }),
        cue(1, { id: "kita-1", kind: "kita" }),
      ],
      "round-1",
      1,
    );
    expect(c.sample(1.1).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "draw",
    );
    expect(c.sample(1.95).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "discard",
    );
    expect(c.sample(2.8).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "kita",
    );
    c.publish(
      frame(2),
      [cue(2, { id: "win-2", kind: "tsumo" })],
      "round-1",
      2.9,
    );
    expect(c.sample(3).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "win-tsumo",
    );
    c.publish(frame(3), [], "round-1", 3.1);
    expect(c.sample(3.1).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "seated-idle",
    );
  });
  it("bounds CPU history in time and skips incomplete overflow batches", () => {
    const c = createCharacterController();
    c.publish(frame(), [], "round-1", 0);
    c.publish(
      frame(1),
      Array.from({ length: 40 }, (_, i) =>
        cue(1, { id: `cpu-${i}`, kind: i % 2 ? "discard" : "draw" }),
      ),
      "round-1",
      1,
    );
    expect(c.sample(1.02).find((a) => a.playerId === "p1")?.pose.clipId).toBe(
      "draw",
    );
    expect(c.sample(5.01).every((a) => a.pose.clipId.endsWith("idle"))).toBe(
      true,
    );
    c.publish(
      { ...frame(2), cueStatus: { overflow: true, dropped: 1 } },
      [cue(2, { id: "incomplete" })],
      "round-1",
      6,
    );
    expect(c.sample(6).every((a) => a.pose.clipId.endsWith("idle"))).toBe(true);
  });
  it("routes all reactions for each actor ID after seating rotations", () => {
    for (const id of ["p0", "p1", "p2", "p3"] as const)
      for (const kind of [
        "riichi",
        "pon",
        "kan",
        "kita",
        "tsumo",
        "ron",
      ] as const) {
        const c = createCharacterController(),
          bench = id === "p3" ? "p0" : "p3";
        c.publish(frame(0, "restore", 1, bench), [], "round-1", 0);
        c.publish(
          frame(1, "live", 1, bench),
          [cue(1, { actorId: id, kind })],
          "round-1",
          1,
        );
        const a = c.sample(1.1);
        expect(
          a
            .filter((v) => !v.pose.clipId.endsWith("idle"))
            .map((v) => v.playerId),
        ).toEqual([id]);
        expect(c.sample(5).every((v) => v.pose.clipId.endsWith("idle"))).toBe(
          true,
        );
        c.dispose();
      }
  });
});

describe("portable model supply", () => {
  it("quaternion export matches source Euler order including combined axes", () => {
    for (const angles of [
      [0.3, -0.4, 0.8],
      [-1.57, 0, 0.035],
      [0, 0.9, 0],
    ] as const) {
      const result = quaternionConventionCheck(angles);
      expect(
        Math.max(...result.source.map((v, i) => Math.abs(v - result.glb[i]))),
      ).toBeLessThan(1e-6);
    }
  });
  it.each(models)(
    "$id exports a self-contained GLB with every rig/clip",
    (model) => {
      const map = model.materials.find((m) => m.texture)!.texture!;
      const glb = exportCharacterGlb(model, readFileSync(map)),
        header = new DataView(glb.buffer);
      expect(header.getUint32(0, true)).toBe(0x46546c67);
      expect(header.getUint32(4, true)).toBe(2);
      expect(header.getUint32(8, true)).toBe(glb.length);
      const jsonLength = header.getUint32(12, true),
        json = JSON.parse(
          new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)),
        );
      expect(json.extras.playerId).toBe(model.id);
      expect(json.skins[0].joints).toHaveLength(19);
      expect(
        json.animations.map((a: { name: string }) => a.name).sort(),
      ).toEqual([...CLIP_IDS].sort());
      expect(json.images[0].mimeType).toBe("image/jpeg");
      expect(json.images[0].uri).toBeUndefined();
      expect(json.meshes[0].primitives).toHaveLength(model.meshes.length);
      for (const a of json.accessors) {
        const v = json.bufferViews[a.bufferView];
        expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(
          json.buffers[0].byteLength,
        );
        expect(a.count).toBeGreaterThan(0);
      }
    },
  );
  it.each(models)(
    "$id emits valid leaf nodes and typed vertex buffer views without changing authored data",
    (model) => {
      const jointCopies = model.meshes.map((mesh) => mesh.joints.slice());
      const glb = exportCharacterGlb(
        model,
        readFileSync(model.materials.find((m) => m.texture)!.texture!),
      );
      const header = new DataView(glb.buffer),
        jsonLength = header.getUint32(12, true);
      const json = JSON.parse(
        new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)),
      );
      const bin = 20 + jsonLength + 8;
      const values = (index: number): Float32Array | Uint16Array => {
        const a = json.accessors[index],
          v = json.bufferViews[a.bufferView],
          components = (
            { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<
              string,
              number
            >
          )[a.type];
        const start = glb.byteOffset + bin + v.byteOffset + (a.byteOffset ?? 0);
        return a.componentType === 5123
          ? new Uint16Array(glb.buffer, start, a.count * components)
          : new Float32Array(glb.buffer, start, a.count * components);
      };
      for (let i = 0; i < model.bones.length; i++) {
        const expected = model.bones
          .map((b, j) => (b.parent === i ? j : -1))
          .filter((j) => j >= 0);
        if (expected.length) expect(json.nodes[i].children).toEqual(expected);
        else expect(json.nodes[i]).not.toHaveProperty("children");
      }
      for (let i = 0; i < model.meshes.length; i++) {
        const mesh = model.meshes[i],
          attributes = json.meshes[0].primitives[i].attributes;
        for (const attribute of Object.values(attributes) as number[])
          expect(
            json.bufferViews[json.accessors[attribute].bufferView].target,
          ).toBe(34962);
        const positions = values(attributes.POSITION),
          normals = values(attributes.NORMAL),
          uv = values(attributes.TEXCOORD_0),
          weights = values(attributes.WEIGHTS_0),
          joints = values(attributes.JOINTS_0);
        let posError = 0,
          normalError = 0,
          uvError = 0;
        for (let vertex = 0; vertex < mesh.vertices.length / 8; vertex++) {
          for (let k = 0; k < 3; k++) {
            posError = Math.max(
              posError,
              Math.abs(
                positions[vertex * 3 + k] - mesh.vertices[vertex * 8 + k],
              ),
            );
            normalError = Math.max(
              normalError,
              Math.abs(
                normals[vertex * 3 + k] - mesh.vertices[vertex * 8 + 3 + k],
              ),
            );
          }
          for (let k = 0; k < 2; k++)
            uvError = Math.max(
              uvError,
              Math.abs(uv[vertex * 2 + k] - mesh.vertices[vertex * 8 + 6 + k]),
            );
        }
        expect(posError).toBe(0);
        expect(normalError).toBe(0);
        expect(uvError).toBe(0);
        expect(weights).toEqual(mesh.weights);
        let mismatches = 0;
        for (let k = 0; k < joints.length; k++)
          if (joints[k] !== (mesh.weights[k] === 0 ? 0 : mesh.joints[k]))
            mismatches++;
        expect(mismatches).toBe(0);
        expect(mesh.joints).toEqual(jointCopies[i]);
      }
      for (const animation of json.animations)
        for (const sampler of animation.samplers) {
          expect(
            json.bufferViews[json.accessors[sampler.input].bufferView],
          ).not.toHaveProperty("target");
          expect(
            json.bufferViews[json.accessors[sampler.output].bufferView],
          ).not.toHaveProperty("target");
        }
      expect(
        json.bufferViews[
          json.accessors[json.skins[0].inverseBindMatrices].bufferView
        ],
      ).not.toHaveProperty("target");
      expect(json.bufferViews[json.images[0].bufferView]).not.toHaveProperty(
        "target",
      );
    },
  );
  it.each(models)(
    "$id connected clothing has one topological component and finite posed edges",
    (model) => {
      const mesh = model.meshes.find((m) => m.id === "connected-clothing")!;
      const points = new Map<string, number>(),
        parent: number[] = [],
        edgeCount = new Map<string, number>();
      const root = (i: number): number => {
        while (parent[i] !== i) {
          parent[i] = parent[parent[i]];
          i = parent[i];
        }
        return i;
      };
      for (let i = 0; i < mesh.vertices.length; i += 24) {
        const tri = [0, 8, 16].map((k) => {
          const key = [0, 1, 2]
            .map((a) => Math.round(mesh.vertices[i + k + a] * 1e5))
            .join(",");
          let id = points.get(key);
          if (id === undefined) {
            id = points.size;
            points.set(key, id);
            parent.push(id);
          }
          return id;
        });
        for (let k = 0; k < 3; k++) {
          const a = tri[k],
            b = tri[(k + 1) % 3];
          parent[root(a)] = root(b);
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        }
      }
      expect(new Set(parent.map((_, i) => root(i))).size).toBe(1);
      expect([...edgeCount.values()].filter((v) => v !== 2)).toHaveLength(0);
      const posed = projectCharacterGeometry(
        model,
        sampleCharacterPose(model, "declare", 0.5),
      ).find((m) => m.id === mesh.id)!;
      let stretch = 0;
      for (let i = 0; i < mesh.vertices.length; i += 24)
        for (let a = 0; a < 3; a++) {
          const x = i + a * 8,
            y = i + ((a + 1) % 3) * 8;
          const before = Math.hypot(
            ...[0, 1, 2].map(
              (k) => mesh.vertices[x + k] - mesh.vertices[y + k],
            ),
          );
          if (before < 0.003) continue;
          const after = Math.hypot(
            ...[0, 1, 2].map(
              (k) => posed.vertices[x + k] - posed.vertices[y + k],
            ),
          );
          stretch = Math.max(stretch, after / before);
        }
      expect(stretch).toBeLessThan(4);
    },
  );
});
