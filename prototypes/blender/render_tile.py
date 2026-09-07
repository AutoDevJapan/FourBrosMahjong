"""Render a close-up of the saved representative tile, using the actual mesh."""

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser=argparse.ArgumentParser()
parser.add_argument("--blend",type=Path,required=True)
parser.add_argument("--output",type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
if args.output.exists():
    raise RuntimeError("Choose a new output path to preserve prior evidence.")
bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
scene=bpy.context.scene
camera=scene.camera
target=Vector((-.38,-.16,.78))
camera.location=target+Vector((.025,-.05,.08))
camera.rotation_euler=(target-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.ortho_scale=.065
camera.data.clip_start=.001
scene.render.resolution_x=640
scene.render.resolution_y=640
scene.render.filepath=str(args.output.resolve())
bpy.ops.render.render(write_still=True)
