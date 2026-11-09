# The hand weapons, their projectiles, the occult items, the loot and the chests, modelled in Blender: real tools and
# fairground gear found in the park, worn and dirty (chipped paint, tape on handles, rust).
#
#   blender --background --factory-startup --python scripts/blender/build-weapons.py -- out.glb
#
# One GLB, one node per model: w_<weapon>, p_<projectile>, i_<occult item>, l_<loot>. Each sits exactly where the old
# code-built model sat (src/weapons.js GRIP: 'hand' = gripped at the origin, handle up +y; 'aim' = pointing along -z
# from the grip; 'bow' = grip at the origin, limbs up and down, string toward +z). Materials are named for the game to
# fill in (src/weapons.js): wood, wooddark, steel, chrome, rust, black, rubber, tape, cardboard, gold, string, rarity
# (the weapon's rarity colour), band / soda / cross / chestwood (set per loot), or a '#rrggbb' paint.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from kitlib import Kit, rod  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]
SMOOTH = math.radians(38)
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def obox(K, mat, c, rt, up, fw, size, bevel=0.002):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        b = min(bevel, min(size) * 0.45)
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=b, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    c, rt, up, fw = Vector(c), Vector(rt), Vector(up), Vector(fw)
    M = Matrix(((rt.x, up.x, fw.x, c.x), (rt.y, up.y, fw.y, c.y), (rt.z, up.z, fw.z, c.z), (0, 0, 0, 1)))
    K._take(mat, bm, M)


def slab(K, mat, outline, axis, c0, thick, bevel=0.0015):
    """A flat shape: outline points (a, b) in the plane across 'axis' ('x': (y, z), 'y': (z, x), 'z': (x, y)),
    from c0 to c0 + thick along that axis, edges softened."""
    bm = bmesh.new()
    def P(a, b, c):
        return {'x': (c, a, b), 'y': (b, c, a), 'z': (a, b, c)}[axis]
    vs = [bm.verts.new(P(a, b, c0)) for a, b in outline]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    d = {'x': (thick, 0, 0), 'y': (0, thick, 0), 'z': (0, 0, thick)}[axis]
    bmesh.ops.translate(bm, vec=d, verts=moved)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(bevel, thick * 0.4), segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='EAR_CLIP')
    K._take(mat, bm)


def tube(K, mat, pts, r, segs=8, plane_normal=None, radii=None):
    """A round tube along a polyline (open, capped). radii: one radius per point (tapers)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    frames = []
    ref = Vector(plane_normal) if plane_normal else None
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        a = ref if ref is not None else (X if abs(t.x) < 0.9 else Y)
        rt = t.cross(a).normalized()
        up = rt.cross(t).normalized()
        frames.append((rt, up))
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        rr = radii[i] if radii else r
        rt, up = frames[i]
        rings.append([bm.verts.new(p + (rt * math.cos(k * 2 * math.pi / segs) + up * math.sin(k * 2 * math.pi / segs)) * rr) for k in range(segs)])
    for i in range(n - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    K._take(mat, bm)


def ring(K, mat, at, r, h, axis='y', segs=14):
    K.cyl(mat, at, r, h, axis=axis, segs=segs)


def wraps(K, mat, axis, c0, c1, r, at=(0, 0), step=0.018, segs=12):
    """Tape or cord wrapped round a handle: slightly raised rings."""
    t = c0
    while t <= c1:
        p = {'y': (at[0], t, at[1]), 'z': (at[0], at[1], t), 'x': (t, at[0], at[1])}[axis]
        K.cyl(mat, p, r, step * 0.8, axis=axis, segs=segs)
        t += step


# ------------------------------------------------------------------ hand weapons

def mallet():
    K = Kit()
    K.cyl('wood', (0, 0.135, 0), 0.016, 0.53, segs=12, r2=0.018)
    K.ball('wood', (0, -0.13, 0), 0.021, segs=10)
    wraps(K, 'tape', 'y', -0.04, 0.1, 0.0185)
    K.cyl('rarity', (0, -0.08, 0), 0.0205, 0.03, segs=14)
    K.cyl('steel', (0, 0.395, 0), 0.021, 0.04, segs=12)
    # the padded whack-a-mole head: red vinyl, yellow rubber ends, a duct-tape repair
    K.cyl('#b8242a', (0, 0.46, 0), 0.072, 0.17, axis='x', segs=20)
    for s in (-1, 1):
        K.cyl('#f2c53a', (s * 0.095, 0.46, 0), 0.074, 0.025, axis='x', segs=20, r2=0.066)
        K.cyl('#f2c53a', (s * 0.111, 0.46, 0), 0.064, 0.008, axis='x', segs=20, r2=0.05)
    K.cyl('tape', (0.025, 0.46, 0), 0.0735, 0.035, axis='x', segs=20)
    return K


def spike():
    K = Kit()
    K.cyl('wood', (0, 0, 0), 0.019, 0.17, segs=12, r2=0.021)
    K.cyl('steel', (0, 0.095, 0), 0.012, 0.03, segs=10)
    K.cyl('rarity', (0, -0.09, 0), 0.022, 0.025, segs=14)
    K.cyl('steel', (0, 0.4, 0), 0.0045, 0.6, segs=8, r2=0.001)
    # a sticky clump of candy floss
    for x, y, z, r in ((0, 0.14, 0, 0.042), (0.025, 0.16, 0.01, 0.03), (-0.02, 0.17, -0.012, 0.032), (0.005, 0.19, 0.02, 0.026), (-0.01, 0.125, 0.025, 0.026)):
        K.ball('#e98ab8', (x, y, z), r, segs=10)
    return K


def lever():
    K = Kit()
    K.cyl('rust', (0, 0.3, 0), 0.016, 0.84, segs=12)
    K.cyl('rubber', (0, 0.56, 0), 0.0205, 0.2, segs=14)
    K.cyl('steel', (0, 0.68, 0), 0.022, 0.02, segs=14)
    K.ball('#c22a22', (0, 0.735, 0), 0.045, segs=16)
    K.cyl('rarity', (0, 0.06, 0), 0.0205, 0.03, segs=14)
    # the pivot it was torn from: a bracket with a bolt still in it
    K.box('rust', (0, -0.125, 0), (0.07, 0.055, 0.036), bevel=0.004)
    K.cyl('steel', (0, -0.13, 0), 0.011, 0.05, axis='z', segs=10)
    K.cyl('steel', (0, -0.13, 0.026), 0.016, 0.006, axis='z', segs=6)
    rod(K, 'rust', (0.03, -0.1, 0), (0.06, -0.05, 0), 0.006, segs=6)
    return K


def sledge():
    K = Kit()
    K.cyl('wood', (0, 0.32, 0), 0.019, 0.9, segs=12, r2=0.023)
    wraps(K, 'tape', 'y', -0.11, 0.09, 0.021)
    K.cyl('rarity', (0, 0.12, 0), 0.023, 0.03, segs=14)
    # the strongman hammer's head: octagonal steel, chamfered faces, painted red ends, a wedge in the eye
    K.cyl('rust', (0, 0.8, 0), 0.056, 0.2, axis='x', segs=8)
    for s in (-1, 1):
        K.cyl('#c22a22', (s * 0.105, 0.8, 0), 0.057, 0.012, axis='x', segs=8)
        K.cyl('steel', (s * 0.12, 0.8, 0), 0.054, 0.02, axis='x', segs=8, r2=0.044)
    K.box('steel', (0, 0.858, 0), (0.008, 0.008, 0.04), bevel=0.001)
    return K


def crowbar():
    K = Kit()
    pts = [(0.034, -0.125, 0), (0.012, -0.095, 0), (0, -0.06, 0), (0, 0.58, 0), (0.004, 0.63, 0), (0.02, 0.668, 0),
           (0.045, 0.688, 0), (0.072, 0.684, 0), (0.092, 0.664, 0)]
    # red paint down the middle, bare rusty steel at both working ends
    tube(K, 'rust', pts[:4], 0.0125, segs=6, plane_normal=Z)
    tube(K, '#a3221d', [(0, 0.05, 0), (0, 0.5, 0)], 0.0128, segs=6, plane_normal=Z)
    tube(K, 'rust', pts[3:], 0.0125, segs=6, plane_normal=Z)
    # the split claw and the flat chisel end
    for s in (-1, 1):
        obox(K, 'rust', (0.1, 0.652, s * 0.006), Vector((1, -0.8, 0)).normalized(), Vector((0.8, 1, 0)).normalized(), Z, (0.03, 0.012, 0.009), bevel=0.001)
    obox(K, 'rust', (0.042, -0.137, 0), Vector((1, -1.2, 0)).normalized(), Vector((1.2, 1, 0)).normalized(), Z, (0.028, 0.006, 0.024), bevel=0.001)
    K.cyl('rarity', (0, 0.02, 0), 0.016, 0.03, segs=14)
    return K


def machete():
    K = Kit()
    # riveted black grip with a lanyard hole
    slab(K, 'black', [(-0.09, -0.016), (0.07, -0.014), (0.07, 0.03), (-0.07, 0.03), (-0.095, 0.02)], 'x', -0.013, 0.026, bevel=0.005)
    for y in (-0.05, 0.0, 0.045):
        K.cyl('chrome', (0, y, 0.007), 0.005, 0.03, axis='x', segs=8)
    K.cyl('rarity', (0, -0.08, 0.007), 0.021, 0.03, segs=14)
    obox(K, 'steel', (0, 0.075, 0.008), X, Y, Z, (0.03, 0.012, 0.062), bevel=0.002)
    blade = [(0.075, -0.012), (0.48, -0.01), (0.535, 0.0), (0.552, 0.016), (0.532, 0.04), (0.45, 0.052), (0.25, 0.049), (0.075, 0.036)]
    slab(K, 'steel', blade, 'x', -0.0025, 0.005, bevel=0.0012)
    # a bright honed edge and rust blooms on the flat
    edge = [(0.08, 0.03), (0.25, 0.043), (0.45, 0.046), (0.528, 0.036), (0.552, 0.016), (0.532, 0.04), (0.45, 0.052), (0.25, 0.049), (0.08, 0.036)]
    slab(K, 'chrome', edge, 'x', -0.0026, 0.0052, bevel=0.0005)
    for y, z, w in ((0.2, 0.01, 0.05), (0.36, 0.02, 0.035), (0.47, 0.008, 0.025)):
        slab(K, 'rust', [(y, z), (y + w, z - 0.004), (y + w * 1.1, z + 0.012), (y + 0.005, z + 0.016)], 'x', -0.0028, 0.0056, bevel=0)
    return K


def axe():
    K = Kit()
    K.cyl('wood', (0, 0.3, 0), 0.017, 0.82, segs=12, r2=0.02)
    wraps(K, 'tape', 'y', -0.1, 0.06, 0.019)
    K.cyl('rarity', (0, 0.1, 0), 0.021, 0.03, segs=14)
    # the fire axe's head: red paint, a ground steel edge, the pick behind
    head = [(0.70, -0.03), (0.70, 0.04), (0.745, 0.152), (0.73, 0.167), (0.70, 0.172), (0.66, 0.174), (0.62, 0.17),
            (0.585, 0.16), (0.578, 0.148), (0.62, 0.04), (0.62, -0.03), (0.646, -0.085), (0.66, -0.152), (0.674, -0.085)]
    slab(K, '#a3221d', head, 'x', -0.014, 0.028, bevel=0.003)
    edge = [(0.7, 0.13), (0.745, 0.152), (0.73, 0.167), (0.70, 0.172), (0.66, 0.174), (0.62, 0.17), (0.585, 0.16), (0.578, 0.148), (0.6, 0.13)]
    slab(K, 'steel', edge, 'x', -0.0145, 0.029, bevel=0.002)
    slab(K, 'steel', [(0.652, -0.12), (0.66, -0.153), (0.668, -0.12)], 'x', -0.0145, 0.029, bevel=0.001)
    return K


def chainsaw():
    K = Kit()
    # orange housing over a black crankcase, vents, a rusty muffler, the fuel cap
    K.box('#d4651c', (0, 0.035, 0.085), (0.1, 0.13, 0.25), bevel=0.018, segs=2)
    K.box('black', (0, -0.045, 0.08), (0.095, 0.05, 0.24), bevel=0.01)
    for k in range(5):
        K.box('black', (0.051, 0.05, 0.03 + k * 0.025), (0.004, 0.06, 0.008), bevel=0)
    K.box('rust', (-0.052, -0.01, 0.0), (0.02, 0.06, 0.05), bevel=0.005)
    K.cyl('black', (0.03, 0.105, 0.17), 0.016, 0.012, segs=10)
    K.cyl('black', (-0.055, 0.04, 0.12), 0.012, 0.02, axis='x', segs=10)
    # the wrap handle over the top, the chain brake in front of it
    tube(K, 'black', [(0, 0.09, 0.2), (0, 0.15, 0.17), (0, 0.17, 0.1), (0, 0.165, 0.0), (0, 0.13, -0.035), (0, 0.08, -0.04)], 0.013, segs=8, plane_normal=X)
    K.box('black', (0, 0.12, -0.055), (0.11, 0.09, 0.006), bevel=0.002)
    K.box('rarity', (0, 0.035, 0.212), (0.102, 0.132, 0.012), bevel=0.003)
    # the bar with its rounded nose (points as (z, y)) and a chain of teeth round it
    bar = [(-0.04, -0.012), (-0.5, -0.012)] + [(-0.5 - 0.034 * math.sin(k * math.pi / 8), 0.022 - 0.034 * math.cos(k * math.pi / 8)) for k in range(1, 8)] + [(-0.5, 0.056), (-0.04, 0.056)]
    slab(K, 'rust', [(y, z) for z, y in bar], 'x', -0.006, 0.012, bevel=0.002)
    z = -0.05
    while z > -0.5:
        for y in (-0.016, 0.06):
            K.box('black', (0, y, z), (0.016, 0.01, 0.012), bevel=0)
        z -= 0.022
    for k in range(9):
        a = k * math.pi / 8
        K.box('black', (0, 0.022 - 0.04 * math.cos(a), -0.5 - 0.04 * math.sin(a)), (0.016, 0.01, 0.01), bevel=0)
    return K


def darts():
    K = Kit()
    for x, z in ((0, 0), (0.018, 0.012), (-0.016, 0.014)):
        K.cyl('steel', (x, 0.065, z), 0.0042, 0.07, segs=8, r2=0.0008)
        K.cyl('chrome', (x, 0.01, z), 0.007, 0.045, segs=10)
        wraps(K, 'steel', 'y', -0.008, 0.026, 0.0075, at=(x, z), step=0.006, segs=10)
        K.cyl('rarity', (x, -0.05, z), 0.0045, 0.06, segs=8)
        for rot in (0, math.pi / 2):
            obox(K, '#f2f0e8', (x, -0.1, z), Vector((math.cos(rot), 0, math.sin(rot))), Y, Vector((-math.sin(rot), 0, math.cos(rot))), (0.03, 0.045, 0.0015), bevel=0)
    return K


def bow():
    K = Kit()
    # laminated riser with a leather grip and an arrow shelf
    slab(K, 'wooddark', [(-0.16, -0.01), (-0.05, -0.03), (0.05, -0.03), (0.16, -0.01), (0.16, 0.015), (0.06, 0.02), (0.03, 0.035), (-0.05, 0.03), (-0.16, 0.015)], 'x', -0.016, 0.032, bevel=0.006)
    K.box('black', (0, -0.005, 0.002), (0.036, 0.1, 0.05), bevel=0.012, segs=2)
    K.box('rarity', (0, 0.07, -0.006), (0.036, 0.02, 0.04), bevel=0.004)
    K.box('#c8b48a', (0.012, 0.06, -0.02), (0.012, 0.008, 0.03), bevel=0.002)
    # two recurve limbs, tapering, with black tips curling back away from the archer
    for s in (-1, 1):
        pts, rad = [], []
        for k in range(15):
            u = k / 14
            y = 0.15 + u * 0.32
            zc = -0.01 + 0.55 * (y - 0.15) ** 2
            if u > 0.85:
                zc -= (u - 0.85) * 0.25
            pts.append(Vector((0, s * y, zc)))
            rad.append(u)
        for k in range(len(pts) - 1):
            a, b = pts[k], pts[k + 1]
            d = (b - a)
            w = 0.034 - 0.018 * rad[k]
            obox(K, 'black' if k >= 12 else 'wood', (a + b) / 2, X, Vector((0, -d.z, d.y)).normalized() * (1 if s > 0 else -1), d.normalized(), (w, 0.011, d.length + 0.004), bevel=0.002)
        tip = pts[-1]
        tips = tip
        if s > 0:
            top = tips
        else:
            bot = tips
    rod(K, 'string', tuple(top + Vector((0, -0.004, 0.006))), tuple(bot + Vector((0, 0.004, 0.006))), 0.0018, segs=5)
    return K


def crossbow():
    K = Kit()
    stock = [(-0.45, 0.06), (0.05, 0.06), (0.14, 0.045), (0.30, 0.062), (0.335, 0.045), (0.335, -0.07), (0.29, -0.082),
             (0.13, -0.03), (0.075, -0.03), (0.07, -0.12), (0.025, -0.128), (0.0, -0.02), (-0.45, 0.0)]
    slab(K, 'wood', [(y, z) for z, y in stock], 'x', -0.022, 0.044, bevel=0.006)
    K.box('rubber', (0, -0.012, 0.343), (0.044, 0.12, 0.016), bevel=0.004)
    K.box('black', (0, 0.066, -0.22), (0.022, 0.012, 0.46), bevel=0.002)
    # trigger and guard
    tube(K, 'black', [(0, -0.01, -0.02), (0, -0.05, -0.03), (0, -0.07, 0.0), (0, -0.05, 0.025)], 0.004, segs=6, plane_normal=X)
    K.box('steel', (0, -0.035, 0.0), (0.006, 0.04, 0.008), bevel=0.001)
    # the prod: a steel bow across the front, its string drawn back to the latch, a foot stirrup
    pts = [Vector((x, 0.06, -0.43 + 0.85 * x * x)) for x in [k * 0.034 - 0.34 for k in range(21)]]
    tube(K, 'steel', pts, 0.009, segs=6, plane_normal=Y, radii=[0.012 - 0.006 * abs(p.x) / 0.34 for p in pts])
    for e in (pts[0], pts[-1]):
        rod(K, 'string', tuple(e), (0, 0.072, -0.06), 0.0016, segs=4)
    K.box('black', (0, 0.07, -0.06), (0.03, 0.02, 0.03), bevel=0.003)
    tube(K, 'steel', [(-0.04, 0.03, -0.45), (-0.045, -0.04, -0.47), (0.045, -0.04, -0.47), (0.04, 0.03, -0.45)], 0.005, segs=6)
    # a bolt laid ready on the rail
    K.cyl('wood', (0, 0.078, -0.24), 0.005, 0.38, axis='z', segs=8)
    K.cyl('steel', (0, 0.078, -0.445), 0.008, 0.03, axis='z', segs=8, r2=0.001)
    for rot in (0, 2.1, -2.1):
        d = Vector((math.sin(rot), math.cos(rot), 0))
        obox(K, '#c43a2a', Vector((0, 0.078, -0.09)) + d * 0.01, d.cross(Z), d, Z, (0.001, 0.014, 0.05), bevel=0)
    K.box('rarity', (0, 0.03, -0.3), (0.05, 0.068, 0.02), bevel=0.003)
    return K


def harpoon():
    K = Kit()
    K.cyl('#2d4a3a', (0, 0.04, -0.2), 0.024, 0.7, axis='z', segs=14)
    K.box('black', (0, 0.04, -0.565), (0.07, 0.05, 0.03), bevel=0.006)
    K.cyl('rarity', (0, 0.04, -0.05), 0.027, 0.03, axis='z', segs=14)
    # the spear with barbs
    K.cyl('steel', (0, 0.07, -0.55), 0.005, 0.66, axis='z', segs=8)
    K.cyl('steel', (0, 0.07, -0.9), 0.009, 0.04, axis='z', segs=8, r2=0.001)
    for s in (-1, 1):
        obox(K, 'steel', (s * 0.006, 0.07, -0.86), Vector((1, 0, s * 0.6)).normalized(), Y, Vector((-s * 0.6, 0, 1)).normalized(), (0.003, 0.004, 0.03), bevel=0)
    # two red rubber bands from the muzzle to the wishbone hooked on the spear
    for s in (-1, 1):
        tube(K, '#7a1e1e', [(s * 0.04, 0.04, -0.565), (s * 0.03, 0.06, -0.4), (s * 0.012, 0.072, -0.22), (0, 0.075, -0.2)], 0.007, segs=6)
    K.box('steel', (0, 0.075, -0.2), (0.03, 0.006, 0.006), bevel=0)
    # pistol grip, trigger guard, a rubber butt pad
    slab(K, 'black', [(-0.0, 0.05), (-0.03, 0.06), (-0.13, 0.04), (-0.13, 0.0), (-0.03, -0.01), (0.0, 0.0)], 'x', -0.016, 0.032, bevel=0.006)
    tube(K, 'black', [(0, 0.015, -0.03), (0, -0.03, -0.04), (0, -0.04, -0.01)], 0.004, segs=6, plane_normal=X)
    K.cyl('rubber', (0, 0.04, 0.17), 0.028, 0.04, axis='z', segs=14)
    return K


def fireworks():
    K = Kit()
    K.cyl('#a8201c', (0, 0.06, -0.15), 0.06, 0.94, axis='z', segs=18)
    for z in (-0.5, -0.3, 0.1):
        K.cyl('#f2c53a', (0, 0.06, z), 0.0615, 0.04, axis='z', segs=18)
    K.cyl('#f2c53a', (0, 0.06, -0.615), 0.063, 0.02, axis='z', segs=18)
    K.cyl('black', (0, 0.06, -0.622), 0.05, 0.006, axis='z', segs=18)
    K.cyl('cardboard', (0, 0.06, 0.32), 0.06, 0.01, axis='z', segs=18)
    # a printed label, the fuse out of the back, a taped-on grip and a bent-wire sight
    obox(K, '#efe4c4', (0.061, 0.06, -0.2), X, Y, Z, (0.002, 0.06, 0.14), bevel=0)
    obox(K, '#2a5a8c', (0.0625, 0.06, -0.2), X, Y, Z, (0.002, 0.025, 0.1), bevel=0)
    tube(K, '#3a6a2a', [(0, 0.07, 0.32), (0.01, 0.08, 0.36), (0.03, 0.07, 0.39), (0.04, 0.05, 0.4)], 0.003, segs=5)
    K.box('black', (0, -0.04, 0.03), (0.03, 0.1, 0.04), bevel=0.006)
    wraps(K, 'tape', 'z', -0.0, 0.07, 0.064, at=(0, 0.06), step=0.02, segs=18)
    tube(K, 'steel', [(0, 0.118, -0.52), (0, 0.14, -0.52), (0, 0.14, -0.5)], 0.002, segs=4)
    K.cyl('rarity', (0, 0.06, 0.25), 0.064, 0.03, axis='z', segs=18)
    return K


# ------------------------------------------------------------------ projectiles (pointing along -z)

def fletch(K, z0, mat='#c43a2a', r=0.006, length=0.08, h=0.016):
    for k in range(3):
        a = k * 2 * math.pi / 3
        d = Vector((math.sin(a), math.cos(a), 0))
        obox(K, mat, d * (r + h / 2), d.cross(Z), d, Z, (0.0012, h, length), bevel=0)


def arrow(length, r):
    K = Kit()
    K.cyl('wood', (0, 0, 0), r, length, axis='z', segs=8)
    # a three-blade broadhead
    K.cyl('steel', (0, 0, -length / 2 - 0.012), r * 1.3, 0.024, axis='z', segs=8)
    for k in range(3):
        a = k * 2 * math.pi / 3
        d = Vector((math.sin(a), math.cos(a), 0))
        obox(K, 'steel', Vector((0, 0, -length / 2 - 0.04)) + d * 0.006, d.cross(Z), d, Z, (0.0012, 0.012, 0.045), bevel=0)
    K.cyl('steel', (0, 0, -length / 2 - 0.06), r * 1.3, 0.02, axis='z', segs=8, r2=0.0005)
    fletch(K, 0, r=r, length=min(0.1, length * 0.2))
    K.cyl('#f2c53a', (0, 0, length / 2 + 0.006), r * 1.1, 0.012, axis='z', segs=8)
    return K


def projectile_bow():
    K = arrow(0.75, 0.005)
    return shift_vanes(K, 0.75)


def projectile_crossbow():
    K = arrow(0.4, 0.006)
    return shift_vanes(K, 0.4)


def shift_vanes(K, length):
    """fletch() puts the vanes at the middle; move the vane material's geometry back to the tail."""
    verts, faces = K.parts['#c43a2a']
    K.parts['#c43a2a'] = ([(x, y, z + length / 2 - 0.07) for x, y, z in verts], faces)
    return K


def projectile_darts():
    K = Kit()
    K.cyl('steel', (0, 0, -0.065), 0.004, 0.06, axis='z', segs=8, r2=0.0008)
    K.cyl('chrome', (0, 0, -0.015), 0.007, 0.045, axis='z', segs=10)
    K.cyl('#e0b030', (0, 0, 0.03), 0.0045, 0.05, axis='z', segs=8)
    for rot in (0, math.pi / 2):
        obox(K, '#f2f0e8', (0, 0, 0.07), Vector((math.cos(rot), math.sin(rot), 0)), Vector((-math.sin(rot), math.cos(rot), 0)), Z, (0.03, 0.0015, 0.04), bevel=0)
    return K


def projectile_harpoon():
    K = Kit()
    K.cyl('steel', (0, 0, 0), 0.006, 1.0, axis='z', segs=8)
    K.cyl('steel', (0, 0, -0.53), 0.012, 0.06, axis='z', segs=8, r2=0.001)
    for s in (-1, 1):
        obox(K, 'steel', (s * 0.008, 0, -0.48), Vector((1, 0, s * 0.6)).normalized(), Y, Vector((-s * 0.6, 0, 1)).normalized(), (0.003, 0.004, 0.04), bevel=0)
    tube(K, 'string', [(0, 0, 0.5), (0.02, 0, 0.53), (0, 0, 0.56), (-0.02, 0, 0.53), (0, 0, 0.5)], 0.002, segs=4)
    return K


def projectile_fireworks():
    K = Kit()
    K.cyl('#e83a2a', (0, 0, 0), 0.034, 0.36, axis='z', segs=14)
    for z in (-0.12, 0.08):
        K.cyl('#f2c53a', (0, 0, z), 0.035, 0.02, axis='z', segs=14)
    K.cyl('#f2c53a', (0, 0, -0.24), 0.035, 0.12, axis='z', segs=14, r2=0.002)
    K.cyl('black', (0, 0, 0.185), 0.03, 0.01, axis='z', segs=14)
    K.cyl('wood', (0.03, 0, 0.35), 0.004, 0.4, axis='z', segs=6)
    return K


# ------------------------------------------------------------------ occult items (lying on the floor, up +y)

def salt():
    K = Kit()
    K.cyl('#2a4a8c', (0, 0.075, 0), 0.06, 0.15, segs=20)
    K.cyl('#e8e4da', (0, 0.08, 0), 0.0605, 0.06, segs=20)
    K.cyl('chrome', (0, 0.162, 0), 0.06, 0.024, segs=20)
    K.cyl('chrome', (0, 0.176, 0), 0.05, 0.006, segs=20, r2=0.04)
    K.box('chrome', (0.045, 0.18, 0), (0.03, 0.006, 0.02), bevel=0.001)
    return K


def relic():
    K = Kit()
    # a tarnished gold reliquary cross with flared ends, a red stone at the crossing and a stepped foot
    K.box('gold', (0, 0.16, 0), (0.03, 0.27, 0.022), bevel=0.004)
    K.box('gold', (0, 0.215, 0), (0.18, 0.03, 0.022), bevel=0.004)
    for x, y in ((0, 0.295), (0.09, 0.215), (-0.09, 0.215)):
        K.box('gold', (x, y, 0), (0.045, 0.045, 0.026), rot=(0, 0, math.pi / 4), bevel=0.004)
        K.ball('gold', (x * 1.25, y + (0.03 if x == 0 else 0), 0), 0.009, segs=8)
    K.cyl('gold', (0, 0.215, 0.012), 0.024, 0.006, axis='z', segs=16)
    K.ball('#8a1a1a', (0, 0.215, 0.016), 0.012, segs=10)
    K.box('gold', (0, 0.02, 0), (0.08, 0.025, 0.05), bevel=0.004)
    K.box('gold', (0, 0.0, 0), (0.11, 0.015, 0.07), bevel=0.003)
    return K


# ------------------------------------------------------------------ loot (centred on the origin)

def ammo():
    K = Kit()
    K.box('#3d4a3a', (0, 0, 0), (0.45, 0.24, 0.3), bevel=0.012)
    K.box('#3d4a3a', (0, 0.135, 0), (0.46, 0.04, 0.31), bevel=0.008)
    K.box('band', (0, -0.02, 0), (0.455, 0.07, 0.305), bevel=0.004)
    K.box('#d8d0b0', (0, 0.06, 0.152), (0.18, 0.05, 0.004), bevel=0)
    for s in (-1, 1):
        K.box('steel', (s * 0.2, 0.11, 0.155), (0.03, 0.05, 0.012), bevel=0.003)
        tube(K, 'black', [(s * 0.236, 0.02, -0.06), (s * 0.25, 0.04, -0.03), (s * 0.25, 0.04, 0.03), (s * 0.236, 0.02, 0.06)], 0.007, segs=6)
    return K


def bandage():
    K = Kit()
    K.cyl('#f2e6d8', (0, 0, 0), 0.14, 0.22, axis='x', segs=18)
    K.cyl('#e0d2c0', (0, 0, 0), 0.05, 0.224, axis='x', segs=12)
    obox(K, '#f2e6d8', (0.02, -0.13, 0.08), X, Vector((0, 0.5, -1)).normalized(), Vector((0, 1, 0.5)).normalized(), (0.2, 0.003, 0.1), bevel=0)
    K.box('chrome', (0.06, 0.0, 0.14), (0.02, 0.05, 0.004), bevel=0)
    return K


def medkit():
    K = Kit()
    K.box('#f4f4f4', (0, 0, 0), (0.5, 0.3, 0.3), bevel=0.03, segs=2)
    K.box('#d8d8d6', (0, 0.07, 0), (0.505, 0.012, 0.305), bevel=0.002)
    for w, h in ((0.26, 0.08), (0.08, 0.26)):
        K.box('cross', (0, 0, -0.152), (w, h, 0.006), bevel=0.002)
    tube(K, 'black', [(-0.08, 0.15, 0), (-0.06, 0.19, 0), (0.06, 0.19, 0), (0.08, 0.15, 0)], 0.012, segs=8)
    for s in (-1, 1):
        K.box('steel', (s * 0.18, 0.06, -0.153), (0.04, 0.03, 0.01), bevel=0.003)
    return K


def soda():
    K = Kit()
    K.cyl('soda', (0, 0, 0), 0.12, 0.3, segs=24)
    K.cyl('chrome', (0, 0.16, 0), 0.115, 0.02, segs=24, r2=0.1)
    K.cyl('chrome', (0, -0.16, 0), 0.105, 0.02, segs=24, r2=0.115)
    K.cyl('#f2f0e8', (0, 0.0, 0), 0.1205, 0.08, segs=24)
    K.box('chrome', (0.03, 0.172, 0), (0.05, 0.004, 0.025), bevel=0.002)
    return K


def chest():
    K = Kit()
    # planked base and a barrel lid, iron-bound with gold-painted bands and studs, a heavy lock
    for k in range(4):
        K.box('chestwood', (0, 0.06 + k * 0.125, 0), (1.0, 0.118, 0.65), bevel=0.01)
    lid = [(0, 0.5), *[(0.33 * math.cos(a), 0.5 + 0.33 * math.sin(a)) for a in [k * math.pi / 12 for k in range(13)]]]
    slab(K, 'chestwood', [(y, z) for z, y in lid[1:]], 'x', -0.5, 1.0, bevel=0.01)
    for x in (-0.38, 0.38):
        K.box('gold', (x, 0.25, 0), (0.07, 0.52, 0.67), bevel=0.006)
        band = [(0.34 * math.cos(a), 0.5 + 0.34 * math.sin(a)) for a in [k * math.pi / 12 for k in range(13)]]
        slab(K, 'gold', [(y, z) for z, y in band], 'x', x - 0.035, 0.07, bevel=0.004)
        for y in (0.08, 0.25, 0.42):
            for s in (-1, 1):
                K.ball('gold', (x, y, s * 0.337), 0.013, segs=8)
    for s in (-1, 1):
        K.box('gold', (s * 0.505, 0.25, 0), (0.012, 0.52, 0.67), bevel=0.004)
    K.box('gold', (0, 0.47, -0.34), (0.16, 0.19, 0.05), bevel=0.01)
    K.cyl('black', (0, 0.45, -0.366), 0.016, 0.004, axis='z', segs=10)
    return K


MODELS = {
    'w_mallet': mallet, 'w_spike': spike, 'w_lever': lever, 'w_sledge': sledge, 'w_crowbar': crowbar,
    'w_machete': machete, 'w_axe': axe, 'w_chainsaw': chainsaw, 'w_darts': darts, 'w_bow': bow,
    'w_crossbow': crossbow, 'w_harpoon': harpoon, 'w_fireworks': fireworks,
    'p_bow': projectile_bow, 'p_crossbow': projectile_crossbow, 'p_darts': projectile_darts,
    'p_harpoon': projectile_harpoon, 'p_fireworks': projectile_fireworks,
    'i_salt': salt, 'i_relic': relic,
    'l_ammo': ammo, 'l_bandage': bandage, 'l_medkit': medkit, 'l_soda': soda, 'l_chest': chest,
}


def export_all(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    total = 0
    for name, fn in MODELS.items():
        K = fn()
        root = bpy.data.objects.new(name, None)
        scene.collection.objects.link(root)
        n = 0
        for mat, (verts, faces) in K.parts.items():
            me = bpy.data.meshes.new(f'{name}:{mat}')
            me.from_pydata([(x, -z, y) for x, y, z in verts], [], faces)
            me.validate()
            me.update()
            me.shade_smooth()
            me.set_sharp_from_angle(angle=SMOOTH)
            m = bpy.data.materials.get(mat) or bpy.data.materials.new(mat)
            me.materials.append(m)
            o = bpy.data.objects.new(f'{name}:{mat}', me)
            scene.collection.objects.link(o)
            o.parent = root
            n += sum(len(p.vertices) - 2 for p in me.polygons)
        total += n
        print(f'MODEL {name}: {len(K.parts)} materials, {n} triangles', flush=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False)
    print(f'WEAPONS {path}: {len(MODELS)} models, {total} triangles', flush=True)


export_all(OUT)
