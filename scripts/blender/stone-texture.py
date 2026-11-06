# Give an untextured model a weathered stone surface, baked in Blender: grey-brown stone with grain and pits, dark
# grime settled in every hollow (ambient occlusion), moss on the faces that look up, rain streaks running down.
# Also smooths the shading (keeping hard creases), so a faceted scan reads as carved stone.
#
#   blender --background --factory-startup --python scripts/blender/stone-texture.py -- src.glb out.glb [size]
import math
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
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

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.make_single_user(object=True, obdata=True)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.active_object
for o in [o for o in bpy.data.objects if o != obj]:
    bpy.data.objects.remove(o)
size = max(obj.dimensions)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

# a fresh UV layout to bake into
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')

m = bpy.data.materials.new('stone')
m.use_nodes = True
N = m.node_tree.nodes
L = m.node_tree.links
for n in list(N):
    N.remove(n)
out = N.new('ShaderNodeOutputMaterial')
bsdf = N.new('ShaderNodeBsdfPrincipled')
L.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
geo = N.new('ShaderNodeNewGeometry')
tc = N.new('ShaderNodeTexCoord')
s = 1.0 / size  # pattern scales with the model


def noise(scale, detail=6.0, rough=0.6):
    n = N.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale * s * 4
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    L.new(tc.outputs['Object'], n.inputs['Vector'])
    return n.outputs['Fac']


def ramp(fac, a, b, lo, hi):
    r = N.new('ShaderNodeMapRange')
    r.inputs['From Min'].default_value = lo
    r.inputs['From Max'].default_value = hi
    L.new(fac, r.inputs['Value'])
    mix = N.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    L.new(r.outputs['Result'], mix.inputs['Factor'])
    mix.inputs['A'].default_value = (*a, 1)
    mix.inputs['B'].default_value = (*b, 1)
    return mix


def blend(base, top, fac, mode='MIX'):
    mix = N.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = mode
    L.new(fac, mix.inputs['Factor'])
    L.new(base, mix.inputs['A'])
    if isinstance(top, tuple):
        mix.inputs['B'].default_value = (*top, 1)
    else:
        L.new(top, mix.inputs['B'])
    return mix.outputs['Result']


grain = noise(9.0)
stone = ramp(grain, (0.16, 0.155, 0.14), (0.3, 0.29, 0.26), 0.3, 0.7).outputs['Result']
# grime in the hollows: ambient occlusion over a reach of a tenth of the model
ao = N.new('ShaderNodeAmbientOcclusion')
ao.inputs['Distance'].default_value = size * 0.12
ao.samples = 16
aor = N.new('ShaderNodeMapRange')
aor.inputs['From Min'].default_value = 0.0
aor.inputs['From Max'].default_value = 1.0
aor.inputs['To Min'].default_value = 1.0
aor.inputs['To Max'].default_value = 0.0
L.new(ao.outputs['AO'], aor.inputs['Value'])
aop = N.new('ShaderNodeMath')
aop.operation = 'POWER'
aop.inputs[1].default_value = 0.6
L.new(aor.outputs['Result'], aop.inputs[0])
col = blend(stone, (0.035, 0.032, 0.028), aop.outputs[0])
# moss where the surface looks up, patchy
sep = N.new('ShaderNodeSeparateXYZ')
L.new(geo.outputs['Normal'], sep.inputs['Vector'])
up = N.new('ShaderNodeMapRange')
up.inputs['From Min'].default_value = 0.3
up.inputs['From Max'].default_value = 0.9
L.new(sep.outputs['Z'], up.inputs['Value'])
patch = N.new('ShaderNodeMapRange')
patch.inputs['From Min'].default_value = 0.45
patch.inputs['From Max'].default_value = 0.65
L.new(noise(5.0, 4.0), patch.inputs['Value'])
moss = N.new('ShaderNodeMath')
moss.operation = 'MULTIPLY'
L.new(up.outputs['Result'], moss.inputs[0])
L.new(patch.outputs['Result'], moss.inputs[1])
col = blend(col, (0.09, 0.12, 0.05), moss.outputs[0])
# rain streaks: long, thin, vertical
streak_vec = N.new('ShaderNodeMapping')
streak_vec.inputs['Scale'].default_value = (14 * s * 4, 14 * s * 4, 0.6 * s * 4)
L.new(tc.outputs['Object'], streak_vec.inputs['Vector'])
streak = N.new('ShaderNodeTexNoise')
streak.inputs['Detail'].default_value = 3
L.new(streak_vec.outputs['Vector'], streak.inputs['Vector'])
sr = N.new('ShaderNodeMapRange')
sr.inputs['From Min'].default_value = 0.55
sr.inputs['From Max'].default_value = 0.75
sr.inputs['To Max'].default_value = 0.35
L.new(streak.outputs['Fac'], sr.inputs['Value'])
col = blend(col, (0.1, 0.095, 0.085), sr.outputs['Result'])
L.new(col, bsdf.inputs['Base Color'])
# pitted, rough
bump = N.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.6
bump.inputs['Distance'].default_value = size * 0.004
L.new(noise(30.0, 8.0, 0.7), bump.inputs['Height'])
L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
rough = N.new('ShaderNodeMath')
rough.operation = 'ADD'
rough.inputs[1].default_value = 0.0
L.new(moss.outputs[0], rough.inputs[0])
rr = N.new('ShaderNodeMapRange')
rr.inputs['To Min'].default_value = 0.82
rr.inputs['To Max'].default_value = 0.95
L.new(rough.outputs[0], rr.inputs['Value'])
L.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
obj.data.materials.clear()
obj.data.materials.append(m)

target = N.new('ShaderNodeTexImage')
N.active = target
obj.select_set(True)
bpy.context.view_layer.objects.active = obj


def bake(name, kind, colour, samples, **kw):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    target.image = img
    scene.cycles.samples = samples
    bpy.ops.object.bake(type=kind, margin=8, use_clear=True, **kw)
    return img


em = N.new('ShaderNodeEmission')
L.new(col, em.inputs['Color'])
L.new(em.outputs['Emission'], out.inputs['Surface'])
c_img = bake('stone_col', 'EMIT', True, 32)
L.new(rr.outputs['Result'], em.inputs['Color'])
r_img = bake('stone_rough', 'EMIT', False, 4)
L.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
n_img = bake('stone_nor', 'NORMAL', False, 4, normal_space='TANGENT')

# the final, plain material the game reads
for n in list(N):
    N.remove(n)
out = N.new('ShaderNodeOutputMaterial')
bsdf = N.new('ShaderNodeBsdfPrincipled')
L.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
tcol = N.new('ShaderNodeTexImage')
tcol.image = c_img
L.new(tcol.outputs['Color'], bsdf.inputs['Base Color'])
trou = N.new('ShaderNodeTexImage')
trou.image = r_img
sep2 = N.new('ShaderNodeSeparateColor')
L.new(trou.outputs['Color'], sep2.inputs['Color'])
L.new(sep2.outputs['Green'], bsdf.inputs['Roughness'])
tnor = N.new('ShaderNodeTexImage')
tnor.image = n_img
nm = N.new('ShaderNodeNormalMap')
L.new(tnor.outputs['Color'], nm.inputs['Color'])
L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
for img in (c_img, r_img, n_img):
    img.pack()
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True)
print(f'STONE {OUT} {len(obj.data.polygons)} faces')
