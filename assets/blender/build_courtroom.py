"""Generator sali sadowej Trybunalu: klocki w stylu postaci i punkty zaczepienia dla sceny 3D.

Uruchomienie (z katalogu repo):

    blender --background --python assets/blender/build_courtroom.py

Zapisuje apps/web/public/models/courtroom.glb i podglad assets/blender/courtroom.png.
Puste wezly seat_*, judge_seat, prosecutor_stand, cv_table to miejsca postaci i akt (obrot = kierunek
patrzenia), a cam_* z cam_*_target to ujecia kamery. Przod sali (strona kamery) to -Y.
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blocks import block, clear_scene, cyl, export, mat, pivot, pixels, r  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODELS = os.path.join(REPO, "apps", "web", "public", "models")
PREVIEW = os.path.join(REPO, "assets", "blender", "courtroom.png")

# Wymiary sali (m): podloga x od -W do W, y od FRONT do BACK; sciany wysokosci H.
W, FRONT, BACK, H = 6.0, -3.0, 7.0, 4.4
PANEL = 1.3  # wysokosc boazerii
JURY_TURN = 60  # przysiegli patrza na srodek sali i lekko w strone kamery
JURY = ["ats", "hr", "techLead", "hiringManager"]  # kolejnosc krytykow z domeny, od glebi sali
SHOTS = ["wide", "judge", "jury", "prosecutor", "table"]
# Puste wezly, ktore zostaja w pliku: kontrakt ze scena 3D (test w apps/web to sprawdza).
ANCHORS = {f"seat_{cid}" for cid in JURY} | {"judge_seat", "prosecutor_stand", "cv_table"}
ANCHORS |= {f"cam_{s}" for s in SHOTS} | {f"cam_{s}_target" for s in SHOTS}


class Palette:
    def __init__(self):
        self.wood_dark = mat("wood_dark", (0.26, 0.14, 0.07), rough=0.5)
        self.wood = mat("wood", (0.42, 0.25, 0.12), rough=0.5)
        self.plank_a = mat("plank_a", (0.58, 0.39, 0.22), rough=0.6)
        self.plank_b = mat("plank_b", (0.52, 0.34, 0.19), rough=0.6)
        self.plank_c = mat("plank_c", (0.62, 0.43, 0.25), rough=0.6)
        self.pot = mat("pot", (0.7, 0.35, 0.2), rough=0.7)
        self.leaf = mat("leaf", (0.2, 0.5, 0.22), rough=0.6)
        self.leaf_dark = mat("leaf_dark", (0.12, 0.38, 0.16), rough=0.6)
        self.books = [mat(f"book_{i}", c, rough=0.6) for i, c in enumerate(((0.55, 0.1, 0.1), (0.1, 0.25, 0.5), (0.15, 0.4, 0.2), (0.6, 0.45, 0.15), (0.3, 0.15, 0.35)))]
        self.wall = mat("wall", (0.86, 0.8, 0.68), rough=0.85)
        self.carpet = mat("carpet", (0.55, 0.08, 0.1), rough=0.9)
        self.gold = mat("gold", (0.95, 0.72, 0.25), metal=1.0, rough=0.25)
        self.leather = mat("leather", (0.45, 0.06, 0.08), rough=0.45)
        self.marble = mat("marble", (0.88, 0.87, 0.83), rough=0.3)
        self.glass = mat("glass", (0.6, 0.8, 0.95), emit=(0.65, 0.82, 1.0), strength=1.2)
        self.lamp = mat("lamp", (1.0, 0.85, 0.6), emit=(1.0, 0.8, 0.5), strength=4)
        self.white = mat("white", (0.95, 0.95, 0.93), rough=0.6)
        self.red = mat("red", (0.8, 0.08, 0.12), rough=0.6)
        self.paper = mat("paper", (0.97, 0.96, 0.92), rough=0.85)
        self.ink = mat("ink", (0.2, 0.25, 0.35), rough=0.8)
        self.folder = mat("folder", (0.15, 0.3, 0.55), rough=0.6)


def floor(root, p):
    g = pivot("floor", root, (0, 0, 0))
    # Deski po 2,4 m z przesunietymi laczeniami; trzy odcienie na zmiane, zeby podloga nie byla w paski.
    plank, length = 0.4, 2.4
    tones = (p.plank_a, p.plank_b, p.plank_c)
    for i in range(int(2 * W / plank)):
        x = -W + plank * (i + 0.5)
        y, k = FRONT - (i * 0.9) % length, 0
        while y < BACK:
            y0, y1 = max(y, FRONT), min(y + length, BACK)
            block(f"plank_{i}_{k}", g, (plank - 0.012, y1 - y0 - 0.01, 0.06), (x, (y0 + y1) / 2, -0.03), tones[(i * 7 + k * 3) % 3], 0)
            y, k = y + length, k + 1
    # Czerwony chodnik od wejscia do stopnia przed lawa sedziowska.
    y0, y1 = FRONT, 4.2
    block("carpet", g, (1.6, y1 - y0, 0.012), (0, (y0 + y1) / 2, 0.006), p.carpet, 0.004)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"carpetedge_{side}", g, (0.06, y1 - y0, 0.014), (sx * 0.77, (y0 + y1) / 2, 0.007), p.gold, 0)


def walls(root, p):
    """Sciana w glebi i dwie boczne: boazeria z ramami paneli, tynk, gzyms."""
    g = pivot("walls", root, (0, 0, 0))
    depth = BACK - FRONT
    block("backwall", g, (2 * W, 0.2, H), (0, BACK + 0.1, H / 2), p.wall, 0)
    block("backpanel", g, (2 * W, 0.08, PANEL), (0, BACK - 0.04, PANEL / 2), p.wood, 0.01)
    block("backcornice", g, (2 * W, 0.16, 0.14), (0, BACK - 0.08, H - 0.07), p.wood_dark, 0.02)
    for k in range(12):
        x = -W + 0.5 + k
        block(f"backframe_{k}", g, (0.7, 0.03, PANEL - 0.4), (x, BACK - 0.095, PANEL / 2), p.wood_dark, 0)
    for side, sx in (("L", -1), ("R", 1)):
        x = sx * (W + 0.1)
        block(f"sidewall_{side}", g, (0.2, depth, H), (x, (FRONT + BACK) / 2, H / 2), p.wall, 0)
        block(f"sidepanel_{side}", g, (0.08, depth, PANEL), (x - sx * 0.14, (FRONT + BACK) / 2, PANEL / 2), p.wood, 0.01)
        block(f"sidecornice_{side}", g, (0.16, depth, 0.14), (x - sx * 0.18, (FRONT + BACK) / 2, H - 0.07), p.wood_dark, 0.02)
        block(f"sidechair_{side}", g, (0.06, depth, 0.06), (x - sx * 0.2, (FRONT + BACK) / 2, PANEL + 0.03), p.wood_dark, 0.01)
        for k in range(10):
            y = FRONT + 0.5 + k
            block(f"sideframe_{side}_{k}", g, (0.03, 0.7, PANEL - 0.4), (x - sx * 0.195, y, PANEL / 2), p.wood_dark, 0)
        # Dwa wysokie okna z laczeniami i kinkiety miedzy nimi.
        for k, y in enumerate((0.2, 3.8)):
            block(f"window_{side}_{k}", g, (0.06, 1.3, 2.0), (x - sx * 0.13, y, 2.55), p.glass, 0)
            block(f"windowframe_{side}_{k}", g, (0.1, 1.46, 2.16), (x - sx * 0.1, y, 2.55), p.white, 0.02)
            block(f"windowmullion_{side}_{k}", g, (0.08, 0.05, 2.0), (x - sx * 0.15, y, 2.55), p.white, 0)
            block(f"windowtransom_{side}_{k}", g, (0.08, 1.3, 0.05), (x - sx * 0.15, y, 2.9), p.white, 0)
            block(f"windowsill_{side}_{k}", g, (0.22, 1.5, 0.06), (x - sx * 0.16, y, 1.5), p.white, 0.01)
        block(f"sconce_{side}", g, (0.1, 0.16, 0.3), (x - sx * 0.17, 2.0, 2.6), p.gold, 0.02)
        block(f"sconcelight_{side}", g, (0.12, 0.14, 0.14), (x - sx * 0.2, 2.0, 2.82), p.lamp, 0.03)


def cameras(root):
    """Ujecia kamery: punkt i cel. Scena przelacza je, gdy zmienia sie mowca."""
    shots = {
        "wide": ((0, -6.2, 3.7), (0, 2.6, 1.0)),
        "judge": ((0, 1.2, 2.3), (0, 5.8, 2.0)),
        "jury": ((0.4, -0.4, 2.0), (-4.75, 2.4, 1.4)),
        "prosecutor": ((-0.6, -0.6, 2.0), (4.06, 2.36, 1.6)),
        "table": ((0, -0.2, 2.1), (0, 2.0, 0.8)),
    }
    for name, (eye, target) in shots.items():
        pivot(f"cam_{name}", root, eye)
        pivot(f"cam_{name}_target", root, target)


def flatten(root):
    """Sala jest statyczna: cala geometria trafia pod jeden wezel "set", wiec po polaczeniu jest
    jedna siatka i jeden draw call na material. Puste wezly (miejsca, kamery) zostaja osobno."""
    group = pivot("set", root, (0, 0, 0))
    bpy.context.view_layer.update()
    for o in [o for o in root.children_recursive if o.type == "MESH"]:
        world = o.matrix_world.copy()
        o.parent = group
        o.matrix_world = world
    for o in [o for o in root.children_recursive if o.type == "EMPTY" and o.name not in ANCHORS and o is not group]:
        bpy.data.objects.remove(o, do_unlink=True)


def build():
    root = bpy.data.objects.new("courtroom", None)
    bpy.context.collection.objects.link(root)
    p = Palette()
    floor(root, p)
    walls(root, p)
    cameras(root)
    return root


def preview(path, eye=(0, -6.2, 3.7), rot=(68, 0, 0), lens=24):
    """Podglad sali z ujecia ogolnego, w kolorach jak w przegladarce."""
    cam = bpy.data.objects.new("previewcam", bpy.data.cameras.new("previewcam"))
    bpy.context.collection.objects.link(cam)
    cam.location = eye
    cam.rotation_euler = tuple(r(a) for a in rot)
    cam.data.lens = lens
    for name, energy, rot_l in (("key", 3.0, (40, 10, -30)), ("fill", 1.0, (60, 0, 140))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        bpy.context.collection.objects.link(light)
        light.data.energy = energy
        light.rotation_euler = tuple(r(a) for a in rot_l)
    scene = bpy.context.scene
    scene.camera = cam
    world = scene.world or bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.62, 0.68, 0.78, 1)
    bg.inputs[1].default_value = 0.7
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    clear_scene()
    root = build()
    flatten(root)
    export(root, os.path.join(MODELS, "courtroom.glb"))
    preview(PREVIEW)


if __name__ == "__main__":
    main()
