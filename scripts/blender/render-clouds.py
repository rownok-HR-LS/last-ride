# The storm sky's clouds (src/clouds.js): a slab of volumetric cloud rendered in Cycles from straight below, twice:
#   clouds_moon.png   lit by the moon from above and to one side: dark bellies, silver where they thin (RGB), and
#                     how much sky they hide (alpha)
#   clouds_flash.png  the same clouds lit from inside, as a lightning flash lights them (RGB)
# The image tiles seamlessly: the cloud density is noise looked up on a torus (so it repeats every TILE metres both
# ways), the slab is three tiles wide so neighbours shadow each other across the seams, and the camera (orthographic,
# looking straight up) frames exactly the middle tile. Image x is the game's x, image up is the game's z.
# scripts/pack-clouds.mjs packs the two into public/tex/clouds.webp.
#
#   blender --background --factory-startup --python scripts/blender/render-clouds.py -- outdir [size] [samples]
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = os.path.abspath(args[0])
SIZE = int(args[1]) if len(args) > 1 else 1024
SAMPLES = int(args[2]) if len(args) > 2 else 96
os.makedirs(OUT, exist_ok=True)
TILE = 100.0
THICK = 14.0

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    sc.cycles.device = 'GPU'
except Exception as e:
    print('CLOUDS cpu', e)
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.volume_bounces = 3
sc.cycles.max_bounces = 6
sc.render.resolution_x = SIZE
sc.render.resolution_y = SIZE
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.image_settings.color_depth = '16'
sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('night')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
sc.world = world

# --- the slab of cloud
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, THICK / 2))
slab = bpy.context.object
slab.scale = (TILE * 3, TILE * 3, THICK)
mat = bpy.data.materials.new('cloud')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
N = nt.nodes.new
L = nt.links.new


def math_node(op, a=None, b=None):
    n = N('ShaderNodeMath')
    n.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            L(v, n.inputs[i])
    return n.outputs[0]


geo = N('ShaderNodeNewGeometry')
sep = N('ShaderNodeSeparateXYZ')
L(geo.outputs['Position'], sep.inputs[0])
au = math_node('MULTIPLY', sep.outputs['X'], 2 * math.pi / TILE)
av = math_node('MULTIPLY', sep.outputs['Y'], 2 * math.pi / TILE)


def torus_noise(features, detail, rough):
    """Noise that repeats every TILE in x and y: looked up on a torus in four dimensions."""
    r = features / (2 * math.pi)
    comb = N('ShaderNodeCombineXYZ')
    L(math_node('MULTIPLY', math_node('COSINE', au), r), comb.inputs[0])
    L(math_node('MULTIPLY', math_node('SINE', au), r), comb.inputs[1])
    L(math_node('MULTIPLY', math_node('COSINE', av), r), comb.inputs[2])
    n = N('ShaderNodeTexNoise')
    n.noise_dimensions = '4D'
    n.inputs['Scale'].default_value = 1.0
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    L(comb.outputs[0], n.inputs['Vector'])
    L(math_node('MULTIPLY', math_node('SINE', av), r), n.inputs['W'])
    return n.outputs['Fac'] if 'Fac' in n.outputs else n.outputs[0]


big = torus_noise(3.0, 7.0, 0.55)
small = torus_noise(9.0, 5.0, 0.6)
n = math_node('ADD', math_node('MULTIPLY', big, 0.72), math_node('MULTIPLY', small, 0.28))
# puffy tops: higher up, only the densest parts reach
zn = math_node('DIVIDE', sep.outputs['Z'], THICK)
thr = math_node('ADD', 0.40, math_node('MULTIPLY', zn, 0.2))
dens = math_node('MULTIPLY', math_node('SUBTRACT', n, thr), 9.0)
clamp = N('ShaderNodeClamp')
L(dens, clamp.inputs['Value'])
density = math_node('MULTIPLY', clamp.outputs[0], 0.55)
vol = N('ShaderNodeVolumePrincipled')
vol.inputs['Color'].default_value = (0.92, 0.94, 1.0, 1)
vol.inputs['Anisotropy'].default_value = 0.35
L(density, vol.inputs['Density'])
glow = N('ShaderNodeValue')
glow.outputs[0].default_value = 0.0
L(math_node('MULTIPLY', clamp.outputs[0], glow.outputs[0]), vol.inputs['Emission Strength'])
vol.inputs['Emission Color'].default_value = (0.75, 0.85, 1.0, 1)
out = N('ShaderNodeOutputMaterial')
L(vol.outputs[0], out.inputs['Volume'])
slab.data.materials.append(mat)

# --- the moon: from above and to one side (the game's moon direction (-0.45, 0.5, -0.74) is Blender's (-0.45, 0.74, 0.5))
moon = bpy.data.lights.new('moon', 'SUN')
moon.energy = 5.0
moon.color = (0.75, 0.83, 1.0)
moon.angle = math.radians(2)
mo = bpy.data.objects.new('moon', moon)
sc.collection.objects.link(mo)
mo.rotation_euler = Vector((-0.45, 0.74, 0.5)).normalized().to_track_quat('Z', 'Y').to_euler()

# --- the camera: under the slab, looking straight up at the middle tile
cam = bpy.data.cameras.new('cam')
cam.type = 'ORTHO'
cam.ortho_scale = TILE
co = bpy.data.objects.new('cam', cam)
sc.collection.objects.link(co)
co.location = (0, 0, -10)
co.rotation_euler = (math.pi, 0, 0)
sc.camera = co

sc.render.filepath = os.path.join(OUT, 'clouds_moon.png')
bpy.ops.render.render(write_still=True)
print('CLOUDS moon pass done', flush=True)
# lightning: no moon, the clouds glow from inside
moon.energy = 0.0
glow.outputs[0].default_value = 0.22
sc.render.filepath = os.path.join(OUT, 'clouds_flash.png')
bpy.ops.render.render(write_still=True)
print(f'CLOUDS -> {OUT} ({SIZE}px, {SAMPLES} samples)', flush=True)
