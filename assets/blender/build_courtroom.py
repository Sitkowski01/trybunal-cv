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


def bench(root, p):
    """Podwyzszenie i lawa sedziowska z waga sprawiedliwosci, krzeslo sedziego, flagi i zegar."""
    g = pivot("bench", root, (0, 0, 0))
    rise = 0.6
    # Blat na wysokosci lokci siedzacego sedziego: widac rece i mlotek, a nie tylko glowe.
    DESK = 0.95
    block("platform", g, (5.0, 2.4, rise), (0, 5.8, rise / 2), p.wood_dark, 0.02)
    block("step", g, (3.0, 0.4, rise / 2), (0, 4.4, rise / 4), p.wood_dark, 0.02)
    block("desk", g, (4.4, 0.5, DESK), (0, 5.05, rise + DESK / 2), p.wood, 0.03)
    block("desktop", g, (4.6, 0.7, 0.07), (0, 5.15, rise + DESK + 0.03), p.wood_dark, 0.02)
    for k, x in enumerate((-1.5, 1.5)):
        block(f"deskpanel_{k}", g, (1.0, 0.04, 0.6), (x, 4.79, rise + 0.48), p.wood_dark, 0.02)
        block(f"deskpanelin_{k}", g, (0.84, 0.03, 0.44), (x, 4.775, rise + 0.48), p.wood, 0.015)
    block("deskplaque", g, (1.2, 0.04, 0.7), (0, 4.785, rise + 0.48), p.wood_dark, 0.02)
    # Waga sprawiedliwosci (piksel-art) na lawie.
    scales = [
        "......X......",
        "..XXXXXXXXX..",
        "..X...X...X..",
        ".X.X..X..X.X.",
        "XXXXX.X.XXXXX",
        "......X......",
        "....XXXXX....",
    ]
    pixels("scales", g, scales, 0.075, (0, rise + 0.5), 4.76, p.gold)
    block("chairback", g, (0.9, 0.18, 1.6), (0, 6.2, rise + 0.95), p.leather, 0.06)
    block("chairtop", g, (1.0, 0.24, 0.12), (0, 6.2, rise + 1.78), p.wood_dark, 0.03)
    block("chairseat", g, (0.9, 0.8, 0.14), (0, 5.85, rise + 0.5), p.leather, 0.05)
    for side, sx in (("L", 1), ("R", -1)):
        block(f"chairarm_{side}", g, (0.1, 0.7, 0.32), (sx * 0.5, 5.85, rise + 0.68), p.wood_dark, 0.02)
        cyl(f"pillar_{side}", g, 0.22, H - 0.3, (sx * 2.8, 6.6, (H - 0.3) / 2), p.marble, axis="Z", bevel=0, verts=24)
        block(f"pillarbase_{side}", g, (0.56, 0.56, 0.2), (sx * 2.8, 6.6, 0.1), p.marble, 0.02)
        block(f"pillarcap_{side}", g, (0.56, 0.56, 0.2), (sx * 2.8, 6.6, H - 0.4), p.marble, 0.02)
        # Flaga bialo-czerwona na drzewcu.
        cyl(f"flagpole_{side}", g, 0.025, 2.9, (sx * 2.0, 6.75, rise + 1.45), p.gold, axis="Z", bevel=0)
        block(f"flagwhite_{side}", g, (0.04, 0.5, 0.36), (sx * 2.0, 6.5, rise + 2.45), p.white, 0.01)
        block(f"flagred_{side}", g, (0.04, 0.5, 0.36), (sx * 2.0, 6.5, rise + 2.09), p.red, 0.01)
        block(f"flagtip_{side}", g, (0.07, 0.07, 0.07), (sx * 2.0, 6.75, rise + 2.94), p.gold, 0.02)
    # Tarcza z waga nad krzeslem i zegar.
    block("plaque", g, (1.5, 0.08, 1.2), (0, BACK - 0.06, 3.3), p.wood_dark, 0.04)
    block("plaquetrim", g, (1.6, 0.06, 1.3), (0, BACK - 0.03, 3.3), p.gold, 0.03)
    pixels("plaquescales", g, scales, 0.11, (0, 3.3), BACK - 0.105, p.gold)
    cyl("clockface", g, 0.32, 0.06, (3.9, BACK - 0.06, 3.3), p.white, axis="Y", verts=32)
    cyl("clockrim", g, 0.36, 0.05, (3.9, BACK - 0.03, 3.3), p.gold, axis="Y", verts=32)
    block("clockhand_h", g, (0.03, 0.02, 0.16), (3.9, BACK - 0.1, 3.36), p.ink, 0)
    block("clockhand_m", g, (0.22, 0.02, 0.025), (3.98, BACK - 0.1, 3.3), p.ink, 0)
    pivot("judge_seat", root, (0, 5.85, rise + 0.57))


def jury_box(root, p):
    """Lawa przysieglych: podest, cztery krzesla i balustrada z panelami."""
    g = pivot("jury", root, (0, 0, 0))
    rise = 0.3
    block("juryplatform", g, (2.0, 4.0, rise), (-4.9, 2.4, rise / 2), p.wood_dark, 0.02)
    block("juryrail", g, (0.14, 4.0, 0.9), (-3.95, 2.4, rise + 0.45), p.wood, 0.02)
    block("juryrailtop", g, (0.24, 4.1, 0.07), (-3.95, 2.4, rise + 0.93), p.wood_dark, 0.02)
    block("juryfront", g, (2.0, 0.14, 0.9), (-4.9, 0.47, rise + 0.45), p.wood, 0.02)
    block("juryfronttop", g, (2.1, 0.24, 0.07), (-4.9, 0.47, rise + 0.93), p.wood_dark, 0.02)
    for k in range(4):
        block(f"jurypanel_{k}", g, (0.04, 0.8, 0.55), (-3.875, 0.95 + k * 0.98, rise + 0.45), p.wood_dark, 0)
    for k, cid in enumerate(JURY):
        y = 3.85 - k * 0.98
        seat = pivot(f"seat_{cid}", root, (-4.75, y, rise + 0.47))
        seat.rotation_euler = (0, 0, r(JURY_TURN))
        chair = pivot(f"chair_{cid}", g, (-4.75, y, rise))
        chair.rotation_euler = (0, 0, r(JURY_TURN))
        block(f"seat_{cid}_cushion", chair, (0.56, 0.5, 0.1), (0, 0.02, 0.42), p.leather, 0.03)
        block(f"seat_{cid}_back", chair, (0.56, 0.1, 0.7), (0, 0.3, 0.75), p.leather, 0.04)
        block(f"seat_{cid}_frame", chair, (0.5, 0.44, 0.36), (0, 0.02, 0.19), p.wood_dark, 0.02)


def prosecution(root, p):
    """Miejsce oskarzyciela: mownica ze skosnym blatem, zwrocona do srodka sali."""
    g = pivot("prosecution", root, (3.4, 1.9, 0))
    g.rotation_euler = (0, 0, r(-55))
    block("lectern", g, (0.8, 0.5, 0.9), (0, 0, 0.45), p.wood, 0.03)
    block("lecterntop", g, (0.9, 0.6, 0.06), (0, 0.02, 0.95), p.wood_dark, 0.02, rot=(r(-15), 0, 0))
    block("lecternband", g, (0.82, 0.52, 0.08), (0, 0, 0.72), p.red, 0.01)
    block("lecternbase", g, (1.0, 0.7, 0.08), (0, 0, 0.04), p.wood_dark, 0.02)
    block("notes", g, (0.36, 0.26, 0.012), (0, 0.0, 0.99), p.paper, 0, rot=(r(-15), 0, 0))
    # Oskarzyciel stoi 0,8 m za mownica, patrzac tam gdzie ona (przod mownicy to obrocone -Y).
    stand = pivot("prosecutor_stand", root, (4.06, 2.36, 0))
    stand.rotation_euler = (0, 0, r(-55))


def evidence_table(root, p):
    """Stol z aktami: teczka z napisem CV i plik kartek — tu laduje wniesione CV."""
    g = pivot("table", root, (0, 2.0, 0))
    block("tabletop", g, (1.8, 0.9, 0.08), (0, 0, 0.78), p.wood_dark, 0.02)
    block("tableapron", g, (1.7, 0.8, 0.14), (0, 0, 0.67), p.wood, 0.015)
    for k, (x, y) in enumerate(((-0.8, -0.35), (0.8, -0.35), (-0.8, 0.35), (0.8, 0.35))):
        block(f"tableleg_{k}", g, (0.09, 0.09, 0.74), (x, y, 0.37), p.wood_dark, 0.015)
    for k in range(4):
        block(f"sheet_{k}", g, (0.32, 0.44, 0.008), (0.45, 0.02 * k, 0.824 + k * 0.008), p.paper, 0, rot=(0, 0, r(6 * k - 8)))
    block("cvfolder", g, (0.5, 0.36, 0.03), (-0.3, -0.05, 0.835), p.folder, 0.008, rot=(0, 0, r(-6)))
    pixels("cvlabel", g, ["XXX.X.X", "X...X.X", "X...X.X", "X....X.", "XXX..X."], 0.035, (0, 0), 0, p.white)
    label = [o for o in g.children if o.name.startswith("cvlabel")]
    for o in label:
        # Piksele napisu leza na okladce: z plaszczyzny XZ na XY (na plasko) i na teczke.
        x, _, z = o.location
        o.location = (-0.3 + x, -0.05 + z, 0.853)
        o.rotation_euler = (r(90), 0, 0)
    pivot("cv_table", root, (0, 2.0, 0.82))


def railing(root, p):
    """Balustrada oddzielajaca sale od widowni, z przejsciem na srodku."""
    g = pivot("railing", root, (0, 0, 0))
    for side, sx in (("L", -1), ("R", 1)):
        x0, x1 = sx * 1.1, sx * (W - 0.3)
        mid, length = (x0 + x1) / 2, abs(x1 - x0)
        block(f"railtop_{side}", g, (length, 0.12, 0.08), (mid, -0.6, 0.92), p.wood_dark, 0.02)
        block(f"railbottom_{side}", g, (length, 0.1, 0.08), (mid, -0.6, 0.12), p.wood_dark, 0.02)
        n = int(length / 0.3)
        for k in range(n + 1):
            x = x0 + sx * k * length / n
            cyl(f"baluster_{side}_{k}", g, 0.035, 0.76, (x, -0.6, 0.52), p.wood, axis="Z", bevel=0, verts=10)
        block(f"railpost_{side}", g, (0.16, 0.16, 1.05), (x0, -0.6, 0.525), p.wood_dark, 0.03)


def gallery(root, p):
    """Lawki dla publicznosci przed balustrada — przod sali nie jest pusta podloga."""
    g = pivot("gallery", root, (0, 0, 0))
    for row, y in enumerate((-1.5, -2.5)):
        for side, sx in (("L", -1), ("R", 1)):
            x, length = sx * 3.3, 3.8
            name = f"pew_{side}_{row}"
            block(f"{name}_seat", g, (length, 0.5, 0.08), (x, y, 0.46), p.wood, 0.02)
            block(f"{name}_back", g, (length, 0.08, 0.5), (x, y + 0.26, 0.76), p.wood, 0.02)
            block(f"{name}_backtop", g, (length + 0.06, 0.12, 0.06), (x, y + 0.26, 1.03), p.wood_dark, 0.02)
            for k, dx in enumerate((-length / 2 + 0.05, length / 2 - 0.05)):
                block(f"{name}_end_{k}", g, (0.08, 0.6, 0.9), (x + dx, y + 0.05, 0.45), p.wood_dark, 0.02)


def bookshelves(root, p):
    """Regaly z kodeksami po obu stronach lawy — kolor i faktura na scianie w glebi."""
    g = pivot("library", root, (0, 0, 0))
    height, width, depth = 2.6, 2.0, 0.4
    widths = (0.07, 0.09, 0.06, 0.08, 0.1, 0.07, 0.05, 0.09)
    for side, sx in (("L", -1), ("R", 1)):
        cx, y = sx * 4.45, BACK - depth / 2 - 0.05
        block(f"shelfback_{side}", g, (width, 0.04, height), (cx, y + depth / 2 - 0.02, height / 2), p.wood_dark, 0)
        for e, dx in (("a", -1), ("b", 1)):
            block(f"shelfside_{side}_{e}", g, (0.08, depth, height), (cx + dx * (width / 2 - 0.04), y, height / 2), p.wood, 0.015)
        block(f"shelfcrown_{side}", g, (width + 0.12, depth + 0.08, 0.1), (cx, y, height + 0.05), p.wood_dark, 0.02)
        for level in range(4):
            z = 0.08 + level * 0.65
            block(f"shelf_{side}_{level}", g, (width - 0.1, depth - 0.04, 0.05), (cx, y, z), p.wood, 0)
            x, n = cx - width / 2 + 0.12, 0
            while x < cx + width / 2 - 0.2:
                w = widths[(n + level * 3 + (side == "R")) % len(widths)]
                h = 0.36 + 0.06 * ((n * 5 + level) % 4)
                tilt = r(12) if (n + level) % 9 == 4 else 0
                block(f"book_{side}_{level}_{n}", g, (w - 0.008, depth - 0.12, h), (x + w / 2, y - 0.02, z + 0.025 + h / 2), p.books[(n * 3 + level) % len(p.books)], 0, rot=(0, tilt, 0))
                x, n = x + w + (0.05 if tilt else 0), n + 1


def plants(root, p):
    """Fikusy w donicach w glebi sali, za lawa przysieglych i za mownica."""
    g = pivot("plants", root, (0, 0, 0))
    leaves = ((0, 0, 1.25, 0.42), (0.18, 0.1, 1.05, 0.3), (-0.17, -0.08, 1.0, 0.32), (0.05, -0.18, 1.5, 0.3), (-0.1, 0.15, 1.45, 0.28))
    for side, sx in (("L", -1), ("R", 1)):
        x, y = sx * 5.45, 5.1
        cyl(f"pot_{side}", g, 0.26, 0.5, (x, y, 0.25), p.pot, axis="Z", verts=20)
        cyl(f"potrim_{side}", g, 0.29, 0.07, (x, y, 0.5), p.pot, axis="Z", verts=20)
        block(f"trunk_{side}", g, (0.06, 0.06, 0.6), (x, y, 0.75), p.wood_dark, 0.01)
        for k, (dx, dy, z, s) in enumerate(leaves):
            block(f"leaves_{side}_{k}", g, (s, s, s * 0.8), (x + dx, y + dy, z), p.leaf if k % 2 else p.leaf_dark, 0.04, rot=(0, 0, r(20 * k)))


def chandeliers(root, p):
    """Dwa zyrandole nad sala: obrecz, swiece i lancuch do sufitu."""
    g = pivot("chandeliers", root, (0, 0, 0))
    for side, sx in (("L", -1), ("R", 1)):
        x, y, z = sx * 2.4, 3.2, 3.3
        cyl(f"chain_{side}", g, 0.015, H - z, (x, y, (H + z) / 2), p.gold, axis="Z", bevel=0, verts=8)
        cyl(f"ring_{side}", g, 0.45, 0.05, (x, y, z), p.gold, axis="Z", bevel=0, verts=32)
        cyl(f"hub_{side}", g, 0.09, 0.2, (x, y, z), p.gold, axis="Z", verts=16)
        for k in range(6):
            a = r(60 * k + 30)
            cx, cy = x + 0.45 * math.cos(a), y + 0.45 * math.sin(a)
            block(f"candle_{side}_{k}", g, (0.05, 0.05, 0.14), (cx, cy, z + 0.1), p.white, 0)
            block(f"flame_{side}_{k}", g, (0.035, 0.035, 0.06), (cx, cy, z + 0.2), p.lamp, 0)


def cameras(root):
    """Ujecia kamery: punkt i cel. Scena przelacza je, gdy zmienia sie mowca."""
    shots = {
        "wide": ((0, -6.2, 3.7), (0, 2.6, 1.0)),
        "judge": ((0, 1.7, 2.9), (0, 5.85, 1.95)),
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
    bench(root, p)
    jury_box(root, p)
    prosecution(root, p)
    evidence_table(root, p)
    railing(root, p)
    gallery(root, p)
    bookshelves(root, p)
    plants(root, p)
    chandeliers(root, p)
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
