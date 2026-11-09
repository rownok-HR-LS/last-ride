# The far horizon beyond the park's woods, rendered in Blender as a 360-degree strip: ranges of hills going blue in
# the night haze, a small town up on a hillside with its windows and street lights still burning and a glow above
# it, and a radio mast with a red warning light. Seen from the middle of the park (eye 2 m up); src/world.js wraps it
# round the park on a band of a sphere, where the mast's light blinks.
#
#   blender --background --factory-startup --python scripts/blender/render-horizon.py -- out.png [width]
#
# Equirectangular, latitude LAT_MIN..LAT_MAX, transparent above the land. Blender is Z-up: game x = Blender X,
# game z = Blender -Y. MARKS (printed) gives where the mast's light lands, in game directions.
import math
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
WIDTH = int(args[1]) if len(args) > 1 else 8192
LAT_MIN, LAT_MAX = -3.0, 18.0
EYE = 2.0

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = 'GPU'
except Exception:
    pass
sc.cycles.samples = 32
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = WIDTH
sc.render.resolution_y = round(WIDTH * (LAT_MAX - LAT_MIN) / 360)
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.world = bpy.data.worlds.new('w')
sc.world.color = (0, 0, 0)


def emit_mat(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    out = t.nodes.new('ShaderNodeOutputMaterial')
    em = t.nodes.new('ShaderNodeEmission')
    build(t, em)
    t.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def haze_land(t, em):
    """Land coloured by how far away it is: near ridges nearly black, far ones a pale night blue."""
    cam = t.nodes.new('ShaderNodeCameraData')
    div = t.nodes.new('ShaderNodeMath')
    div.operation = 'DIVIDE'
    div.inputs[1].default_value = 9000.0
    t.links.new(cam.outputs['View Distance'], div.inputs[0])
    ramp = t.nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position = 0.12
    els[0].color = (0.006, 0.008, 0.012, 1)
    els[1].position = 0.9
    els[1].color = (0.035, 0.045, 0.07, 1)
    t.links.new(div.outputs[0], ramp.inputs['Fac'])
    # a little moonlight on the slopes that face it
    geo = t.nodes.new('ShaderNodeNewGeometry')
    dot = t.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = (0.3, -0.5, 0.8)
    t.links.new(geo.outputs['Normal'], dot.inputs[0])
    mul = t.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY_ADD'
    mul.inputs[1].default_value = 0.6
    mul.inputs[2].default_value = 0.55
    t.links.new(dot.outputs['Value'], mul.inputs[0])
    t.links.new(ramp.outputs['Color'], em.inputs['Color'])
    t.links.new(mul.outputs[0], em.inputs['Strength'])


def height(x, y):
    """Ground height: flat under the park and its woods, rising to ranges of hills further out."""
    d = math.hypot(x, y)
    rise = max(0.0, min(1.0, (d - 1100) / 4000))
    v = Vector((x / 4200, y / 4200, 0.3))
    ridge = noise.fractal(v, 0.45, 2.0, 4, noise_basis='PERLIN_ORIGINAL')
    big = noise.noise(Vector((x / 9000, y / 9000, 1.7)))
    return (300 + 1000 * rise * rise) * (0.55 + 0.45 * ridge + 0.5 * big) * rise


# the land: one big grid, displaced
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=420, y_segments=420, size=12000)
for v in bm.verts:
    v.co.z = height(v.co.x, v.co.y)
me = bpy.data.meshes.new('land')
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
land = bpy.data.objects.new('land', me)
sc.collection.objects.link(land)
me.materials.append(emit_mat('land', haze_land))

random.seed(7)
# the town: a hillside to the north-east (game +x, -z), houses with lit windows and a church spire
TOWN_A = math.radians(35)            # angle from game +x toward game -z
TOWN_D = 4200
tx, ty = math.cos(TOWN_A) * TOWN_D, math.sin(TOWN_A) * TOWN_D   # Blender: game -z is +Y
house = emit_mat('house', lambda t, em: (setattr(em.inputs['Color'], 'default_value', (0.01, 0.011, 0.016, 1)), setattr(em.inputs['Strength'], 'default_value', 1.0)))
window = emit_mat('window', lambda t, em: (setattr(em.inputs['Color'], 'default_value', (1.0, 0.62, 0.28, 1)), setattr(em.inputs['Strength'], 'default_value', 14.0)))
street = emit_mat('street', lambda t, em: (setattr(em.inputs['Color'], 'default_value', (1.0, 0.45, 0.12, 1)), setattr(em.inputs['Strength'], 'default_value', 30.0)))
red = emit_mat('red', lambda t, em: (setattr(em.inputs['Color'], 'default_value', (1.0, 0.05, 0.03, 1)), setattr(em.inputs['Strength'], 'default_value', 60.0)))


def cube(mat, at, size):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    o = bpy.context.object
    o.scale = size
    o.data.materials.append(mat)
    return o


for k in range(110):
    a = TOWN_A + random.gauss(0, 0.045)
    d = TOWN_D + random.gauss(0, 260)
    x, y = math.cos(a) * d, math.sin(a) * d
    z = height(x, y)
    w = random.uniform(8, 18)
    h = random.uniform(6, 14)
    cube(house, (x, y, z + h / 2), (w, w, h))
    if random.random() < 0.55:
        # a lit window or two, facing the park
        n = Vector((-x, -y, 0)).normalized()
        for _ in range(random.randint(1, 2)):
            cube(window, (x + n.x * (w / 2 + 0.3), y + n.y * (w / 2 + 0.3), z + random.uniform(2, h - 2)), (3.5, 3.5, 2.5))
# street lights strung along a road winding up through the town
for k in range(40):
    u = k / 39
    a = TOWN_A - 0.09 + u * 0.18
    d = TOWN_D - 300 + u * 500 + 120 * math.sin(u * 9)
    x, y = math.cos(a) * d, math.sin(a) * d
    cube(street, (x, y, height(x, y) + 8), (4, 4, 4))
# the church spire
sx, sy = math.cos(TOWN_A + 0.01) * (TOWN_D + 80), math.sin(TOWN_A + 0.01) * (TOWN_D + 80)
sz = height(sx, sy)
cube(house, (sx, sy, sz + 20), (14, 14, 40))
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=10, depth=40, location=(sx, sy, sz + 60))
bpy.context.object.data.materials.append(house)
# the town's glow on the haze above it: a soft card facing the park
glow = bpy.data.materials.new('glow')
glow.use_nodes = True
gt = glow.node_tree
gt.nodes.clear()
go = gt.nodes.new('ShaderNodeOutputMaterial')
gem = gt.nodes.new('ShaderNodeEmission')
gem.inputs['Color'].default_value = (1.0, 0.42, 0.14, 1)
gem.inputs['Strength'].default_value = 0.14
gtr = gt.nodes.new('ShaderNodeBsdfTransparent')
gmix = gt.nodes.new('ShaderNodeMixShader')
gtc = gt.nodes.new('ShaderNodeTexCoord')
ggrad = gt.nodes.new('ShaderNodeTexGradient')
ggrad.gradient_type = 'SPHERICAL'
gmap = gt.nodes.new('ShaderNodeMapping')
gmap.inputs['Location'].default_value = (0.5, 0.5, 0)
gmap.inputs['Scale'].default_value = (2.0, 2.0, 1)
gsub = gt.nodes.new('ShaderNodeVectorMath')
gsub.operation = 'SUBTRACT'
gsub.inputs[1].default_value = (0.5, 0.5, 0.5)
gt.links.new(gtc.outputs['Generated'], gsub.inputs[0])
gscale = gt.nodes.new('ShaderNodeVectorMath')
gscale.operation = 'MULTIPLY'
gscale.inputs[1].default_value = (2.0, 2.0, 0.0)
gt.links.new(gsub.outputs[0], gscale.inputs[0])
gt.links.new(gscale.outputs[0], ggrad.inputs['Vector'])
gpow = gt.nodes.new('ShaderNodeMath')
gpow.operation = 'POWER'
gpow.inputs[1].default_value = 2.2
gt.links.new(ggrad.outputs['Fac'], gpow.inputs[0])
gt.links.new(gpow.outputs[0], gmix.inputs[0])
gt.links.new(gtr.outputs[0], gmix.inputs[1])
gt.links.new(gem.outputs[0], gmix.inputs[2])
gt.links.new(gmix.outputs[0], go.inputs['Surface'])
gz = height(tx, ty)
bpy.ops.mesh.primitive_plane_add(size=1, location=(tx * 0.98, ty * 0.98, gz + 150))
card = bpy.context.object
card.scale = (1500, 420, 1)
card.rotation_euler = (math.pi / 2, 0, TOWN_A + math.pi / 2)
card.data.materials.append(glow)

# the radio mast: off to the south-west on a ridge, with its warning light
MAST_A = math.radians(200)
MAST_D = 3000
mx, my = math.cos(MAST_A) * MAST_D, math.sin(MAST_A) * MAST_D
mz = height(mx, my)
mast = emit_mat('mast', lambda t, em: (setattr(em.inputs['Color'], 'default_value', (0.008, 0.009, 0.012, 1)), setattr(em.inputs['Strength'], 'default_value', 1.0)))
cube(mast, (mx, my, mz + 120), (3, 3, 240))
for z in (80, 160, 230):
    cube(mast, (mx, my, mz + z), (10, 1.2, 1.2))
cube(red, (mx, my, mz + 244), (7, 7, 7))
top = Vector((mx, my, mz + 244))
d = top - Vector((0, 0, EYE))
az_game = math.degrees(math.atan2(-my, mx))  # angle in the game's x-z plane, from +x toward +z
el = math.degrees(math.atan2(d.z, math.hypot(d.x, d.y)))
print(f'MARKS mast light: game direction ({mx / MAST_D:.4f}, {-my / MAST_D:.4f}) azimuth {az_game:.2f} deg, elevation {el:.3f} deg', flush=True)
tz = height(tx, ty)
print(f'MARKS town: game direction ({math.cos(TOWN_A):.4f}, {-math.sin(TOWN_A):.4f}) elevation {math.degrees(math.atan2(tz - EYE, TOWN_D)):.3f} deg', flush=True)

# the camera: equirectangular, level, in the middle of the park; its centre column looks along game -x
cam = bpy.data.cameras.new('cam')
cam.type = 'PANO'
cam.panorama_type = 'EQUIRECTANGULAR'
cam.latitude_min = math.radians(LAT_MIN)
cam.latitude_max = math.radians(LAT_MAX)
cam.longitude_min = -math.pi
cam.longitude_max = math.pi
cam.clip_end = 20000
co = bpy.data.objects.new('cam', cam)
co.location = (0, 0, EYE)
co.rotation_euler = (math.pi / 2, 0, math.pi / 2)
sc.collection.objects.link(co)
sc.camera = co
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f'HORIZON {OUT} {sc.render.resolution_x} x {sc.render.resolution_y}', flush=True)
