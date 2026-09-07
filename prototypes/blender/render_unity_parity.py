"""Render the saved .blend from the Unity preview camera transform (#1165).

`prototypes/unity-display/Assets/FourBrosBlenderStudy/` builds a Unity scene whose
camera pivots at (0, .8, 0) with yaw 25 / pitch 25 / distance 3.1 and Unity's default
60 degree vertical field of view. This script reproduces that exact viewpoint inside
Blender so a Unity screenshot and this render can be compared frame to frame.

Lighting and colour management are NOT matched: Blender keeps the Cycles studio rig
saved in the .blend, Unity uses one directional light plus flat ambient. Only camera
transform, field of view, aspect ratio and the visible object set are made comparable.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

# Mirrors BlenderStudyCamera.SetInitialView and BlenderAssetStudy.BuildScene.
UNITY_PIVOT = (0.0, 0.8, 0.0)
UNITY_YAW = 25.0
UNITY_PITCH = 25.0
UNITY_DISTANCE = 3.1
UNITY_VERTICAL_FOV = 60.0
UNITY_BACKGROUND = (0.07, 0.09, 0.12)
# Objects the Unity preview scene does not contain; the .blend adds them for the hero shot.
KEEP_UNPARENTED = {"StudioFloor"}


def unity_camera_position():
    """Unity applies Euler angles in Z, X, Y order: R = Ry * Rx * Rz (Rz is identity here)."""
    pitch = math.radians(UNITY_PITCH)
    yaw = math.radians(UNITY_YAW)
    x, y, z = 0.0, 0.0, -UNITY_DISTANCE
    y, z = y*math.cos(pitch) - z*math.sin(pitch), y*math.sin(pitch) + z*math.cos(pitch)
    x, z = x*math.cos(yaw) + z*math.sin(yaw), -x*math.sin(yaw) + z*math.cos(yaw)
    return (UNITY_PIVOT[0]+x, UNITY_PIVOT[1]+y, UNITY_PIVOT[2]+z)


def to_blender(point):
    """FBX export used axis_up=Y / axis_forward=-Z, so Unity (x, y, z) is Blender (x, z, y)."""
    return Vector((point[0], point[2], point[1]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resolution", type=int, nargs=2, default=(960, 540))
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    if args.output.exists():
        raise RuntimeError(f"Choose a new output path to preserve prior evidence: {args.output}")
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
    removed = [obj.name for obj in list(bpy.context.scene.objects)
               if obj.type == "MESH" and obj.parent is None and obj.name not in KEEP_UNPARENTED]
    for name in removed:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)

    unity_position = unity_camera_position()
    location = to_blender(unity_position)
    target = to_blender(UNITY_PIVOT)
    camera = bpy.context.scene.camera
    camera.data.type = "PERSP"
    camera.data.sensor_fit = "VERTICAL"
    camera.data.angle_y = math.radians(UNITY_VERTICAL_FOV)
    camera.data.clip_start = 0.01
    camera.data.clip_end = 100
    camera.location = location
    camera.rotation_euler = (target-location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.world.color = UNITY_BACKGROUND

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.render.resolution_x, scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 100
    scene.render.filepath = str(args.output.resolve())
    bpy.ops.render.render(write_still=True)

    report = {
        "schemaVersion": 1,
        "blenderVersion": bpy.app.version_string,
        "sourceBlend": args.blend.name,
        "parity": "camera transform, vertical FOV, aspect ratio and visible object set only",
        "lightingParity": "not-matched-blender-cycles-studio-rig-vs-unity-directional",
        "unityCamera": {"pivot": list(UNITY_PIVOT), "yawDegrees": UNITY_YAW,
                        "pitchDegrees": UNITY_PITCH, "distanceMeters": UNITY_DISTANCE,
                        "verticalFovDegrees": UNITY_VERTICAL_FOV,
                        "position": list(unity_position),
                        "backgroundRgb": list(UNITY_BACKGROUND)},
        "blenderCamera": {"location": list(location), "target": list(target),
                          "rotationEuler": list(camera.rotation_euler)},
        "removedPresentationObjects": sorted(removed),
        "resolution": list(args.resolution), "samples": args.samples,
        "outputBytes": args.output.stat().st_size,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "removed": len(removed),
                      "unityCameraPosition": list(unity_position)}))


if __name__ == "__main__":
    main()
