# Story props for the park, modelled in Blender from code: the memorial to the twenty at the gate, the MISSING
# notice boards, the county's CLOSED barricades and the prize teddy bears left behind. Textures come from
# scripts/story-textures.mjs; the GLBs go to assets-src/blender and scripts/convert-env.mjs slims them for the game.
#
#   node scripts/story-textures.mjs
#   blender --background --factory-startup --python scripts/blender/story-props.py -- <last-ride folder>
#   node scripts/convert-env.mjs memorial missing_board barricade plush
#
# Blender is Z-up and the front of every prop faces -Y, which the game sees as +Z (where facePath points).
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT = sys.argv[sys.argv.index('--') + 1]
TEX = os.path.join(ROOT, 'assets-src', 'blender', 'tex')
OUT = os.path.join(ROOT, 'assets-src', 'blender')
rnd = random.Random(1987)
D = math.radians


def lin(hexcol):
    h = hexcol.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, col='#ffffff', rough=0.85, metal=0.0, emit=None, strength=0.0, image=None, cull=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin(col), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    if image:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TEX, image), check_existing=True)
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    m.use_backface_culling = cull
    return m


def done(o, m, name, parent=None, smooth=False):
    o.name = name
    o.data.materials.clear()
    o.data.materials.append(m)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if parent:
        o.parent = parent
    return o


def apply_scale(o, s):
    o.scale = s
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def box(name, size, loc, m, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    apply_scale(o, size)
    return done(o, m, name, parent)


def cyl(name, r, h, loc, m, rot=(0, 0, 0), verts=10, parent=None, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot)
    return done(bpy.context.active_object, m, name, parent, smooth=True)


def ball(name, r, loc, m, scale=(1, 1, 1), rot=(0, 0, 0), seg=12, rings=8, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc, rotation=rot)
    o = bpy.context.active_object
    apply_scale(o, scale)
    return done(o, m, name, parent, smooth=True)


def card(name, w, h, loc, m, region, atlas=(1024, 1024), rot=(D(90), 0, 0), parent=None):
    """A flat picture w x h cut from the atlas region (x, y, width, height in pixels from the top left).
    The default rotation stands it up facing -Y; a second angle turns it about its own face."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    apply_scale(o, (w, h, 1))
    x, y, rw, rh = region
    W, H = atlas
    u0, u1 = x / W, (x + rw) / W
    v0, v1 = 1 - (y + rh) / H, 1 - y / H
    for l in o.data.uv_layers.active.data:
        l.uv = (u0 + l.uv[0] * (u1 - u0), v0 + l.uv[1] * (v1 - v0))
    return done(o, m, name, parent)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(name):
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True)
    n = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f'PROPS {name}: {len(bpy.data.objects)} objects, {n} faces -> {path}')


# --- a sitting teddy bear (about 0.45 m) ---------------------------------------------------------------------------
BEARS = {
    'brown': ('#6e4a2e', '#c4a682'),
    'pink': ('#a7787b', '#d9c2b8'),
    'blue': ('#66788c', '#c9ccd0'),
}


def bear(kind, at=(0, 0, 0), turn=0.0, s=1.0, one_eye=False):
    fur_c, pale_c = BEARS[kind]
    fur = mat(f'plush_{kind}', fur_c, 1.0)
    pale = mat(f'plush_{kind}_pale', pale_c, 1.0)
    black = mat('button', '#111111', 0.35)
    ribbon = mat('ribbon', '#8e1b20', 0.6)
    parts = []
    P = lambda x, y, z: (x * s, y * s, z * s)
    parts.append(ball('body', 0.13 * s, P(0, 0, 0.14), fur, (1, 0.85, 1.15)))
    parts.append(ball('head', 0.1 * s, P(0, -0.01, 0.33), fur))
    for sx in (-1, 1):
        parts.append(ball('ear', 0.04 * s, P(0.07 * sx, 0, 0.415), fur, (1, 0.5, 1), seg=10, rings=6))
        parts.append(ball('arm', 0.04 * s, P(0.13 * sx, -0.045, 0.17), fur, (1, 1, 2.0), rot=(D(30), D(-20 * sx), 0)))
        parts.append(ball('leg', 0.05 * s, P(0.075 * sx, -0.12, 0.05), fur, (1, 2.0, 1)))
        parts.append(ball('pad', 0.04 * s, P(0.075 * sx, -0.215, 0.05), pale, (1, 0.3, 1), seg=10, rings=6))
        if not (one_eye and sx > 0):
            parts.append(ball('eye', 0.013 * s, P(0.04 * sx, -0.088, 0.355), black, seg=8, rings=6))
    if one_eye:
        parts.append(ball('stuffing', 0.017 * s, P(0.04, -0.085, 0.355), mat('stuffing', '#ddd8cc', 1.0), (1.2, 0.8, 1), seg=8, rings=6))
    parts.append(ball('snout', 0.045 * s, P(0, -0.085, 0.31), pale, (1, 0.9, 0.8)))
    parts.append(ball('nose', 0.016 * s, P(0, -0.128, 0.324), black, seg=8, rings=6))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.072 * s, minor_radius=0.014 * s, major_segments=16, minor_segments=6, location=P(0, -0.01, 0.255))
    parts.append(done(bpy.context.active_object, ribbon, 'ribbon', smooth=True))
    for sx in (-1, 1):
        parts.append(ball('bow', 0.03 * s, P(0.03 * sx, -0.08, 0.255), ribbon, (1.2, 0.4, 0.7), rot=(0, D(20 * sx), 0), seg=8, rings=6))
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.name = f'bear_{kind}'
    o.location = at
    o.rotation_euler = (0, 0, turn)
    return o


def plush():
    reset()
    for kind in BEARS:
        bear(kind, one_eye=kind == 'brown')
    export('plush')


# --- MISSING notice board --------------------------------------------------------------------------------------------
def missing_board():
    reset()
    wood = mat('tex:woodDark', '#4a3b2d', 0.9)
    ply = mat('tex:wood', '#6d5839', 0.95)
    roof = mat('tex:woodDark', '#2e2822', 0.9)
    paper = mat('posters', image='posters.png', rough=0.9, cull=True)
    for sx in (-1, 1):
        box('post', (0.1, 0.1, 2.45), (1.0 * sx, 0, 1.225), wood)
    box('board', (2.1, 0.05, 1.25), (0, 0, 1.55), ply)
    box('rail', (2.2, 0.07, 0.07), (0, -0.01, 0.93), wood)
    for sy in (-1, 1):
        box('roof', (2.45, 0.36, 0.03), (0, 0.14 * sy, 2.36), roof, rot=(D(-24 * sy), 0, 0))
    # posters pinned over each other, the later ones on top
    POS = [(-0.66, 1.66, 4), (0.0, 1.62, -3), (0.64, 1.67, 6), (-0.36, 1.2, -5), (0.36, 1.17, 3)]
    for k, (x, z, a) in enumerate(POS):
        i = [0, 2, 4, 1, 5][k]
        card('poster', 0.4, 0.602, (x, -0.028 - k * 0.002, z), paper, ((i % 3) * 341, (i // 3) * 512, 340, 512), rot=(D(90), D(a), 0))
    # one on the back, and one torn down, lying in the mud at the foot of the board
    card('poster', 0.4, 0.602, (0.2, 0.028, 1.6), paper, (341, 512, 340, 512), rot=(D(90), D(-4), D(180)))
    card('poster', 0.4, 0.602, (-0.45, -0.55, 0.012), paper, (682, 0, 340, 512), rot=(D(3), D(-2), D(28)))
    export('missing_board')


# --- the county's CLOSED barricade (sawhorse) ------------------------------------------------------------------------
def barricade():
    reset()
    white = mat('tex:#cfc6b2', '#cfc6b2', 0.9)
    grey = mat('tex:woodDark', '#5d5348', 0.95)
    sign = mat('barricade_sign', image='barricade.png', rough=0.85, cull=True)
    amber = mat('barricade_lamp', '#8a5a14', 0.4)
    box('rail', (2.0, 0.06, 0.22), (0, 0, 0.98), white)
    for sy in (-1, 1):
        for k, sx in enumerate((-0.5, 0.5)):
            card('stripes', 1.0, 0.22, (sx, 0.031 * -sy, 0.98), sign, (0, 0, 512, 128), (512, 512), rot=(D(90), 0, D(0 if sy > 0 else 180)))
    for sx in (-0.85, 0.85):
        for sy in (-1, 1):
            box('leg', (0.06, 0.08, 1.06), (sx, 0.14 * sy, 0.5), grey, rot=(D(15 * sy), 0, 0))
        box('brace', (0.05, 0.36, 0.06), (sx, 0, 0.35), grey)
    box('sign_back', (0.92, 0.02, 0.47), (0.08, -0.055, 0.64), white, rot=(0, D(4), 0))
    card('sign', 0.9, 0.45, (0.08, -0.0665, 0.64), sign, (0, 128, 512, 256), (512, 512), rot=(D(90), D(4), 0))
    cyl('lamp', 0.07, 0.12, (0.9, 0, 1.15), amber, verts=12)
    box('lamp_foot', (0.08, 0.06, 0.06), (0.9, 0, 1.11), grey)
    export('barricade')


# --- the memorial to the twenty, just inside the gate ----------------------------------------------------------------
def memorial():
    reset()
    wood = mat('tex:woodDark', '#4b3a2b', 0.9)
    ply = mat('tex:wood', '#5e4a33', 0.95)
    pics = mat('mem_pics', image='memorial.png', rough=0.8, cull=True)
    jar_r = mat('jar_red', '#6e1712', 0.3)
    jar_w = mat('jar_white', '#cfc4ae', 0.5)
    flame = mat('flame', '#ffb060', 0.5, emit='#ffa040', strength=8.0)
    kraft = mat('wrap_kraft', '#8d7356', 0.9)
    pinkp = mat('wrap_pink', '#9c7c7c', 0.9)
    petal_r = mat('petal_red', '#5e171c', 0.8)
    petal_w = mat('petal_white', '#bdb4a2', 0.8)
    balloon = mat('balloon', '#a3151a', 0.3)
    string = mat('string', '#d8d0c0', 0.8)

    # a low bench and the board of photographs leaning on it
    box('bench', (1.8, 0.45, 0.06), (0, 0.2, 0.36), wood)
    for sx in (-0.8, 0.8):
        for sy in (0.02, 0.38):
            box('bench_leg', (0.06, 0.06, 0.34), (sx, sy, 0.17), wood)
    lean = D(-12)
    board = box('board', (1.5, 0.04, 1.0), (0, 0.33, 0.39 + 0.5 * math.cos(lean)), ply, rot=(lean, 0, 0))
    for sx in (-0.6, 0.6):
        box('prop_leg', (0.05, 0.05, 1.1), (sx, 0.62, 0.52), wood, rot=(D(18), 0, 0))
    for i in range(20):
        c, r = i % 5, i // 5
        x = (c - 2) * 0.24 + rnd.uniform(-0.02, 0.02)
        z = 0.36 - r * 0.19 + rnd.uniform(-0.015, 0.015)
        card('photo', 0.17, 0.159, (x, -0.022 - (i % 3) * 0.0015, z), pics, (c * 204.8, r * 192, 204.8, 192),
             rot=(D(90), D(rnd.uniform(-7, 7)), 0), parent=board)
    card('card', 0.56, 0.22, (-0.24, -0.026, -0.37), pics, (4, 772, 632, 248), rot=(D(90), D(-2), 0), parent=board)
    card('note', 0.3, 0.195, (0.48, -0.027, -0.36), pics, (644, 776, 376, 244), rot=(D(90), D(7), 0), parent=board)

    # candles: a loose crescent on the ground in front, a few along the bench
    spots = []
    for k in range(16):
        a = D(-160 + k * (140 / 15)) + rnd.uniform(-0.06, 0.06)
        rr = 0.55 + rnd.uniform(-0.12, 0.12)
        spots.append((math.cos(a) * rr * 1.5, -0.1 + math.sin(a) * rr * 0.7, 0))
    for k in range(5):
        spots.append((-0.7 + k * 0.35 + rnd.uniform(-0.05, 0.05), 0.06, 0.39))
    for x, y, z in spots:
        h = rnd.uniform(0.08, 0.17)
        cyl('jar', 0.042, h, (x, y, z + h / 2), jar_r if rnd.random() < 0.6 else jar_w, verts=10)
        if rnd.random() < 0.85:
            cyl('flame', 0.013, 0.04, (x, y, z + h + 0.02), flame, verts=6, r2=0.0)

    # bunches of flowers, wilted, lying on the ground
    for k, (x, y, a) in enumerate([(-0.95, -0.2, 20), (-0.55, -0.42, -15), (0.35, -0.5, 40), (0.85, -0.25, -30), (1.1, 0.05, 70)]):
        rz = D(a)
        dx, dy = math.sin(rz), -math.cos(rz)
        cyl('wrap', 0.09, 0.34, (x, y, 0.06), kraft if k % 2 else pinkp, verts=8, r2=0.015,
            rot=(D(90), 0, rz + math.pi))
        for j in range(7):
            ox = dx * 0.2 + rnd.uniform(-0.06, 0.06)
            oy = dy * 0.2 + rnd.uniform(-0.06, 0.06)
            ball('bloom', 0.035, (x + ox, y + oy, 0.07 + rnd.uniform(-0.01, 0.03)), petal_r if (j + k) % 3 else petal_w,
                 scale=(1, 1, 0.7), seg=8, rings=5)

    # a red balloon tied to the board's corner, still floating after all these years
    corner = (0.72, 0.42, 1.36)
    top = (0.95, 0.5, 2.15)
    mid = tuple((a + b) / 2 for a, b in zip(corner, top))
    vx, vy, vz = (b - a for a, b in zip(corner, top))
    ln = math.sqrt(vx * vx + vy * vy + vz * vz)
    s = cyl('string', 0.004, ln, mid, string, verts=4)
    s.rotation_mode = 'QUATERNION'
    s.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector((vx, vy, vz)))
    ball('balloon', 0.16, (top[0], top[1], top[2] + 0.19), balloon, scale=(1, 1, 1.18), seg=16, rings=10)
    cyl('knot', 0.02, 0.04, (top[0], top[1], top[2] + 0.01), balloon, verts=6, r2=0.005, rot=(D(180), 0, 0))

    # a bear someone left, and a photo blown off onto the ground
    bear('brown', at=(-1.05, -0.45, 0), turn=D(25), s=0.85, one_eye=False)
    card('photo', 0.17, 0.159, (0.62, -0.72, 0.01), pics, (2 * 204.8, 3 * 192, 204.8, 192), rot=(0, 0, D(33)))
    export('memorial')


# --- set dressing, round two ----------------------------------------------------------------------------------------
def strip(name, pts, width, m, region, atlas=(1024, 1024)):
    """A ribbon through pts [(point, width direction)], its texture running the whole length once."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    lens = [0.0]
    for i in range(1, len(pts)):
        lens.append(lens[-1] + (Vector(pts[i][0]) - Vector(pts[i - 1][0])).length)
    x, y, rw, rh = region
    W, H = atlas
    u0, u1 = x / W, (x + rw) / W
    v0, v1 = 1 - (y + rh) / H, 1 - y / H
    rows = []
    for (p, w), l in zip(pts, lens):
        w = Vector(w).normalized() * width / 2
        p = Vector(p)
        rows.append((bm.verts.new(p - w), bm.verts.new(p + w), u0 + (u1 - u0) * l / lens[-1]))
    for a, b in zip(rows, rows[1:]):
        f = bm.faces.new((a[0], b[0], b[1], a[1]))
        for loop, uv in zip(f.loops, ((a[2], v0), (b[2], v0), (b[2], v1), (a[2], v1))):
            loop[uvl].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(m)
    return o


TAPE = (0, 0, 1000, 64)
TAPE_OLD = (0, 64, 1000, 64)


def police_tape():
    reset()
    tape = mat('tape', image='dressing.png', rough=0.45)
    stake = mat('tex:rust', '#7a1c16', 0.6, metal=0.3)
    band = mat('stake_band', '#d8d4c8', 0.5)
    xs = (-2.3, 0.0, 2.3)
    for x in xs:
        cyl('stake', 0.028, 1.02, (x, 0, 0.51), stake, verts=8)
        cyl('band', 0.03, 0.08, (x, 0, 0.86), band, verts=8)
    # sagging runs between the stakes, with a slight twist
    for a, b in zip(xs, xs[1:]):
        pts = []
        for i in range(13):
            t = i / 12
            tw = math.sin(t * math.pi * 2) * 0.35
            pts.append(((a + (b - a) * t, math.sin(t * math.pi) * 0.04, 0.93 - 0.13 * math.sin(t * math.pi)), (0, tw, 1)))
        strip('tape', pts, 0.07, tape, TAPE)
    # the far end torn loose: it trails off the last stake and lies in the mud
    trail = [((2.3, 0, 0.93), (0, 0, 1)), ((2.42, -0.03, 0.72), (0, 0.2, 1)), ((2.5, -0.05, 0.45), (0, 0.5, 1)),
             ((2.56, -0.07, 0.18), (0, 0.8, 0.6)), ((2.66, -0.1, 0.02), (0, 1, 0.1)), ((3.0, -0.2, 0.012), (0.2, 1, 0)),
             ((3.4, -0.18, 0.012), (0, 1, 0)), ((3.7, -0.3, 0.012), (-0.2, 1, 0))]
    strip('tape_torn', trail, 0.07, tape, TAPE_OLD)
    export('police_tape')


def sneaker(at, rot):
    red = mat('canvas', '#9a2f2a', 0.9)
    white = mat('rubber', '#cfc9bb', 0.8)
    parts = [box('sole', (0.28, 0.1, 0.03), (0, 0, 0.015), white),
             ball('upper', 0.1, (-0.03, 0, 0.06), red, (1.2, 0.48, 0.5)),
             ball('toe', 0.06, (0.08, 0, 0.035), white, (1.0, 0.75, 0.55))]
    for k in range(4):
        parts.append(box('lace', (0.012, 0.07, 0.006), (0.03 - k * 0.03, 0, 0.098 - k * 0.004), white))
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.location = at
    o.rotation_euler = rot
    return o


def evidence():
    reset()
    marks = mat('markers', image='dressing.png', rough=0.6, cull=True)
    for i, (x, y, a) in enumerate([(-0.6, -0.2, 20), (-0.1, 0.35, -35), (0.45, -0.1, 10), (0.95, 0.4, 60), (0.25, -0.65, -15)]):
        region = (i * 128 + 4, 132, 120, 120)
        for side in (-1, 1):
            # a folded card tent: two faces leaning on each other
            card('marker', 0.1, 0.1, (x + math.sin(D(a)) * 0.022 * side, y - math.cos(D(a)) * 0.022 * side, 0.048), marks,
                 region, rot=(D(90 - 22), 0, D(a) + (0 if side > 0 else math.pi)))
    sneaker((0.5, 0.12, 0.04), (D(75), 0, D(130)))
    # a flashlight dropped in the search, long dead
    body = mat('torch', '#1d1d1f', 0.5, metal=0.6)
    lens = mat('torch_lens', '#9aa3a8', 0.2)
    c, s = math.cos(D(25)), math.sin(D(25))
    cyl('torch', 0.02, 0.18, (0.9, -0.05, 0.022), body, rot=(0, D(90), D(25)), verts=10)
    cyl('torch_head', 0.032, 0.05, (0.9 + c * 0.11, -0.05 + s * 0.11, 0.032), body, rot=(0, D(90), D(25)), verts=10, r2=0.022)
    cyl('torch_lens', 0.03, 0.004, (0.9 + c * 0.137, -0.05 + s * 0.137, 0.032), lens, rot=(0, D(90), D(25)), verts=10)
    export('evidence')


def pram():
    reset()
    navy = mat('tex:#2b3345', '#2b3345', 0.7)
    chrome = mat('tex:metal', '#8c8a86', 0.35, metal=0.8)
    rubber = mat('pram_tyre', '#121212', 0.9)
    # the tub: an open box
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z > 0.9], context='FACES')
    me = bpy.data.meshes.new('tub')
    bm.to_mesh(me)
    bm.free()
    tub = bpy.data.objects.new('tub', me)
    bpy.context.scene.collection.objects.link(tub)
    apply_scale(tub, (0.8, 0.42, 0.3))
    tub.location = (0, 0, 0.47)
    done(tub, navy, 'tub')
    # the folding hood over the back third
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.26, location=(-0.26, 0, 0.62))
    hood = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(hood.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01 or v.co.x > 0.02], context='VERTS')
    bm.to_mesh(hood.data)
    bm.free()
    apply_scale(hood, (1.0, 0.82, 1.0))
    done(hood, navy, 'hood', smooth=True)
    for sy in (-1, 1):
        cyl('rail', 0.014, 0.92, (0, 0.17 * sy, 0.3), chrome, rot=(0, D(90), 0), verts=8)
        # the handle rising behind
        cyl('handle', 0.014, 0.5, (-0.5, 0.17 * sy, 0.78), chrome, rot=(0, D(-38), 0), verts=8)
        for sx in (-1, 1):
            cyl('tyre', 0.16, 0.035, (0.31 * sx, 0.26 * sy, 0.16), rubber, rot=(D(90), 0, 0), verts=20)
            cyl('hub', 0.05, 0.045, (0.31 * sx, 0.26 * sy, 0.16), chrome, rot=(D(90), 0, 0), verts=10)
            cyl('strut', 0.012, 0.3, (0.24 * sx, 0.21 * sy, 0.24), chrome, rot=(D(90 + 10 * sy), D(-30 * sx), 0), verts=6)
    cyl('axle', 0.012, 0.56, (0.31, 0, 0.16), chrome, rot=(D(90), 0, 0), verts=6)
    cyl('axle', 0.012, 0.56, (-0.31, 0, 0.16), chrome, rot=(D(90), 0, 0), verts=6)
    cyl('bar', 0.02, 0.4, (-0.66, 0, 0.98), rubber, rot=(D(90), 0, 0), verts=8)
    # a bear still sits in it
    bear('blue', at=(0.12, 0, 0.36), turn=D(-90), s=0.55)
    export('pram')


def tour_board():
    reset()
    wood = mat('tex:woodDark', '#3a2c20', 0.85)
    face = mat('tour_face', image='dressing.png', rough=0.8, cull=True)
    chain = mat('tex:iron', '#555555', 0.5, metal=0.7)
    for sy, lean in ((-1, D(-13)), (1, D(13))):
        b = box('panel', (0.66, 0.03, 0.96), (0, 0.11 * sy, 0.47), wood, rot=(lean, 0, 0))
        card('poster', 0.56, 0.84, (0, 0.017 * sy, 0.0), face, (0, 256, 512, 768),
             rot=(D(90), 0, 0 if sy < 0 else math.pi), parent=b)
    box('hinge', (0.6, 0.06, 0.04), (0, 0, 0.94), wood)
    for sx in (-0.3, 0.3):
        box('chain', (0.012, 0.22, 0.012), (sx, 0, 0.3), chain)
    export('tour_board')


plush()
missing_board()
barricade()
memorial()
police_tape()
evidence()
pram()
tour_board()
