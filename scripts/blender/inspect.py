# List a model's meshes in Blender: triangles, loose parts (hair cards are many small loose parts), material.
# blender --background --factory-startup --python scripts/blender/inspect.py -- public/models/oldlady.glb
import sys
import bpy
import bmesh

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
total = 0
for ob in bpy.context.scene.objects:
    if ob.type != 'MESH':
        continue
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    total += tris
    # loose parts: walk connected faces
    seen = set()
    parts = 0
    for f in bm.faces:
        if f.index in seen:
            continue
        parts += 1
        stack = [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
    mats = ','.join(m.name for m in ob.data.materials if m)
    print(f'MESH {ob.name:30s} tris {tris:7d} parts {parts:6d} mats {mats}')
    bm.free()
print('TOTAL', total)
