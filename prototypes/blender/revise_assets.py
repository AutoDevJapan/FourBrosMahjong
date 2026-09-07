"""Open the real saved .blend, change felt, export while retaining object names."""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import bpy

sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_assets import export, metrics


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--baseline",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    start=time.monotonic()
    source=args.baseline.resolve()
    out=args.output.resolve()
    out.mkdir(parents=True,exist_ok=True)
    if any(out.iterdir()):
        raise RuntimeError(f"Output directory must be empty: {out}")
    baseline_file=source/"fourbros-study.blend"
    bpy.ops.wm.open_mainfile(filepath=str(baseline_file))
    manifest=json.loads((source/"manifest.json").read_text())
    manifest["variant"]="revision"
    manifest["sourceBlendSha256"]=hashlib.sha256(baseline_file.read_bytes()).hexdigest()
    mat=bpy.data.materials["Felt"]
    mat.diffuse_color=(.025,.11,.24,1)
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value=mat.diffuse_color
    for entry in manifest["materialPalette"]:
        if entry["name"]=="Felt":
            entry["rgba"]=list(mat.diffuse_color)
    for name in manifest["assets"]:
        root=bpy.data.objects[name]
        saved_position=root.location.copy()
        root.location=(0,0,0)
        bpy.context.view_layer.update()
        manifest["assets"][name]=metrics(root)
        target=out/f"{name}.fbx"
        export(root,target)
        manifest["assets"][name]["fbxBytes"]=target.stat().st_size
        manifest["assets"][name]["sha256"]=hashlib.sha256(target.read_bytes()).hexdigest()
        root.location=saved_position
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(out/"fourbros-study.blend"))
    scene=bpy.context.scene
    scene.render.filepath=str(out/"blender-preview.png")
    bpy.ops.render.render(write_still=True)
    manifest["elapsedSeconds"]=round(time.monotonic()-start,3)
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
    print(f"Revised saved blend and exported 3 FBX files: {out}")


if __name__=="__main__":
    main()
