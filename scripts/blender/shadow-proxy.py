# The moonlight's shadow stand-in (src/shadowproxy.js): the park's still scenery, exported from the game in 30 m
# tiles, welded and simplified to what a ~4 cm shadow texel can show. Flat runs (walls, roofs, boards) are dissolved
# exactly first, so boxy buildings keep their outline; then dense scanned props are collapsed to a fraction.
#
#   blender --background --factory-startup --python scripts/blender/shadow-proxy.py -- casters.glb out.glb [ratio]
import sys
import math

import bpy
import bmesh

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
RATIO = float(args[2]) if len(args) > 2 else 0.2
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
before = sum(tri(o) for o in objs)
after = 0
for o in objs:
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # parts that touch share their edges once welded, so simplifying doesn't open cracks between them
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    # slivers and specks a shadow texel can't show
    tiny = [f for f in bm.faces if f.calc_area() < 1e-6]
    bmesh.ops.delete(bm, geom=tiny, context='FACES')
    bm.to_mesh(me)
    bm.free()
    bpy.context.view_layer.objects.active = o
    flat = o.modifiers.new('flat', 'DECIMATE')
    flat.decimate_type = 'DISSOLVE'
    flat.angle_limit = math.radians(1.0)
    bpy.ops.object.modifier_apply(modifier='flat')
    tr = o.modifiers.new('tri', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier='tri')
    n = tri(o)
    # boxy tiles are already small; only dense ones (scanned tents, props, trunks) are collapsed
    if n > 4000:
        m = o.modifiers.new('lod', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = max(RATIO, 4000 / n)
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='lod')
    after += tri(o)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
                          export_normals=False, export_texcoords=False, export_materials='NONE')
print(f'SHADOW PROXY {len(objs)} tiles, {before} -> {after} triangles -> {OUT}')
