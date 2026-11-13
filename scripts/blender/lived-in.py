# Lived-in dressing for the park, modelled in Blender from code: a poster column wrapped in torn circus posters,
# a scatter of ride tickets for the paths, and a cluster of half-deflated balloons trailing tangled strings (hung in
# the park's trees). Textures come from scripts/lived-in-textures.mjs; the GLBs go to assets-src/blender and
# scripts/convert-env.mjs slims them for the game.
#
#   node scripts/lived-in-textures.mjs
#   blender --background --factory-startup --python scripts/blender/lived-in.py -- <last-ride folder>
#   node scripts/convert-env.mjs poster_column ticket_litter balloons
#
# Blender is Z-up and the front of every prop faces -Y, which the game sees as +Z.
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


def mat(name, col='#ffffff', rough=0.85, metal=0.0, image=None, cull=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin(col), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if image:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TEX, image), check_existing=True)
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    m.use_backface_culling = cull
    return m


def done(o, m, name, smooth=False):
    o.name = name
    o.data.materials.clear()
    o.data.materials.append(m)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    return o


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(name):
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True)
    print('LIVED-IN', name, '->', path, flush=True)


def poster_column():
    """An advertising pillar: concrete foot, a column papered in torn posters, a green-painted cap and a finial."""
    reset()
    paper = mat('posters', image='posters_torn.png', rough=0.9)
    concrete = mat('tex:concrete', '#7a7670', 0.95)
    paint = mat('cap', '#3c5a46', 0.6, metal=0.4)
    # the papered shaft: a cylinder whose sides carry the poster wrap once round (u) and full height (v)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.42, depth=2.3, location=(0, 0, 0.35 + 1.15), end_fill_type='NOTHING')
    shaft = bpy.context.object
    me = shaft.data
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            a = math.atan2(v.y, v.x)
            u = (a / (2 * math.pi)) % 1.0
            uv.data[li].uv = (u, (v.z + 1.15) / 2.3)
    # fix the seam: faces straddling u=0/1 get their small u's pushed past 1
    for poly in me.polygons:
        us = [uv.data[li].uv[0] for li in poly.loop_indices]
        if max(us) - min(us) > 0.5:
            for li in poly.loop_indices:
                if uv.data[li].uv[0] < 0.5:
                    uv.data[li].uv[0] += 1.0
    done(shaft, paper, 'shaft', smooth=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.5, depth=0.35, location=(0, 0, 0.175))
    done(bpy.context.object, concrete, 'foot', smooth=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.52, depth=0.12, location=(0, 0, 2.71))
    done(bpy.context.object, paint, 'rim', smooth=True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=8, radius=0.5, location=(0, 0, 2.77))
    dome = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(dome.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
    bm.to_mesh(dome.data)
    bm.free()
    dome.scale = (1, 1, 0.55)
    done(dome, paint, 'dome', smooth=True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.07, location=(0, 0, 3.1))
    done(bpy.context.object, paint, 'finial', smooth=True)
    export('poster_column')


def ticket_litter():
    """Ride tickets dropped and trodden into the ground, about a metre and a half across: some flat, some curled."""
    reset()
    paper = mat('tickets', image='tickets.png', rough=0.9)
    bm = bmesh.new()
    uv_l = bm.loops.layers.uv.new('UVMap')
    for i in range(30):
        r = 0.75 * math.sqrt(rnd.random())
        a = rnd.random() * 2 * math.pi
        cx, cy = math.cos(a) * r, math.sin(a) * r
        rot = rnd.random() * 2 * math.pi
        w, h = 0.11, 0.055
        cell = rnd.randrange(16)
        u0, v0 = (cell % 4) / 4, 1 - (cell // 4 + 1) / 4
        curl = rnd.random() * 0.025 if rnd.random() < 0.45 else 0.0
        # three strips across, so a curl lifts the ends
        cols = 4
        verts = []
        for k in range(cols):
            t = k / (cols - 1)
            for s in (-1, 1):
                x = (t - 0.5) * w
                y = s * h / 2
                z = 0.004 + curl * (2 * t - 1) ** 2 + rnd.random() * 0.001
                X = cx + x * math.cos(rot) - y * math.sin(rot)
                Y = cy + x * math.sin(rot) + y * math.cos(rot)
                verts.append((bm.verts.new((X, Y, z)), (u0 + t / 4, v0 + (0 if s < 0 else 1 / 4))))
        for k in range(cols - 1):
            a0, a1 = verts[k * 2], verts[k * 2 + 1]
            b0, b1 = verts[k * 2 + 2], verts[k * 2 + 3]
            f = bm.faces.new((a0[0], b0[0], b1[0], a1[0]))
            for loop, src in zip(f.loops, (a0, b0, b1, a1)):
                loop[uv_l].uv = src[1]
    me = bpy.data.meshes.new('tickets')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('tickets', me)
    bpy.context.collection.objects.link(o)
    done(o, paper, 'tickets')
    export('ticket_litter')


def balloons():
    """Three party balloons gone soft, knotted, their strings hanging in a tangle (hung up in a tree by their tops)."""
    reset()
    colours = [('red', '#a8342e'), ('yellow', '#c7a43a'), ('blue', '#355ba8')]
    string = mat('string', '#d8d2c4', 0.9)
    for i, (name, col) in enumerate(colours):
        rubber = mat(f'balloon_{name}', col, 0.32)
        r = 0.17 + rnd.random() * 0.04
        soft = 0.55 + rnd.random() * 0.35
        x = (i - 1) * 0.22 + (rnd.random() - 0.5) * 0.06
        z = -0.1 - rnd.random() * 0.25
        bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=12, radius=r, location=(x, 0, z))
        b = bpy.context.object
        # a balloon's shape (narrower at the knot), and wrinkled and sagging where it has lost air
        for v in b.data.vertices:
            co = v.co
            if co.z < 0:
                co.x *= 1 + co.z / r * 0.35
                co.y *= 1 + co.z / r * 0.35
            co.z *= 1.18
            n = math.sin(co.x * 40 + i) * math.sin(co.y * 37 + 2 * i) * math.sin(co.z * 33)
            co.x += co.x * n * 0.12 * (1 - soft)
            co.y += co.y * n * 0.12 * (1 - soft)
            co.z -= max(0.0, co.z) * (1 - soft) * 0.5
        b.rotation_euler = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0)
        done(b, rubber, f'balloon_{name}', smooth=True)
        # the knot
        bottom = z - r * 1.18 * 0.95
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.022, radius2=0.0, depth=0.04, location=(x, 0, bottom), rotation=(math.pi, 0, 0))
        done(bpy.context.object, rubber, f'knot_{name}')
        # its string: hanging down, wandering, and drifting together with the others below
        pts = []
        p = Vector((x, 0, bottom - 0.02))
        for k in range(12):
            pts.append(p.copy())
            p += Vector((rnd.uniform(-0.05, 0.05) - x * 0.06, rnd.uniform(-0.05, 0.05), -0.1 - rnd.random() * 0.04))
        cu = bpy.data.curves.new(f'string_{name}', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.004
        cu.bevel_resolution = 1
        sp = cu.splines.new('POLY')
        sp.points.add(len(pts) - 1)
        for k, q in enumerate(pts):
            sp.points[k].co = (q.x, q.y, q.z, 1)
        so = bpy.data.objects.new(f'string_{name}', cu)
        bpy.context.collection.objects.link(so)
        bpy.context.view_layer.objects.active = so
        so.select_set(True)
        bpy.ops.object.convert(target='MESH')
        so = bpy.context.object
        done(so, string, f'string_{name}')
        so.select_set(False)
    export('balloons')


poster_column()
ticket_litter()
balloons()
