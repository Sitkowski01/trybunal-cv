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


# ---------------------------------------------------------------- robot


class Palette:
    def __init__(self, cid, body, trim, dark, accent, eye):
        self.body = mat(f"{cid}_body", body, metal=0.15, rough=0.38)
        self.trim = mat(f"{cid}_trim", trim, metal=0.1, rough=0.45)
        self.dark = mat(f"{cid}_dark", dark, metal=0.5, rough=0.45)
        self.accent = mat(f"{cid}_accent", accent, metal=0.2, rough=0.35)
        self.screen = mat(f"{cid}_screen", (0.02, 0.025, 0.035), metal=0.0, rough=0.12)
        self.eye = mat(f"{cid}_eye", eye, emit=eye)


HEAD = (0.5, 0.42, 0.4)  # szer., gleb., wys. glowy robota
FACE_Y = -HEAD[1] / 2 - 0.004  # przednia sciana ekranu twarzy


def robot(cid, p, *, chest=None, pauldrons=True, backpack=True):
    """Robot-krytyk o wspolnym szkielecie. Zwraca (korzen, stawy)."""
    root = bpy.data.objects.new(cid, None)
    bpy.context.collection.objects.link(root)
    root["character"] = cid
    j = {}

    # Biodra i nogi: krotkie i masywne — zabawkowe proporcje.
    j["hips"] = pivot("hips", root, (0, 0, 0.74))
    block("pelvis", j["hips"], (0.44, 0.28, 0.16), (0, 0, 0), p.dark, 0.04)
    block("belt", j["hips"], (0.47, 0.3, 0.05), (0, 0, 0.06), p.trim, 0.015)
    for side, sx in (("L", 1), ("R", -1)):
        hip = j[f"hip_{side}"] = pivot(f"hip_{side}", j["hips"], (sx * 0.13, 0, -0.06))
        cyl(f"hipjoint_{side}", hip, 0.07, 0.17, (0, 0, -0.01), p.dark)
        block(f"thigh_{side}", hip, (0.17, 0.19, 0.24), (0, 0, -0.14), p.body, 0.035)
        knee = j[f"knee_{side}"] = pivot(f"knee_{side}", hip, (0, 0, -0.29))
        cyl(f"kneejoint_{side}", knee, 0.065, 0.15, (0, 0, 0), p.dark)
        block(f"kneecap_{side}", knee, (0.12, 0.04, 0.09), (0, -0.09, 0.0), p.trim, 0.015)
        block(f"shin_{side}", knee, (0.16, 0.18, 0.26), (0, 0, -0.16), p.body, 0.035)
        block(f"boot_{side}", knee, (0.21, 0.32, 0.1), (0, -0.05, -0.38), p.dark, 0.035)
        block(f"toecap_{side}", knee, (0.19, 0.08, 0.07), (0, -0.19, -0.385), p.accent, 0.02)

    # Tulow: klatka piersiowa szersza od brzucha, z panelem na plecach.
    j["spine"] = pivot("spine", j["hips"], (0, 0, 0.09))
    block("abdomen", j["spine"], (0.4, 0.27, 0.14), (0, 0, 0.06), p.dark, 0.03)
    for i in range(2):
        block(f"rib_{i}", j["spine"], (0.42, 0.29, 0.02), (0, 0, 0.035 + i * 0.05), p.trim, 0.006)
    block("chest", j["spine"], (0.58, 0.38, 0.38), (0, 0, 0.32), p.body, 0.06)
    if backpack:
        block("backpack", j["spine"], (0.4, 0.1, 0.28), (0, 0.22, 0.33), p.dark, 0.03)
    for i in range(3 if backpack else 0):
        block(f"vent_{i}", j["spine"], (0.3, 0.02, 0.025), (0, 0.272, 0.25 + i * 0.07), p.trim, 0.005)
    if chest:
        chest(j["spine"], p)
    else:
        block("chestplate", j["spine"], (0.32, 0.03, 0.2), (0, -0.19, 0.34), p.accent, 0.02)

    # Szyja i glowa: duza glowa, twarz jako ciemny ekran.
    j["neck"] = pivot("neck", j["spine"], (0, 0, 0.51))
    cyl("neckpipe", j["neck"], 0.075, 0.09, (0, 0, 0.03), p.dark, axis="Z")
    cyl("neckring", j["neck"], 0.095, 0.025, (0, 0, 0.0), p.trim, axis="Z")
    j["head"] = pivot("head", j["neck"], (0, 0, 0.07))
    block("skull", j["head"], HEAD, (0, 0, HEAD[2] / 2), p.body, 0.07)
    block("facebezel", j["head"], (0.42, 0.02, 0.27), (0, FACE_Y + 0.006, 0.2), p.dark, 0.03)
    block("screen", j["head"], (0.38, 0.02, 0.23), (0, FACE_Y - 0.002, 0.2), p.screen, 0.025)
    for side, sx in (("L", 1), ("R", -1)):
        cyl(f"earbolt_{side}", j["head"], 0.07, 0.05, (sx * 0.26, 0, 0.2), p.trim)
        cyl(f"earcap_{side}", j["head"], 0.04, 0.03, (sx * 0.29, 0, 0.2), p.accent)

    # Rece: naramiennik, przeguby, mocne przedramie, dlon z kciukiem.
    for side, sx in (("L", 1), ("R", -1)):
        sh = j[f"shoulder_{side}"] = pivot(f"shoulder_{side}", j["spine"], (sx * 0.36, 0, 0.42))
        cyl(f"shoulderjoint_{side}", sh, 0.075, 0.12, (0, 0, 0), p.dark)
        if pauldrons:
            block(f"pauldron_{side}", sh, (0.2, 0.26, 0.11), (sx * 0.03, 0, 0.06), p.body, 0.045)
        block(f"upperarm_{side}", sh, (0.12, 0.13, 0.2), (0, 0, -0.12), p.trim, 0.03)
        el = j[f"elbow_{side}"] = pivot(f"elbow_{side}", sh, (0, 0, -0.24))
        cyl(f"elbowjoint_{side}", el, 0.06, 0.13, (0, 0, 0), p.dark)
        block(f"forearm_{side}", el, (0.15, 0.16, 0.2), (0, 0, -0.12), p.body, 0.04)
        block(f"cuff_{side}", el, (0.16, 0.17, 0.04), (0, 0, -0.22), p.accent, 0.012)
        block(f"palm_{side}", el, (0.11, 0.13, 0.11), (0, 0, -0.29), p.dark, 0.03)
        block(f"thumb_{side}", el, (0.04, 0.05, 0.07), (-sx * 0.065, -0.04, -0.27), p.dark, 0.015)
    return root, j


def pixels(name, parent, rows, px, center, y, material):
    """Piksel-art z klockow: rows to napisy, X = zapalony piksel; center = (x, z) srodka obrazka."""
    h, w = len(rows), max(len(row) for row in rows)
    for i, row in enumerate(rows):
        for k, ch in enumerate(row):
            if ch == "X":
                x = center[0] + (k - (w - 1) / 2) * px
                z = center[1] + ((h - 1) / 2 - i) * px
                block(f"{name}_{i}_{k}", parent, (px * 0.92, 0.012, px * 0.92), (x, y, z), material, 0)


def eyes_pair(head, p, w=0.07, h=0.08, gap=0.09, z=0.22, tilt=0.0, prefix="eye"):
    for side, sx in (("L", 1), ("R", -1)):
        block(f"{prefix}_{side}", head, (w, 0.012, h), (sx * gap, FACE_Y - 0.012, z), p.eye, min(w, h) * 0.35, rot=(0, sx * r(tilt), 0))


def mouth(head, p, w=0.12, z=0.13, smile=0.0):
    """Usta z trzech segmentow; smile > 0 unosi kaciki (usmiech), < 0 opuszcza."""
    seg = w / 3
    block("mouth_mid", head, (seg, 0.012, 0.022), (0, FACE_Y - 0.012, z), p.eye, 0.006)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"mouth_{side}", head, (seg, 0.012, 0.022), (sx * seg * 0.95, FACE_Y - 0.012, z + smile * 0.5), p.eye, 0.006, rot=(0, -sx * r(smile * 600), 0))


# ---------------------------------------------------------------- krytycy


def build_ats():
    # Bot ATS: jedno szerokie oko-skaner i kod kreskowy na piersi — czyta tylko slowa kluczowe.
    p = Palette("ats", (0.08, 0.5, 0.46), (0.82, 0.86, 0.84), (0.1, 0.13, 0.15), (0.98, 0.78, 0.15), (0.35, 1.0, 0.5))

    def chest(spine, p):
        block("labelplate", spine, (0.34, 0.03, 0.2), (0, -0.19, 0.34), p.trim, 0.015)
        bars = mat("ats_bars", (0.04, 0.05, 0.06), rough=0.6)
        x = -0.13
        for i, w in enumerate((0.012, 0.03, 0.012, 0.02, 0.04, 0.012, 0.025, 0.012, 0.03, 0.016)):
            block(f"barcode_{i}", spine, (w, 0.012, 0.13), (x + w / 2, -0.207, 0.355), bars, 0)
            x += w + 0.012
        block("scanled", spine, (0.24, 0.012, 0.02), (0, -0.207, 0.27), p.eye, 0)

    root, j = robot("ats", p, chest=chest)
    block("scanner", j["head"], (0.32, 0.012, 0.045), (0, FACE_Y - 0.012, 0.22), p.eye, 0.012)
    block("scanbeam", j["head"], (0.08, 0.013, 0.07), (0.06, FACE_Y - 0.014, 0.22), mat("ats_beam", (1, 1, 1), emit=(0.8, 1.0, 0.85), strength=6), 0.015)
    block("readout", j["head"], (0.16, 0.012, 0.02), (-0.08, FACE_Y - 0.012, 0.14), p.eye, 0.005)
    for side, sx in (("L", 1), ("R", -1)):
        cyl(f"antenna_{side}", j["head"], 0.014, 0.16, (sx * 0.15, 0, 0.47), p.dark, axis="Z", bevel=0)
        block(f"antennatip_{side}", j["head"], (0.045, 0.045, 0.045), (sx * 0.15, 0, 0.56), p.accent, 0.015)
    return root


def build_hr():
    # HR screener: przyjazne okragle oczy, usmiech, rumience i podkladka z formularzem.
    p = Palette("hr", (0.93, 0.52, 0.46), (0.98, 0.9, 0.82), (0.32, 0.2, 0.26), (0.98, 0.78, 0.35), (0.55, 0.95, 1.0))
    def chest(spine, p):
        block("heartplate", spine, (0.26, 0.03, 0.2), (0, -0.19, 0.34), p.dark, 0.02)
        heart = mat("hr_heart", (1.0, 0.3, 0.45), emit=(1.0, 0.25, 0.42), strength=1.2)
        pixels("heart", spine, [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."], 0.025, (0, 0.34), -0.207, heart)

    root, j = robot("hr", p, chest=chest)
    eyes_pair(j["head"], p, w=0.075, h=0.085, gap=0.085, z=0.23)
    mouth(j["head"], p, w=0.12, z=0.14, smile=0.025)
    blush = mat("hr_blush", (1.0, 0.45, 0.55), emit=(1.0, 0.35, 0.5), strength=1.5)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"blush_{side}", j["head"], (0.05, 0.01, 0.022), (sx * 0.14, FACE_Y - 0.01, 0.16), blush, 0.006)
    # Lewa reka trzyma podkladke przed soba.
    board = mat("hr_board", (0.5, 0.32, 0.18), rough=0.7)
    paper = mat("hr_paper", (0.97, 0.97, 0.95), rough=0.85)
    ink = mat("hr_ink", (0.25, 0.3, 0.4), rough=0.8)
    el = j["elbow_L"]
    block("clipboard", el, (0.03, 0.26, 0.32), (0.1, -0.06, -0.3), board, 0.012)
    block("clip", el, (0.035, 0.08, 0.03), (0.1, -0.06, -0.14), mat("hr_clip", (0.75, 0.75, 0.78), metal=0.9, rough=0.3), 0.008)
    block("form", el, (0.006, 0.22, 0.27), (0.117, -0.06, -0.31), paper, 0)
    for i in range(5):
        block(f"formline_{i}", el, (0.004, 0.16 - (i % 2) * 0.05, 0.012), (0.121, -0.06 + (i % 2) * 0.025, -0.22 - i * 0.045), ink, 0)
    # Kokarda na glowie — czytelny znak HR z daleka.
    bow = mat("hr_bow", (0.85, 0.2, 0.35), rough=0.45)
    block("bowknot", j["head"], (0.06, 0.06, 0.06), (0.14, 0.02, 0.42), bow, 0.02)
    for side, sx in (("a", 1), ("b", -1)):
        block(f"bowloop_{side}", j["head"], (0.1, 0.05, 0.08), (0.14 + sx * 0.07, 0.02, 0.42), bow, 0.025, rot=(0, sx * r(20), 0))
    return root


def build_tech_lead():
    # Tech Lead: ciemny, sceptyczny (jedna brew w gore), sluchawki i kubek kawy.
    p = Palette("techLead", (0.24, 0.27, 0.33), (0.4, 0.44, 0.5), (0.1, 0.11, 0.13), (0.98, 0.5, 0.1), (1.0, 0.6, 0.18))

    def chest(spine, p):
        # Ekran na piersi z symbolem kodu.
        block("chestbezel", spine, (0.34, 0.03, 0.2), (0, -0.19, 0.34), p.dark, 0.02)
        block("chestscreen", spine, (0.3, 0.012, 0.16), (0, -0.203, 0.34), p.screen, 0.012)
        pixels("code", spine, ["..X....X..X..", ".X.....X...X.", "X.....X.....X", ".X...X.....X.", "..X..X....X.."], 0.02, (0, 0.34), -0.211, p.eye)

    root, j = robot("techLead", p, chest=chest)
    eyes_pair(j["head"], p, w=0.085, h=0.05, gap=0.09, z=0.215)
    block("brow_L", j["head"], (0.09, 0.012, 0.018), (0.09, FACE_Y - 0.012, 0.275), p.eye, 0.004, rot=(0, r(-12), 0))
    block("brow_R", j["head"], (0.09, 0.012, 0.018), (-0.09, FACE_Y - 0.012, 0.265), p.eye, 0.004)
    block("mouth", j["head"], (0.1, 0.012, 0.02), (0.02, FACE_Y - 0.012, 0.13), p.eye, 0.005, rot=(0, r(6), 0))
    band = mat("techLead_band", (0.06, 0.06, 0.07), rough=0.4)
    block("headband", j["head"], (0.6, 0.08, 0.05), (0, 0, 0.43), band, 0.02)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"bandside_{side}", j["head"], (0.04, 0.08, 0.2), (sx * 0.285, 0, 0.34), band, 0.015)
        cyl(f"earcup_{side}", j["head"], 0.1, 0.07, (sx * 0.29, 0, 0.2), band, verts=24)
        cyl(f"earring_{side}", j["head"], 0.075, 0.075, (sx * 0.295, 0, 0.2), p.accent, verts=24)
    cyl("mic", j["head"], 0.012, 0.2, (0.27, -0.12, 0.13), band, axis="Y", bevel=0)
    block("mictip", j["head"], (0.04, 0.04, 0.04), (0.27, -0.22, 0.13), p.accent, 0.012)
    # Kubek w prawej dloni.
    mug = mat("techLead_mug", (0.95, 0.95, 0.93), rough=0.3)
    el = j["elbow_R"]
    cyl("mug", el, 0.06, 0.13, (0, -0.1, -0.29), mug, axis="Z", verts=24)
    cyl("coffee", el, 0.052, 0.01, (0, -0.1, -0.222), mat("techLead_coffee", (0.25, 0.13, 0.06), rough=0.2), axis="Z", verts=24, bevel=0)
    block("mughandle", el, (0.02, 0.04, 0.08), (0, -0.175, -0.29), mug, 0.01)
    return root


BUILDERS = {
    "ats": build_ats,
    "hr": build_hr,
    "techLead": build_tech_lead,
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
