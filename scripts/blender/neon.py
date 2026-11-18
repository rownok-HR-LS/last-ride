# Neon tubes for the park's signs: each sign's words bent in glass tube along the letters' outlines (a font turned to
# curves, swept with a round profile), on little standoffs and with the electrode ends where a stroke starts. One
# model per text, built for a board 1 m wide and 0.25 m tall (the game scales it to the sign: src/world.js neonSign),
# the letters fitted inside it, facing the gate (+z in the game). The game gives the tubes the sign's colour and its
# flicker; the board behind them stays the painted, rusted one.
#
#   blender --background --factory-startup --python scripts/blender/neon.py -- <out dir> <font file> <slug=TEXT> ...
#   node scripts/pack-neon.mjs
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT, FONT = args[0], args[1]
SIGNS = [a.split('=', 1) for a in args[2:]]
os.makedirs(OUT, exist_ok=True)

# the board is 1 x 0.25; the words fit in 0.86 x 0.15 of it
FIT_W, FIT_H = 0.86, 0.15


def material(name, col, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = 0.25
    if emit:
        b.inputs['Emission Color'].default_value = (*col, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


for slug, text in SIGNS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    font = bpy.data.fonts.load(FONT)
    cu = bpy.data.curves.new(slug, 'FONT')
    cu.body = text
    cu.font = font
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = 1.0
    cu.space_character = 1.06
    cu.resolution_u = 2
    ob = bpy.data.objects.new(slug, cu)
    bpy.context.collection.objects.link(ob)
    # measure the words first (as filled shapes), to size them and the tube
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    ob.evaluated_get(dg).to_mesh_clear()
    k = min(FIT_W / w, FIT_H / h)
    # a tube a fraction of the letters' height, swept just inside each outline
    r = 0.045 * h
    cu.fill_mode = 'NONE'
    cu.bevel_depth = r
    cu.bevel_resolution = 0
    cu.offset = 0.0  # (pulled inside the outline, sharp corners shot out spikes)
    ob.data.materials.append(material('neon_tube', (1.0, 0.92, 0.85), emit=3.0))
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    tube = bpy.context.view_layer.objects.active
    for p in tube.data.polygons:
        p.use_smooth = True
    # stand the words up facing -Y in Blender (+z in the game), centred and scaled to the board
    tube.data.transform(Matrix.Translation((-cx, -cy, 0)))
    tube.data.transform(Matrix.Scale(k, 4))
    tube.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    # standoffs: little posts holding the glass off the board, at the bottom of the letters, every so often
    bm = bmesh.new()
    lo = min(v.co.z for v in tube.data.vertices)
    xs = sorted(v.co.x for v in tube.data.vertices)
    step = 0.08
    x = xs[0] + step / 2
    while x < xs[-1]:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.004, radius2=0.004, depth=0.03,
                              matrix=Matrix.Translation((x, 0.012, lo + 0.01)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
        x += step
    post = bpy.data.meshes.new(slug + '_posts')
    bm.to_mesh(post)
    bm.free()
    posts = bpy.data.objects.new(slug + '_posts', post)
    bpy.context.collection.objects.link(posts)
    posts.data.materials.append(material('neon_post', (0.12, 0.11, 0.1)))
    # glass sits 2 cm in front of the board (the board is the game's plane at z = 0)
    tube.location = (0, -0.02, 0)
    path = os.path.join(OUT, f'neon_{slug}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True)
    print(f'NEON {slug}: {len(tube.data.polygons)} faces, tube r {r * k:.4f}', flush=True)
