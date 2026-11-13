# The themed buildings' painted fronts and their insides, modelled in Blender from code, with the artwork painted by
# scripts/themed-textures.mjs:
#   front_tunnel    monster mouths round both doors (lips, fangs, tusks, bulging eyes, angry brows), the graveyard
#                   mural between them and two warning posters at the ends
#   front_funhouse  the sunburst painted over the arched false front, hypnotic spiral discs, stretched clowns and
#                   "step right up" boards
#   front_arcade    a marquee canopy with bulbs over the door, game posters and coin signs
#   inside_tunnel   scenery cut-outs facing the track, tombstones, cobwebs, hanging bats, eyes glowing in the dark
#   inside_funhouse dizzy wall panels, giant dice, bunting, a table and chairs stuck to the ceiling
#   inside_arcade   cosmic carpet, game posters, a high-score board, a prize shelf, coin signs
# Each model is built in its building's own coordinates (shared/map.js BUILDINGS: x right, y up, z toward the gate)
# and written to assets-src/blender/<name>.glb; shared/themed-layout.js (written here too) says where each goes and
# which parts are solid, and scripts/convert-env.mjs slims them for the game.
#
#   node scripts/themed-textures.mjs
#   node scripts/export-kit-layout.mjs layout.json
#   blender --background --factory-startup --python scripts/blender/themed.py -- <last-ride folder> layout.json
#   node scripts/convert-env.mjs front_tunnel front_funhouse front_arcade inside_tunnel inside_funhouse inside_arcade
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
ROOT, LAYOUT = args[0], args[1]
TEX = os.path.join(ROOT, 'assets-src', 'blender', 'tex')
OUT = os.path.join(ROOT, 'assets-src', 'blender')
layout = {b['style']: b for b in json.load(open(LAYOUT))['buildings']}
rnd = random.Random(1987)
T = 0.4  # wall thickness
# game space (x right, y up, z toward the gate) -> Blender (x right, z up, -y toward the gate)
G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def lin(hexcol):
    h = hexcol.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MATS = {}


def mat(name, col='#ffffff', rough=0.85, metal=0.0, image=None, alpha=False, emit=None, emit_strength=1.0, emit_from_image=False):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin(col), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.join(TEX, image))
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        if alpha:
            # a hard cut-out: the glTF exporter writes alphaMode MASK for alpha through a "greater than" node
            cut = nt.nodes.new('ShaderNodeMath')
            cut.operation = 'GREATER_THAN'
            cut.inputs[1].default_value = 0.5
            nt.links.new(tex.outputs['Alpha'], cut.inputs[0])
            nt.links.new(cut.outputs[0], b.inputs['Alpha'])
        if emit_from_image:
            nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
            b.inputs['Emission Strength'].default_value = emit_strength
    if emit and not emit_from_image:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if alpha:
        m.use_backface_culling = False
    MATS[name] = m
    return m


class Model:
    """Pieces gathered per material in game space, written as one object per material."""

    def __init__(self, name):
        self.name = name
        self.parts = {}
        self.solids = []

    def take(self, m, bm):
        self.parts.setdefault(m.name, (m, []))[1].append(bm)

    def solid(self, x, z, w, d, h, rot=0.0):
        """A collider (cover) in building coordinates."""
        self.solids.append([round(x, 3), round(z, 3), round(w, 3), round(d, 3), round(h, 3), round(rot, 4)])

    def build(self):
        objs = []
        for mname, (m, bms) in self.parts.items():
            me = bpy.data.meshes.new(f'{self.name}_{mname}')
            out = bmesh.new()
            uvl = out.loops.layers.uv.new('UVMap')
            for bm in bms:
                src_uv = bm.loops.layers.uv.active
                vmap = {}
                for v in bm.verts:
                    vmap[v] = out.verts.new((G2B @ v.co.to_4d()).to_3d())
                for f in bm.faces:
                    try:
                        nf = out.faces.new([vmap[v] for v in f.verts])
                    except ValueError:
                        continue
                    nf.smooth = f.smooth
                    if src_uv is not None:
                        for l0, l1 in zip(f.loops, nf.loops):
                            l1[uvl].uv = l0[src_uv].uv
                bm.free()
            out.normal_update()
            out.to_mesh(me)
            out.free()
            me.materials.append(m)
            ob = bpy.data.objects.new(me.name, me)
            bpy.context.collection.objects.link(ob)
            objs.append(ob)
        return objs


def planar_uv(bm, fn):
    """UVs from each vertex's game position: fn(co) -> (u, v_from_top)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            u, vt = fn(l.vert.co)
            l[uv].uv = (u, 1 - vt)


# directions a flat piece can face: (right, up, normal) in game space
FACING = {
    '+z': (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))),
    '-z': (Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, -1))),
    '+x': (Vector((0, 0, -1)), Vector((0, 1, 0)), Vector((1, 0, 0))),
    '-x': (Vector((0, 0, 1)), Vector((0, 1, 0)), Vector((-1, 0, 0))),
    '-y': (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))),
    '+y': (Vector((1, 0, 0)), Vector((0, 0, -1)), Vector((0, 1, 0))),
}


def quad(M, m, c, w, h, facing, uv=(0, 0, 1, 1), tilt=0.0):
    """A flat picture w x h centred at c, facing a direction, showing the image rect uv (u0, v0, u1, v1; v from top)."""
    r, up, n = FACING[facing]
    if tilt:
        rot = Matrix.Rotation(tilt, 3, n)
        r, up = rot @ r, rot @ up
    c = Vector(c)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new(c + r * (sx * w / 2) + up * (sy * h / 2)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    u0, v0, u1, v1 = uv
    for l, (u, v) in zip(f.loops, ((u0, v1), (u1, v1), (u1, v0), (u0, v0))):
        l[uvl].uv = (u, 1 - v)
    M.take(m, bm)


def box(M, m, c, size, rot_y=0.0, rot_z=0.0, bevel=0.0, uv_scale=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=min(bevel, min(size) * 0.45), segments=2, affect='EDGES', clamp_overlap=True)
    R = Matrix.Rotation(rot_y, 4, 'Y') @ Matrix.Rotation(rot_z, 4, 'Z')
    bm.transform(Matrix.Translation(Vector(c)) @ R)
    if uv_scale:
        planar_uv(bm, lambda co: ((co.x + co.z) / uv_scale, -co.y / uv_scale))
    M.take(m, bm)


def cone(M, m, base, tip, r, segs=10):
    """A cone from a circle of radius r at base to a point at tip (game space)."""
    base, tip = Vector(base), Vector(tip)
    axis = tip - base
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=0.0, depth=axis.length)
    # create_cone is centred on z; lay it along the axis
    q = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    bm.transform(Matrix.Translation((base + tip) / 2) @ q.to_matrix().to_4x4())
    for f in bm.faces:
        f.smooth = True
    M.take(m, bm)


def cylinder(M, m, c, r, depth, axis='y', segs=16, uv_disc=False):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=depth)
    R = {'z': Matrix.Identity(4), 'y': Matrix.Rotation(-math.pi / 2, 4, 'X'), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y')}[axis]
    bm.transform(Matrix.Translation(Vector(c)) @ R)
    if uv_disc:
        cc = Vector(c)
        planar_uv(bm, lambda co: (0.5 + (co.x - cc.x) / (2 * r), 0.5 - (co.y - cc.y) / (2 * r)))
    M.take(m, bm)


def disc(M, m, c, r, facing='+z', segs=48):
    """A flat round picture (the whole image mapped across it)."""
    rr, up, n = FACING[facing]
    c = Vector(c)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        vs.append(bm.verts.new(c + rr * (math.cos(a) * r) + up * (math.sin(a) * r)))
    f = bm.faces.new(vs)
    for l in f.loops:
        d = l.vert.co - c
        l[uvl].uv = (0.5 + d.dot(rr) / (2 * r), 0.5 + d.dot(up) / (2 * r))
    M.take(m, bm)


def hemisphere(M, m, c, r, facing='+z'):
    """A half ball bulging out of a wall, its image mapped straight on (an eye)."""
    rr, up, n = FACING[facing]
    c = Vector(c)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=r)
    # the sphere's +z half, turned to face n
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
    basis = Matrix((rr, up, n)).transposed().to_4x4()
    bm.transform(Matrix.Translation(c) @ basis)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        f.smooth = True
        for l in f.loops:
            d = l.vert.co - c
            l[uvl].uv = (0.5 + d.dot(rr) / (2 * r), 0.5 + d.dot(up) / (2 * r))
    M.take(m, bm)


def prism(M, m, outline, z0, depth, bevel=0.0, uv=None):
    """An outline in the x-y plane pushed out along +z from z0 (game space)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in outline]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, depth), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES', clamp_overlap=True)
    for f in bm.faces:
        f.smooth = bevel > 0
    if uv:
        planar_uv(bm, uv)
    M.take(m, bm)


def picture(M, m, c, w, h, facing, uv=(0, 0, 1, 1), frame='board', depth=0.08):
    """A painted board: the picture on a slightly larger backing board."""
    r, up, n = FACING[facing]
    c = Vector(c)
    back = mat('board', '#2a1e16', 0.9)
    bc = c - n * (depth / 2 + 0.01)
    size = (abs(r.x) * (w + 0.16) + abs(n.x) * depth, h + 0.16, abs(r.z) * (w + 0.16) + abs(n.z) * depth)
    box(M, back, tuple(bc), size)
    quad(M, m, tuple(c + n * 0.006), w, h, facing, uv)


def arch_outline(w, base, rise, n=14):
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, base), (w * 0.32, base)]

    def q(p0, c, p1):
        return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1])
                for t in [i / n for i in range(1, n + 1)]]

    pts += q((w * 0.32, base), (w * 0.3, base + rise * 0.6), (0, base + rise))
    pts += q((0, base + rise), (-w * 0.3, base + rise * 0.6), (-w * 0.32, base))
    pts.append((-w / 2, base))
    return pts


def bulb_row(M, x0, x1, y, z, step=0.32, r=0.06):
    lit = mat('bulb_warm', '#fff2c8', 0.4, emit='#ffd890', emit_strength=4.0)
    dead = mat('bulb_dead', '#5a4a3a', 0.5)
    n = max(1, int((x1 - x0) / step))
    for k in range(n + 1):
        x = x0 + (x1 - x0) * k / n
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=r)
        bm.transform(Matrix.Translation((x, y, z)))
        M.take(lit if rnd.random() < 0.75 else dead, bm)


# ===================================================================== the fronts
def front_tunnel():
    b = layout['tunnel']
    M = Model('front_tunnel')
    fz = b['d'] / 2 + T / 2  # the wall's face
    flesh = mat('flesh', '#ffffff', 0.45, image='themed_flesh.png')
    bone = mat('bone', '#e8dfc6', 0.55)
    eye = mat('monster_eye', '#ffffff', 0.25, image='themed_tunnel_eye.png', emit_from_image=True, emit_strength=0.35)
    mural = mat('tunnel_mural', '#ffffff', 0.8, image='themed_tunnel_mural.png')
    posters = mat('tunnel_posters', '#ffffff', 0.8, image='themed_tunnel_posters.png')
    for dx in b['doors']['s']:
        # the lips: a thick U round the doorway, clear of the opening and the shutter box over it
        outer = [(dx - 2.7, 0.0)] + [(dx - 2.7 * math.cos(t), 3.9 + 1.5 * math.sin(t)) for t in [i / 16 * math.pi for i in range(17)]] + [(dx + 2.7, 0.0)]
        inner = [(dx + 1.62, 0.0)] + [(dx + 1.62 * math.cos(t), 3.95 + 0.4 * math.sin(t)) for t in [i / 16 * math.pi for i in range(17)]] + [(dx - 1.62, 0.0)]
        prism(M, flesh, outer + inner, fz + 0.05, 0.5, bevel=0.09, uv=lambda co: (co.x / 2.5, -co.y / 2.5))
        # fangs hanging from the upper lip, tusks either side of the way in
        for ox, ln in ((-1.15, 0.62), (-0.5, 0.82), (0.5, 0.82), (1.15, 0.62)):
            top = 3.95 + 0.4 * math.sqrt(max(0.0, 1 - (ox / 1.62) ** 2))
            cone(M, bone, (dx + ox, top + 0.05, fz + 0.36), (dx + ox * 0.96, top - ln, fz + 0.42), 0.16)
        for ox in (-1.85, 1.85):
            cone(M, bone, (dx + ox, 0.02, fz + 0.4), (dx + ox * 0.94, 1.05, fz + 0.52), 0.19)
        # bulging eyes with angry brows
        for ex in (-1.2, 1.2):
            hemisphere(M, eye, (dx + ex, 6.05, fz + 0.04), 0.55)
            box(M, flesh, (dx + ex, 6.78, fz + 0.28), (1.45, 0.3, 0.5), rot_z=-0.38 * (1 if ex < 0 else -1), bevel=0.08, uv_scale=2.0)
    # the graveyard mural between the mouths, warning posters at the ends
    picture(M, mural, (0, 3.5, fz + 0.3), 10.0, 5.0, '+z')
    for x, u in ((-b['w'] / 2 + 1.55, 0.0), (b['w'] / 2 - 1.55, 0.5)):
        picture(M, posters, (x, 3.2, fz + 0.3), 2.2, 4.4, '+z', uv=(u, 0, u + 0.5, 1))
    return M


def front_funhouse():
    b = layout['funhouse']
    M = Model('front_funhouse')
    fz = b['d'] / 2 + T / 2
    h = b['h']
    rays = mat('funhouse_rays', '#ffffff', 0.8, image='themed_funhouse_rays.png')
    spiral = mat('spiral', '#ffffff', 0.7, image='themed_spiral.png')
    panels = mat('funhouse_panels', '#ffffff', 0.8, image='themed_funhouse_panels.png')
    wood = mat('board', '#2a1e16', 0.9)
    # the sunburst over the arched false front (whose face is at the wall line, 0.4 thick: kit build-kit.py)
    fw = b['w'] * 0.75
    outline = arch_outline(fw - 0.7, 1.45, 4.95)
    pts = [(x, h + y) for x, y in outline]
    prism(M, rays, pts, b['d'] / 2 + 0.005, 0.02, uv=lambda co: ((co.x + fw / 2) / fw, (h + 9.0 - co.y) / 9.0))
    # hypnotic spirals on round boards
    for sx in (-1, 1):
        x = sx * 7.4
        cylinder(M, wood, (x, 4.6, fz + 0.22), 1.82, 0.12, axis='z', segs=40)
        disc(M, spiral, (x, 4.6, fz + 0.29), 1.7)
    # stretched clowns either side of the door, and the boards under the spirals and at the ends
    for sx, u in ((-1, 0.0), (1, 0.25)):
        picture(M, panels, (sx * 4.3, 3.5, fz + 0.3), 1.3, 5.2, '+z', uv=(u, 0, u + 0.25, 1))
    for (x, y, w, hh, v) in ((-7.4, 1.6, 2.6, 1.3, 0.0), (7.4, 1.6, 2.6, 1.3, 0.25), (-10.6, 1.8, 2.2, 1.1, 0.5), (10.6, 1.8, 2.2, 1.1, 0.75)):
        picture(M, panels, (x, y, fz + 0.3), w, hh, '+z', uv=(0.5, v, 1.0, v + 0.25))
    return M


def front_arcade():
    b = layout['arcade']
    M = Model('front_arcade')
    fz = b['d'] / 2 + T / 2
    marquee = mat('arcade_marquee', '#ffffff', 0.6, image='themed_arcade_marquee.png', emit_from_image=True, emit_strength=0.25)
    posters = mat('arcade_posters', '#ffffff', 0.8, image='themed_arcade_posters.png')
    signs = mat('arcade_signs', '#ffffff', 0.8, image='themed_arcade_signs.png')
    steel = mat('steel', '#3a3c40', 0.5, metal=0.8)
    dx = b['doors']['s'][0]
    # the canopy over the door, hung on two rods from the wall above
    box(M, steel, (dx, 4.38, fz + 0.8), (5.8, 0.18, 1.6), bevel=0.03)
    for sx in (-1, 1):
        cyl = bmesh.new()
        bmesh.ops.create_cone(cyl, cap_ends=True, segments=6, radius1=0.03, radius2=0.03, depth=1.9)
        a = Vector((dx + sx * 2.5, 4.45, fz + 1.5))
        bb = Vector((dx + sx * 2.5, 5.9, fz + 0.05))
        q = Vector((0, 0, 1)).rotation_difference((bb - a).normalized())
        cyl.transform(Matrix.Translation((a + bb) / 2) @ q.to_matrix().to_4x4())
        M.take(steel, cyl)
    picture(M, marquee, (dx, 5.1, fz + 1.62), 5.6, 1.4, '+z', depth=0.1)
    bulb_row(M, dx - 2.75, dx + 2.75, 5.86, fz + 1.62)
    bulb_row(M, dx - 2.75, dx + 2.75, 4.34, fz + 1.62)
    # game posters along the long wall, coin signs by the door
    for i, x in enumerate((0.2, 2.4, 6.2, 8.4)):
        picture(M, posters, (x, 1.9, fz + 0.3), 1.1, 2.2, '+z', uv=(i * 0.25, 0, i * 0.25 + 0.25, 1))
    picture(M, signs, (-8.2, 2.2, fz + 0.3), 1.3, 1.3, '+z', uv=(0.5, 0.5, 1.0, 1.0))
    picture(M, signs, (dx + 2.15, 2.0, fz + 0.3), 0.9, 0.9, '+z', uv=(0.0, 0.0, 0.5, 0.5))
    return M


# ===================================================================== the insides
def inside_funhouse():
    b = layout['funhouse']
    M = Model('inside_funhouse')
    walls = mat('funhouse_walls', '#ffffff', 0.8, image='themed_funhouse_walls.png')
    hw, hd = b['w'] / 2 - T / 2, b['d'] / 2 - T / 2
    k = 0
    # dizzy panels: (x, z, facing)
    for (x, z, f) in ((-9.0, hd, '-z'), (-3.5, hd, '-z'), (3.6, hd, '-z'), (9.4, hd, '-z'),
                      (-hw, -4.0, '+x'), (-hw, 4.2, '+x'), (3.0, -2 + T / 2, '+z'), (7.2, -2 + T / 2, '+z'),
                      (6 + T / 2, 4.5, '+x'), (hw, -5.4, '-x'), (hw, 6.4, '-x')):
        n = FACING[f][2]
        u = (k % 4) * 0.25
        picture(M, walls, (x + n.x * 0.06, 2.3, z + n.z * 0.06), 1.6, 3.2, f, uv=(u, 0, u + 0.25, 1), depth=0.05)
        k += 1
    # giant dice to hide behind
    die = mat('die', '#f4ecd8', 0.5)
    pip = mat('pip', '#1a0a14', 0.6)
    for (x, z, r, s) in ((-9.6, -5.3, 0.3, 1.15), (-8.1, -6.2, 0.85, 0.95), (2.4, 5.2, -0.4, 1.05)):
        box(M, die, (x, s / 2, z), (s, s, s), rot_y=r, bevel=0.12)
        # pips on the top and the two faces you see most
        c, si = math.cos(r), math.sin(r)
        for (px, pz) in ((0, 0), (0.25, 0.25), (-0.25, -0.25)):
            p = Vector((px * s, s + 0.003, pz * s))
            box(M, pip, (x + p.x * c + p.z * si, p.y, z - p.x * si + p.z * c), (0.16 * s, 0.01, 0.16 * s), rot_y=r)
        M.solid(x, z, s, s, s, r)
    # bunting across the ceiling
    flagmats = [mat(f'flag_{c}', c, 0.8) for c in ('#d8202c', '#f2b632', '#2a7ab0', '#2a8a5a', '#c94f7c')]
    for (x0, z0, x1, z1) in ((-11.5, -6, -6.5, 6), (-5.5, -7.5, 11.5, -2.5), (-5.5, 7.5, 11.5, 2.5), (-11.5, 6.5, -6.5, -6.5)):
        L = math.hypot(x1 - x0, z1 - z0)
        n = int(L / 0.45)
        for i in range(n):
            t = (i + 0.5) / n
            sag = 0.6 * math.sin(math.pi * t)
            x = x0 + (x1 - x0) * t
            z = z0 + (z1 - z0) * t
            y = b['h'] - 1.1 - sag
            ang = math.atan2(x1 - x0, z1 - z0)
            bm = bmesh.new()
            r = Vector((math.sin(ang), 0, math.cos(ang))) * 0.17
            vs = [bm.verts.new(Vector((x, y, z)) - r), bm.verts.new(Vector((x, y, z)) + r), bm.verts.new((x, y - 0.38, z))]
            bm.faces.new(vs)
            M.take(flagmats[i % len(flagmats)], bm)
    # the tilted room's joke: a table and two chairs stuck to the ceiling (west room)
    wood = mat('furniture', '#7a4a2a', 0.7)
    cy = b['h'] - 0.02
    cx, cz = -9.0, 1.5
    box(M, wood, (cx, cy - 0.04, cz), (1.4, 0.07, 0.9))
    for lx in (-0.6, 0.6):
        for lz in (-0.38, 0.38):
            box(M, wood, (cx + lx, cy - 0.42, cz + lz), (0.06, 0.75, 0.06))
    for side in (-1, 1):
        sx, sz = cx, cz + side * 0.95
        box(M, wood, (sx, cy - 0.47, sz), (0.48, 0.05, 0.48))
        for lx in (-0.2, 0.2):
            for lz in (-0.2, 0.2):
                box(M, wood, (sx + lx, cy - 0.22, sz + lz), (0.04, 0.45, 0.04))
        box(M, wood, (sx, cy - 0.75, sz + side * 0.22), (0.48, 0.55, 0.05))
    return M


def inside_tunnel():
    b = layout['tunnel']
    M = Model('inside_tunnel')
    flats = mat('tunnel_flats', '#ffffff', 0.85, image='themed_tunnel_flats.png', alpha=True)
    web = mat('cobweb', '#ffffff', 0.9, image='themed_cobweb.png', alpha=True)
    batm = mat('bats', '#ffffff', 0.9, image='themed_bats.png', alpha=True)
    stone = mat('tombstone', '#9a9284', 0.95)
    wood = mat('board', '#2a1e16', 0.9)
    glow_r = mat('eyes_red', '#ff2010', 0.5, emit='#ff2010', emit_strength=6.0)
    glow_y = mat('eyes_yellow', '#ffd020', 0.5, emit='#ffc020', emit_strength=5.0)
    posters = mat('tunnel_posters', '#ffffff', 0.8, image='themed_tunnel_posters.png')
    hw, hd = b['w'] / 2 - T / 2, b['d'] / 2 - T / 2
    # scenery cut-outs facing the track, each on two struts: (x, z, facing, sheet column, w, h)
    for (x, z, f, col, w, h) in ((-11.2, -3.0, '+z', 0, 2.6, 5.2), (-2.0, -hd + 0.45, '+z', 1, 2.4, 4.8),
                                 (2.4, -hd + 0.45, '+z', 2, 2.6, 5.2), (hw - 0.5, 0.4, '-x', 3, 2.6, 5.2)):
        u = col * 0.25
        n = FACING[f][2]
        quad(M, flats, (x, h / 2 + 0.05, z), w, h, f, uv=(u, 0, u + 0.25, 1))
        # short braces at its foot (tall struts showed where a cut-out is mostly sky)
        for s in (-0.3, 0.3):
            rr = FACING[f][0]
            p = Vector((x, 0, z)) + rr * (s * w) - n * 0.22
            box(M, wood, (p.x, 0.35, p.z), (0.08 + abs(n.x) * 0.36, 0.7, 0.08 + abs(n.z) * 0.36))
    # tombstones beside the first stretch of track
    for (x, z, r) in ((-11.2, 4.2, 0.2), (-10.6, 2.0, -0.15), (-11.7, -0.6, 0.35), (-10.4, -5.0, -0.3), (11.0, -3.6, 0.1)):
        box(M, stone, (x, 0.48, z), (0.62, 0.96, 0.16), rot_y=r + math.pi / 2, bevel=0.05)
        M.solid(x, z, 0.62, 0.16, 0.96, r + math.pi / 2)
    # cobwebs in the corners under the roof
    for (x, z, f, tilt) in ((-hw + 0.02, -hd + 1.0, '+x', 0.0), (-hw + 0.02, hd - 1.0, '+x', math.pi / 2), (hw - 0.02, -hd + 1.0, '-x', math.pi / 2),
                            (hw - 0.02, hd - 1.0, '-x', 0.0), (-4 - T / 2 - 0.02, 3.0, '-x', 0.0), (4 + T / 2 + 0.02, -3.0, '+x', math.pi / 2),
                            (-1.0, -hd + 0.02, '+z', 0.0), (6.0, -hd + 0.02, '+z', math.pi / 2)):
        quad(M, web, (x, b['h'] - 1.1, z), 2.0, 2.0, f, tilt=tilt)
    # bats hanging under the roof
    for i in range(12):
        x = rnd.uniform(-hw + 1, hw - 1)
        z = rnd.uniform(-hd + 1, hd - 1)
        if abs(x) < 4.6 and z > -4.4:
            x += 9 if x > 0 else -9
        cell = rnd.randrange(4)
        u, v = (cell % 2) * 0.5, (cell // 2) * 0.5
        quad(M, batm, (x, rnd.uniform(4.8, 6.6), z), 0.9, 0.9, '-y', uv=(u, v, u + 0.5, v + 0.5), tilt=rnd.uniform(0, 6.28))
    # eyes in the dark corners
    for (x, z, f, m) in ((-hw + 0.03, 5.6, '+x', glow_r), (-4 - T / 2 - 0.03, -2.0, '-x', glow_y), (hw - 0.03, 5.2, '-x', glow_r),
                         (4 + T / 2 + 0.03, 1.5, '+x', glow_y), (-6.0, -hd + 0.03, '+z', glow_r), (9.5, -hd + 0.03, '+z', glow_y)):
        n = FACING[f][2]
        rr = FACING[f][0]
        y = rnd.uniform(1.1, 2.3)
        for s in (-0.11, 0.11):
            p = Vector((x, y, z)) + rr * s
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=0.045)
            bm.transform(Matrix.Translation(p))
            M.take(m, bm)
    # warnings in the middle room
    picture(M, posters, (-4 + T / 2 + 0.05, 2.6, 2.2), 1.6, 3.2, '+x', uv=(0, 0, 0.5, 1), depth=0.05)
    picture(M, posters, (4 - T / 2 - 0.05, 2.6, 2.2), 1.6, 3.2, '-x', uv=(0.5, 0, 1, 1), depth=0.05)
    return M


def inside_arcade():
    b = layout['arcade']
    M = Model('inside_arcade')
    carpet = mat('carpet', '#ffffff', 0.95, image='themed_carpet.png')
    posters = mat('arcade_posters', '#ffffff', 0.8, image='themed_arcade_posters.png')
    signs = mat('arcade_signs', '#ffffff', 0.8, image='themed_arcade_signs.png')
    shelf = mat('shelf', '#5a3a22', 0.8)
    hw, hd = b['w'] / 2 - T / 2, b['d'] / 2 - T / 2
    # the carpet, wall to wall, a little above the floor
    bm = bmesh.new()
    vs = [bm.verts.new((sx * hw, 0.025, sz * hd)) for sx, sz in ((-1, 1), (1, 1), (1, -1), (-1, -1))]
    bm.faces.new(vs)
    planar_uv(bm, lambda co: (co.x / 3.0, co.z / 3.0))
    M.take(carpet, bm)
    # posters round the walls: (x, z, facing, which)
    for i, (x, z, f) in enumerate(((-7.0, -hd, '+z'), (-3.0, -hd, '+z'), (1.0, -hd, '+z'), (8.4, -hd, '+z'),
                                   (hw, -4.6, '-x'), (hw, 5.4, '-x'), (0.6, hd, '-z'), (3.6, hd, '-z'))):
        n = FACING[f][2]
        u = (i % 4) * 0.25
        picture(M, posters, (x + n.x * 0.06, 2.5, z + n.z * 0.06), 1.2, 2.4, f, uv=(u, 0, u + 0.25, 1), depth=0.05)
    # the high-score board, the rules, insert coin
    picture(M, signs, (-hw + 0.06, 2.6, 4.6), 1.6, 1.6, '+x', uv=(0.5, 0.0, 1.0, 0.5), depth=0.05)
    picture(M, signs, (-0.8, 3.7, -hd + 0.06), 1.3, 1.3, '+z', uv=(0.0, 0.5, 0.5, 1.0), depth=0.05)
    picture(M, signs, (hw - 0.06, 2.4, -0.9), 1.1, 1.1, '-x', uv=(0.5, 0.5, 1.0, 1.0), depth=0.05)
    # the prize shelf behind the counter, and TOKENS over it
    sx, sz = 6.5, hd - 0.22
    box(M, shelf, (sx, 1.1, sz), (2.6, 2.2, 0.06))
    for y in (0.45, 1.05, 1.65, 2.18):
        box(M, shelf, (sx, y, sz - 0.2), (2.6, 0.05, 0.42))
    for side in (-1, 1):
        box(M, shelf, (sx + side * 1.28, 1.1, sz - 0.2), (0.05, 2.2, 0.42))
    prize = [mat(f'prize_{c}', c, 0.85) for c in ('#e83ad8', '#5ad0e8', '#ffe14a', '#5aff7a', '#f2702c', '#c45aff')]
    for y in (0.47, 1.07, 1.67):
        x = sx - 1.1
        while x < sx + 1.05:
            s = rnd.uniform(0.18, 0.32)
            m = prize[rnd.randrange(len(prize))]
            if rnd.random() < 0.5:
                box(M, m, (x + s / 2, y + s / 2 + 0.03, sz - 0.22), (s, s, s * 0.8), rot_y=rnd.uniform(-0.3, 0.3), bevel=0.02)
            else:
                bm = bmesh.new()
                bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=s / 2)
                bm.transform(Matrix.Translation((x + s / 2, y + s / 2 + 0.03, sz - 0.22)))
                for f in bm.faces:
                    f.smooth = True
                M.take(m, bm)
            x += s + 0.05
    picture(M, signs, (sx, 2.95, hd - 0.06), 1.2, 1.2, '-z', uv=(0.0, 0.0, 0.5, 0.5), depth=0.05)
    return M


def export(M, style):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    built = {'front_tunnel': front_tunnel, 'front_funhouse': front_funhouse, 'front_arcade': front_arcade,
             'inside_tunnel': inside_tunnel, 'inside_funhouse': inside_funhouse, 'inside_arcade': inside_arcade}[M]()
    objs = built.build()
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    path = os.path.join(OUT, f'{M}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    # its box in building coordinates (game space), for placing it back exactly
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for v in o.data.vertices:
            g = Vector((v.co.x, v.co.z, -v.co.y))
            lo = Vector(map(min, lo, g))
            hi = Vector(map(max, hi, g))
    print(f'THEMED {M}: {sum(len(o.data.polygons) for o in objs)} faces, box {tuple(round(c, 2) for c in lo)} .. {tuple(round(c, 2) for c in hi)}', flush=True)
    return {'model': M, 'style': style, 'x': round((lo.x + hi.x) / 2, 3), 'z': round((lo.z + hi.z) / 2, 3), 'y': round(lo.y, 3),
            'w': round(hi.x - lo.x, 3), 'd': round(hi.z - lo.z, 3), 'h': round(hi.y - lo.y, 3), 'solids': built.solids}


entries = []
for M, style in (('front_tunnel', 'tunnel'), ('front_funhouse', 'funhouse'), ('front_arcade', 'arcade'),
                 ('inside_tunnel', 'tunnel'), ('inside_funhouse', 'funhouse'), ('inside_arcade', 'arcade')):
    entries.append(export(M, style))

js = ['// Written by scripts/blender/themed.py: where the themed buildings\' painted fronts and inside dressing go, in each',
      '// building\'s own coordinates (x, z: the model\'s centre; y: its foot; w, d, h: its size), and the parts of it',
      '// that are solid ([x, z, w, d, h, rot] colliders, also building coordinates). shared/map.js places them.',
      'export const THEMED = ' + json.dumps(entries, indent=1) + ';', '']
open(os.path.join(ROOT, 'shared', 'themed-layout.js'), 'w').write('\n'.join(js))
print('THEMED layout written', flush=True)
