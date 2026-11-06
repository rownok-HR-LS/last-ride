# A far version of a model for the game's distance switch: Blender's Decimate (collapse) down to a fraction of the
# triangles, keeping its materials and UVs. scripts/bake-atlases.mjs runs it on the baked atlases.
#
#   blender --background --factory-startup --python scripts/blender/lod.py -- src.glb out.glb triangles
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, TARGET = args[0], args[1], int(args[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
before = sum(tri(o) for o in objs)
RATIO = min(1.0, TARGET / max(1, before))
after = 0
for o in objs:
    # cut-outs and glass keep their silhouettes
    if o.name.startswith('clear'):
        after += tri(o)
        continue
    bpy.context.view_layer.objects.active = o
    m = o.modifiers.new('lod', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = RATIO
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='lod')
    after += tri(o)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True)
print(f'LOD {before} -> {after} triangles -> {OUT}')
