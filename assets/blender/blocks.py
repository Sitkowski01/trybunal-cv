"""Wspolne klocki generatorow Trybunalu: materialy, bryly z fazowaniem, pivoty, eksport glTF i podglad.

Importuja je build_characters.py (postacie) i build_courtroom.py (sala).
"""

import math

import bpy

r = math.radians


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


def pixels(name, parent, rows, px, center, y, material):
    """Piksel-art z klockow: rows to napisy, X = zapalony piksel; center = (x, z) srodka obrazka."""
    h, w = len(rows), max(len(row) for row in rows)
    for i, row in enumerate(rows):
        for k, ch in enumerate(row):
            if ch == "X":
                x = center[0] + (k - (w - 1) / 2) * px
                z = center[1] + ((h - 1) / 2 - i) * px
                block(f"{name}_{i}_{k}", parent, (px * 0.92, 0.012, px * 0.92), (x, y, z), material, 0)


def merge_per_pivot(root):
    """Laczy klocki wiszace na tym samym pivocie w jedna siatke: mniej wezlow i draw calli w scenie.

    Modyfikatory (fazy, grubosc blony) trzeba najpierw zaaplikowac — join zachowalby tylko te
    z obiektu aktywnego. Pivoty zostaja nietkniete, wiec kontrakt stawow sie nie zmienia.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    # Kolejnosc po nazwie: children_recursive zalezy od pamieci, a od kolejnosci laczenia zalezy
    # uklad wierzcholkow — bez sortowania kazdy eksport dawalby inny plik .glb.
    meshes = sorted((o for o in root.children_recursive if o.type == "MESH"), key=lambda o: o.name)
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
        parts[0].name = parts[0].data.name = f"{parent.name}_mesh"


def export(root, path):
    merge_per_pivot(root)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB", use_selection=True, export_apply=True, export_extras=True, export_yup=True,
        export_texcoords=False,  # bez tekstur; UV po fazowaniu bywaja rozne miedzy uruchomieniami
    )


def studio(path, *, size=(1400, 560), cam_loc=(0, -7.5, 1.6), cam_rot=(84, 0, 0), lens=50):
    """Swiatlo trzypunktowe, podloga i kamera; render do pliku w kolorach jak w przegladarce."""
    bpy.ops.mesh.primitive_plane_add(size=40)
    bpy.context.active_object.name = "floor"
    bpy.context.active_object.data.materials.append(mat("floor", (0.42, 0.3, 0.2), rough=0.75))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.collection.objects.link(cam)
    cam.location = cam_loc
    cam.rotation_euler = tuple(r(a) for a in cam_rot)
    cam.data.lens = lens
    for name, kind, energy, rot, loc in (
        ("key", "SUN", 3.2, (50, 0, 35), (0, 0, 5)),
        ("fill", "SUN", 1.0, (60, 0, -50), (0, 0, 5)),
        ("rim", "SUN", 2.0, (60, 0, 170), (0, 0, 5)),
    ):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
        bpy.context.collection.objects.link(light)
        light.data.energy = energy
        light.rotation_euler = tuple(r(a) for a in rot)
        light.location = loc
    scene = bpy.context.scene
    scene.camera = cam
    world = scene.world or bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.62, 0.68, 0.78, 1)
    bg.inputs[1].default_value = 0.6
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
