import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #1165 pins the committed Blender study artefacts without needing Blender or Unity in CI.
 * Blender itself proves geometry (`verify_fbx.py`, `compare_builds.py`); this file proves the
 * committed manifests, the reproduction record, the README table and the Unity camera constants
 * still describe the exact bytes that sit in `prototypes/blender/generated/`.
 */

const STUDY_DIR = resolve(process.cwd(), "prototypes/blender");
const GENERATED_DIR = resolve(STUDY_DIR, "generated");
const REVISION_DIR = resolve(GENERATED_DIR, "revision");
const UNITY_VALIDATION_DIR = resolve(
  GENERATED_DIR,
  "unity-validation-2026-09-08",
);
const UNITY_STUDY_DIR = resolve(
  process.cwd(),
  "prototypes/unity-display/Assets/FourBrosBlenderStudy",
);
const ASSET_NAMES = ["MahjongTable", "TilePin5", "SoakuhinStudy"] as const;

type AssetMetrics = {
  meshes: number;
  triangles: number;
  uvMeshes: number;
  imageTextureBytes: number;
  fbxBytes: number;
  sha256: string;
  materials: string[];
};
type Manifest = {
  schemaVersion: number;
  blenderVersion: string;
  variant: string;
  units: string;
  blenderUp: string;
  fbxUp: string;
  unityValidation: string;
  rigging: string;
  materialPalette: { name: string; rgba: number[] }[];
  assets: Record<string, AssetMetrics>;
};

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;
const readText = (path: string) => readFileSync(path, "utf8");
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const baseline = readJson<Manifest>(resolve(GENERATED_DIR, "manifest.json"));
const revision = readJson<Manifest>(resolve(REVISION_DIR, "manifest.json"));
const validation = readJson<{
  blenderVersion: string;
  validation: string;
  unityValidation: string;
  assets: Record<
    string,
    {
      baselineChecks: string;
      revisionChecks: string;
      negativeChecksRejected: string[];
      baseline: { meshes: number; triangles: number };
    }
  >;
}>(resolve(GENERATED_DIR, "fbx-validation.json"));
const reproduction = readJson<{
  schemaVersion: number;
  environment: Record<string, string>;
  runs: { script: string; exitCode: number }[];
  reproducibility: Record<string, unknown>;
  unityParityRender: { resolution: number[]; cameraMatches: string };
  unityValidation: string;
}>(resolve(GENERATED_DIR, "reproduction-2026-09-08.json"));
const readme = readText(resolve(STUDY_DIR, "README.md"));
const cameraScript = readText(
  resolve(UNITY_STUDY_DIR, "BlenderStudyCamera.cs"),
);
const editorScript = readText(
  resolve(UNITY_STUDY_DIR, "Editor/BlenderAssetStudy.cs"),
);
const parityScript = readText(resolve(STUDY_DIR, "render_unity_parity.py"));
type UnityModelRecord = {
  name: (typeof ASSET_NAMES)[number];
  guid: string;
  prefabGuid: string;
  sourceFbxSha256: string;
  geometrySha256: string;
  position: Record<string, number>;
  rotation: Record<string, number>;
  scale: Record<string, number>;
  meshes: number;
  triangles: number;
  uvMeshes: number;
  normalMeshes: number;
  materialPaths: string[];
};
const unityValidation = readJson<{
  unityVersion: string;
  graphicsApi: string;
  interaction: string;
  performanceScope: string;
  baseline: UnityModelRecord[];
  revision: UnityModelRecord[];
  captures: { file: string; sha256: string }[];
  renderSamples: number;
  renderCpuMedianMilliseconds: number;
  renderCpuP95Milliseconds: number;
  totalAllocatedMemoryBytes: number;
}>(resolve(UNITY_VALIDATION_DIR, "unity-validation.json"));

describe("Blender study artefacts (#1165)", () => {
  it("keeps every committed FBX byte-identical to the hash recorded in its manifest", () => {
    for (const [directory, manifest] of [
      [GENERATED_DIR, baseline],
      [REVISION_DIR, revision],
    ] as const) {
      expect(Object.keys(manifest.assets).sort()).toEqual(
        [...ASSET_NAMES].sort(),
      );
      for (const name of ASSET_NAMES) {
        const path = resolve(directory, `${name}.fbx`);
        expect(sha256(path)).toBe(manifest.assets[name].sha256);
        expect(readFileSync(path).byteLength).toBe(
          manifest.assets[name].fbxBytes,
        );
      }
    }
  });

  it("keeps the revision a colour-only change with identical topology", () => {
    expect(baseline.variant).toBe("baseline");
    expect(revision.variant).toBe("revision");
    for (const name of ASSET_NAMES) {
      expect(revision.assets[name].meshes).toBe(baseline.assets[name].meshes);
      expect(revision.assets[name].triangles).toBe(
        baseline.assets[name].triangles,
      );
      expect(revision.assets[name].materials).toEqual(
        baseline.assets[name].materials,
      );
    }
    const felt = (manifest: Manifest) =>
      manifest.materialPalette.find((entry) => entry.name === "Felt")?.rgba;
    expect(felt(baseline)).toBeDefined();
    expect(felt(revision)).not.toEqual(felt(baseline));
    for (const entry of baseline.materialPalette) {
      if (entry.name === "Felt") continue;
      const other = revision.materialPalette.find(
        (candidate) => candidate.name === entry.name,
      );
      expect(other?.rgba).toEqual(entry.rgba);
    }
  });

  it("keeps every mesh UV-mapped and free of image textures", () => {
    for (const name of ASSET_NAMES) {
      expect(baseline.assets[name].uvMeshes).toBe(baseline.assets[name].meshes);
      expect(baseline.assets[name].imageTextureBytes).toBe(0);
    }
    expect(baseline.units).toBe("metres");
    expect(baseline.blenderUp).toBe("Z");
    expect(baseline.fbxUp).toBe("Y");
  });

  it("keeps the Blender reimport report aligned with the manifests", () => {
    expect(validation.validation).toBe("Blender FBX reimport only");
    expect(Object.keys(validation.assets).sort()).toEqual(
      [...ASSET_NAMES].sort(),
    );
    for (const name of ASSET_NAMES) {
      const entry = validation.assets[name];
      expect(entry.baselineChecks).toBe("passed");
      expect(entry.revisionChecks).toBe("passed");
      expect(entry.negativeChecksRejected.length).toBeGreaterThanOrEqual(3);
      expect(entry.baseline.meshes).toBe(baseline.assets[name].meshes);
      expect(entry.baseline.triangles).toBe(baseline.assets[name].triangles);
    }
  });

  it("preserves the historical pre-Unity records separately from later validation", () => {
    for (const flag of [
      baseline.unityValidation,
      revision.unityValidation,
      validation.unityValidation,
      reproduction.unityValidation,
    ]) {
      expect(flag).toBe("not-run-editor-unavailable");
    }
    expect(baseline.rigging).toBe("not-implemented-static-study");
    expect(reproduction.environment.unityEditor).toBe("not-installed");
    expect(readme).toContain("Unity検証前の履歴");
    expect(readme).toContain("物理マウス／キーボード入力とPlayerのFPSは未検証");
  });

  it("ties the Unity import and reimport evidence to the committed FBX files", () => {
    expect(unityValidation.unityVersion).toBe("2022.3.62f2");
    expect(unityValidation.graphicsApi).toBe("Metal");
    expect(unityValidation.baseline.map((model) => model.name)).toEqual(
      ASSET_NAMES,
    );
    expect(unityValidation.revision.map((model) => model.name)).toEqual(
      ASSET_NAMES,
    );
    for (const [index, before] of unityValidation.baseline.entries()) {
      const after = unityValidation.revision[index];
      expect(before.sourceFbxSha256).toBe(baseline.assets[before.name].sha256);
      expect(after.sourceFbxSha256).toBe(revision.assets[after.name].sha256);
      expect(before.guid).toMatch(/^[a-f0-9]{32}$/);
      expect(before.prefabGuid).toBe(before.guid);
      for (const key of [
        "guid",
        "prefabGuid",
        "geometrySha256",
        "position",
        "rotation",
        "scale",
        "materialPaths",
      ] as const)
        expect(after[key]).toEqual(before[key]);
      for (const model of [before, after]) {
        expect(model.meshes).toBe(baseline.assets[model.name].meshes);
        expect(model.triangles).toBe(baseline.assets[model.name].triangles);
        expect(model.uvMeshes).toBe(model.meshes);
        expect(model.normalMeshes).toBe(model.meshes);
      }
    }
  });

  it("preserves all four actual Unity PNG captures and their measured scope", () => {
    expect(unityValidation.captures.map((capture) => capture.file)).toEqual([
      "unity-baseline.png",
      "unity-revision.png",
      "unity-tile-detail.png",
      "unity-tile-moved.png",
    ]);
    for (const capture of unityValidation.captures) {
      const path = resolve(UNITY_VALIDATION_DIR, capture.file);
      const png = readFileSync(path);
      expect(sha256(path)).toBe(capture.sha256);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const detail = capture.file.startsWith("unity-tile-");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(
        detail ? [1920, 1080] : [960, 540],
      );
    }
    expect(unityValidation.interaction).toContain(
      "physical mouse/keyboard input not exercised",
    );
    expect(unityValidation.performanceScope).toContain(
      "excludes presentation, GPU completion and player FPS",
    );
    expect(unityValidation.renderSamples).toBe(30);
    expect(unityValidation.renderCpuMedianMilliseconds).toBeGreaterThan(0);
    expect(unityValidation.renderCpuP95Milliseconds).toBeGreaterThanOrEqual(
      unityValidation.renderCpuMedianMilliseconds,
    );
    expect(readme).toContain(
      String(Number(unityValidation.renderCpuMedianMilliseconds.toFixed(5))),
    );
    expect(readme).toContain(
      String(Number(unityValidation.renderCpuP95Milliseconds.toFixed(5))),
    );
    expect(readme).toContain(
      unityValidation.totalAllocatedMemoryBytes.toLocaleString("en-US"),
    );
  });

  it("keeps the reproduction record consistent with the committed manifests", () => {
    expect(reproduction.schemaVersion).toBe(1);
    expect(reproduction.environment.blender).toContain(baseline.blenderVersion);
    expect(validation.blenderVersion).toBe(baseline.blenderVersion);
    for (const run of reproduction.runs) expect(run.exitCode).toBe(0);
    expect(reproduction.runs.map((run) => run.script)).toEqual(
      expect.arrayContaining([
        "build_assets.py",
        "revise_assets.py",
        "verify_fbx.py",
        "compare_builds.py",
        "render_unity_parity.py",
      ]),
    );
    // Byte-level reproducibility is explicitly NOT claimed; geometry equality is.
    expect(reproduction.reproducibility.fbxSha256).toContain("differs");
    expect(reproduction.reproducibility.faceStorageOrder).toContain(
      "NOT stable",
    );
  });

  it("keeps the README measurement table equal to the manifest numbers", () => {
    for (const name of ASSET_NAMES) {
      const metrics = baseline.assets[name];
      expect(readme).toContain(metrics.triangles.toLocaleString("en-US"));
      expect(readme).toContain(
        `${metrics.fbxBytes.toLocaleString("en-US")} bytes`,
      );
    }
  });

  it("keeps the Blender parity render aligned with the Unity preview camera", () => {
    const constant = (source: string, pattern: RegExp) => {
      const match = source.match(pattern);
      expect(match, pattern.source).not.toBeNull();
      return Number(match?.[1]);
    };
    const yaw = constant(cameraScript, /yaw\s*=\s*(-?[\d.]+)/);
    const pitch = constant(cameraScript, /pitch\s*=\s*(-?[\d.]+)/);
    const distance = constant(cameraScript, /distance\s*=\s*(-?[\d.]+)f/);
    expect(constant(parityScript, /UNITY_YAW\s*=\s*(-?[\d.]+)/)).toBe(yaw);
    expect(constant(parityScript, /UNITY_PITCH\s*=\s*(-?[\d.]+)/)).toBe(pitch);
    expect(constant(parityScript, /UNITY_DISTANCE\s*=\s*(-?[\d.]+)/)).toBe(
      distance,
    );
    const width = constant(editorScript, /ParityWidth\s*=\s*(\d+)/);
    const height = constant(editorScript, /ParityHeight\s*=\s*(\d+)/);
    const fov = constant(editorScript, /ParityVerticalFov\s*=\s*(\d+)/);
    expect(constant(parityScript, /UNITY_VERTICAL_FOV\s*=\s*(-?[\d.]+)/)).toBe(
      fov,
    );
    expect(reproduction.unityParityRender.resolution).toEqual([width, height]);
  });
});
