"""Generator postaci Trybunalu: 4 krytykow-robotow, smok-prokurator i sedzia.

Postacie sa z klockow, a kazdy staw to pusty obiekt (pivot). Scena 3D obraca pivoty w kodzie,
wiec nie potrzebujemy szkieletu ani klatek animacji. Uruchomienie (z katalogu repo):

    blender --background --python assets/blender/build_characters.py

Zapisuje apps/web/public/models/<id>.glb i podglad assets/blender/lineup.png.
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


def build_hiring_manager():
    # Hiring Manager: granatowy garnitur z klapami, krawat, spokojna twarz i teczka.
    p = Palette("hiringManager", (0.16, 0.24, 0.48), (0.24, 0.33, 0.6), (0.08, 0.1, 0.17), (0.85, 0.7, 0.35), (0.6, 0.85, 1.0))
    shirt = mat("hiringManager_shirt", (0.96, 0.96, 0.98), rough=0.7)
    tie = mat("hiringManager_tie", (0.78, 0.12, 0.14), rough=0.45)

    def chest(spine, p):
        block("shirt", spine, (0.16, 0.03, 0.3), (0, -0.188, 0.35), shirt, 0.01)
        block("knot", spine, (0.06, 0.035, 0.05), (0, -0.2, 0.47), tie, 0.012)
        block("tie", spine, (0.07, 0.025, 0.22), (0, -0.2, 0.33), tie, 0.012)
        for side, sx in (("L", 1), ("R", -1)):
            block(f"lapel_{side}", spine, (0.07, 0.03, 0.26), (sx * 0.1, -0.195, 0.37), p.trim, 0.012, rot=(0, sx * r(-18), 0))
        block("pocketsquare", spine, (0.07, 0.03, 0.03), (0.2, -0.195, 0.43), p.accent, 0.008)
        for i in range(2):
            cyl(f"button_{i}", spine, 0.014, 0.02, (0, -0.2, 0.19 + i * 0.06), p.accent, axis="Y", bevel=0)

    root, j = robot("hiringManager", p, chest=chest)
    eyes_pair(j["head"], p, w=0.075, h=0.07, gap=0.09, z=0.22)
    mouth(j["head"], p, w=0.11, z=0.135, smile=0.008)
    # Fryzura z przedzialkiem — zeby z daleka nie mylil sie z innymi robotami.
    hair = mat("hiringManager_hair", (0.18, 0.12, 0.08), rough=0.6)
    block("hair", j["head"], (0.53, 0.45, 0.06), (0, 0.01, 0.41), hair, 0.03)
    block("hairback", j["head"], (0.53, 0.08, 0.2), (0, 0.2, 0.33), hair, 0.03)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"hairside_{side}", j["head"], (0.04, 0.34, 0.14), (sx * 0.255, 0.04, 0.35), hair, 0.015)
    # Przedzialek z lewej, grzywka zaczesana w prawo i lekko uniesiona.
    block("quiff", j["head"], (0.36, 0.16, 0.07), (-0.07, -0.13, 0.445), hair, 0.03, rot=(r(-10), r(-6), 0))
    block("parting", j["head"], (0.015, 0.3, 0.012), (0.12, -0.02, 0.442), mat("hiringManager_parting", (0.1, 0.07, 0.05)), 0)
    # Teczka w prawej dloni.
    leather = mat("hiringManager_case", (0.36, 0.2, 0.1), rough=0.55)
    el = j["elbow_R"]
    block("briefcase", el, (0.1, 0.38, 0.27), (0, -0.02, -0.5), leather, 0.03)
    block("casehandle", el, (0.03, 0.14, 0.04), (0, -0.02, -0.35), leather, 0.01)
    for side, sy in (("a", 1), ("b", -1)):
        block(f"caselatch_{side}", el, (0.105, 0.04, 0.03), (0, -0.02 + sy * 0.1, -0.41), p.accent, 0.006)
    return root


def build_judge():
    """Sedzia: wiekszy robot w todze z fioletowym zabotem, lancuchem, peruka i mlotkiem."""
    p = Palette("judge", (0.6, 0.63, 0.68), (0.78, 0.8, 0.84), (0.16, 0.16, 0.18), (0.88, 0.68, 0.22), (1.0, 0.85, 0.45))
    robe = mat("judge_robe", (0.035, 0.035, 0.045), rough=0.85)
    purple = mat("judge_jabot", (0.42, 0.14, 0.58), rough=0.6)
    gold = mat("judge_gold", (0.95, 0.72, 0.25), metal=1.0, rough=0.25)

    def chest(spine, p):
        # Toga do kolan, rozszerzajaca sie ku dolowi; fioletowy kolnierz i zabot jak w polskim sadzie.
        block("robe", spine, (0.66, 0.44, 0.96), (0, 0, 0.06), robe, 0.08)
        block("robeseam", spine, (0.012, 0.012, 0.6), (0, -0.222, -0.1), mat("judge_seam", (0.13, 0.13, 0.15), rough=0.8), 0)
        block("collar", spine, (0.46, 0.4, 0.06), (0, 0, 0.53), purple, 0.025)
        block("jabot", spine, (0.13, 0.04, 0.16), (0, -0.235, 0.43), purple, 0.025)
        # Lancuch sedziowski: ogniwa w ksztalt litery V, medalion z orlem.
        links = 5
        for side, sx in (("L", 1), ("R", -1)):
            for k in range(links):
                t = k / (links - 1)
                x, z = sx * (0.2 - 0.17 * t), 0.5 - 0.2 * t
                block(f"chain_{side}_{k}", spine, (0.045, 0.03, 0.03), (x, -0.235, z), gold, 0.008, rot=(0, sx * r(50), 0))
        cyl("medallion", spine, 0.06, 0.025, (0, -0.245, 0.24), gold, axis="Y", verts=28)
        block("eagle", spine, (0.05, 0.012, 0.055), (0, -0.26, 0.24), mat("judge_eagle", (0.95, 0.95, 0.95), rough=0.4), 0.006)

    root, j = robot("judge", p, chest=chest, pauldrons=False, backpack=False)
    # Toga zaslania tez ramiona; fioletowy mankiet na koncu rekawa.
    for side, sx in (("L", 1), ("R", -1)):
        sh = j[f"shoulder_{side}"]
        block(f"sleeve_{side}", sh, (0.24, 0.27, 0.36), (sx * 0.01, 0, -0.07), robe, 0.07)
        el = j[f"elbow_{side}"]
        block(f"sleevelower_{side}", el, (0.22, 0.24, 0.2), (0, 0, -0.1), robe, 0.06)
        block(f"sleevecuff_{side}", el, (0.23, 0.25, 0.05), (0, 0, -0.2), purple, 0.02)
    eyes_pair(j["head"], p, w=0.08, h=0.05, gap=0.09, z=0.21)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"brow_{side}", j["head"], (0.1, 0.012, 0.02), (sx * 0.09, FACE_Y - 0.012, 0.26), p.eye, 0.005, rot=(0, sx * r(14), 0))
    block("mouth", j["head"], (0.12, 0.012, 0.02), (0, FACE_Y - 0.012, 0.13), p.eye, 0.005)
    # Peruka: czapa i trzy rzedy lokow po bokach.
    wig = mat("judge_wig", (0.96, 0.95, 0.9), rough=0.95)
    block("wigtop", j["head"], (0.56, 0.48, 0.12), (0, 0.02, 0.43), wig, 0.05)
    for side, sx in (("L", 1), ("R", -1)):
        for k in range(3):
            cyl(f"curl_{side}_{k}", j["head"], 0.055, 0.42, (sx * 0.3, 0.03, 0.38 - k * 0.11), wig, axis="Y", verts=16)
    block("wigback", j["head"], (0.54, 0.06, 0.3), (0, 0.235, 0.3), wig, 0.03)
    for k in range(2):
        cyl(f"backcurl_{k}", j["head"], 0.05, 0.5, (0, 0.27, 0.2 - k * 0.1), wig, axis="X", verts=16)
    # Mlotek w prawej dloni: trzonek do przodu, obuch w poprzek.
    wood = mat("judge_wood", (0.38, 0.2, 0.09), rough=0.5)
    el = j["elbow_R"]
    cyl("gavelhandle", el, 0.022, 0.3, (0, -0.15, -0.29), wood, axis="Y", bevel=0)
    cyl("gavelhead", el, 0.055, 0.2, (0, -0.31, -0.29), wood, axis="X", verts=24)
    for side, sx in (("a", 1), ("b", -1)):
        cyl(f"gavelband_{side}", el, 0.058, 0.02, (sx * 0.07, -0.31, -0.29), gold, axis="X", verts=24, bevel=0)
    root.scale = (1.18, 1.18, 1.18)
    return root


def build_prosecutor():
    """Smok-prokurator w todze z czerwonym zabotem: szczeka, ogon i skrzydla maja wlasne stawy."""
    cid = "prosecutor"
    scale = mat(f"{cid}_scale", (0.13, 0.45, 0.22), rough=0.55)
    scale_dark = mat(f"{cid}_scaledark", (0.07, 0.28, 0.13), rough=0.6)
    belly = mat(f"{cid}_belly", (0.92, 0.78, 0.42), rough=0.6)
    horn = mat(f"{cid}_horn", (0.93, 0.89, 0.78), rough=0.35)
    eye = mat(f"{cid}_eye", (1.0, 0.75, 0.1), emit=(1.0, 0.62, 0.05), strength=5)
    pupil = mat(f"{cid}_pupil", (0.02, 0.02, 0.02), rough=0.2)
    robe = mat(f"{cid}_robe", (0.04, 0.04, 0.05), rough=0.85)
    red = mat(f"{cid}_jabot", (0.75, 0.08, 0.1), rough=0.55)
    membrane = mat(f"{cid}_membrane", (0.55, 0.12, 0.14), rough=0.7)
    teeth = mat(f"{cid}_teeth", (0.98, 0.97, 0.92), rough=0.3)
    mouth_in = mat(f"{cid}_mouth", (0.35, 0.05, 0.06), rough=0.6)

    root = bpy.data.objects.new(cid, None)
    bpy.context.collection.objects.link(root)
    root["character"] = cid

    hips = pivot("hips", root, (0, 0, 0.7))
    block("pelvis", hips, (0.5, 0.4, 0.2), (0, 0, 0), scale, 0.05)

    # Nogi: grube uda, stopy z trzema pazurami.
    for side, sx in (("L", 1), ("R", -1)):
        hp = pivot(f"hip_{side}", hips, (sx * 0.17, 0, -0.06))
        block(f"thigh_{side}", hp, (0.22, 0.26, 0.26), (0, 0.02, -0.12), scale, 0.06)
        kn = pivot(f"knee_{side}", hp, (0, 0, -0.27))
        block(f"shin_{side}", kn, (0.17, 0.19, 0.26), (0, 0.02, -0.14), scale, 0.045)
        block(f"foot_{side}", kn, (0.22, 0.3, 0.1), (0, -0.06, -0.33), scale_dark, 0.035)
        for k, dx in enumerate((-0.07, 0, 0.07)):
            spike(f"toeclaw_{side}_{k}", kn, 0.03, 0.08, (dx, -0.23, -0.35), horn, rot=(r(-90), 0, 0))

    # Tulow w todze, brzuch w luskach, czerwony zabot prokuratora.
    spine = pivot("spine", hips, (0, 0, 0.09))
    block("robe", spine, (0.64, 0.5, 0.84), (0, 0.02, 0.11), robe, 0.08)
    block("collar", spine, (0.44, 0.42, 0.06), (0, 0.0, 0.52), red, 0.025)
    block("belly", spine, (0.26, 0.03, 0.42), (0, -0.24, 0.2), belly, 0.02)
    for i in range(4):
        block(f"bellyplate_{i}", spine, (0.22, 0.02, 0.012), (0, -0.257, 0.06 + i * 0.09), mat(f"{cid}_bellyline", (0.75, 0.6, 0.3), rough=0.7), 0)
    block("jabot", spine, (0.14, 0.04, 0.17), (0, -0.262, 0.42), red, 0.02)
    # Kolce wzdluz grzbietu.
    for i, (z, h) in enumerate(((0.5, 0.14), (0.38, 0.17), (0.24, 0.15), (0.1, 0.12))):
        spike(f"backspike_{i}", spine, 0.05, h, (0, 0.27 + h / 2 - 0.03, z), horn, rot=(r(-80), 0, 0))

    # Szyja i glowa: dlugi pysk, brwi zmarszczone, rogi zagiete do tylu.
    neck = pivot("neck", spine, (0, -0.02, 0.52))
    block("neckblock", neck, (0.24, 0.24, 0.2), (0, 0, 0.08), scale, 0.05)
    head = pivot("head", neck, (0, -0.04, 0.18))
    head.scale = (1.25, 1.25, 1.25)  # duza glowa jak u robotow — czytelna z drugiego konca sali
    block("skull", head, (0.42, 0.4, 0.3), (0, 0.02, 0.15), scale, 0.07)
    block("snout", head, (0.3, 0.3, 0.15), (0, -0.3, 0.12), scale, 0.05)
    block("nosebridge", head, (0.14, 0.24, 0.05), (0, -0.28, 0.21), scale_dark, 0.02)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"nostril_{side}", head, (0.03, 0.02, 0.018), (sx * 0.075, -0.452, 0.15), scale_dark, 0.006)
        block(f"eye_{side}", head, (0.09, 0.03, 0.07), (sx * 0.12, -0.19, 0.2), eye, 0.015)
        block(f"pupil_{side}", head, (0.02, 0.012, 0.06), (sx * 0.12, -0.207, 0.2), pupil, 0.004)
        block(f"brow_{side}", head, (0.13, 0.05, 0.04), (sx * 0.12, -0.19, 0.26), scale_dark, 0.012, rot=(0, sx * r(20), 0))
        block(f"horn_{side}", head, (0.07, 0.07, 0.16), (sx * 0.14, 0.1, 0.33), horn, 0.015, rot=(r(-35), sx * r(12), 0))
        block(f"horntip_{side}", head, (0.05, 0.05, 0.14), (sx * 0.15, 0.2, 0.42), horn, 0.012, rot=(r(-70), sx * r(12), 0))
        block(f"cheekfin_{side}", head, (0.03, 0.14, 0.1), (sx * 0.22, 0.06, 0.12), scale_dark, 0.01, rot=(0, 0, sx * r(-15)))
        for k in range(3):
            spike(f"tooth_{side}_{k}", head, 0.018, 0.045, (sx * (0.05 + k * 0.04), -0.32 - (0.08 - k * 0.04), 0.035), teeth, rot=(r(180), 0, 0))
    jaw = pivot("jaw", head, (0, -0.06, 0.06))
    block("lowerjaw", jaw, (0.27, 0.36, 0.07), (0, -0.2, -0.02), scale, 0.03)
    block("tongue", jaw, (0.15, 0.25, 0.02), (0, -0.2, 0.02), mouth_in, 0.008)
    for side, sx in (("L", 1), ("R", -1)):
        spike(f"fang_{side}", jaw, 0.022, 0.06, (sx * 0.1, -0.33, 0.035), teeth)

    # Rece: rekawy togi, lapy z trzema pazurami (prawa wskazuje oskarzonego).
    for side, sx in (("L", 1), ("R", -1)):
        sh = pivot(f"shoulder_{side}", spine, (sx * 0.38, 0, 0.42))
        block(f"sleeve_{side}", sh, (0.19, 0.2, 0.28), (0, 0, -0.1), robe, 0.045)
        el = pivot(f"elbow_{side}", sh, (0, 0, -0.24))
        block(f"forearm_{side}", el, (0.14, 0.15, 0.18), (0, 0, -0.09), scale, 0.04)
        block(f"cuff_{side}", el, (0.16, 0.17, 0.04), (0, 0, -0.01), red, 0.012)
        block(f"paw_{side}", el, (0.14, 0.14, 0.1), (0, 0, -0.22), scale, 0.035)
        for k, dx in enumerate((-0.045, 0, 0.045)):
            spike(f"claw_{side}_{k}", el, 0.018, 0.07, (dx, -0.04, -0.3), horn, rot=(r(180), 0, 0))

        # Skrzydla: plaska blona z falistym brzegiem rozpieta na kosciach-palcach. Geometria
        # siedzi w "plaszczyznie skrzydla" odchylonej do tylu, a staw wing_* zostaje bez obrotu.
        wing = pivot(f"wing_{side}", spine, (sx * 0.18, 0.26, 0.42))
        plane = pivot(f"wingplane_{side}", wing, (0, 0.02, 0))
        plane.rotation_euler = (0, 0, sx * r(-28))
        tip = (0.62, 0.42)
        fingers = [(0.5, -0.12), (0.34, -0.24), (0.16, -0.3)]
        edge = [tip, (0.56, 0.02), fingers[0], (0.42, -0.06), fingers[1], (0.25, -0.13), fingers[2], (0.05, -0.12), (0.0, 0.0)]
        flat(f"wingmembrane_{side}", plane, [(sx * x, z) for x, z in edge], membrane, 0.02)
        bones = [((0, 0), tip)] + [(tip, f) for f in fingers]
        for k, ((x0, z0), (x1, z1)) in enumerate(bones):
            length = math.hypot(x1 - x0, z1 - z0)
            angle = math.atan2(z1 - z0, x1 - x0)
            thick = 0.06 if k == 0 else 0.035
            block(f"wingbone_{side}_{k}", plane, (length + thick, thick, thick), (sx * (x0 + x1) / 2, 0.0, (z0 + z1) / 2), scale_dark, thick / 3, rot=(0, -sx * angle, 0))
        spike(f"wingclaw_{side}", plane, 0.03, 0.1, (sx * tip[0], 0, tip[1] + 0.05), horn, rot=(0, sx * r(-30), 0))

    # Ogon w trzech segmentach, zakonczony grotem.
    tail = pivot("tail", hips, (0, 0.2, -0.02))
    block("tail1", tail, (0.22, 0.34, 0.18), (0, 0.16, -0.04), scale, 0.05)
    spike("tailspike_0", tail, 0.04, 0.1, (0, 0.18, 0.08), horn)
    tail2 = pivot("tail2", tail, (0, 0.32, -0.06))
    block("tail2block", tail2, (0.16, 0.3, 0.13), (0, 0.14, -0.03), scale, 0.04)
    spike("tailspike_1", tail2, 0.032, 0.08, (0, 0.15, 0.06), horn)
    block("tailtip", tail2, (0.16, 0.16, 0.04), (0, 0.33, -0.03), scale_dark, 0.01, rot=(0, 0, r(45)))
    return root


BUILDERS = {
    "ats": build_ats,
    "hr": build_hr,
    "techLead": build_tech_lead,
    "hiringManager": build_hiring_manager,
    "prosecutor": build_prosecutor,
    "judge": build_judge,
}


# ---------------------------------------------------------------- eksport i podglad


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


def render_lineup():
    """Podglad wszystkich postaci obok siebie, wczytanych z gotowych plikow .glb."""
    clear_scene()
    order = ["ats", "hr", "techLead", "judge", "hiringManager", "prosecutor"]
    for i, cid in enumerate(order):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"{cid}.glb"))
        for o in set(bpy.data.objects) - before:
            if o.parent is None:
                o.location.x += (i - 2.5) * 1.15
    studio(LINEUP, size=(1600, 640), cam_loc=(0, -10.5, 1.5), cam_rot=(86, 0, 0))


def main():
    os.makedirs(MODELS, exist_ok=True)
    for cid, build in BUILDERS.items():
        clear_scene()
        export(build(), os.path.join(MODELS, f"{cid}.glb"))
    render_lineup()


if __name__ == "__main__":
    main()
