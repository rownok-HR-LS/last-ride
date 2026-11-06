# Bake the park ground's ambient occlusion in Blender: everything static that stands on the ground (exported from the
# game with src/tools/export-occluders.js) shades a 240 x 240 m plane, top-down. The game lays the result over its
# ground (public/tex/ground_ao.webp): soft darkening around every building, tent, ride, booth, prop and tree.
#
#   blender --background --factory-startup --python scripts/blender/bake-ground-ao.py -- occluders.glb out.png [size] [samples]
#
# Blender is Z-up: the game's x is Blender's X and the game's z is Blender's -Y. The plane's UV runs u along +X and
# v along +Y, so in the game u = (x + 120) / 240 and v = (120 - z) / 240.
import sys
import time
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
size = int(args[2]) if len(args) > 2 else 2048
samples = int(args[3]) if len(args) > 3 else 64

bpy.ops.wm.read_factory_settings(use_empty=True)
t0 = time.time()
bpy.ops.import_scene.gltf(filepath=src)
print(f'BAKE imported {len(bpy.data.objects)} objects in {time.time() - t0:.1f}s')

# the ground to bake onto
bpy.ops.mesh.primitive_plane_add(size=240, location=(0, 0, 0))
ground = bpy.context.active_object
ground.name = 'GroundBake'
img = bpy.data.images.new('ground_ao', size, size, alpha=False)
mat = bpy.data.materials.new('GroundBake')
mat.use_nodes = True
node = mat.node_tree.nodes.new('ShaderNodeTexImage')
node.image = img
mat.node_tree.nodes.active = node
ground.data.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = samples
# the graphics card if there is one, the processor otherwise
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = 'GPU'
                print('BAKE device', kind)
                break
        except TypeError:
            continue
    else:
        print('BAKE device CPU')
except Exception as e:
    print('BAKE device CPU', e)

# how far occlusion reaches: a booth darkens the ground a few metres around it, a tent a little more
world = bpy.data.worlds.new('World')
scene.world = world
world.light_settings.distance = 7.0

bpy.ops.object.select_all(action='DESELECT')
ground.select_set(True)
bpy.context.view_layer.objects.active = ground
t0 = time.time()
bpy.ops.object.bake(type='AO', margin=8, use_clear=True)
print(f'BAKE baked {size}px at {samples} samples in {time.time() - t0:.1f}s')
img.filepath_raw = out
img.file_format = 'PNG'
img.save()
print('BAKE saved', out)
