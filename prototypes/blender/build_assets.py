"""Run with Blender --background --factory-startup --python-exit-code 1 --python.

Creates inspectable mesh assets, no downloaded textures or third-party models.
The reference character sheet is consulted by the author, not embedded in assets.
"""

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector


BASE = Path(__file__).resolve().parent
ROOT = BASE.parent.parent
REFERENCE = ROOT / "documents/assets/characters/originals/p0-soakuhin-character-sheet.png"
MATERIALS = {}
ASSETS = {}
ACTIVE_ROOT = None


def material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    MATERIALS[name] = mat
    return mat


def asset(name):
    global ACTIVE_ROOT
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    ASSETS[name] = root
    ACTIVE_ROOT = root
    return root


def finish(obj, name, mat, bevel=0):
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.materials.append(mat)
    obj.parent = ACTIVE_ROOT
    return obj


def box(name, pos, size, mat, bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.scale = size
    return finish(obj, name, mat, bevel)


def ellipsoid(name, pos, size, mat, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj = bpy.context.object
    obj.scale = size
    return finish(obj, name, mat)


def rod(name, start, end, radius, mat, radius_top=None, vertices=12):
    delta = Vector(end) - Vector(start)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
                                   radius2=radius if radius_top is None else radius_top,
                                   depth=delta.length, location=(Vector(start)+Vector(end))/2)
    obj = bpy.context.object
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return finish(obj, name, mat)


def line(name, points, radius, mat):
    for index, (a, b) in enumerate(zip(points, points[1:])):
        rod(f"{name}_{index}", a, b, radius, mat, vertices=8)


def ring(name, center, radius, tube, mat, axis="Z"):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube,
                                    major_segments=24, minor_segments=6, location=center)
    obj = bpy.context.object
    if axis == "Y":
        obj.rotation_euler.x = math.pi/2
    return finish(obj, name, mat)


def make_table(felt):
    asset("MahjongTable")
    box("Base", (0, 0, .685), (.94, .94, .105), MATERIALS["Frame"], .035)
    box("Rim", (0, 0, .744), (.94, .94, .035), MATERIALS["Black"], .025)
    box("Felt", (0, 0, .763), (.83, .83, .008), felt, .018)
    box("CenterPanel", (0, 0, .770), (.16, .16, .009), MATERIALS["Frame"], .008)
    box("CenterIndicator", (0, 0, .776), (.092, .048, .004), MATERIALS["Ivory"], .003)
    for side in (-1, 1):
        for other in (-1, 1):
            box(f"Leg_{side}_{other}", (side*.35, other*.35, .33),
                (.07, .07, .66), MATERIALS["Frame"], .009)
            box(f"Foot_{side}_{other}", (side*.35, other*.35, .025),
                (.09, .09, .05), MATERIALS["Black"], .008)
        box(f"RedRail_{side}", (0, side*.446, .767), (.66, .006, .003), MATERIALS["Red"], .001)
    for x in (-.024, 0, .024):
        box("PanelBar", (x, 0, .779), (.013, .028, .001), MATERIALS["Green"], 0)


def make_tile():
    asset("TilePin5")
    # Face is +Z; the short width is X, the long face height is Y, in metres.
    box("TileBack", (0, 0, .004), (.026, .036, .008), MATERIALS["Green"], .002)
    box("TileFace", (0, 0, .012), (.026, .036, .012), MATERIALS["Ivory"], .002)
    for index, (x, y) in enumerate(((-.006, -.009), (.006, -.009), (0, 0), (-.006, .009), (.006, .009))):
        mat = MATERIALS["Red"] if index == 2 else MATERIALS["Ink"]
        ring(f"Pip_{index}", (x, y, .01815), .0023, .00045, mat)
        ellipsoid(f"PipDot_{index}", (x, y, .0182), (.0007, .0007, .00025), mat, 8, 6)


def make_character():
    asset("SoakuhinStudy")
    black, charcoal, red = MATERIALS["Black"], MATERIALS["Jacket"], MATERIALS["Red"]
    skin, hair, silver = MATERIALS["Skin"], MATERIALS["Hair"], MATERIALS["Silver"]
    # Stylised geometric study: boots, slim trousers, bomber jacket, swept hair.
    for sign in (-1, 1):
        x = sign*.115
        box(f"Sole_{sign}", (x, -.045, .032), (.15, .27, .05), black, .018)
        box(f"Boot_{sign}", (x, -.045, .086), (.142, .25, .095), black, .028)
        box(f"Ankle_{sign}", (x, .01, .15), (.125, .14, .16), black, .022)
        for z in (.08, .104, .128):
            rod("BootLace", (x-.04, -.155, z), (x+.04, -.155, z), .003, silver, vertices=8)
        rod(f"TrouserLower_{sign}", (x, 0, .2), (x*1.03, 0, .56), .060, charcoal, .071)
        rod(f"TrouserUpper_{sign}", (x*1.03, 0, .56), (x*.85, 0, .94), .078, charcoal, .092)
        ellipsoid("Knee", (x*1.03, -.006, .55), (.067, .068, .076), charcoal)
        rod("OuterSeam", (x+sign*.045, -.039, .24), (x+sign*.058, -.046, .84), .003, black, vertices=8)
    box("Waist", (0, 0, .97), (.35, .20, .18), black, .055)
    # Tapered torso has a deliberately low polygon silhouette.
    verts = []
    for z, width, depth in ((.98, .18, .115), (1.15, .21, .125), (1.37, .24, .115), (1.44, .19, .09)):
        for i in range(12):
            angle = 2*math.pi*i/12
            verts.append((math.cos(angle)*width, math.sin(angle)*depth, z))
    faces = [tuple(reversed(range(12)))]
    for layer in range(3):
        for i in range(12):
            j=(i+1)%12
            faces.append((layer*12+i, layer*12+j, (layer+1)*12+j, (layer+1)*12+i))
    faces.append(tuple(range(36, 48)))
    mesh = bpy.data.meshes.new("BomberTorsoMesh")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new("BomberTorso", mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = ACTIVE_ROOT
    obj.data.materials.append(charcoal)
    box("JacketHem", (0, -.005, .993), (.365, .226, .055), black, .024)
    for z in (.987, 1.005):
        rod("HemPiping", (-.166, -.118, z), (.166, -.118, z), .0035, red)
    rod("Zip", (0, -.128, 1.03), (0, -.119, 1.36), .003, silver, vertices=8)
    box("Shirt", (0, -.105, 1.399), (.12, .016, .12), black, .009)
    for sign in (-1, 1):
        line("Collar", [(sign*.09, -.08, 1.45), (sign*.063, -.125, 1.39), (sign*.012, -.137, 1.35)], .012, black)
        line("CollarTrim", [(sign*.083, -.092, 1.45), (sign*.056, -.138, 1.39), (sign*.012, -.145, 1.36)], .003, red)
        shoulder=(sign*.23, .0, 1.37)
        elbow=(sign*.30, -.005, 1.17)
        wrist=(sign*.295, -.05, 1.005)
        ellipsoid("Shoulder", shoulder, (.085, .102, .11), charcoal)
        rod("SleeveUpper", shoulder, elbow, .087, charcoal, .073)
        ellipsoid("Elbow", elbow, (.074, .074, .078), charcoal)
        rod("SleeveLower", elbow, wrist, .071, charcoal, .05)
        rod("Cuff", (wrist[0], wrist[1], 1.025), (wrist[0], wrist[1], .983), .053, black)
        rod("CuffTrim", (wrist[0], wrist[1], 1.009), (wrist[0], wrist[1], 1.016), .054, red)
        line("SleeveStripe", [(sign*.27, -.084, 1.38), (sign*.324, -.064, 1.18), (sign*.317, -.093, 1.04)], .004, red)
        ellipsoid("Hand", (sign*.297, -.045, .945), (.043, .040, .067), skin)
    rod("Neck", (0, 0, 1.40), (0, 0, 1.54), .059, skin)
    ellipsoid("Head", (0, -.006, 1.64), (.100, .091, .139), skin, 20, 14)
    ellipsoid("Jaw", (0, -.025, 1.57), (.073, .072, .071), skin)
    for sign in (-1, 1):
        ellipsoid("Ear", (sign*.101, -.002, 1.63), (.018, .015, .034), skin)
        ellipsoid("EyeWhite", (sign*.037, -.088, 1.66), (.022, .008, .010), MATERIALS["Ivory"])
        ellipsoid("Eye", (sign*.037, -.096, 1.66), (.008, .004, .008), black, 12, 8)
        rod("Brow", (sign*.017, -.096, 1.682), (sign*.060, -.089, 1.688), .006, hair)
    ellipsoid("Nose", (0, -.099, 1.627), (.015, .022, .028), skin)
    line("Mouth", [(-.021, -.090, 1.588), (0, -.100, 1.583), (.021, -.090, 1.588)], .0025, MATERIALS["Lip"])
    ellipsoid("HairCap", (0, .011, 1.736), (.103, .093, .069), hair, 20, 12)
    for sign in (-1, 1):
        ellipsoid("SideHair", (sign*.083, .027, 1.68), (.023, .064, .074), hair)
    for i in range(7):
        x=-.075+i*.024
        tuft=ellipsoid(f"SweptHair_{i}", (x, -.033+i*.005, 1.77), (.028, .064, .034), hair)
        tuft.rotation_euler.y=-.35
        tuft.rotation_euler.z=-.45
    # Generic red crest; not a reproduction of the supplied embroidery artwork.
    ring("ChestCrest", (.112, -.122, 1.337), .033, .0035, red, "Y")
    for i in range(5):
        a=i*2*math.pi/5
        ellipsoid("CrestPetal", (.112+.016*math.sin(a), -.125, 1.337+.016*math.cos(a)), (.009, .003, .009), red, 8, 6)
    line("Necklace", [(-.052, -.125, 1.417), (0, -.143, 1.326), (.052, -.125, 1.417)], .002, silver)
    box("Pendant", (0, -.15, 1.318), (.016, .009, .03), silver, .003)


def meshes(root):
    return [obj for obj in root.children_recursive if obj.type == "MESH"]


def prepare_meshes(root):
    for obj in meshes(root):
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active=obj
        # Explicit UVs permit subsequent texture painting; no image textures yet.
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(island_margin=.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)


def metrics(root):
    objects=meshes(root)
    points=[obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    minimum=[min(p[i] for p in points) for i in range(3)]
    maximum=[max(p[i] for p in points) for i in range(3)]
    for obj in objects:
        obj.data.calc_loop_triangles()
    return {
        "meshes":len(objects), "vertices":sum(len(obj.data.vertices) for obj in objects),
        "triangles":sum(len(obj.data.loop_triangles) for obj in objects),
        "boundsMeters":{"min":minimum,"max":maximum},
        "dimensionsMeters":[maximum[i]-minimum[i] for i in range(3)],
        "materials":sorted({m.name for obj in objects for m in obj.data.materials}),
        "uvMeshes":sum(bool(obj.data.uv_layers) for obj in objects), "imageTextureBytes":0,
    }


def export(root, target):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in meshes(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.fbx(filepath=str(target), use_selection=True,
                             object_types={"EMPTY", "MESH"}, axis_forward="-Z", axis_up="Y",
                             apply_unit_scale=True, apply_scale_options="FBX_SCALE_UNITS",
                             use_mesh_modifiers=True, bake_anim=False, add_leaf_bones=False,
                             path_mode="AUTO")


def camera_at(name, pos, target, ortho):
    bpy.ops.object.camera_add(location=pos)
    obj=bpy.context.object
    obj.name=name
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat("-Z", "Y").to_euler()
    obj.data.type="ORTHO"
    obj.data.ortho_scale=ortho
    bpy.context.scene.camera=obj
    return obj


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=BASE/"generated")
    parser.add_argument("--variant", choices=("baseline", "revision"), default="baseline")
    parser.add_argument("--render", action="store_true")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    start=time.monotonic()
    out=args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise RuntimeError(f"Output directory must be empty; preserve existing edits: {out}")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene
    scene.unit_settings.system="METRIC"
    scene.unit_settings.scale_length=1
    material("Frame", (.07,.09,.10), .2)
    material("Black", (.013,.015,.018), .05)
    material("Jacket", (.035,.038,.045), .12, .38)
    material("Red", (.62,.025,.018), .05)
    material("Ivory", (.90,.87,.72), 0, .32)
    material("Green", (.017,.24,.14))
    material("Felt", (.015,.16,.10) if args.variant=="baseline" else (.025,.11,.24), 0, .95)
    material("Ink", (.012,.055,.10))
    material("Skin", (.66,.38,.23), 0, .6)
    material("Hair", (.011,.009,.008), .03, .3)
    material("Lip", (.32,.10,.07))
    material("Silver", (.55,.57,.6), .7, .25)
    make_table(MATERIALS["Felt"])
    make_tile()
    make_character()
    report={"schemaVersion":1,"blenderVersion":bpy.app.version_string,
            "variant":args.variant,"units":"metres", "blenderUp":"Z", "fbxUp":"Y",
            "characterForwardBlender":"-Y", "exportForward":"-Z",
            "reference":{"path":str(REFERENCE.relative_to(ROOT)),"sha256":hashlib.sha256(REFERENCE.read_bytes()).hexdigest()},
            "assets":{},"unityValidation":"not-run-editor-unavailable",
            "rigging":"not-implemented-static-study", "renderEngine":"CYCLES CPU",
            "materialPalette":[{"name":name,"rgba":list(mat.diffuse_color),
                                "metallic":mat.node_tree.nodes.get("Principled BSDF").inputs["Metallic"].default_value,
                                "roughness":mat.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value}
                               for name,mat in MATERIALS.items()]}
    for name, root in ASSETS.items():
        prepare_meshes(root)
        bpy.context.view_layer.update()
        report["assets"][name]=metrics(root)
        target=out/f"{name}.fbx"
        export(root, target)
        report["assets"][name]["fbxBytes"]=target.stat().st_size
        report["assets"][name]["sha256"]=hashlib.sha256(target.read_bytes()).hexdigest()
    # Presentation only: exported FBX assets above all have their root at origin.
    ASSETS["MahjongTable"].location.x=-.38
    ASSETS["SoakuhinStudy"].location=(.54,.15,0)
    ASSETS["TilePin5"].location=(-.38,-.16,.768)
    for i in range(12):
        for original in meshes(ASSETS["TilePin5"]):
            copy=original.copy()
            copy.data=original.data
            bpy.context.collection.objects.link(copy)
            copy.parent=None
            copy.location=original.location+Vector((-.56+i*.03,.23,.768))
    global ACTIVE_ROOT
    ACTIVE_ROOT=None
    material("Floor", (.055,.07,.095), 0, .9)
    box("StudioFloor", (0,0,-.047), (200,200,.06), MATERIALS["Floor"], 0)
    scene.world.color=(.18,.18,.18)
    for name,pos,power,size in (("Key",(1,-3,4),650,4),("Fill",(-3,-1,2),400,3),("Rim",(1,3,3),800,2)):
        bpy.ops.object.light_add(type="AREA", location=pos)
        light=bpy.context.object
        light.name=name
        light.data.energy=power
        light.data.shape="DISK"
        light.data.size=size
        light.rotation_euler=(Vector((0,0,.8))-light.location).to_track_quat("-Z","Y").to_euler()
    camera_at("HeroCamera", (3,-5,3), (0,0,.89), 2.55)
    scene.render.engine="CYCLES"
    scene.cycles.device="CPU"
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1200
    scene.render.resolution_y=1000
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    bpy.ops.wm.save_as_mainfile(filepath=str(out/"fourbros-study.blend"))
    if args.render:
        scene.render.filepath=str(out/"blender-preview.png")
        bpy.ops.render.render(write_still=True)
    report["elapsedSeconds"]=round(time.monotonic()-start,3)
    (out/"manifest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"output":str(out),"elapsedSeconds":report["elapsedSeconds"]}))


if __name__=="__main__":
    main()
