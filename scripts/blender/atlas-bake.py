# Bake a model's many materials into one atlas in Blender: base colour (with soft ambient occlusion baked in, so
# creases, undersides and corners stay dark under any light), a normal map and roughness / metalness. One material
# and three textures instead of a dozen or more: a smaller download and fewer draw calls. See-through and cut-out
# materials (glass, leaves, hair) are kept as they are.
#
#   blender --background --factory-startup --python scripts/blender/atlas-bake.py -- src.glb out.glb [size] [ao]
#
# size: atlas pixels (default 1024). ao: how much of the occlusion goes into the colour, 0..1 (default 0.65).
# The output still has the source's detail; scripts/convert-env.mjs simplifies and compresses it for the game.
import math
import sys
import time

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 1024
AO = float(args[3]) if len(args) > 3 else 0.65

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = 'GPU'
                break
        except TypeError:
            continue
except Exception as e:
    print('ATLAS cpu', e)


def principled(mat):
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    return None


def see_through(mat):
    """Glass, hair cards, leaves: anything with alpha. These keep their own material."""
    p = principled(mat)
    if p is None:
        return True
    a = p.inputs['Alpha']
    if a.is_linked or a.default_value < 0.999:
        return True
    if p.inputs.get('Transmission Weight') and p.inputs['Transmission Weight'].default_value > 0.01:
        return True
    return getattr(mat, 'surface_render_method', 'DITHERED') == 'BLENDED' and a.is_linked


# --- one mesh in world space ----------------------------------------------------------------------------------------
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    o.hide_set(False)
    o.select_set(False)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.make_single_user(object=True, obdata=True)
# drop the importer's parent nodes but keep where everything is
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
body = bpy.context.active_object
body.name = 'baked'
for o in [o for o in bpy.data.objects if o != body]:
    bpy.data.objects.remove(o)

# see-through faces go to a separate object that keeps its materials
keep = None
clear_slots = [i for i, s in enumerate(body.material_slots) if see_through(s.material)]
if clear_slots:
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in body.data.polygons:
        p.select = p.material_index in clear_slots
    if any(p.select for p in body.data.polygons):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        keep = [o for o in bpy.context.selected_objects if o != body][0]
        keep.name = 'clear'
print(f'ATLAS {len(body.data.polygons)} faces to bake, {len(keep.data.polygons) if keep else 0} see-through kept, '
      f'{len(body.material_slots)} materials')

# --- a fresh UV layout for the atlas --------------------------------------------------------------------------------
uvs = body.data.uv_layers
if not len(uvs):
    uvs.new(name='UVMap')
render_uv = uvs[0]
render_uv.active_render = True
atlas_uv = uvs.new(name='atlas')
uvs.active = atlas_uv
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True)
bpy.ops.object.mode_set(mode='OBJECT')


# --- baking: every material gets an (unconnected) target image node --------------------------------------------------
def image(name, colour):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


targets = []
for s in body.material_slots:
    m = s.material
    if m is None:
        continue
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    m.node_tree.nodes.active = n
    targets.append((m, n))


def aim(img):
    for _, n in targets:
        n.image = img


def bake(kind, img, samples=1, **kw):
    aim(img)
    scene.cycles.samples = samples
    bpy.ops.object.bake(type=kind, margin=6, use_clear=True, **kw)


def through_emission(socket_name, img):
    """Bake one input of the surface as it is (texture, vertex colour, or value) by sending it to an emission."""
    undo = []
    for m, _ in targets:
        nt = m.node_tree
        p = principled(m)
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None) \
            or next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if p is None or out is None:
            continue
        e = nt.nodes.new('ShaderNodeEmission')
        src = p.inputs[socket_name]
        if src.is_linked:
            nt.links.new(src.links[0].from_socket, e.inputs['Color'])
        else:
            v = src.default_value
            e.inputs['Color'].default_value = (v[0], v[1], v[2], 1) if hasattr(v, '__len__') else (v, v, v, 1)
        old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
        nt.links.new(e.outputs['Emission'], out.inputs['Surface'])
        undo.append((nt, e, out, old))
    # several samples a texel: a finely repeating texture (planks, rivets) would alias into stripes with one
    bake('EMIT', img, samples=8)
    for nt, e, out, old in undo:
        nt.nodes.remove(e)
        if old is not None:
            nt.links.new(old, out.inputs['Surface'])


def pixels(img):
    a = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(SIZE, SIZE, 4)


t1 = time.time()
col = image('atlas_color', True)
through_emission('Base Color', col)
rough = image('atlas_rough', False)
through_emission('Roughness', rough)
metal = image('atlas_metal', False)
through_emission('Metallic', metal)
nrm = image('atlas_normal', False)
bake('NORMAL', nrm, normal_space='TANGENT')
# occlusion reaches about a tenth of the model's size: a crate's slats, a shed's eaves
dims = body.dimensions
world = bpy.data.worlds.new('w')
scene.world = world
world.light_settings.distance = max(0.15, min(2.5, max(dims) * 0.1))
ao = image('atlas_ao', False)
if AO > 0:
    bake('AO', ao, samples=96)
print(f'ATLAS baked {SIZE}px in {time.time() - t1:.1f}s (ao reach {world.light_settings.distance:.2f} m)')

# colour x occlusion; roughness and metalness packed the glTF way (G and B)
c = pixels(col)
o = pixels(ao)[..., :1]
if AO > 0:
    c[..., :3] *= 1.0 - AO + AO * o
col.pixels.foreach_set(c.ravel())
orm = image('atlas_orm', False)
r = pixels(rough)
mt = pixels(metal)
p = np.ones((SIZE, SIZE, 4), dtype=np.float32)
p[..., 1] = r[..., 0]
p[..., 2] = mt[..., 0]
orm.pixels.foreach_set(p.ravel())

# --- the one material ------------------------------------------------------------------------------------------------
mat = bpy.data.materials.new('atlas')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes.get('Principled BSDF')
tc = nt.nodes.new('ShaderNodeTexImage')
tc.image = col
nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
to = nt.nodes.new('ShaderNodeTexImage')
to.image = orm
sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(to.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
tn = nt.nodes.new('ShaderNodeTexImage')
tn.image = nrm
nm = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
body.data.materials.clear()
body.data.materials.append(mat)
for poly in body.data.polygons:
    poly.material_index = 0
for layer in [l for l in uvs if l.name != 'atlas']:
    uvs.remove(layer)
uvs['atlas'].name = 'UVMap'
for img in (col, orm, nrm):
    img.pack()

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
if keep:
    keep.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
print(f'ATLAS done in {time.time() - t0:.1f}s -> {OUT}')
