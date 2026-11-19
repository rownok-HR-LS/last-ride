# The ghosts' blackout as a cloud of shadow rather than a smooth dark dome: a billowing hemisphere (an icosphere's top
# half pushed in and out by layered noise), its foot spreading into a ragged skirt of wisps along the ground. Radius 1
# (the game scales it to the blackout), standing on y = 0. The vertex colour's red is how solid each point is: thick at
# the crown, thinning to nothing at the skirt's ragged edge (src/rides.js's shader churns it and fades its rim).
#
#   blender --background --factory-startup --python scripts/blender/blackout-cloud.py -- <out.glb>
import math
import sys

import bmesh
import bpy
from mathutils import Vector, noise

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=5, radius=1.0)
# keep the upper half and a band below the equator (that band becomes the skirt)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.35], context='VERTS')
solid = {}
for v in bm.verts:
    d = v.co.normalized()
    h = d.z  # -0.35 .. 1 (Blender z is up)
    # billows: big slow lumps and smaller ones on top
    n = noise.fractal(d * 2.2 + Vector((3.1, 1.7, 0.4)), 0.6, 2.0, 4)
    r = 1.0 + 0.16 * n
    if h < 0.05:
        # the skirt: pushed out along the ground and flattened onto it, its edge torn into wisps
        k = (0.05 - h) / 0.4
        tear = noise.noise(d * 6.0 + Vector((7.0, 2.0, 1.0)))
        out = 1.0 + 0.55 * k + 0.25 * k * tear
        v.co = Vector((d.x * r * out, d.y * r * out, max(0.0, 0.05 * (1 - k)) + 0.02 * tear * k))
    else:
        v.co = d * r
        v.co.z = max(v.co.z, 0.04)
    solid[v.index if False else v] = max(0.0, min(1.0, 0.45 + h * 0.9)) if h >= 0.05 else max(0.0, 0.5 * (1 - (0.05 - h) / 0.4) ** 1.5)

me = bpy.data.meshes.new('blackout')
bm.to_mesh(me)
col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
for v, b in zip(me.vertices, bm.verts):
    s = solid[b]
    col.data[v.index].color = (s, s, s, 1.0)
bm.free()
for p in me.polygons:
    p.use_smooth = True
ob = bpy.data.objects.new('blackout', me)
bpy.context.collection.objects.link(ob)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_normals=True,
                          export_vertex_color='ACTIVE')
print(f'BLACKOUT {OUT}: {len(me.polygons)} faces', flush=True)
