"""Generator postaci Trybunalu: 4 krytykow-robotow, smok-prokurator i sedzia.

Postacie sa z klockow, a kazdy staw to pusty obiekt (pivot). Scena 3D obraca pivoty w kodzie,
wiec nie potrzebujemy szkieletu ani klatek animacji. Uruchomienie (z katalogu repo):

    blender --background --python assets/blender/build_characters.py

Zapisuje apps/web/public/models/<id>.glb.
Przod postaci to -Y w Blenderze, czyli +Z w glTF (patrzy w strone domyslnej kamery three.js).
"""

import math
import os

import bpy

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODELS = os.path.join(REPO, "apps", "web", "public", "models")
LINEUP = os.path.join(REPO, "assets", "blender", "lineup.png")

r = math.radians


# ---------------------------------------------------------------- klocki


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)


def mat(name, rgb, metal=0.0, rough=0.5, emit=None, strength=4.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def pivot(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "SPHERE"
    e.empty_display_size = 0.06
    bpy.context.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def _finish(o, name, parent, loc, rot, material, bevel):
    o.name = name
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    o.data.materials.append(material)
    if bevel:
        mod = o.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        bpy.ops.object.shade_smooth()
    return o


def block(name, parent, size, loc, material, bevel=0.025, rot=(0, 0, 0)):
    """Prostopadloscian o wymiarach size, srodek w loc (wzgledem rodzica)."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, name, parent, loc, rot, material, bevel)


def cyl(name, parent, radius, depth, loc, material, axis="X", bevel=0.01, verts=20):
    """Walec, domyslnie wzdluz osi X (przegub lokcia i kolana)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth)
    o = bpy.context.active_object
    rot = {"X": (0, r(90), 0), "Y": (r(90), 0, 0), "Z": (0, 0, 0)}[axis]
    return _finish(o, name, parent, loc, rot, material, bevel)


def flat(name, parent, outline, material, thickness):
    """Plaski wielokat w plaszczyznie XZ (obrys [(x, z), ...]) o zadanej grubosci — blona skrzydla."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, 0, z) for x, z in outline], [], [list(range(len(outline)))])
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    o.data.materials.append(material)
    mod = o.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 0
    return o


def spike(name, parent, radius, height, loc, material, rot=(0, 0, 0)):
    """Czworoboczny kolec (piramida) — kolce smoka, zeby, pazury."""
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=radius, radius2=0, depth=height)
    o = bpy.context.active_object
    o.rotation_euler = (0, 0, r(45))
    bpy.ops.object.transform_apply(rotation=True)
    o.location = (0, 0, 0)
    return _finish(o, name, parent, loc, rot, material, 0)


BUILDERS = {
}


# ---------------------------------------------------------------- eksport


def merge_per_pivot(root):
    """Laczy klocki wiszace na tym samym pivocie w jedna siatke: mniej wezlow i draw calli w scenie.

    Modyfikatory (fazy, grubosc blony) trzeba najpierw zaaplikowac — join zachowalby tylko te
    z obiektu aktywnego. Pivoty zostaja nietkniete, wiec kontrakt stawow sie nie zmienia.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [o for o in root.children_recursive if o.type == "MESH"]
    for o in meshes:
        baked = bpy.data.meshes.new_from_object(o.evaluated_get(depsgraph))
        o.modifiers.clear()
        o.data = baked
    by_parent = {}
    for o in meshes:
        by_parent.setdefault(o.parent, []).append(o)
    for parent, parts in by_parent.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        if len(parts) > 1:
            bpy.ops.object.join()
        parts[0].name = f"{parent.name}_mesh"


def export(root, path):
    merge_per_pivot(root)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_extras=True, export_yup=True)


def main():
    os.makedirs(MODELS, exist_ok=True)
    for cid, build in BUILDERS.items():
        clear_scene()
        export(build(), os.path.join(MODELS, f"{cid}.glb"))


if __name__ == "__main__":
    main()
