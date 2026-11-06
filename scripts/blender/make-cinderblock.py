# A seamless painted cinder-block wall texture, made in Blender: 40 x 20 cm blocks in running bond with recessed
# mortar, chipped and flaking paint showing the grey block underneath, small pits. One tile is 2.4 m square.
# Writes the game's PBR set (diff / nor / arm, like the photo textures in public/tex):
#
#   blender --background --factory-startup --python scripts/blender/make-cinderblock.py -- outdir [size]
#   (then scripts/pack-cinderblock.mjs turns the PNGs into public/tex/cinder_block/*.webp)
import math
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
SIZE = int(args[1]) if len(args) > 1 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    scene.cycles.device = 'GPU'
except Exception:
    pass
scene.cycles.samples = 4

# the tile: a 1 x 1 sheet whose UV runs 0..1 (one repeat)
me = bpy.data.meshes.new('tile')
me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)])
uv = me.uv_layers.new(name='UVMap')
for loop, c in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
    loop.uv = c
obj = bpy.data.objects.new('tile', me)
scene.collection.objects.link(obj)

m = bpy.data.materials.new('block')
m.use_nodes = True
nt = m.node_tree
N = nt.nodes
L = nt.links
for n in list(N):
    N.remove(n)
out = N.new('ShaderNodeOutputMaterial')
bsdf = N.new('ShaderNodeBsdfPrincipled')
L.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
tc = N.new('ShaderNodeTexCoord')
sep = N.new('ShaderNodeSeparateXYZ')
L.new(tc.outputs['UV'], sep.inputs['Vector'])


def math_node(op, a, b=None, v=None):
    n = N.new('ShaderNodeMath')
    n.operation = op
    for i, x in enumerate((a, b)):
        if x is None:
            if v is not None and i == 1:
                n.inputs[1].default_value = v
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            L.new(x, n.inputs[i])
    return n.outputs[0]


# seamless noise: the tile's u and v go round two circles, so a 4D noise field wraps at the edges
def wrap_noise(scale, detail=6.0, rough=0.6):
    tau = 2 * math.pi
    cu = math_node('COSINE', math_node('MULTIPLY', sep.outputs['X'], tau))
    su = math_node('SINE', math_node('MULTIPLY', sep.outputs['X'], tau))
    cv = math_node('COSINE', math_node('MULTIPLY', sep.outputs['Y'], tau))
    sv = math_node('SINE', math_node('MULTIPLY', sep.outputs['Y'], tau))
    comb = N.new('ShaderNodeCombineXYZ')
    L.new(cu, comb.inputs['X'])
    L.new(su, comb.inputs['Y'])
    L.new(cv, comb.inputs['Z'])
    nz = N.new('ShaderNodeTexNoise')
    nz.noise_dimensions = '4D'
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    nz.inputs['Roughness'].default_value = rough
    L.new(comb.outputs['Vector'], nz.inputs['Vector'])
    L.new(math_node('MULTIPLY', sv, 1.0), nz.inputs['W'])
    return nz.outputs['Fac']


# blocks: 6 across and 12 high in one tile (40 x 20 cm on a 2.4 m tile), running bond
brick = N.new('ShaderNodeTexBrick')
brick.offset = 0.5
brick.offset_frequency = 2
brick.squash = 1.0
brick.squash_frequency = 1
brick.inputs['Scale'].default_value = 1.0
brick.inputs['Mortar Size'].default_value = 0.0045
brick.inputs['Mortar Smooth'].default_value = 0.25
brick.inputs['Bias'].default_value = 0.0
brick.inputs['Brick Width'].default_value = 1 / 6
brick.inputs['Row Height'].default_value = 1 / 12
brick.inputs['Color1'].default_value = (0.0, 0.0, 0.0, 1)
brick.inputs['Color2'].default_value = (1.0, 1.0, 1.0, 1)  # per-block variation lives in Color
brick.inputs['Mortar'].default_value = (1, 1, 1, 1)
L.new(tc.outputs['UV'], brick.inputs['Vector'])
mortar = brick.outputs['Fac']  # 1 in the joints

pits = wrap_noise(60.0, 2.0, 0.5)  # small pits in the block face
paint = wrap_noise(7.0, 8.0, 0.65)  # where paint has flaked away
grime = wrap_noise(3.0, 4.0, 0.5)
# flaked: a hard threshold on the paint noise
flake = math_node('GREATER_THAN', paint, None, v=0.62)
var = brick.outputs['Color']  # 0..1 per block

# colour: off-white paint (the game tints it), grey concrete where it has flaked, darker mortar
paint_col = N.new('ShaderNodeMix')
paint_col.data_type = 'RGBA'
paint_col.inputs['A'].default_value = (0.82, 0.81, 0.78, 1)
paint_col.inputs['B'].default_value = (0.74, 0.73, 0.70, 1)
L.new(math_node('MULTIPLY', N.new('ShaderNodeSeparateColor').outputs[0], 1.0) if False else grime, paint_col.inputs['Factor'])
block_col = N.new('ShaderNodeMix')
block_col.data_type = 'RGBA'
L.new(flake, block_col.inputs['Factor'])
L.new(paint_col.outputs['Result'], block_col.inputs['A'])
block_col.inputs['B'].default_value = (0.38, 0.37, 0.35, 1)
var_col = N.new('ShaderNodeMix')
var_col.data_type = 'RGBA'
var_col.blend_type = 'MULTIPLY'
var_col.inputs['Factor'].default_value = 0.28
L.new(block_col.outputs['Result'], var_col.inputs['A'])
L.new(var, var_col.inputs['B'])
col = N.new('ShaderNodeMix')
col.data_type = 'RGBA'
L.new(mortar, col.inputs['Factor'])
L.new(var_col.outputs['Result'], col.inputs['A'])
col.inputs['B'].default_value = (0.42, 0.41, 0.39, 1)
# broad grime and weathering across the wall: water stains, soot
grime2 = wrap_noise(2.0, 5.0, 0.55)
dirt = N.new('ShaderNodeMix')
dirt.data_type = 'RGBA'
dirt.blend_type = 'MULTIPLY'
ramp = N.new('ShaderNodeMapRange')
ramp.inputs['From Min'].default_value = 0.45
ramp.inputs['From Max'].default_value = 0.7
ramp.inputs['To Min'].default_value = 0.0
ramp.inputs['To Max'].default_value = 0.55
L.new(grime2, ramp.inputs['Value'])
L.new(ramp.outputs['Result'], dirt.inputs['Factor'])
L.new(col.outputs['Result'], dirt.inputs['A'])
dirt.inputs['B'].default_value = (0.45, 0.4, 0.33, 1)
L.new(dirt.outputs['Result'], bsdf.inputs['Base Color'])

# height: joints sunk, flaked paint a hair lower, pits
h = math_node('SUBTRACT', 1.0, math_node('MULTIPLY', mortar, None, v=0.8))
h = math_node('SUBTRACT', h, math_node('MULTIPLY', flake, None, v=0.06))
h = math_node('SUBTRACT', h, math_node('MULTIPLY', math_node('GREATER_THAN', pits, None, v=0.66), None, v=0.12))
bump = N.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 1.0
bump.inputs['Distance'].default_value = 0.004
L.new(h, bump.inputs['Height'])
L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

# roughness: chalky old paint, rougher bare block and joints
r = math_node('ADD', 0.78, math_node('MULTIPLY', math_node('MAXIMUM', flake, mortar), None, v=0.18))
L.new(r, bsdf.inputs['Roughness'])
bsdf.inputs['Metallic'].default_value = 0.0
me.materials.append(m)

img_node = N.new('ShaderNodeTexImage')
N.active = img_node
obj.select_set(True)
bpy.context.view_layer.objects.active = obj


def bake_to(name, kind, colour, **kw):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    img_node.image = img
    bpy.ops.object.bake(type=kind, margin=0, use_clear=True, **kw)
    img.filepath_raw = f'{OUT}/{name}.png'
    img.file_format = 'PNG'
    img.save()
    return img


def via_emission(socket):
    """Bake what feeds a BSDF input (colour or roughness) straight, through an emission."""
    e = N.new('ShaderNodeEmission')
    src = bsdf.inputs[socket].links[0].from_socket
    L.new(src, e.inputs['Color'])
    L.new(e.outputs['Emission'], out.inputs['Surface'])
    return e


e = via_emission('Base Color')
bake_to('diff', 'EMIT', True)
N.remove(e)
e = via_emission('Roughness')
rough = bake_to('rough', 'EMIT', False)
N.remove(e)
L.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
bake_to('nor', 'NORMAL', False, normal_space='TANGENT')

# arm: occlusion (darker in the joints), roughness, no metal
a = np.empty(SIZE * SIZE * 4, dtype=np.float32)
rough.pixels.foreach_get(a)
a = a.reshape(SIZE, SIZE, 4)
arm = bpy.data.images.new('arm', SIZE, SIZE, alpha=False)
arm.colorspace_settings.name = 'Non-Color'
p = np.ones((SIZE, SIZE, 4), dtype=np.float32)
p[..., 0] = 1.0
p[..., 1] = a[..., 0]
p[..., 2] = 0.0
arm.pixels.foreach_set(p.ravel())
arm.filepath_raw = f'{OUT}/arm.png'
arm.file_format = 'PNG'
arm.save()
print('BLOCK done', OUT)
