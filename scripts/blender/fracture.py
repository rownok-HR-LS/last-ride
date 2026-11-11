# Breakable props (src/debris.js): a prop model cut into irregular chunks, Voronoi style. Random seeds are scattered
# through the model's bounds; each chunk is the model clipped by the planes halfway between its seed and every other
# seed, and the cut faces are capped with an 'inside' material (raw wood, foam, metal: the game paints it). Each chunk
# is its own object, its origin at its centre; positions stay in the model's own space, so the game can place the
# chunks exactly where the whole prop stood. Geometry and material names only: the game reuses the prop's materials.
#
#   blender --background --factory-startup --python scripts/blender/fracture.py -- in.glb out.glb [chunks] [seed]
import random
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
N = int(args[2]) if len(args) > 2 else 8
SEED = int(args[3]) if len(args) > 3 else 7

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
# one mesh in the model's own space: every transform applied, then joined
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(objs) > 1:
    bpy.ops.object.join()
src = bpy.context.view_layer.objects.active
for o in [o for o in bpy.data.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o)
me = src.data
# the model's own materials (textures already stripped: the game has the real ones), plus the inside of things
inside = bpy.data.materials.new('inside')
me.materials.append(inside)
INSIDE = len(me.materials) - 1

lo = Vector((min(v.co[i] for v in me.vertices) for i in range(3)))
hi = Vector((max(v.co[i] for v in me.vertices) for i in range(3)))
size = hi - lo
rng = random.Random(SEED)
# seeds near the model's surface points (so chunks follow its shape), spread out
pts = [v.co.copy() for v in me.vertices]
seeds = []
for _ in range(N * 40):
    if len(seeds) >= N:
        break
    p = pts[rng.randrange(len(pts))] * 0.6 + Vector((lo[i] + rng.random() * size[i] for i in range(3))) * 0.4
    if all((p - s).length > size.length / (N ** 0.5) * 0.45 for s in seeds):
        seeds.append(p)
while len(seeds) < 2:
    seeds.append(Vector((lo[i] + rng.random() * size[i] for i in range(3))))

made = 0
for i, s in enumerate(seeds):
    bm = bmesh.new()
    bm.from_mesh(me)
    for j, t in enumerate(seeds):
        if i == j:
            continue
        n = (t - s).normalized()
        mid = (s + t) / 2
        # a little wobble so cuts aren't perfectly flat
        n = (n + Vector((rng.uniform(-0.08, 0.08) for _ in range(3)))).normalized()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=mid, plane_no=n, clear_outer=True)
        cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if cut:
            # cap the opening
            try:
                filled = bmesh.ops.edgeloop_fill(bm, edges=cut)
                for f in filled['faces']:
                    f.material_index = INSIDE
            except Exception:
                try:
                    filled = bmesh.ops.holes_fill(bm, edges=cut, sides=0)
                    for f in filled['faces']:
                        f.material_index = INSIDE
                except Exception:
                    pass
        if not bm.faces:
            break
    if len(bm.faces) < 4:
        bm.free()
        continue
    cm = bpy.data.meshes.new(f'chunk_{i}')
    bm.to_mesh(cm)
    bm.free()
    for m in me.materials:
        cm.materials.append(m)
    ob = bpy.data.objects.new(f'chunk_{i}', cm)
    bpy.context.scene.collection.objects.link(ob)
    # origin at the chunk's centre (the game spins each chunk about it)
    c = sum((v.co for v in cm.vertices), Vector()) / len(cm.vertices)
    for v in cm.vertices:
        v.co -= c
    ob.location = c
    made += 1

bpy.data.objects.remove(src)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
                          export_normals=True, export_texcoords=True, export_materials='EXPORT', export_image_format='NONE')
print(f'FRACTURE {SRC} -> {made} chunks ({len(seeds)} seeds) -> {OUT}')
