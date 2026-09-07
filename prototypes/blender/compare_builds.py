"""Compare two independent build_assets.py outputs asset by asset (#1165).

FBX files are not byte-reproducible: the exporter stamps the creation time and the
absolute source path into the file header, so `manifest.json`'s sha256 only proves that
a manifest matches the FBX sitting next to it. This script instead reimports both builds
into Blender and asserts that the geometry, material palette and bounds are equal,
which is the property a third party actually needs when reproducing the committed assets.

Measured on 2026-09-08 (Blender 5.2.0 LTS, macOS 26.2 arm64): vertex positions and vertex
order reproduce exactly, but the order in which faces are stored does not - `TilePin5`'s
`PipDot_*` spheres come back with the same face set in a different sequence. Faces are
therefore compared as a canonical multiset: each face is rotated to start at its lowest
index, which keeps the winding direction significant while ignoring storage order.
"""

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_fbx import inspect

import bpy

TOLERANCE = 1e-5


def canonical_faces(polygons):
    """Rotate each face to start at its lowest index: order-insensitive, winding-sensitive."""
    canonical = []
    for face in polygons:
        pivot = face.index(min(face))
        canonical.append(tuple(face[pivot:]+face[:pivot]))
    return sorted(canonical)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assert_same_build(left, right, name):
    assert left["names"] == right["names"], f"Object names differ: {name}"
    assert left["meshes"] == right["meshes"], f"Mesh count differs: {name}"
    assert left["triangles"] == right["triangles"], f"Triangle count differs: {name}"
    assert left["materials"] == right["materials"], f"Materials differ: {name}"
    for boundary in ("min", "max"):
        assert all(abs(a-b) < TOLERANCE for a, b in
                   zip(left["boundsMeters"][boundary], right["boundsMeters"][boundary])), \
            f"Bounds differ: {name}/{boundary}"
    assert left["_geometry"].keys() == right["_geometry"].keys(), f"Mesh identity differs: {name}"
    for mesh, geometry in left["_geometry"].items():
        other = right["_geometry"][mesh]
        assert canonical_faces(geometry["polygons"]) == canonical_faces(other["polygons"]), \
            f"Topology differs: {name}/{mesh}"
        assert len(geometry["vertices"]) == len(other["vertices"]), f"Vertex count differs: {name}/{mesh}"
        assert all(abs(a-b) < TOLERANCE for v, w in zip(geometry["vertices"], other["vertices"])
                   for a, b in zip(v, w)), f"Vertex positions differ: {name}/{mesh}"
    for material, color in left["baseColors"].items():
        assert all(abs(a-b) < TOLERANCE for a, b in zip(color, right["baseColors"][material])), \
            f"Base colour differs: {name}/{material}"


def negative_checks(actual, name):
    """Prove the comparison rejects the differences it claims to detect."""
    cases = []
    moved = copy.deepcopy(actual)
    for boundary in ("min", "max"):
        moved["boundsMeters"][boundary][1] += 0.5
    cases.append(("translated-bounds", moved))
    deformed = copy.deepcopy(actual)
    next(iter(deformed["_geometry"].values()))["vertices"][0][2] += 0.01
    cases.append(("internal-geometry-change", deformed))
    recoloured = copy.deepcopy(actual)
    next(iter(recoloured["baseColors"].values()))[1] += 0.2
    cases.append(("material-colour-change", recoloured))
    flipped = copy.deepcopy(actual)
    next(iter(flipped["_geometry"].values()))["polygons"][0].reverse()
    cases.append(("reversed-face-winding", flipped))
    retopologised = copy.deepcopy(actual)
    faces = next(iter(retopologised["_geometry"].values()))["polygons"]
    faces[0] = list(faces[1])
    cases.append(("changed-face-set", retopologised))
    for case, mutated in cases:
        try:
            assert_same_build(actual, mutated, name)
        except AssertionError:
            continue
        raise AssertionError(f"Negative check incorrectly accepted: {case}")
    return [case for case, _ in cases]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--left", type=Path, required=True, help="reference build directory")
    parser.add_argument("--right", type=Path, required=True, help="reproduced build directory")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    left_manifest = json.loads((args.left/"manifest.json").read_text(encoding="utf-8"))
    right_manifest = json.loads((args.right/"manifest.json").read_text(encoding="utf-8"))
    assert left_manifest["variant"] == right_manifest["variant"], "Comparing different variants"
    assert left_manifest["assets"], "No assets to compare"
    assert left_manifest["assets"].keys() == right_manifest["assets"].keys(), "Asset sets differ"
    report = {"schemaVersion": 1, "blenderVersion": bpy.app.version_string,
              "comparison": "Blender FBX reimport of two independent builds",
              "unityValidation": "not-run-editor-unavailable",
              "left": str(args.left), "right": str(args.right),
              "variant": left_manifest["variant"],
              "leftBlenderVersion": left_manifest["blenderVersion"],
              "rightBlenderVersion": right_manifest["blenderVersion"],
              "assets": {}}
    for name, expected in left_manifest["assets"].items():
        left_path, right_path = args.left/f"{name}.fbx", args.right/f"{name}.fbx"
        left_sha, right_sha = digest(left_path), digest(right_path)
        assert left_sha == expected["sha256"], f"Stale manifest: {args.left}/{name}"
        assert right_sha == right_manifest["assets"][name]["sha256"], f"Stale manifest: {args.right}/{name}"
        left_asset = inspect(left_path)
        right_asset = inspect(right_path)
        assert_same_build(left_asset, right_asset, name)
        rejected = negative_checks(left_asset, name)
        face_order_identical = all(
            left_asset["_geometry"][mesh]["polygons"] == right_asset["_geometry"][mesh]["polygons"]
            for mesh in left_asset["_geometry"])
        report["assets"][name] = {
            "geometryEqual": True, "checksRejected": rejected,
            "vertexOrderIdentical": all(
                left_asset["_geometry"][mesh]["vertices"] == right_asset["_geometry"][mesh]["vertices"]
                for mesh in left_asset["_geometry"]),
            "faceStorageOrderIdentical": face_order_identical,
            "meshes": left_asset["meshes"], "triangles": left_asset["triangles"],
            "materials": left_asset["materials"],
            "dimensionsMeters": left_asset["dimensionsMeters"],
            "bytesEqual": left_path.stat().st_size == right_path.stat().st_size,
            "sha256Equal": left_sha == right_sha,
            "leftBytes": left_path.stat().st_size, "rightBytes": right_path.stat().st_size,
        }
    byte_identical = all(entry["sha256Equal"] for entry in report["assets"].values())
    report["byteIdenticalAcrossBuilds"] = byte_identical
    report["note"] = ("FBX headers embed a creation timestamp and the absolute source path, "
                      "so byte equality across builds is not expected; geometry equality is. "
                      "Face storage order is also not stable across builds, so faces are "
                      "compared as a winding-sensitive canonical multiset.")
    report["faceStorageOrderIdenticalAcrossBuilds"] = all(
        entry["faceStorageOrderIdentical"] for entry in report["assets"].values())
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(f"PASS: {len(report['assets'])} assets geometrically identical across builds, "
          f"byteIdentical={byte_identical}")


if __name__ == "__main__":
    main()
