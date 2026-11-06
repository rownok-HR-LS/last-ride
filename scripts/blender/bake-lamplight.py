# Bake the park's lamp light in Blender (Cycles): every working street lamp and the fire in the big top, with the
# light they bounce off walls and ground, and the shadows of everything standing in the way.
#
#   blender --background --factory-startup --python scripts/blender/bake-lamplight.py -- occluders.glb lamps.json outdir [samples] [ground px]
#
# Writes two images and a scale (outdir/lamplight.json), which scripts/pack-lamplight.mjs turns into game textures:
#   ground_light.png  2048 x 2048 top-down: the light on the ground (u = (x + 120) / 240, v = (120 - z) / 240)
#   light_volume.png  the light in the air above the park, a 1 m grid 240 x 240 at 9 heights (0.5 m, 2 m ... 12.5 m),
#                     for each of six directions, so a wall facing a lamp is lit and its back is not:
#                     9 slices across (x), 6 directions down (+x, -x, +y, -y, +z, -z), each slice 240 x 240.
# Values are stored as sqrt(light / scale) so dim light keeps its steps; the game squares them back.
import json
import math
import sys
import time

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
OCC, LAMPS, OUT = args[0], args[1], args[2]
HALF = 120.0
GRID = 240
HEIGHTS = [0.5 + 1.5 * k for k in range(9)]
# game directions (x right, y up, z towards the gate) and the same in Blender (z up, game z = -Blender y)
DIRS = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
LAMP_POWER = 900.0
FIRE_POWER = 3500.0
SAMPLES = int(args[3]) if len(args) > 3 else 48
GROUND_PX = int(args[4]) if len(args) > 4 else 1536
ONLY = args[5] if len(args) > 5 else 'all'  # 'ground' to time the ground alone


def b(v):
    """Game coordinates to Blender's."""
    return (v[0], -v[2], v[1])


t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=OCC)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    scene.cycles.device = 'GPU'
except Exception as e:
    print('LIGHT cpu', e)
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 3
# no sky: only what the lamps give
world = bpy.data.worlds.new('dark')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
scene.world = world


def grey(name, v):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (v, v, v, 1)
    p.inputs['Roughness'].default_value = 0.9
    return m


def plane(name, size, z):
    """A square sheet (built from data: operators crawl in a scene of twenty thousand objects)."""
    h = size / 2
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-h, -h, z), (h, -h, z), (h, h, z), (-h, h, z)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    for loop, c in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop.uv = c
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def point(at, energy, colour, radius):
    li = bpy.data.lights.new('lamp', 'POINT')
    li.energy = energy
    li.color = colour
    li.shadow_soft_size = radius
    o = bpy.data.objects.new('lamp', li)
    o.location = at
    scene.collection.objects.link(o)


print(f'LIGHT imported in {time.time() - t0:.1f}s', flush=True)
# the occluders all share the exporter's one grey material: make it a dark wall grey (touching twenty thousand
# objects one by one instead takes Blender many minutes)
for m in list(bpy.data.materials):
    p = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
    if p:
        p.inputs['Base Color'].default_value = (0.28, 0.28, 0.28, 1)
        p.inputs['Roughness'].default_value = 0.9
print(f'LIGHT {len(bpy.data.objects)} objects ready in {time.time() - t0:.1f}s', flush=True)
# the ground, for light to bounce off
plane('ground', 2 * HALF + 40, 0.0).data.materials.append(grey('ground', 0.2))

lamps = json.load(open(LAMPS))
n = 0
for l in lamps:
    if l['kind'] == 'dead':
        continue
    # just under the scanned lamp's housing (inside it, the housing swallows all of the light)
    point(b((l['x'], l['y'] - 0.5, l['z'])), LAMP_POWER, (1.0, 0.55, 0.26), 0.25)  # sodium
    n += 1
point(b((0, 13, 0)), FIRE_POWER, (1.0, 0.3, 0.08), 1.5)
print(f'LIGHT {n} lamps and the fire, {SAMPLES} samples', flush=True)


def target(obj, img):
    m = bpy.data.materials.new('bake_' + img.name)
    m.use_nodes = True
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    m.node_tree.nodes.active = t
    obj.data.materials.clear()
    obj.data.materials.append(m)
    # a bake target stands in nobody's light (camera visibility stays on: with every ray type off, Cycles drops
    # the object and bakes nothing)
    for flag in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_shadow', 'visible_volume_scatter'):
        setattr(obj, flag, False)


def bake(obj):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.cycles.samples = SAMPLES
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=2, use_clear=True)


def read(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    # Blender's rows run bottom-up; return top-down
    return a.reshape(h, w, 4)[::-1, :, :3].copy()


# --- the ground: a sheet just above it -----------------------------------------------------------------------------
t1 = time.time()
sheet = plane('sheet', 2 * HALF, 0.03)
gimg = bpy.data.images.new('ground_light', GROUND_PX, GROUND_PX, float_buffer=True)
target(sheet, gimg)
bake(sheet)
ground = read(gimg)
print(f'LIGHT ground baked in {time.time() - t1:.1f}s', flush=True)
if ONLY == 'ground':
    sys.exit(0)


# --- the air: for each direction, one small card per grid point and height, facing that way ------------------------
def cards(d):
    """One object: a 0.16 m card at every grid point and height facing game direction d, each mapped to its texel."""
    dx, dy, dz = b(d)
    nrm = np.array([dx, dy, dz], dtype=np.float64)
    a = np.array([0.0, 0.0, 1.0]) if abs(nrm[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    t1 = np.cross(a, nrm)
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(nrm, t1)
    s = 0.08
    xs = -HALF + (np.arange(GRID) + 0.5) * (2 * HALF / GRID)
    zs = -HALF + (np.arange(GRID) + 0.5) * (2 * HALF / GRID)
    W = GRID * len(HEIGHTS)
    H = GRID
    cos = []
    uvs = []
    for k, y in enumerate(HEIGHTS):
        X, Z = np.meshgrid(xs, zs)  # rows: z, columns: x
        P = np.stack([X.ravel(), -Z.ravel(), np.full(X.size, y)], axis=1)  # Blender coordinates
        corners = [P - t1 * s - t2 * s, P + t1 * s - t2 * s, P + t1 * s + t2 * s, P - t1 * s + t2 * s]
        cos.append(np.stack(corners, axis=1))
        # texel: column k * GRID + i, row j counted from the top (Blender v counts from the bottom)
        I, J = np.meshgrid(np.arange(GRID), np.arange(GRID))
        u0 = (k * GRID + I.ravel() + 0.1) / W
        u1 = (k * GRID + I.ravel() + 0.9) / W
        v0 = (H - 1 - J.ravel() + 0.1) / H
        v1 = (H - 1 - J.ravel() + 0.9) / H
        uvs.append(np.stack([np.stack([u0, v0], 1), np.stack([u1, v0], 1), np.stack([u1, v1], 1), np.stack([u0, v1], 1)], axis=1))
    co = np.concatenate(cos).reshape(-1, 3)
    uv = np.concatenate(uvs).reshape(-1, 2)
    nq = co.shape[0] // 4
    me = bpy.data.meshes.new('cards')
    me.vertices.add(co.shape[0])
    me.vertices.foreach_set('co', co.astype(np.float32).ravel())
    me.loops.add(co.shape[0])
    me.loops.foreach_set('vertex_index', np.arange(co.shape[0], dtype=np.int32))
    me.polygons.add(nq)
    me.polygons.foreach_set('loop_start', np.arange(0, co.shape[0], 4, dtype=np.int32))
    me.update(calc_edges=True)
    layer = me.uv_layers.new(name='UVMap')
    layer.data.foreach_set('uv', uv.astype(np.float32).ravel())
    o = bpy.data.objects.new('cards', me)
    scene.collection.objects.link(o)
    return o, W, H


volume = []
for d in DIRS:
    t1 = time.time()
    o, W, H = cards(d)
    img = bpy.data.images.new('vol', W, H, float_buffer=True)
    target(o, img)
    bake(o)
    volume.append(read(img))
    bpy.data.objects.remove(o)
    print(f'LIGHT direction {d} baked in {time.time() - t1:.1f}s', flush=True)
vol = np.concatenate(volume, axis=0)  # 6 * 240 rows

# one scale for both, so ground and air agree: what the brightest light near a lamp reaches
lit = np.concatenate([ground.max(axis=2).ravel(), vol.max(axis=2).ravel()])
print(f'LIGHT ground max {ground.max():.3f} mean {ground.mean():.4f}, air max {vol.max():.3f} mean {vol.mean():.4f}, lit share {(lit > 1e-4).mean():.3f}', flush=True)
scale = float(np.percentile(lit[lit > 1e-4], 99.5)) if (lit > 1e-4).any() else 1.0


def save(a, name):
    enc = np.sqrt(np.clip(a / scale, 0, 1))
    h, w, _ = enc.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = enc
    img.pixels.foreach_set(px[::-1].ravel())
    img.filepath_raw = f'{OUT}/{name}.png'
    img.file_format = 'PNG'
    img.save()


save(ground, 'ground_light')
save(vol, 'light_volume')
json.dump({'scale': scale, 'grid': GRID, 'half': HALF, 'heights': HEIGHTS, 'lamps': n}, open(f'{OUT}/lamplight.json', 'w'))
print(f'LIGHT done in {time.time() - t0:.1f}s, scale {scale:.3f}')
