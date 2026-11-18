# Shared modelling helpers for the textured dressing scripts (themed.py, rides-dress.py): pieces gathered per
# material in game space (x right, y up, z toward the gate), pictures and boards with painted art, simple solids, and
# the colliders each model brings. Call setup(textures folder, seed) first.
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

TEX = ''
rnd = random.Random(1987)


def setup(tex, seed=1987):
    global TEX
    TEX = tex
    rnd.seed(seed)
    MATS.clear()


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


