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

args = sys.argv[sys.argv.index('--') + 1:]
LAYOUT, OUT = args[0], args[1]
layout = json.load(open(LAYOUT))
T = 0.4  # wall thickness
DOOR = 3.0

# paint per building: wall colour comes from the game's material; these are the 80s accents
ACCENT = {
    'funhouse': ('#c94f7c', '#f2b632'),
    'tunnel': ('#7a1c1c', '#1c1a1a'),
    'arcade': ('#2f9be0', '#f0702c'),
}


class Kit:
    """Geometry gathered per material, then turned into one mesh per material."""

    def __init__(self):
        self.parts = {}

    def _take(self, mat, bm, M=None, recalc=True):
        if M is not None:
            bm.transform(M)
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        verts, faces = self.parts.setdefault(mat, ([], []))
        base = len(verts)
        verts.extend(tuple(v.co) for v in bm.verts)
        idx = {v: i for i, v in enumerate(bm.verts)}
        faces.extend(tuple(base + idx[v] for v in f.verts) for f in bm.faces)
        bm.free()

    def box(self, mat, at, size, rot=(0, 0, 0), bevel=0.02, segs=1):
        """A box size (w, h, d) centred at 'at', turned by rot (x, y, z radians, applied y, x, z)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        if bevel > 0:
            b = min(bevel, min(size) * 0.45)
            bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=b, segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
        M = Matrix.Translation(Vector(at)) @ Euler(rot, 'YXZ').to_matrix().to_4x4()
        self._take(mat, bm, M)

    def cyl(self, mat, at, r, h, axis='y', segs=10, r2=None, rot=None):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
        # the cone is made along z; point it along the asked axis
        R = {'y': Euler((-math.pi / 2, 0, 0)), 'x': Euler((0, math.pi / 2, 0)), 'z': Euler((0, 0, 0))}[axis].to_matrix().to_4x4()
        if rot is not None:
            R = Euler(rot, 'YXZ').to_matrix().to_4x4() @ R
        self._take(mat, bm, Matrix.Translation(Vector(at)) @ R)

    def ball(self, mat, at, r, segs=8):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(4, segs // 2), radius=r)
        self._take(mat, bm, Matrix.Translation(Vector(at)))

    def prism(self, mat, outline, z0, depth, bevel=0.03):
        """An outline in the x-y plane (game), pushed out in z from z0 to z0 + depth, with softened edges."""
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, z0)) for x, y in outline]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=(0, 0, depth), verts=moved)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
        # the outline is concave: cut its faces into triangles the careful way, or the exporter leaves holes
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='EAR_CLIP')
        self._take(mat, bm)

    def export(self, path):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        total = 0
        for mat, (verts, faces) in self.parts.items():
            me = bpy.data.meshes.new(mat)
            # game (x, y, z) -> Blender (x, -z, y): a proper rotation, so faces keep their winding
            me.from_pydata([(x, -z, y) for x, y, z in verts], [], faces)
            me.validate()
            me.update()
            m = bpy.data.materials.get(mat) or bpy.data.materials.new(mat)
            me.materials.append(m)
            o = bpy.data.objects.new(mat, me)
            scene.collection.objects.link(o)
            total += sum(len(p.vertices) - 2 for p in me.polygons)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                                  export_materials='EXPORT', export_normals=True, export_texcoords=False)
        print(f'KIT {path}: {len(self.parts)} materials, {total} triangles', flush=True)


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
    # pennant bunting hanging in loops round the eave
    loops = 12
    for i in range(loops):
        a0 = i * 2 * math.pi / loops
        for k in range(5):
            t = (k + 0.5) / 5
            a = a0 + t * 2 * math.pi / loops
            sag = math.sin(t * math.pi) * 0.35
            x, z = math.cos(a) * (eave_r + 0.08), math.sin(a) * (eave_r + 0.08)
            y = eave_y - sag
            col = BALLOONS[(i * 5 + k) % len(BALLOONS)]
            tri = [(-0.13, 0.0), (0.13, 0.0), (0.0, -0.3)]
            # a flag facing outward: build it in its own plane, then turn it round the tent
            bm_pts = [(x + math.sin(a) * px * -1, y + py, z + math.cos(a) * px) for px, py in tri]
            flag(K, col, bm_pts)
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


for b in layout['buildings']:
    building(b).export(f"{OUT}/kit_{b['style']}.glb")
trailer().export(f'{OUT}/kit_trailer.glb')
gate().export(f'{OUT}/kit_arch.glb')
for v in ('ringtoss', 'darts', 'milk', 'gallery', 'prize'):
    booth(v).export(f'{OUT}/kit_booth_{v}.glb')
tentdress().export(f'{OUT}/kit_tentdress.glb')
