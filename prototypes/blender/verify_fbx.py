"""Check actual Blender FBX reimports against the saved source metrics.

This is deliberately NOT reported as Unity importer validation.
"""

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def inspect(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Avoid Blender suffixing imported material names after the previous asset.
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    bpy.ops.import_scene.fbx(filepath=str(path))
    objects=[obj for obj in bpy.context.scene.objects if obj.type=="MESH"]
    assert objects, f"No meshes imported from {path}"
    points=[obj.matrix_world @ Vector(c) for obj in objects for c in obj.bound_box]
    low=[min(p[i] for p in points) for i in range(3)]
    high=[max(p[i] for p in points) for i in range(3)]
    for obj in objects:
        obj.data.calc_loop_triangles()
        assert obj.data.uv_layers, f"Missing UV on {obj.name}"
        assert all(v.normal.length>.9 for v in obj.data.vertices), f"Invalid normals: {obj.name}"
    return {"names":sorted(obj.name for obj in objects), "meshes":len(objects),
            "_geometry":{obj.name:{"vertices":[list(obj.matrix_world @ v.co) for v in obj.data.vertices],
                                   "polygons":[list(p.vertices) for p in obj.data.polygons]}
                         for obj in objects},
            "triangles":sum(len(obj.data.loop_triangles) for obj in objects),
            "boundsMeters":{"min":low,"max":high},
            "dimensionsMeters":[high[i]-low[i] for i in range(3)],
            "materials":sorted(mat.name for mat in bpy.data.materials),
            "baseColors":{mat.name:list(mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value)
                          for mat in bpy.data.materials}}


def assert_geometry_same(actual,revised):
    for boundary in ("min","max"):
        assert all(abs(a-b)<1e-5 for a,b in zip(actual["boundsMeters"][boundary],revised["boundsMeters"][boundary])), "Revision moved bounds"
    assert actual["_geometry"].keys()==revised["_geometry"].keys(), "Revision changed mesh identity"
    for name,mesh in actual["_geometry"].items():
        other=revised["_geometry"][name]
        assert mesh["polygons"]==other["polygons"], f"Revision changed topology: {name}"
        assert len(mesh["vertices"])==len(other["vertices"]), f"Revision changed vertices: {name}"
        assert all(abs(a-b)<1e-5 for v,w in zip(mesh["vertices"],other["vertices"]) for a,b in zip(v,w)), f"Revision moved mesh vertices: {name}"


def assert_palette(actual,manifest):
    palette={entry["name"]:entry["rgba"] for entry in manifest["materialPalette"]}
    for mat,color in actual["baseColors"].items():
        assert len(color)==len(palette[mat])==4
        assert all(abs(a-b)<1e-5 for a,b in zip(color,palette[mat])), f"Source color mismatch: {mat}"


def negative_checks(actual,manifest):
    # Regression checks against the real imported asset, without modifying files.
    mutated=copy.deepcopy(actual)
    for boundary in ("min","max"):
        mutated["boundsMeters"][boundary][0]+=1
    cases=[("translated-bounds",lambda:assert_geometry_same(actual,mutated))]
    deformed=copy.deepcopy(actual)
    next(iter(deformed["_geometry"].values()))["vertices"][0][0]+=.01
    cases.append(("internal-geometry-change",lambda:assert_geometry_same(actual,deformed)))
    wrong_color=copy.deepcopy(actual)
    next(iter(wrong_color["baseColors"].values()))[0]+=.2
    cases.append(("manifest-color-mismatch",lambda:assert_palette(wrong_color,manifest)))
    for name,check in cases:
        try:
            check()
        except AssertionError:
            continue
        raise AssertionError(f"Negative check incorrectly accepted: {name}")
    return [name for name,_ in cases]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--baseline",type=Path,required=True)
    parser.add_argument("--revision",type=Path)
    parser.add_argument("--report",type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    report={"blenderVersion":bpy.app.version_string,"validation":"Blender FBX reimport only",
            "unityValidation":"not-run-editor-unavailable","assets":{}}
    baseline_manifest=json.loads((args.baseline/"manifest.json").read_text())
    for name,expected in baseline_manifest["assets"].items():
        path=args.baseline/f"{name}.fbx"
        assert hashlib.sha256(path.read_bytes()).hexdigest()==expected["sha256"], f"Stale manifest: {name}"
        actual=inspect(path)
        assert actual["meshes"]==expected["meshes"], f"Lost mesh in {name}"
        assert actual["triangles"]==expected["triangles"], f"Topology changed: {name}"
        assert actual["materials"]==expected["materials"], f"Lost material in {name}"
        assert_palette(actual,baseline_manifest)
        for boundary in ("min","max"):
            assert all(abs(a-b)<1e-5 for a,b in zip(actual["boundsMeters"][boundary],expected["boundsMeters"][boundary])), f"Axis, origin or scale mismatch: {name}"
        result={"baseline":actual,"baselineChecks":"passed",
                "negativeChecksRejected":negative_checks(actual,baseline_manifest)}
        if args.revision:
            revision_manifest=json.loads((args.revision/"manifest.json").read_text())
            revision_path=args.revision/f"{name}.fbx"
            assert hashlib.sha256(revision_path.read_bytes()).hexdigest()==revision_manifest["assets"][name]["sha256"]
            revised=inspect(revision_path)
            assert_palette(revised,revision_manifest)
            for key in ("names","meshes","triangles","materials"):
                assert revised[key]==actual[key], f"Revision changed identity/topology: {name}/{key}"
            assert all(abs(a-b)<1e-5 for a,b in zip(actual["dimensionsMeters"],revised["dimensionsMeters"]))
            assert_geometry_same(actual,revised)
            for mat,color in actual["baseColors"].items():
                if mat=="Felt":
                    assert color!=revised["baseColors"][mat], "Felt revision was not exported"
                else:
                    assert color==revised["baseColors"][mat], f"Unexpected material change: {mat}"
            revised.pop("_geometry")
            result.update({"revision":revised,"revisionChecks":"passed",
                           "geometryComparison":"world-space vertices and polygon indices; tolerance 0.00001 metres"})
        actual.pop("_geometry")
        report["assets"][name]=result
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2)+"\n")
    print(f"PASS: {len(report['assets'])} assets, scale / bounds / UV / normals / materials / topology")


if __name__=="__main__":
    main()
