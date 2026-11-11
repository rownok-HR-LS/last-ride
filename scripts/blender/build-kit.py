# The park's walk-in buildings, the backlot trailers and the front gate, modelled in Blender in a faded 1980s
# amusement-park style: painted cinder block on concrete footings, bevelled pilasters and cornices, colour bands,
# steel door frames with roller-shutter boxes, boarded windows with concrete sills, drainpipes, roof vents and a
# ladder, marquee bulbs, and the themed false fronts.
#
#   node scripts/export-kit-layout.mjs layout.json
#   blender --background --factory-startup --python scripts/blender/build-kit.py -- layout.json outdir
#
# Writes kit_<style>.glb for each building (centred on it), kit_trailer.glb and kit_arch.glb (the gate, centred on
# it). Geometry only: every material is named after one of the game's materials (src/world.js MATS, or a '#rrggbb'
# paint), and the game gives it its own tiling textures, rain and lamp light. Everything is in game coordinates
# (x right, y up, z toward the gate) and turned to Blender's at the end.
import json
import math
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, __import__('os').path.dirname(__file__))
from kitlib import Kit, rod  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
LAYOUT, OUT = args[0], args[1]
# optional: only rebuild these kits (e.g. tentdress)
ONLY = set(args[2:])
layout = json.load(open(LAYOUT))
T = 0.4  # wall thickness
DOOR = 3.0

# paint per building: wall colour comes from the game's material; these are the 80s accents
ACCENT = {
    'funhouse': ('#c94f7c', '#f2b632'),
    'tunnel': ('#7a1c1c', '#1c1a1a'),
    'arcade': ('#2f9be0', '#f0702c'),
}


# ------------------------------------------------------------------ helpers for a building's sides

def sides(b):
    w, d = b['w'], b['d']
    # name, line position, outward sign, horizontal (runs along x)?, length
    return [('n', -d / 2, -1, True, w), ('s', d / 2, 1, True, w), ('w', -w / 2, -1, False, d), ('e', w / 2, 1, False, d)]


def segments(length, gaps):
    """Runs of wall between the door gaps: [(a0, a1)] along the side."""
    out = []
    s = -length / 2
    for g in sorted(gaps):
        a, c = g - DOOR / 2, g + DOOR / 2
        if a > s:
            out.append((s, a))
        s = c
    if s < length / 2:
        out.append((s, length / 2))
    return out


def building(b):
    K = Kit()
    rr = random.Random(int(b['cx'] * 13 + b['cz'] * 7))
    style = b['style']
    block = 'block_' + style  # painted cinder block (the game tints it per building)
    h = b['h']
    top = h + 0.9  # parapet
    acc1, acc2 = ACCENT[style]
    # the walls themselves, exactly where the map's are
    for wl in b['walls']:
        K.box(block, (wl['x'], wl['y0'] + wl['h'] / 2, wl['z']), (wl['w'], wl['h'], wl['d']), (0, wl['rot'], 0), bevel=0.02)
    # flat roof: concrete deck, tar membrane
    K.box('plinth', (0, h + 0.15, 0), (b['w'] + 0.3, 0.3, b['d'] + 0.3), bevel=0.03)
    K.box('dark', (0, h + 0.33, 0), (b['w'] - 0.3, 0.06, b['d'] - 0.3), bevel=0.0)
    for name, line, out, horiz, length in sides(b):
        gaps = b['doors'].get(name, [])
        front = name == 's' and style in ('funhouse', 'tunnel')

        def put(mat, a, alen, y, hh, off, depth, rot=0.0, bevel=0.025, segs=1):
            """A box against this side: centred a along it, off out from the wall line, depth thick."""
            across = line + out * off
            if horiz:
                K.box(mat, (a, y, across), (alen, hh, depth), (0, 0, rot), bevel, segs)
            else:
                K.box(mat, (across, y, a), (depth, hh, alen), (rot, 0, 0), bevel, segs)

        def at(a, y, off):
            across = line + out * off
            return (a, y, across) if horiz else (across, y, a)

        # parapet over the roof, a concrete coping, and a stepped cornice under it (over the door lintels too)
        put(block, 0, length + 0.4, h + 0.45, 0.9, 0, T, bevel=0.02)
        put('plinth', 0, length + 0.62, top + 0.07, 0.14, 0.02, 0.56, bevel=0.035, segs=2)
        put('plinth', 0, length + 0.72, h - 0.18, 0.36, T / 2 + 0.13, 0.26, bevel=0.04, segs=2)
        put(acc1, 0, length + 0.6, h - 0.47, 0.2, T / 2 + 0.07, 0.14, bevel=0.02)
        for a0, a1 in segments(length, gaps):
            seg = a1 - a0
            mid = (a0 + a1) / 2
            # footing, and the 80s colour bands at shoulder height
            put('plinth', mid, seg, 0.35, 0.7, T / 2 + 0.07, 0.14, bevel=0.03, segs=2)
            put(acc1, mid, seg, 2.35, 0.32, T / 2 + 0.012, 0.024, bevel=0.006)
            put(acc2, mid, seg, 2.66, 0.11, T / 2 + 0.012, 0.024, bevel=0.006)
            # pilasters: both ends of the run and every few metres between, with a cap block
            bays = max(1, round(seg / 4.2))
            xs = [a0 + 0.28 + (seg - 0.56) * i / bays for i in range(bays + 1)]
            for x in xs:
                put(acc1 if front else 'plinth', x, 0.52, (0.7 + h - 0.62) / 2, h - 1.32, T / 2 + 0.09, 0.18, bevel=0.03, segs=2)
                put('plinth', x, 0.66, h - 0.6, 0.18, T / 2 + 0.12, 0.26, bevel=0.03)
            # boarded-up windows in most bays (not on the themed fronts), up out of reach
            if not front:
                for i in range(bays):
                    bw = (seg - 0.56) / bays
                    if bw < 2.7 or rr.random() < 0.25:
                        continue
                    cx = (xs[i] + xs[i + 1]) / 2
                    wy = min(h * 0.58, h - 1.9)
                    put('dark', cx, 1.72, wy, 1.62, T / 2 + 0.01, 0.02, bevel=0.0)
                    put('plinth', cx, 2.15, wy - 0.9, 0.12, T / 2 + 0.11, 0.24, bevel=0.025, segs=2)  # sill
                    put('plinth', cx, 2.0, wy + 0.92, 0.2, T / 2 + 0.06, 0.14, bevel=0.02)  # lintel
                    for e in (-0.9, 0.9):
                        put('iron', cx + e, 0.08, wy, 1.72, T / 2 + 0.05, 0.1, bevel=0.01)
                    n = 4 + rr.randint(0, 1)
                    for k in range(n):
                        if rr.random() < 0.15:
                            continue  # a board has come away
                        put('boards', cx + (rr.random() - 0.5) * 0.12, 2.0, wy - 0.62 + k * 1.24 / (n - 1), 0.28, T / 2 + 0.1, 0.05,
                            rot=(rr.random() - 0.5) * 0.14, bevel=0.012)
        # doorways: steel frames, a roller shutter rolled most of the way up, its box, a lamp over the top
        for o in gaps:
            for e in (-1, 1):
                put('iron', o + e * (DOOR / 2 + 0.07), 0.14, 1.65, 3.3, T / 2 + 0.05, 0.22, bevel=0.015)
            put('iron', o, DOOR + 0.28, 3.27, 0.14, T / 2 + 0.05, 0.22, bevel=0.015)
            put('shutter', o, DOOR + 0.5, 3.62, 0.48, T / 2 + 0.24, 0.46, bevel=0.05, segs=2)
            for k in range(5):
                put('shutter', o, DOOR - 0.05, 3.2 - k * 0.11, 0.1, 0.0, 0.05, bevel=0.012)
            put('plinth', o, DOOR + 0.6, 0.03, 0.06, T / 2 + 0.45, 0.9, bevel=0.02)
            put('iron', o, 0.34, 4.1, 0.2, T / 2 + 0.08, 0.14, bevel=0.02)
            K.ball('bulb' if rr.random() < 0.4 else 'bulbPink', at(o, 4.0, T / 2 + 0.16), 0.07)
        # marquee bulbs under the cornice along a themed front
        if front:
            n = int((length - 1) / 0.5)
            for k in range(n + 1):
                a = -length / 2 + 0.5 + k * (length - 1) / n
                K.ball('bulb' if rr.random() < 0.55 else 'bulbPink', at(a, h - 0.72, T / 2 + 0.2), 0.07)
    # drainpipes down every corner, with brackets, heads and shoes
    for sx in (-1, 1):
        for sz in (-1, 1):
            x = sx * (b['w'] / 2 + 0.17)
            z = sz * (b['d'] / 2 + 0.17)
            K.cyl('pipe', (x, (top - 0.3) / 2 + 0.1, z), 0.07, top - 0.5, segs=8)
            K.cyl('pipe', (x, top - 0.12, z), 0.17, 0.32, segs=8, r2=0.09)
            K.cyl('pipe', (x + sx * 0.1, 0.12, z + sz * 0.1), 0.075, 0.36, axis='x' if sx else 'z', segs=8, rot=(0, math.atan2(sz, sx), 0))
            for y in (1.2, h * 0.5, h - 0.8):
                K.box('iron', (x, y, z), (0.2, 0.05, 0.2), bevel=0.01)
    # roof: vent stacks, and a ladder up the back wall
    for k in range(3):
        vx = (rr.random() - 0.5) * (b['w'] - 3)
        vz = (rr.random() - 0.5) * (b['d'] - 3)
        K.cyl('pipe', (vx, h + 0.75, vz), 0.11, 0.8, segs=8)
        K.cyl('iron', (vx, h + 1.22, vz), 0.22, 0.14, segs=8, r2=0.12)
    lx = b['w'] / 2 - 2.0
    lz = -b['d'] / 2 - T / 2 - 0.22
    for e in (-0.22, 0.22):
        K.box('iron', (lx + e, (top + 0.9) / 2 + 0.5, lz), (0.05, top + 0.9 - 1.0, 0.05), bevel=0.008)
    y = 1.3
    while y < top + 0.6:
        K.box('iron', (lx, y, lz), (0.44, 0.035, 0.035), bevel=0.0)
        y += 0.32
    # themed false fronts over the door side
    fz = b['d'] / 2
    if style == 'funhouse':
        fw = b['w'] * 0.75
        outline = arch_outline(fw, 1.6, 5.2)
        K.prism(acc1, [(x, h + y) for x, y in outline], fz - 0.4, 0.4)
        K.prism(acc2, [(x, h - 0.05 + y) for x, y in arch_outline(fw + 0.5, 1.75, 5.45)], fz - 0.55, 0.25)
        bulbs_along(K, [(x, h + y) for x, y in outline], fz + 0.06, rr)
    elif style == 'tunnel':
        fw = b['w'] * 0.85
        outline = gable_outline(fw, 5.5)
        K.prism(block, [(x, h + y) for x, y in outline], fz - 0.4, 0.4)
        K.prism('plinth', [(x, h - 0.05 + y) for x, y in gable_outline(fw + 0.5, 5.8)], fz - 0.55, 0.25)
        bulbs_along(K, [(x, h + y) for x, y in outline], fz + 0.06, rr, red=True)
    return K


def arch_outline(w, base, rise, n=14):
    """The Funhouse's false front: shoulders, then a round crown (the same shape src/buildings.js drew)."""
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, base), (w * 0.32, base)]

    def quad(p0, c, p1):
        return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
                 (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]) for t in [i / n for i in range(1, n + 1)]]

    pts += quad((w * 0.32, base), (w * 0.3, base + rise * 0.6), (0, base + rise))
    pts += quad((0, base + rise), (-w * 0.3, base + rise * 0.6), (-w * 0.32, base))
    pts.append((-w / 2, base))
    return pts


def gable_outline(w, rise):
    return [(-w / 2, 0), (w / 2, 0), (w / 2, rise * 0.25), (w * 0.3, rise * 0.25), (w * 0.3, rise * 0.55), (w * 0.12, rise * 0.55),
            (0, rise), (-w * 0.12, rise * 0.55), (-w * 0.3, rise * 0.55), (-w * 0.3, rise * 0.25), (-w / 2, rise * 0.25)]


def bulbs_along(K, outline, z, rr, red=False, step=0.55):
    """Marquee bulbs round the top of a false front (not along its foot)."""
    for (x0, y0), (x1, y1) in zip(outline[2:], outline[3:]):
        ln = math.hypot(x1 - x0, y1 - y0)
        for k in range(max(1, int(ln / step))):
            t = k / max(1, int(ln / step))
            on = rr.random() < 0.6
            K.ball(('bulbRed' if red else 'bulb') if on else 'bulbPink', (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - 0.18, z), 0.075)


# ------------------------------------------------------------------ the backlot trailer (8 x 2.8, 3 m tall)

def trailer():
    K = Kit()
    rr = random.Random(5)
    body = 'trailer'
    K.box(body, (0, 1.68, 0), (7.6, 2.4, 2.6), bevel=0.2, segs=3)
    K.box('#2f9be0', (0, 1.42, 0), (7.64, 0.28, 2.64), bevel=0.06, segs=2)
    K.box('#f0702c', (0, 1.66, 0), (7.64, 0.08, 2.64), bevel=0.03)
    # chassis rails, tandem axle and wheels with fenders
    for z in (-0.95, 0.95):
        K.box('iron', (0.2, 0.42, z), (7.4, 0.14, 0.1), bevel=0.01)
    for x in (-0.55, 0.55):
        K.cyl('iron', (x, 0.36, 0), 0.05, 2.7, axis='z', segs=8)
        for z in (-1.2, 1.2):
            K.cyl('rubber', (x, 0.36, z), 0.36, 0.24, axis='z', segs=16)
            K.cyl('iron', (x, 0.36, z + (0.13 if z > 0 else -0.13)), 0.18, 0.04, axis='z', segs=10)
    for z in (-1.32, 1.32):
        K.box(body, (0, 0.84, z), (1.9, 0.08, 0.18), bevel=0.02)
    # tow hitch, jack, gas bottles
    for e in (-1, 1):
        K.box('iron', (4.35, 0.45, e * 0.45), (1.6, 0.1, 0.1), rot=(0, e * 0.42, 0), bevel=0.01)
    K.box('iron', (5.05, 0.45, 0), (0.3, 0.12, 0.18), bevel=0.02)
    K.cyl('iron', (4.7, 0.28, 0.3), 0.04, 0.6, segs=8)
    K.box('iron', (4.7, 0.02, 0.3), (0.2, 0.04, 0.2), bevel=0.0)
    for z in (-0.32, 0.32):
        K.cyl('tank', (4.25, 0.85, z), 0.17, 0.62, segs=12)
        K.ball('tank', (4.25, 1.16, z), 0.17, segs=10)
    # windows: aluminium frames round dark glass, two on the back wall
    for x in (-2.6, 0.4, 2.6):
        win(K, (x, 2.1, 1.31), 1.1, 0.7, 'z')
    for x in (-2.0, 2.0):
        win(K, (x, 2.1, -1.31), 1.1, 0.7, 'z', back=True)
    win(K, (3.81, 2.15, 0), 1.5, 0.55, 'x')
    # the door, a step, a light
    K.box(body, (-1.0, 1.55, 1.315), (0.82, 1.9, 0.04), bevel=0.02)
    K.box('iron', (-1.0, 1.55, 1.33), (0.9, 1.98, 0.02), bevel=0.0)
    K.box('dark', (-1.0, 2.15, 1.345), (0.4, 0.5, 0.02), bevel=0.0)
    K.box('iron', (-0.68, 1.45, 1.36), (0.05, 0.16, 0.05), bevel=0.0)
    for k, y in enumerate((0.48, 0.24)):
        K.box('iron', (-1.0, y, 1.55 + k * 0.22), (0.8, 0.04, 0.3), bevel=0.01)
    K.box('iron', (-1.0, 2.62, 1.36), (0.24, 0.14, 0.1), bevel=0.02)
    K.ball('bulbPink', (-1.0, 2.58, 1.42), 0.05)
    # roof: an air conditioner and a vent
    K.box('tank', (1.2, 3.03, 0), (0.95, 0.34, 0.75), bevel=0.05, segs=2)
    for k in range(5):
        K.box('dark', (1.2 - 0.36 + k * 0.18, 3.03, 0.38), (0.05, 0.24, 0.02), bevel=0.0)
    K.box('iron', (-2.4, 2.95, 0), (0.45, 0.14, 0.45), bevel=0.03)
    # corner jacks at the back
    for z in (-1.0, 1.0):
        K.cyl('iron', (-3.5, 0.22, z), 0.035, 0.45, segs=6)
    return K


def win(K, at, w, h, axis, back=False):
    x, y, z = at
    if axis == 'z':
        s = -1 if back else 1
        K.box('dark', (x, y, z), (w, h, 0.03), bevel=0.0)
        K.box('iron', (x, y + h / 2 + 0.03, z + s * 0.02), (w + 0.1, 0.06, 0.05), bevel=0.01)
        K.box('iron', (x, y - h / 2 - 0.03, z + s * 0.02), (w + 0.14, 0.07, 0.07), bevel=0.01)
        for e in (-1, 0, 1):
            K.box('iron', (x + e * (w / 2 + 0.02), y, z + s * 0.02), (0.05, h, 0.05), bevel=0.008)
    else:
        K.box('dark', (x, y, z), (0.03, h, w), bevel=0.0)
        K.box('iron', (x + 0.02, y + h / 2 + 0.03, z), (0.05, 0.06, w + 0.1), bevel=0.01)
        K.box('iron', (x + 0.02, y - h / 2 - 0.03, z), (0.07, 0.07, w + 0.14), bevel=0.01)


# ------------------------------------------------------------------ the front gate (two towers and a header)

def gate():
    K = Kit()
    rr = random.Random(110)
    for sx in (-7, 7):
        K.box('plinth', (sx, 0.35, 0), (2.7, 0.7, 2.7), bevel=0.05, segs=2)
        K.box('#3a2a4a', (sx, 3.95, 0), (2.2, 6.5, 2.2), bevel=0.06, segs=2)
        K.box('#d9b45a', (sx, 1.0, 0), (2.28, 0.22, 2.28), bevel=0.03)
        K.box('#d9b45a', (sx, 6.7, 0), (2.28, 0.22, 2.28), bevel=0.03)
        # a sunken channel of bulbs up each face toward the road
        for fz in (-1, 1):
            K.box('dark', (sx, 3.9, fz * 1.105), (0.5, 5.2, 0.02), bevel=0.0)
            for k in range(11):
                on = rr.random() < 0.5
                K.ball('bulb' if on else 'bulbPink', (sx, 1.6 + k * 0.48, fz * 1.16), 0.08)
        # capital and finial
        K.box('plinth', (sx, 7.35, 0), (2.6, 0.3, 2.6), bevel=0.05, segs=2)
        K.box('#3a2a4a', (sx, 9.75, 0), (2.4, 0.3, 2.4), bevel=0.05, segs=2)
        K.cyl('plinth', (sx, 10.05, 0), 0.45, 0.3, segs=12, r2=0.3)
        K.ball('gold', (sx, 10.75, 0), 0.6, segs=14)
    # the header the LAST RIDE signs hang on, gold trim and a bulb border on both faces
    K.box('#3a2a4a', (0, 8.6, 0), (16.0, 2.0, 1.4), bevel=0.06, segs=2)
    for y in (7.62, 9.58):
        K.box('gold', (0, y, 0), (16.2, 0.14, 1.5), bevel=0.03)
    for fz in (-1, 1):
        n = 26
        for k in range(n):
            x = -7.6 + k * 15.2 / (n - 1)
            on = rr.random() < 0.55
            K.ball('bulb' if on else 'bulbPink', (x, 7.82, fz * 0.74), 0.09)
            K.ball('bulb' if rr.random() < 0.5 else 'bulbPink', (x, 9.38, fz * 0.74), 0.09)
    return K


# ------------------------------------------------------------------ carnival game booths (4.8 x 3.2, open to +z)
# 'booth_main' is a stand-in: the game paints it each booth's own colour. The booth's walls, counter and roof sit on
# the map's colliders: back wall at z -1.2, sides at x +-2.1, counter at z +1.1 (1.05 high), roof at 3.0 - 3.25.

CREAM = '#e9e3d2'
GLASS = '#2c4a3a'
BALLOONS = ['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87', '#f0702c']


def booth(variant):
    K = Kit()
    rr = random.Random({'ringtoss': 1, 'darts': 2, 'milk': 3, 'gallery': 4, 'prize': 5}[variant])
    main = 'booth_main'
    # frame and walls: plank back and sides, painted below, a bare post at each corner
    for x in (-2.15, 2.15):
        for z in (-1.25, 1.3):
            K.box('woodDark', (x, 1.6, z), (0.14, 3.2, 0.14), bevel=0.02)
    K.box('woodDark', (0, 1.55, -1.2), (4.2, 3.0, 0.1), bevel=0.01)
    K.box(main, (0, 0.6, -1.14), (4.2, 1.2, 0.03), bevel=0.005)
    for x in (-2.1, 2.1):
        K.box('woodDark', (x, 1.55, 0.02), (0.1, 3.0, 2.5), bevel=0.01)
        K.box(main, (x + (0.05 if x > 0 else -0.05), 0.6, 0.02), (0.03, 1.2, 2.5), bevel=0.005)
        K.box(CREAM, (x + (0.05 if x > 0 else -0.05), 1.24, 0.02), (0.035, 0.08, 2.5), bevel=0.005)
    # the counter: painted front with a cream frame, a worn top, a steel kick plate
    K.box(main, (0, 0.55, 1.28), (4.0, 1.0, 0.1), bevel=0.02)
    for x in (-1.95, 1.95):
        K.box(CREAM, (x, 0.55, 1.34), (0.1, 1.0, 0.04), bevel=0.01)
    K.box(CREAM, (0, 1.0, 1.34), (4.0, 0.1, 0.04), bevel=0.01)
    K.box('iron', (0, 0.1, 1.34), (4.0, 0.2, 0.03), bevel=0.005)
    K.box('woodDark', (0, 1.08, 1.12), (4.25, 0.06, 0.62), bevel=0.02)
    # roof deck and a striped awning tilting out over the counter, scalloped along its edge
    K.box('woodDark', (0, 3.12, 0.0), (4.8, 0.12, 3.2), bevel=0.02)
    n = 8
    for i in range(n):
        x = -2.4 + (i + 0.5) * 4.8 / n
        col = main if i % 2 == 0 else CREAM
        K.box(col, (x, 2.92, 1.95), (4.8 / n + 0.005, 0.04, 0.8), rot=(0.45, 0, 0), bevel=0.0)
        K.prism(col, [(x - 0.3 + 0.3 - 0.3 * math.cos(a), 2.74 - 0.18 * math.sin(a)) for a in [k * math.pi / 8 for k in range(9)]], 2.33, 0.03, bevel=0.0)
    if variant != 'prize':
        # a marquee sign box on the roof (the game hangs the game's name on it) with a ring of bulbs
        K.box('dark', (0, 3.62, 1.2), (3.6, 0.82, 0.2), bevel=0.03)
        K.box('gold', (0, 3.62, 1.19), (3.75, 0.95, 0.16), bevel=0.02)
        for k in range(12):
            for y in (3.14, 4.1):
                K.ball('bulb' if rr.random() < 0.5 else 'bulbPink', (-1.8 + k * 3.6 / 11, y, 1.32), 0.06)
        for y in (3.4, 3.62, 3.84):
            for x in (-1.92, 1.92):
                K.ball('bulb' if rr.random() < 0.5 else 'bulbPink', (x, y, 1.32), 0.06)
        for x in (-1.5, 1.5):
            K.box('iron', (x, 3.3, 1.0), (0.06, 0.4, 0.06), bevel=0.0)
    # shelves along the back for the prizes (the game sets plush bears on them); the dart board and the shooting
    # gallery fill the back wall themselves
    for y in ((1.72, 2.36) if variant in ('ringtoss', 'milk', 'prize') else ()):
        K.box('woodDark', (0, y, -0.98), (3.9, 0.05, 0.36), bevel=0.01)
        for x in (-1.6, 0, 1.6):
            K.box('iron', (x, y - 0.1, -1.08), (0.04, 0.18, 0.16), bevel=0.0)
    # the game itself, kept to the back so the floor stays clear
    if variant == 'ringtoss':
        K.box('woodDark', (0, 0.42, -0.66), (2.6, 0.84, 0.5), bevel=0.02)
        for i in range(6):
            for j in range(3):
                x, z = -1.1 + i * 0.44, -0.84 + j * 0.17
                K.cyl(GLASS, (x, 0.97, z), 0.055, 0.22, segs=8)
                K.cyl(GLASS, (x, 1.13, z), 0.02, 0.12, segs=6, r2=0.016)
        for k in range(4):
            K.cyl('#e2384f' if k % 2 else '#f2b632', (-1.2 + k * 0.7, 1.12, 1.15 + (k % 2) * 0.1), 0.09, 0.02, segs=10)
    elif variant == 'darts':
        K.box('woodDark', (0, 1.95, -1.12), (3.7, 1.7, 0.06), bevel=0.02)
        K.box('#8c6a4a', (0, 1.95, -1.08), (3.5, 1.5, 0.03), bevel=0.0)
        for i in range(9):
            for j in range(4):
                if rr.random() < 0.3:
                    continue  # burst long ago
                K.ball(rr.choice(BALLOONS), (-1.55 + i * 0.39, 1.38 + j * 0.38, -0.98), 0.14, segs=10)
        for k in range(5):
            K.cyl('iron', (-1.3 + rr.random() * 2.6, 1.4 + rr.random() * 1.1, -0.94), 0.01, 0.16, axis='z', segs=4)
    elif variant == 'milk':
        for px in (-0.9, 0.9):
            K.box('woodDark', (px, 0.5, -0.72), (0.7, 1.0, 0.42), bevel=0.02)
            for row, count in enumerate((3, 2, 1)):
                for c in range(count):
                    x = px - (count - 1) * 0.11 + c * 0.22
                    K.cyl('metal', (x, 1.14 + row * 0.3, -0.72), 0.1, 0.28, segs=10)
                    K.cyl('metal', (x, 1.31 + row * 0.3, -0.72), 0.07, 0.06, segs=10, r2=0.055)
    elif variant == 'gallery':
        K.box('iron', (0, 1.5, -0.8), (3.8, 0.06, 0.06), bevel=0.0)
        K.box('woodDark', (0, 1.2, -0.95), (3.8, 0.6, 0.06), bevel=0.01)
        for k in range(8):
            x = -1.6 + k * 0.46
            if rr.random() < 0.2:
                continue
            duck = [(-0.14, 0), (0.12, 0), (0.16, 0.08), (0.1, 0.14), (0.12, 0.24), (0.04, 0.27), (-0.02, 0.2), (-0.12, 0.14)]
            K.prism('#f2b632', [(x + px, 1.53 + py) for px, py in duck], -0.83, 0.03, bevel=0.0)
        for x in (-1.2, 0, 1.2):
            for r, col in ((0.3, '#e2384f'), (0.2, CREAM), (0.1, '#e2384f')):
                K.cyl(col, (x, 2.55, -1.12 + (0.3 - r) * 0.1), r, 0.02, axis='z', segs=16)
    return K


# ------------------------------------------------------------------ a game tent's dressing (the tent is a scan, r 4)

def tentdress():
    K = Kit()
    rr = random.Random(77)
    eave_r, eave_y = 3.95, 2.3
    # (the pennant bunting round the eave is drawn by the game, flapping in the wind: src/motion.js bunting())
    # guy ropes from the eave out to stakes in the ground
    for i in range(8):
        a = (i + 0.5) * 2 * math.pi / 8
        x0, z0 = math.cos(a) * eave_r, math.sin(a) * eave_r
        x1, z1 = math.cos(a) * 6.3, math.sin(a) * 6.3
        ln = math.hypot(x1 - x0, z1 - z0)
        mid = ((x0 + x1) / 2, (eave_y + 0.05) / 2, (z0 + z1) / 2)
        d = Vector((x1 - x0, 0.05 - eave_y, z1 - z0))
        q = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_euler('YXZ')
        K.box('#8c7c64', mid, (0.025, d.length, 0.025), rot=(q.x, q.y, q.z), bevel=0.0)
        K.box('woodDark', (x1, 0.18, z1), (0.08, 0.4, 0.08), rot=(0, -a, 0.35), bevel=0.01)
    # a pair of sandbags and an old ticket podium by the door side
    for k, (x, z) in enumerate(((4.6, 1.2), (4.8, -0.9))):
        K.box('#6a5a44', (x, 0.15, z), (0.6, 0.3, 0.4), rot=(0, k * 0.6, 0), bevel=0.1, segs=2)
    K.box(CREAM, (5.2, 0.55, 0.2), (0.6, 1.1, 0.5), bevel=0.03)
    K.box('#e2384f', (5.2, 1.13, 0.2), (0.7, 0.06, 0.6), bevel=0.02)
    return K


def flag(K, mat, pts):
    """A thin triangle (pennant) through three points, with a little thickness so it shows from both sides."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bm.faces.new(vs)
    bm.faces.new(list(reversed([bm.verts.new(p) for p in pts])))
    K._take(mat, bm, recalc=False)


# ------------------------------------------------------------------ the park's iron fence (12 m panels along x)

def fence(seed):
    K = Kit()
    rr = random.Random(seed)
    half = 6.0
    for x in (-half, half):
        K.box('plinth', (x, 0.2, 0), (0.42, 0.4, 0.42), bevel=0.03)
        K.box('iron', (x, 1.9, 0), (0.13, 3.1, 0.13), bevel=0.015)
        K.box('iron', (x, 3.48, 0), (0.2, 0.06, 0.2), bevel=0.01)
        K.ball('iron', (x, 3.6, 0), 0.09, segs=8)
    for y in (0.4, 2.62, 2.84):
        K.box('iron', (0, y, 0), (2 * half, 0.05, 0.03), bevel=0.0)
    n = int(2 * half / 0.22)
    for k in range(1, n):
        x = -half + k * 2 * half / n
        if rr.random() < 0.03:
            continue  # a picket long gone
        lean = (rr.random() - 0.5) * 0.12 if rr.random() < 0.08 else 0.0
        K.box('iron', (x, 1.62, 0), (0.024, 2.95, 0.024), rot=(0, 0, lean), bevel=0.0)
        # a spear tip on every picket, a collar between the top rails
        tip = bmesh.new()
        bmesh.ops.create_cone(tip, cap_ends=True, segments=4, radius1=0.035, radius2=0.0, depth=0.12)
        M = Matrix.Translation(Vector((x - math.sin(lean) * 1.47, 3.15, 0))) @ Euler((-math.pi / 2, math.pi / 4, 0), 'YXZ').to_matrix().to_4x4()
        K._take('iron', tip, M)
        K.box('iron', (x, 2.73, 0), (0.05, 0.05, 0.05), bevel=0.0)
    return K


# ------------------------------------------------------------------ food carts (1.4 x 2.4, long along z)

def cart(kind):
    K = Kit()
    main = {'popcorn': '#c8392b', 'candy': '#d96aa8', 'hotdog': '#e8b23a'}[kind]
    K.box(main, (0, 0.78, 0.05), (1.15, 0.85, 2.0), bevel=0.06, segs=2)
    for y in (0.4, 1.16):
        K.box(CREAM, (0, y, 0.05), (1.18, 0.07, 2.03), bevel=0.02)
    K.box('woodDark', (0, 1.24, 0.05), (1.3, 0.06, 2.2), bevel=0.02)
    # two big spoked wheels at the back, a pair of legs at the front, a push bar
    for x in (-0.66, 0.66):
        K.cyl('rubber', (x, 0.44, -0.55), 0.44, 0.06, axis='x', segs=20)
        K.cyl('iron', (x * 1.02, 0.44, -0.55), 0.06, 0.1, axis='x', segs=8)
        for s in range(6):
            K.box('iron', (x, 0.44, -0.55), (0.02, 0.8, 0.025), rot=(s * math.pi / 6, 0, 0), bevel=0.0)
        K.box('iron', (x * 0.8, 0.2, 0.85), (0.05, 0.4, 0.05), bevel=0.0)
    K.cyl('iron', (0, 0.44, -0.55), 0.03, 1.36, axis='x', segs=6)
    for x in (-0.5, 0.5):
        rod(K, 'iron', (x, 1.1, -0.95), (x, 1.05, -1.3), 0.025)
    K.cyl('rubber', (0, 1.05, -1.3), 0.035, 1.05, axis='x', segs=8)
    # the striped umbrella
    K.cyl('iron', (0.3, 1.9, 0.6), 0.025, 1.4, segs=6)
    apex = Vector((0.3, 2.95, 0.6))
    n = 8
    for i in range(n):
        a0, a1 = i * 2 * math.pi / n, (i + 1) * 2 * math.pi / n
        p0 = apex + Vector((math.cos(a0) * 1.25, -0.55, math.sin(a0) * 1.25))
        p1 = apex + Vector((math.cos(a1) * 1.25, -0.55, math.sin(a1) * 1.25))
        flag(K, main if i % 2 == 0 else CREAM, [tuple(apex), tuple(p1), tuple(p0)])
    K.ball('gold', tuple(apex + Vector((0, 0.06, 0))), 0.05, segs=8)
    # what it sold
    if kind == 'popcorn':
        # a glass case on thin corner posts
        K.box('dark', (0, 1.75, 0.15), (0.76, 0.86, 0.66), bevel=0.0)
        for x in (-0.39, 0.39):
            for z in (-0.19, 0.49):
                K.box('iron', (x, 1.75, z), (0.04, 0.9, 0.04), bevel=0.0)
        K.box('iron', (0, 1.31, 0.15), (0.82, 0.04, 0.72), bevel=0.0)
        K.box('#fff4c4', (0, 1.42, 0.15), (0.7, 0.18, 0.62), bevel=0.06, segs=2)
        K.box(main, (0, 2.26, 0.15), (0.86, 0.12, 0.76), bevel=0.03)
    elif kind == 'candy':
        K.cyl('metal', (0, 1.5, 0.3), 0.38, 0.45, segs=16, r2=0.3)
        K.cyl('dark', (0, 1.72, 0.3), 0.36, 0.02, segs=16)
        for k in range(6):
            x = -0.4 + (k % 3) * 0.4
            z = -0.45 + (k // 3) * 0.25
            K.cyl('woodDark', (x, 1.45, z), 0.012, 0.4, segs=4)
            K.ball('#f2a8c8' if k % 2 else '#a8d8f0', (x, 1.72, z), 0.13, segs=8)
    else:
        K.box('metal', (0, 1.45, 0.25), (0.9, 0.36, 0.9), bevel=0.04, segs=2)
        K.box('metal', (0, 1.66, 0.25), (0.86, 0.06, 0.86), rot=(-0.25, 0, 0), bevel=0.02)
        for k, col in enumerate(('#c8392b', '#e8b23a', '#c8392b')):
            K.cyl(col, (-0.35 + k * 0.3, 1.38, -0.5), 0.05, 0.22, segs=8)
            K.cyl(col, (-0.35 + k * 0.3, 1.53, -0.5), 0.02, 0.08, segs=6, r2=0.008)
    return K


# ------------------------------------------------------------------ ticket kiosks by the gate (2.6 x 2.4, window to +z)

def kiosk():
    K = Kit()
    rr = random.Random(9)
    K.box('plinth', (0, 0.15, 0), (2.6, 0.3, 2.4), bevel=0.04, segs=2)
    K.box('#c8392b', (0, 1.4, 0), (2.4, 2.2, 2.2), bevel=0.05, segs=2)
    K.box(CREAM, (0, 0.62, 0), (2.44, 0.12, 2.24), bevel=0.03)
    # the window: a dark pane behind a brass grille, a little counter and a speak-through
    K.box('dark', (0, 1.55, 1.1), (1.5, 0.9, 0.04), bevel=0.0)
    K.box('gold', (0, 1.55, 1.12), (1.62, 1.02, 0.03), bevel=0.01)
    for k in range(7):
        K.box('gold', (-0.6 + k * 0.2, 1.55, 1.14), (0.025, 0.88, 0.025), bevel=0.0)
    K.box('woodDark', (0, 1.05, 1.25), (1.6, 0.06, 0.32), bevel=0.02)
    K.cyl('iron', (0, 1.2, 1.15), 0.1, 0.03, axis='z', segs=12)
    # price board on the side
    K.box('dark', (1.21, 1.6, 0.3), (0.03, 0.9, 1.1), bevel=0.0)
    K.box('gold', (1.22, 1.6, 0.3), (0.02, 1.0, 1.2), bevel=0.0)
    # roof: an overhang and a marquee box for the TICKETS sign, bulbs round it
    K.box('woodDark', (0, 2.56, 0.1), (2.9, 0.12, 2.7), bevel=0.03)
    K.box('dark', (0, 3.02, 0.6), (2.2, 0.66, 0.2), bevel=0.03)
    K.box('gold', (0, 3.02, 0.59), (2.34, 0.78, 0.16), bevel=0.02)
    for k in range(8):
        for y in (2.64, 3.4):
            K.ball('bulb' if rr.random() < 0.5 else 'bulbPink', (-1.05 + k * 0.3, y, 0.72), 0.055)
    return K


# ------------------------------------------------------------------ the backlot water tower

def watertower():
    K = Kit()
    legs = [(sx * 2.6, sz * 2.6) for sx in (-1, 1) for sz in (-1, 1)]
    for x, z in legs:
        K.box('plinth', (x, 0.25, z), (0.8, 0.5, 0.8), bevel=0.04, segs=2)
        K.cyl('iron', (x, 6.25, z), 0.2, 11.6, segs=10)
    # cross bracing between the legs, two storeys of it, and rings of struts
    ring = [legs[0], legs[1], legs[3], legs[2]]
    for (ax, az), (bx, bz) in zip(ring, ring[1:] + ring[:1]):
        for y0, y1 in ((0.6, 6.0), (6.0, 11.8)):
            rod(K, 'iron', (ax, y0, az), (bx, y1, bz), 0.045)
            rod(K, 'iron', (bx, y0, bz), (ax, y1, az), 0.045)
        for y in (6.0, 11.8):
            rod(K, 'iron', (ax, y, az), (bx, y, bz), 0.06)
    # the tank: bands of rivets, a painted stripe, a dished bottom, a cone roof and a finial
    K.cyl('tank', (0, 14.5, 0), 4.0, 5.0, segs=28)
    for y in (12.3, 13.9, 15.6, 16.8):
        K.cyl('iron', (0, y, 0), 4.04, 0.08, segs=28)
    K.cyl('#c8392b', (0, 15.0, 0), 4.03, 0.55, segs=28)
    K.cyl(CREAM, (0, 15.42, 0), 4.03, 0.14, segs=28)
    K.cyl('tank', (0, 11.6, 0), 1.2, 0.8, segs=28, r2=4.0)
    K.cyl('roof', (0, 18.2, 0), 4.35, 2.4, segs=28, r2=0.2)
    K.ball('gold', (0, 19.5, 0), 0.3, segs=10)
    # a catwalk round the tank's foot with a railing, and a ladder up one leg
    K.cyl('iron', (0, 12.02, 0), 4.85, 0.06, segs=28)
    for k in range(16):
        a = k * 2 * math.pi / 16
        a1 = (k + 1) * 2 * math.pi / 16
        K.box('iron', (math.cos(a) * 4.75, 12.55, math.sin(a) * 4.75), (0.04, 1.0, 0.04), bevel=0.0)
        for y in (12.6, 13.05):
            rod(K, 'iron', (math.cos(a) * 4.75, y, math.sin(a) * 4.75), (math.cos(a1) * 4.75, y, math.sin(a1) * 4.75), 0.02, segs=4)
    lx, lz = 2.6, 2.6 + 0.35
    for e in (-0.2, 0.2):
        K.box('iron', (lx + e, 6.1, lz), (0.04, 11.8, 0.04), bevel=0.0)
    y = 0.6
    while y < 12.0:
        K.box('iron', (lx, y, lz), (0.4, 0.03, 0.03), bevel=0.0)
        y += 0.32
    return K



# ------------------------------------------------------------------ a ride's hanging sign (the post, and the part that swings)
# The post stands at the origin; its arm reaches out along +x to the pivot at (1.15, 3.3, 0). The board and its chains
# are a separate kit (signboard), built round that pivot so the game can swing it.

def signpost():
    K = Kit()
    K.box('plinth', (0, 0.15, 0), (0.5, 0.3, 0.5), bevel=0.03)
    K.box('woodDark', (0, 1.85, 0), (0.18, 3.4, 0.18), bevel=0.02)
    # the arm, a brace under it, and an iron cap
    K.box('woodDark', (0.6, 3.42, 0), (1.35, 0.14, 0.12), bevel=0.015)
    rod(K, 'iron', (0.07, 2.85, 0), (0.85, 3.36, 0), 0.025)
    K.box('iron', (0, 3.62, 0), (0.24, 0.06, 0.24), bevel=0.0)
    # the hook the chains hang from
    K.cyl('iron', (1.15, 3.33, 0), 0.03, 0.12, segs=8)
    return K


def signboard():
    K = Kit()
    # two chains of oval links from the hook (pivot at the origin) down to the board's top corners
    for x in (-0.55, 0.55):
        top = (0.0, -0.02, 0.0)
        end = (x, -0.62, 0.0)
        n = 7
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            a = tuple(top[k] + (end[k] - top[k]) * t0 for k in range(3))
            b = tuple(top[k] + (end[k] - top[k]) * t1 for k in range(3))
            rod(K, 'iron', a, b, 0.012, segs=4)
            K.ball('iron', a, 0.02, segs=6)
    # the board: weathered planks in a painted frame (the game paints the ride's name on both faces)
    K.box('woodDark', (0, -0.95, 0), (1.5, 0.62, 0.06), bevel=0.01)
    for y in (-0.66, -1.24):
        K.box('#b8892e', (0, y, 0), (1.56, 0.05, 0.08), bevel=0.0)
    for x in (-0.76, 0.76):
        K.box('#b8892e', (x, -0.95, 0), (0.05, 0.63, 0.08), bevel=0.0)
    return K


# ------------------------------------------------------------------ inside the walk-in buildings
# Each piece stands on the floor at its origin, its front toward +z. shared/map.js places them (and their colliders).

def arcade_cabinet(seed=1):
    """A dead 1980s upright: side panels, a cracked screen (some still glow faintly), a control deck, a marquee."""
    K = Kit()
    rr = random.Random(seed)
    body = ['#2a2440', '#3c1f24', '#1f3036', '#40381c'][seed % 4]
    for x in (-0.36, 0.36):
        K.box(body, (x, 0.95, 0), (0.06, 1.9, 0.78), bevel=0.01)
    K.box(body, (0, 0.45, -0.05), (0.66, 0.9, 0.6), bevel=0.01)
    K.box('dark', (0, 1.55, -0.18), (0.66, 1.1, 0.42), bevel=0.0)
    # the screen, tilted back; a few still give a cold glow
    K.box('bulbCyan' if rr.random() < 0.35 else 'dark', (0, 1.42, 0.05), (0.5, 0.42, 0.03), rot=(-0.25, 0, 0), bevel=0.0)
    K.box('#cfc9b8', (0, 1.0, 0.24), (0.66, 0.08, 0.34), rot=(0.35, 0, 0), bevel=0.01)
    for x in (-0.15, 0.12, 0.2):
        K.cyl('#d0322a', (x, 1.07, 0.27), 0.025, 0.04, segs=8)
    K.box('#e9d9a0', (0, 1.84, 0.02), (0.66, 0.16, 0.08), bevel=0.0)
    K.box('trim', (0, 1.93, -0.05), (0.74, 0.04, 0.8), bevel=0.0)
    return K


def claw_machine():
    K = Kit()
    K.box('#c83b4c', (0, 0.45, 0), (1.1, 0.9, 1.1), bevel=0.02)
    for x in (-0.53, 0.53):
        for z in (-0.53, 0.53):
            K.box('gold', (x, 1.45, z), (0.05, 1.1, 0.05), bevel=0.0)
    K.box('#c83b4c', (0, 2.08, 0), (1.12, 0.16, 1.12), bevel=0.02)
    # the prizes heaped inside, and the claw hanging still
    rr = random.Random(5)
    for i in range(14):
        K.ball(['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87'][i % 5], (rr.uniform(-0.38, 0.38), 0.98 + rr.random() * 0.12, rr.uniform(-0.38, 0.38)), 0.09, segs=6)
    rod(K, 'iron', (0.1, 1.98, -0.1), (0.1, 1.55, -0.1), 0.012)
    for a in range(3):
        ang = a * 2 * math.pi / 3
        rod(K, 'iron', (0.1, 1.55, -0.1), (0.1 + math.cos(ang) * 0.08, 1.42, -0.1 + math.sin(ang) * 0.08), 0.01)
    K.box('#2a2a2a', (0, 0.95, 0.56), (0.5, 0.06, 0.12), bevel=0.0)
    return K


def change_counter():
    K = Kit()
    K.box('boards', (0, 0.52, 0), (2.4, 1.04, 0.62), bevel=0.02)
    K.box('woodDark', (0, 1.07, 0.02), (2.5, 0.06, 0.7), bevel=0.01)
    # a brass grille, a coin tray, the CHANGE sign
    for i in range(9):
        K.box('gold', (-0.9 + i * 0.225, 1.55, -0.2), (0.02, 0.9, 0.02), bevel=0.0)
    K.box('gold', (0, 2.0, -0.2), (2.0, 0.04, 0.04), bevel=0.0)
    K.box('iron', (0.5, 1.13, 0.2), (0.3, 0.05, 0.22), bevel=0.0)
    K.box('#c8392b', (0, 2.2, -0.2), (1.1, 0.3, 0.04), bevel=0.0)
    return K


def mirror_warped():
    """A funhouse mirror: a tall bulging glass in a gilded frame on feet."""
    K = Kit()
    K.box('gold', (0, 1.25, 0), (1.3, 2.5, 0.12), bevel=0.03)
    # the glass, bulging out in the middle
    K.box('metal', (0, 1.25, 0.07), (1.08, 2.25, 0.02), bevel=0.0)
    K.ball('metal', (0, 1.25, 0.03), 0.5, segs=16)
    K.box('woodDark', (0, 0.05, 0.1), (1.0, 0.1, 0.4), bevel=0.01)
    return K


def clown_cutout(seed=2):
    """A painted plywood clown on a stand: grinning face, round red nose, peeling."""
    K = Kit()
    K.box('#e9e3d2', (0, 1.0, 0), (0.7, 1.4, 0.04), bevel=0.0)
    K.ball('#e9e3d2', (0, 1.95, 0), 0.32, segs=10)
    K.ball('#d0322a', (0, 1.93, 0.28), 0.06, segs=8)
    K.box('#2a2440' if seed % 2 else '#2f9be0', (0, 1.0, 0.03), (0.72, 0.9, 0.02), bevel=0.0)
    K.box('#d0322a', (0, 1.62, 0.05), (0.5, 0.08, 0.02), bevel=0.0)
    K.box('woodDark', (0, 0.2, -0.2), (0.08, 0.4, 0.4), rot=(0.5, 0, 0), bevel=0.0)
    K.box('woodDark', (0, 0.02, -0.12), (0.6, 0.04, 0.3), bevel=0.0)
    return K


def fortune_booth():
    """A fortune teller's cabinet: a glass case, a turbaned dummy at a crystal ball, a coin slot."""
    K = Kit()
    K.box('#4a1f3a', (0, 0.45, 0), (1.3, 0.9, 0.9), bevel=0.02)
    K.box('#4a1f3a', (0, 2.25, 0), (1.3, 0.3, 0.9), bevel=0.02)
    for x in (-0.62, 0.62):
        K.box('gold', (x, 1.35, 0.42), (0.05, 1.5, 0.05), bevel=0.0)
        K.box('#4a1f3a', (x, 1.35, -0.2), (0.06, 1.5, 0.5), bevel=0.0)
    K.box('dark', (0, 1.35, -0.42), (1.2, 1.5, 0.05), bevel=0.0)
    # the dummy, its turban and the ball
    K.box('#6a2a4a', (0, 1.25, -0.12), (0.5, 0.6, 0.3), bevel=0.04)
    K.ball('skin', (0, 1.72, -0.12), 0.15, segs=10)
    K.ball('#d9b45a', (0, 1.86, -0.12), 0.16, segs=10)
    K.ball('bulbCyan', (0, 1.05, 0.15), 0.1, segs=10)
    K.box('#e9d9a0', (0, 2.25, 0.46), (1.0, 0.18, 0.02), bevel=0.0)
    return K


def coffin():
    """A coffin prop lying on the floor, its lid knocked askew."""
    K = Kit()
    K.box('woodDark', (0, 0.22, 0), (0.62, 0.44, 1.95), bevel=0.04, segs=2)
    K.box('woodDark', (0, 0.2, 0.75), (0.74, 0.4, 0.3), bevel=0.04, segs=2)
    K.box('#5a2a1a', (0.08, 0.47, 0.05), (0.66, 0.05, 1.9), rot=(0, 0.12, 0.08), bevel=0.01)
    K.box('gold', (0.08, 0.5, 0.35), (0.06, 0.02, 0.4), rot=(0, 0.12, 0.08), bevel=0.0)
    K.box('gold', (0.08, 0.5, 0.35), (0.25, 0.02, 0.06), rot=(0, 0.12, 0.08), bevel=0.0)
    return K


def ride_car():
    """A stalled dark-ride car: a high-backed tub with a lap bar, on bogies."""
    K = Kit()
    K.box('#5a1a1c', (0, 0.55, 0), (1.1, 0.6, 1.6), bevel=0.06, segs=2)
    K.box('#5a1a1c', (0, 1.05, -0.65), (1.1, 0.7, 0.25), bevel=0.06, segs=2)
    K.box('dark', (0, 0.62, 0.05), (0.9, 0.5, 1.2), bevel=0.02)
    rod(K, 'iron', (-0.45, 0.95, 0.25), (0.45, 0.95, 0.25), 0.025)
    for z in (-0.55, 0.55):
        K.box('iron', (0, 0.15, z), (0.9, 0.2, 0.3), bevel=0.01)
    K.box('gold', (0, 0.9, 0.82), (0.5, 0.2, 0.04), bevel=0.0)
    return K


def rail_segment():
    """2 m of dark-ride track on the floor: two flat rails on sleepers, a centre guide."""
    K = Kit()
    for x in (-0.42, 0.42):
        K.box('rust', (x, 0.04, 0), (0.07, 0.06, 2.0), bevel=0.0)
    K.box('iron', (0, 0.05, 0), (0.05, 0.08, 2.0), bevel=0.0)
    for z in (-0.75, -0.25, 0.25, 0.75):
        K.box('woodDark', (0, 0.015, z), (1.1, 0.03, 0.14), bevel=0.0)
    return K


def skeleton_hanging():
    """A prop skeleton dangling from a chain, for the dark ride's scares (feet about 2.15 m up)."""
    K = Kit()
    rod(K, 'iron', (0, 4.2, 0), (0, 3.35, 0), 0.01)
    K.ball('#e2dccb', (0, 3.2, 0), 0.12, segs=8)
    K.box('#e2dccb', (0, 2.85, 0), (0.28, 0.42, 0.14), bevel=0.04)
    for side in (-1, 1):
        rod(K, '#e2dccb', (side * 0.15, 3.02, 0), (side * 0.22, 2.55, 0.03), 0.025)
        rod(K, '#e2dccb', (side * 0.08, 2.6, 0), (side * 0.1, 2.15, 0.04), 0.03)
    for i in range(4):
        K.box('#e2dccb', (0, 2.98 - i * 0.09, 0.07), (0.26, 0.02, 0.02), bevel=0.0)
    return K


for b in layout['buildings']:
    if not ONLY or b['style'] in ONLY:
        building(b).export(f'{OUT}/kit_{b['style']}.glb')
if not ONLY or 'trailer' in ONLY:
    trailer().export(f'{OUT}/kit_trailer.glb')
if not ONLY or 'arch' in ONLY:
    gate().export(f'{OUT}/kit_arch.glb')
for v in ('ringtoss', 'darts', 'milk', 'gallery', 'prize'):
    if not ONLY or f'booth_{v}' in ONLY:
        booth(v).export(f'{OUT}/kit_booth_{v}.glb')
if not ONLY or 'tentdress' in ONLY:
    tentdress().export(f'{OUT}/kit_tentdress.glb')
if not ONLY or 'fence_a' in ONLY:
    fence(1).export(f'{OUT}/kit_fence_a.glb')
if not ONLY or 'fence_b' in ONLY:
    fence(2).export(f'{OUT}/kit_fence_b.glb')
for k in ('popcorn', 'candy', 'hotdog'):
    if not ONLY or f'cart_{k}' in ONLY:
        cart(k).export(f'{OUT}/kit_cart_{k}.glb')
if not ONLY or 'kiosk' in ONLY:
    kiosk().export(f'{OUT}/kit_kiosk.glb')
if not ONLY or 'watertower' in ONLY:
    watertower().export(f'{OUT}/kit_watertower.glb')
if not ONLY or 'signpost' in ONLY:
    signpost().export(f'{OUT}/kit_signpost.glb')
if not ONLY or 'signboard' in ONLY:
    signboard().export(f'{OUT}/kit_signboard.glb')
for i in range(4):
    if not ONLY or f'cabinet_{i}' in ONLY:
        arcade_cabinet(i).export(f'{OUT}/kit_cabinet_{i}.glb')
for name, fn in (('claw', claw_machine), ('counter', change_counter), ('mirror', mirror_warped), ('clown', clown_cutout),
                 ('fortune', fortune_booth), ('coffin', coffin), ('ridecar', ride_car), ('rail', rail_segment),
                 ('skeleton', skeleton_hanging)):
    if not ONLY or name in ONLY:
        fn().export(f'{OUT}/kit_{name}.glb')
