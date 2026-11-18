# Dressing for the rides, modelled in Blender from code with art from scripts/rides-textures.mjs:
#   dress_station   the coaster's loading station: a "you must be this tall" clown, an entry lane of pipe rail from
#                   the steps, ride rules and an EXIT board hung from the roof on chains
#   dress_arena     the bumper cars: a worn steel floor painted with one-way arrows, the electric grid under the roof,
#                   a rubber bumper strip round the rails, rules on the columns, a pay podium at the way in
#   dress_freefall  the drop tower's base: the operator's control desk, power cabinets in hazard stripes, a cable
#                   drum and the height warning at the way in
# Each is built round its ride's map prop (shared/map.js; scripts/export-kit-layout.mjs), staying clear of the
# colliders the ride already has, and shared/rides-layout.js (written here) places it and adds its solid parts.
#
#   node scripts/rides-textures.mjs
#   node scripts/export-kit-layout.mjs layout.json
#   blender --background --factory-startup --python scripts/blender/rides-dress.py -- <last-ride folder> layout.json
#   node scripts/convert-env.mjs dress_station dress_arena dress_freefall
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import dresslib  # noqa: E402
from dresslib import FACING, MATS, Model, box, cylinder, mat, picture, quad, rnd  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
ROOT, LAYOUT = args[0], args[1]
TEX = os.path.join(ROOT, 'assets-src', 'blender', 'tex')
OUT = os.path.join(ROOT, 'assets-src', 'blender')
L = json.load(open(LAYOUT))
dresslib.setup(TEX, 4242)


def sheet(i):
    """The signs sheet: 0 the height clown (tall), then 1..6 the square boards (two rows of three, left to right)."""
    if i == 0:
        return (0.0, 0.0, 0.25, 1.0)
    col, row = (i - 1) % 3, (i - 1) // 3
    return (0.25 + col * 0.25, row * 0.5, 0.5 + col * 0.25, 0.5 + row * 0.5)


KEEP_ARMS, EXIT, NO_HEAD_ON, PAY_HERE, MUST_BE_48, HIGH_VOLTAGE = 1, 4, 2, 5, 3, 6


def rail(M, m, a, b, y0, posts=True):
    """A pipe rail from a to b (x, z) with a top bar, a mid bar and posts, standing on y0."""
    a, b = Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1]))
    d = b - a
    n = max(1, int(d.length / 1.4))
    ang = math.atan2(d.x, d.z)
    for y in (0.5, 1.0):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.025, radius2=0.025, depth=d.length)
        bm.transform(Matrix.Translation((a + b) / 2 + Vector((0, y0 + y, 0))) @ Matrix.Rotation(ang, 4, 'Y') @ Matrix.Identity(4))
        M.take(m, bm)
    if posts:
        for k in range(n + 1):
            p = a + d * (k / n)
            cylinder(M, m, (p.x, y0 + 0.52, p.z), 0.035, 1.04, axis='y', segs=8)


def chain_board(M, m, c, size, facing, uv, top):
    """A board hung on two chains from the roof at height top."""
    picture(M, m, c, size, size, facing, uv=uv, depth=0.05)
    r = FACING[facing][0]
    steel = mat('chain', '#3a3a3a', 0.6, metal=0.7)
    for s in (-0.4, 0.4):
        p = Vector(c) + r * (s * size)
        y0 = c[1] + size / 2 + 0.05
        cylinder(M, steel, (p.x, (y0 + top) / 2, p.z), 0.012, top - y0, axis='y', segs=4)


# ===================================================================== the coaster's station
def dress_station():
    M = Model('dress_station')
    signs = mat('rides_signs', '#ffffff', 0.8, image='rides_signs.png')
    pipe = mat('rail_pipe', '#8a1c22', 0.5, metal=0.5)
    deck = 0.98
    # the height clown at the top of the steps, facing the people coming up them
    picture(M, signs, (2.2, deck + 1.2, -4.0), 1.2, 2.4, '+x', uv=sheet(0))
    for s in (-0.45, 0.45):
        box(M, mat('board', '#2a1e16', 0.9), (2.12, deck + 0.3, -4.0 + s), (0.08, 0.6, 0.08))
    M.solid(2.15, -4.0, 0.25, 1.3, deck + 2.5)
    # an entry lane of pipe rail from the steps onto the deck
    for z in (-3.25, 3.25):
        rail(M, pipe, (2.4, z), (0.6, z), deck)
        M.solid(1.5, z, 1.9, 0.12, deck + 1.05)
    # rules and the way out, hung from the roof
    chain_board(M, signs, (0.4, 3.2, -1.2), 1.3, '+x', sheet(KEEP_ARMS), 4.58)
    chain_board(M, signs, (0.4, 3.2, 7.2), 1.1, '+x', sheet(EXIT), 4.58)
    return M


# ===================================================================== the bumper cars
def dress_arena():
    a = L['arena']
    w, d = a['w'], a['d']
    M = Model('dress_arena')
    floor = mat('rides_arena_floor', '#7a7a7a', 0.85, metal=0.1, image='rides_arena_floor.png')
    signs = mat('rides_signs', '#ffffff', 0.8, image='rides_signs.png')
    grid = mat('ceiling_grid', '#2a2c30', 0.5, metal=0.8)
    rubber = mat('rubber', '#141414', 0.9)
    wood = mat('podium', '#7a2a2a', 0.7)
    # the painted floor, just over the steel (inside the rails)
    quad(M, floor, (0, 0.187, 0), w - 1.0, d - 1.0, '+y')
    # the electric grid the cars drew their power from
    y = 5.78
    x = -w / 2 + 0.6
    while x < w / 2 - 0.5:
        box(M, grid, (x, y, 0), (0.025, 0.025, d - 1.2))
        x += 0.6
    z = -d / 2 + 0.6
    while z < d / 2 - 0.5:
        box(M, grid, (0, y - 0.03, z), (w - 1.2, 0.025, 0.025))
        z += 0.6
    # the rubber strip round the inside of the rails (the long sides have a 6 m gap in the middle)
    inset = 0.34
    for sz in (-1, 1):
        for x0, x1 in ((-w / 2 + inset, -3.0), (3.0, w / 2 - inset)):
            box(M, rubber, ((x0 + x1) / 2, 0.48, sz * (d / 2 - inset)), (x1 - x0, 0.32, 0.16), bevel=0.06)
    for sx in (-1, 1):
        box(M, rubber, (sx * (w / 2 - inset), 0.48, 0), (0.16, 0.32, d - 2 * inset), bevel=0.06)
    # the rules on the middle columns, facing in
    picture(M, signs, (0, 2.4, -d / 2 + 0.36), 1.1, 1.1, '+z', uv=sheet(NO_HEAD_ON), depth=0.05)
    picture(M, signs, (0, 2.4, d / 2 - 0.36), 1.1, 1.1, '-z', uv=sheet(KEEP_ARMS), depth=0.05)
    # a pay podium by the way in, its sign on a post
    box(M, wood, (4.4, 0.55, d / 2 + 1.2), (0.9, 1.1, 0.7), bevel=0.04)
    box(M, mat('podium_top', '#2a1e16', 0.6), (4.4, 1.12, d / 2 + 1.2), (1.0, 0.05, 0.8))
    cylinder(M, mat('chain', '#3a3a3a', 0.6, metal=0.7), (5.1, 1.0, d / 2 + 1.5), 0.04, 2.0, axis='y', segs=8)
    picture(M, signs, (5.1, 2.3, d / 2 + 1.55), 0.8, 0.8, '+z', uv=sheet(PAY_HERE), depth=0.04)
    M.solid(4.4, d / 2 + 1.2, 0.9, 0.7, 1.15)
    return M


# ===================================================================== the Free Fall's base
def dress_freefall():
    M = Model('dress_freefall')
    signs = mat('rides_signs', '#ffffff', 0.8, image='rides_signs.png')
    hazard = mat('rides_hazard', '#ffffff', 0.7, image='rides_hazard.png')
    panel = mat('rides_panel', '#ffffff', 0.5, image='rides_panel.png', emit_from_image=True, emit_strength=0.4)
    steel = mat('cabinet', '#6a7074', 0.6, metal=0.5)
    wood = mat('drum', '#6a4a2a', 0.85)
    pad = 0.4
    # the operator's control desk, its panel tilted toward whoever stands at it (toward the way in)
    dx, dz = 2.6, 3.0
    box(M, steel, (dx, pad + 0.45, dz), (1.3, 0.9, 0.7), rot_y=0.6, bevel=0.03)
    c = Vector((dx, pad + 0.95, dz)) + Vector((math.sin(0.6), 0, math.cos(0.6))) * 0.05
    quad(M, panel, tuple(c), 1.2, 0.6, '+y', tilt=0.6)
    M.solid(dx, dz, 1.3, 0.7, pad + 0.95, 0.6)
    # power cabinets at the back, hazard-striped, the high-voltage warning on the end one
    for (x, z) in ((-3.3, -1.6), (-2.5, -2.7)):
        box(M, steel, (x, pad + 0.95, z), (0.8, 1.9, 0.5), rot_y=math.atan2(x, z), bevel=0.03)
        box(M, hazard, (x, pad + 0.15, z), (0.82, 0.3, 0.52), rot_y=math.atan2(x, z), uv_scale=0.6)
        M.solid(x, z, 0.8, 0.5, pad + 1.9, math.atan2(x, z))
    picture(M, signs, (-3.62, pad + 1.35, -1.75), 0.6, 0.6, '-x', uv=sheet(HIGH_VOLTAGE), depth=0.03)
    # a cable drum left on its side by the pad
    cylinder(M, wood, (6.4, 0.75, -2.6), 0.75, 0.12, axis='x', segs=20)
    cylinder(M, wood, (5.6, 0.75, -2.6), 0.75, 0.12, axis='x', segs=20)
    cylinder(M, mat('cable', '#1a1a1a', 0.7), (6.0, 0.75, -2.6), 0.55, 0.7, axis='x', segs=20)
    M.solid(6.0, -2.6, 1.0, 1.5, 1.5)
    # the height warning on a post at the way in
    cylinder(M, mat('chain', '#3a3a3a', 0.6, metal=0.7), (1.9, 1.0, 5.4), 0.05, 2.0, axis='y', segs=8)
    picture(M, signs, (1.9, 1.85, 5.45), 0.9, 0.9, '+z', uv=sheet(MUST_BE_48), depth=0.04)
    return M


ANCHOR = {'dress_station': (L['station']['x'], L['station']['z']), 'dress_arena': (L['arena']['x'], L['arena']['z']),
          'dress_freefall': (L['freefall']['x'], L['freefall']['z'])}


def export(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    built = {'dress_station': dress_station, 'dress_arena': dress_arena, 'dress_freefall': dress_freefall}[name]()
    objs = built.build()
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f'{name}.glb'), export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for v in o.data.vertices:
            g = Vector((v.co.x, v.co.z, -v.co.y))
            lo = Vector(map(min, lo, g))
            hi = Vector(map(max, hi, g))
    ax, az = ANCHOR[name]
    print(f'RIDES {name}: {sum(len(o.data.polygons) for o in objs)} faces, box {tuple(round(c, 2) for c in lo)} .. {tuple(round(c, 2) for c in hi)}', flush=True)
    return {'model': name, 'x': round(ax + (lo.x + hi.x) / 2, 3), 'z': round(az + (lo.z + hi.z) / 2, 3), 'y': round(lo.y, 3),
            'w': round(hi.x - lo.x, 3), 'd': round(hi.z - lo.z, 3), 'h': round(hi.y - lo.y, 3),
            'solids': [[round(ax + s[0], 3), round(az + s[1], 3), *s[2:]] for s in built.solids]}


entries = [export(n) for n in ('dress_station', 'dress_arena', 'dress_freefall')]
js = ['// Written by scripts/blender/rides-dress.py: where the rides\' dressing goes (park coordinates; x, z: the model\'s',
      '// centre; y: its foot; w, d, h: its size) and its solid parts ([x, z, w, d, h, rot] colliders). shared/map.js places them.',
      'export const RIDES_DRESS = ' + json.dumps(entries, indent=1) + ';', '']
open(os.path.join(ROOT, 'shared', 'rides-layout.js'), 'w').write('\n'.join(js))
print('RIDES layout written', flush=True)
