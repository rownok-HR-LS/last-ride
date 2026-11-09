# The park's grime as decals, made in Blender: oil stains, cracks, mud, tyre tracks, a drain cover, spray-painted
# graffiti, torn posters, a stencilled EXIT, litter and a dark drag stain. Each is drawn on a 1 x 1 m card with
# procedural shaders (and text for the graffiti and posters) and rendered from straight above with a transparent
# background; scripts/pack-decals.mjs puts the 16 tiles into one 4 x 4 sheet (public/tex/decals.webp) for src/decals.js.
#
#   blender --background --factory-startup --python scripts/blender/make-decals.py -- outdir [px]
#
# Tile order (row by row): 0-1 oil, 2-3 cracks, 4-5 mud, 6 tyre tracks (repeats along its length), 7 drain cover,
# 8-10 graffiti, 11-12 posters, 13 EXIT stencil, 14 litter, 15 drag stain.
import math
import os
import random
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
PX = int(args[1]) if len(args) > 1 else 512
os.makedirs(OUT, exist_ok=True)


def reset():
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
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.resolution_x = sc.render.resolution_y = PX
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = 1.0
    o = bpy.data.objects.new('cam', cam)
    o.location = (0, 0, 2)
    sc.collection.objects.link(o)
    sc.camera = o
    return sc


class N:
    """A small helper for building one material's node tree."""

    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.t = self.m.node_tree
        self.t.nodes.clear()
        self.out = self.t.nodes.new('ShaderNodeOutputMaterial')
        tc = self.t.nodes.new('ShaderNodeTexCoord')
        # the card's own 0..1 square, flattened (a flat card's generated depth isn't zero)
        sep = self.t.nodes.new('ShaderNodeSeparateXYZ')
        self.t.links.new(tc.outputs['Generated'], sep.inputs[0])
        comb = self.t.nodes.new('ShaderNodeCombineXYZ')
        self.t.links.new(sep.outputs['X'], comb.inputs['X'])
        self.t.links.new(sep.outputs['Y'], comb.inputs['Y'])
        self.uv = comb.outputs[0]

    def node(self, kind, **inputs):
        n = self.t.nodes.new(kind)
        for k, v in inputs.items():
            if hasattr(v, 'is_output'):
                self.t.links.new(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        return n

    def math(self, op, a, b=0.0, clamp=False):
        n = self.t.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if hasattr(v, 'is_output'):
                self.t.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def vmath(self, op, a, b=(0, 0, 0)):
        n = self.t.nodes.new('ShaderNodeVectorMath')
        n.operation = op
        for i, v in enumerate((a, b)):
            if hasattr(v, 'is_output'):
                self.t.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs['Value'] if op in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else n.outputs['Vector']

    def noise(self, vec, scale, detail=6.0, w=0.0, rough=0.55):
        n = self.t.nodes.new('ShaderNodeTexNoise')
        n.noise_dimensions = '4D'
        self.t.links.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['W'].default_value = w
        n.inputs['Roughness'].default_value = rough
        return n.outputs['Fac']

    def ramp(self, fac, stops):
        n = self.t.nodes.new('ShaderNodeValToRGB')
        self.t.links.new(fac, n.inputs['Fac'])
        els = n.color_ramp.elements
        while len(els) > len(stops):
            els.remove(els[-1])
        while len(els) < len(stops):
            els.new(0.5)
        for e, (pos, val) in zip(els, stops):
            e.position = pos
            e.color = (val, val, val, 1) if not isinstance(val, tuple) else (*val, 1)
        return n.outputs['Color']

    def mixcol(self, fac, a, b):
        n = self.t.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        for key, v in (('Factor', fac), ('A', a), ('B', b)):
            sock = n.inputs[key] if key == 'Factor' else n.inputs[6 if key == 'A' else 7]
            if hasattr(v, 'is_output'):
                self.t.links.new(v, sock)
            else:
                sock.default_value = v if key == 'Factor' else (*v, 1)
        return n.outputs[2]

    def finish(self, color, alpha):
        em = self.node('ShaderNodeEmission', Strength=1.0)
        if hasattr(color, 'is_output'):
            self.t.links.new(color, em.inputs['Color'])
        else:
            em.inputs['Color'].default_value = (*color, 1)
        tr = self.t.nodes.new('ShaderNodeBsdfTransparent')
        mix = self.t.nodes.new('ShaderNodeMixShader')
        if hasattr(alpha, 'is_output'):
            self.t.links.new(alpha, mix.inputs[0])
        else:
            mix.inputs[0].default_value = alpha
        self.t.links.new(tr.outputs[0], mix.inputs[1])
        self.t.links.new(em.outputs[0], mix.inputs[2])
        self.t.links.new(mix.outputs[0], self.out.inputs['Surface'])
        return self.m


def card(sc, mat, size=(1, 1), at=(0, 0, 0), rot=0.0):
    me = bpy.data.meshes.new('card')
    w, h = size
    me.from_pydata([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new('card', me)
    o.location = at
    o.rotation_euler = (0, 0, rot)
    me.materials.append(mat)
    sc.collection.objects.link(o)
    return o


def flat(name, color, alpha=1.0):
    n = N(name)
    return n.finish(color, alpha)


def text(sc, body, mat, size, at=(0, 0, 0.01), rot=0.0, bold=0.0, spacing=1.0):
    cu = bpy.data.curves.new('t', 'FONT')
    cu.body = body
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = size
    cu.offset = bold
    cu.space_character = spacing
    o = bpy.data.objects.new('t', cu)
    o.location = at
    o.rotation_euler = (0, 0, rot)
    cu.materials.append(mat)
    sc.collection.objects.link(o)
    return o


def render(sc, i):
    sc.render.filepath = f'{OUT}/tile_{i:02d}.png'
    bpy.ops.render.render(write_still=True)
    print(f'DECAL tile {i}', flush=True)


# ------------------------------------------------------------------ the procedural ones

def blotch(i, color, edge=0.42, warp=0.28, mottle=10.0, seed=0.0, stretch=(1.0, 1.0), inner=0.9, dark=None):
    """A soft irregular stain: radial falloff warped by noise, mottled."""
    sc = reset()
    n = N('blotch')
    p = n.vmath('SUBTRACT', n.uv, (0.5, 0.5, 0.0))
    p = n.vmath('MULTIPLY', p, (1.0 / stretch[0], 1.0 / stretch[1], 1.0))
    d = n.vmath('LENGTH', p)
    w = n.noise(n.uv, 3.0, 8.0, seed)
    d = n.math('ADD', d, n.math('MULTIPLY', n.math('SUBTRACT', w, 0.5), warp))
    a = n.ramp(d, [(0.0, inner), (edge * 0.7, inner * 0.85), (edge, 0.0)])
    m = n.ramp(n.noise(n.uv, mottle, 4.0, seed + 3.0), [(0.3, 0.45), (0.65, 1.0)])
    alpha = n.math('MULTIPLY', a, m, clamp=True)
    col = color if dark is None else n.mixcol(n.noise(n.uv, mottle * 0.6, 3.0, seed + 7.0), dark, color)
    card(sc, n.finish(col, alpha))
    render(sc, i)


def cracks(i, scale, seed):
    sc = reset()
    n = N('crack')
    warp = n.vmath('ADD', n.uv, n.vmath('MULTIPLY', n.vmath('SUBTRACT', n.node('ShaderNodeTexNoise', Vector=n.uv, Scale=4.0, Detail=6.0).outputs['Color'], (0.5, 0.5, 0.5)), (0.12, 0.12, 0.0)))
    v = n.t.nodes.new('ShaderNodeTexVoronoi')
    v.feature = 'DISTANCE_TO_EDGE'
    n.t.links.new(warp, v.inputs['Vector'])
    v.inputs['Scale'].default_value = scale
    v.inputs['Randomness'].default_value = 1.0
    line = n.ramp(v.outputs['Distance'], [(0.0, 1.0), (0.025, 0.6), (0.05, 0.0)])
    d = n.vmath('LENGTH', n.vmath('SUBTRACT', n.uv, (0.5, 0.5, 0.0)))
    d = n.math('ADD', d, n.math('MULTIPLY', n.math('SUBTRACT', n.noise(n.uv, 2.5, 4.0, seed), 0.5), 0.35))
    fade = n.ramp(d, [(0.0, 1.0), (0.25, 0.9), (0.45, 0.0)])
    alpha = n.math('MULTIPLY', line, fade, clamp=True)
    card(sc, n.finish((0.008, 0.007, 0.006), alpha))
    render(sc, i)


def tyres(i):
    sc = reset()
    n = N('tyre')
    sep = n.node('ShaderNodeSeparateXYZ', Vector=n.uv)
    x, y = sep.outputs['X'], sep.outputs['Y']
    # two tread strips either side of the middle
    s = n.math('ABSOLUTE', n.math('SUBTRACT', n.math('ABSOLUTE', n.math('SUBTRACT', x, 0.5)), 0.24))
    strip = n.math('LESS_THAN', s, 0.085)
    # chevron tread blocks, a whole number of them along the card so it repeats cleanly
    tread = n.math('SINE', n.math('MULTIPLY', n.math('ADD', y, n.math('MULTIPLY', s, 1.2)), 2 * math.pi * 12))
    tread = n.ramp(tread, [(0.35, 0.35), (0.6, 1.0)])
    fade = n.ramp(n.noise(n.uv, 3.0, 4.0, 2.0), [(0.25, 0.3), (0.6, 1.0)])
    alpha = n.math('MULTIPLY', n.math('MULTIPLY', strip, tread), n.math('MULTIPLY', fade, 0.8), clamp=True)
    card(sc, n.finish((0.035, 0.024, 0.014), alpha))
    render(sc, i)


def drain(i):
    sc = reset()
    n = N('drain')
    d = n.vmath('LENGTH', n.vmath('SUBTRACT', n.uv, (0.5, 0.5, 0.0)))
    disc = n.math('LESS_THAN', d, 0.44)
    rim = n.ramp(d, [(0.39, 0.0), (0.4, 1.0), (0.43, 1.0), (0.44, 0.0)])
    sep = n.node('ShaderNodeSeparateXYZ', Vector=n.uv)
    gx = n.math('LESS_THAN', n.math('ABSOLUTE', n.math('SINE', n.math('MULTIPLY', sep.outputs['X'], 2 * math.pi * 7))), 0.35)
    gy = n.math('LESS_THAN', n.math('ABSOLUTE', n.math('SINE', n.math('MULTIPLY', sep.outputs['Y'], 2 * math.pi * 7))), 0.35)
    slots = n.math('MULTIPLY', n.math('MAXIMUM', gx, gy), n.math('LESS_THAN', d, 0.37))
    iron = n.mixcol(n.noise(n.uv, 9.0, 6.0, 4.0), (0.02, 0.02, 0.022), (0.06, 0.035, 0.02))
    col = n.mixcol(rim, iron, (0.09, 0.085, 0.08))
    col = n.mixcol(n.math('MULTIPLY', slots, 0.85), col, (0.003, 0.003, 0.003))
    card(sc, n.finish(col, disc))
    render(sc, i)


def spray_mat(name, color, erode=0.32, seed=1.0):
    """Spray paint: mostly solid, eaten at the edges by noise."""
    n = N(name)
    a = n.ramp(n.noise(n.uv, 40.0, 3.0, seed), [(erode, 0.0), (erode + 0.08, 0.95)])
    return n.finish(color, n.math('MULTIPLY', a, 1.0, clamp=True))


def haze_mat(name, color, a=0.22):
    n = N(name)
    return n.finish(color, n.math('MULTIPLY', n.ramp(n.noise(n.uv, 18.0, 3.0, 9.0), [(0.3, 0.3), (0.7, 1.0)]), a))


def graffiti(i, lines, color, size, seed, drips=6, rot=0.0):
    sc = reset()
    random.seed(seed)
    paint = spray_mat(f'paint{i}', color, seed=seed)
    haze = haze_mat(f'haze{i}', color)
    text(sc, lines, haze, size, at=(0, 0, 0.005), rot=rot, bold=0.02)
    text(sc, lines, paint, size, at=(0, 0, 0.01), rot=rot, bold=0.006)
    # paint runs below the letters
    for _ in range(drips):
        x = random.uniform(-0.38, 0.38)
        ln = random.uniform(0.06, 0.2)
        y0 = random.uniform(-0.12, 0.05) - (0.05 if '\n' not in lines else 0.15)
        card(sc, paint, (0.008, ln), at=(x, y0 - ln / 2, 0.012))
        card(sc, paint, (0.016, 0.016), at=(x, y0 - ln, 0.012), rot=0.785)
    render(sc, i)


def smiley(i, color, seed):
    sc = reset()
    random.seed(seed)
    paint = spray_mat(f'paint{i}', color, seed=seed)
    haze = haze_mat(f'haze{i}', color)
    # a crude spray-painted grin with crossed-out eyes
    for k in range(48):
        a = k * 2 * math.pi / 48
        for m, s in ((haze, 0.07), (paint, 0.035)):
            card(sc, m, (s, s), at=(0.3 * math.cos(a), 0.3 * math.sin(a), 0.01 if m is paint else 0.005), rot=a)
    for ex in (-0.11, 0.11):
        for r in (0.785, -0.785):
            card(sc, paint, (0.12, 0.03), at=(ex, 0.09, 0.012), rot=r)
    for k in range(13):
        a = math.pi * (1.15 + k * 0.7 / 12)
        card(sc, paint, (0.035, 0.035), at=(0.17 * math.cos(a), -0.02 + 0.17 * math.sin(a), 0.012))
    for k in range(5):
        x = random.uniform(-0.25, 0.25)
        ln = random.uniform(0.06, 0.16)
        card(sc, paint, (0.008, ln), at=(x, -0.3 - ln / 2, 0.012))
    render(sc, i)


def poster(i, lines, sub, band, ink, seed):
    sc = reset()
    n = N(f'paper{i}')
    sep = n.node('ShaderNodeSeparateXYZ', Vector=n.uv)
    x = n.math('ABSOLUTE', n.math('SUBTRACT', sep.outputs['X'], 0.5))
    y = n.math('ABSOLUTE', n.math('SUBTRACT', sep.outputs['Y'], 0.5))
    ragged = n.math('MULTIPLY', n.math('SUBTRACT', n.noise(n.uv, 22.0, 4.0, seed), 0.5), 0.05)
    inside = n.math('MULTIPLY', n.math('LESS_THAN', x, n.math('ADD', 0.34, ragged)), n.math('LESS_THAN', y, n.math('ADD', 0.46, ragged)))
    # a torn-away corner
    tear = n.math('GREATER_THAN', n.math('ADD', n.math('ADD', sep.outputs['X'], sep.outputs['Y']), n.math('MULTIPLY', n.noise(n.uv, 14.0, 5.0, seed + 1), 0.25)), 1.55)
    alpha = n.math('MULTIPLY', inside, n.math('SUBTRACT', 1.0, tear), clamp=True)
    stain = n.ramp(n.noise(n.uv, 5.0, 6.0, seed + 2), [(0.35, 0.55), (0.7, 1.0)])
    top = n.math('GREATER_THAN', sep.outputs['Y'], 0.78)
    base = n.mixcol(top, (0.5, 0.42, 0.27), band)
    col = n.node('ShaderNodeMix', Factor=1.0)
    col.data_type = 'RGBA'
    col.blend_type = 'MULTIPLY'
    n.t.links.new(stain, col.inputs[0])
    n.t.links.new(base, col.inputs[6])
    col.inputs[7].default_value = (0.75, 0.68, 0.55, 1)
    card(sc, n.finish(col.outputs[2], alpha))
    ink_m = spray_mat(f'ink{i}', ink, erode=0.18, seed=seed + 5)
    text(sc, lines, ink_m, 0.13, at=(0, 0.06, 0.01), spacing=1.0)
    text(sc, sub, ink_m, 0.06, at=(0, -0.3, 0.01))
    text(sc, '1987', flat(f'cream{i}', (0.55, 0.47, 0.32)), 0.06, at=(0, 0.4, 0.01))
    render(sc, i)


def stencil(i):
    sc = reset()
    paint = spray_mat('stencil', (0.62, 0.6, 0.55), erode=0.42, seed=3.0)
    text(sc, 'EXIT', paint, 0.26, at=(0, 0.18, 0.01), spacing=1.2)
    card(sc, paint, (0.08, 0.36), at=(0, -0.2, 0.01))
    me = bpy.data.meshes.new('head')
    me.from_pydata([(-0.13, 0.0, 0), (0.13, 0.0, 0), (0, 0.16, 0)], [], [(0, 1, 2)])
    o = bpy.data.objects.new('head', me)
    o.location = (0, -0.04, 0.01)
    me.materials.append(paint)
    sc.collection.objects.link(o)
    render(sc, i)


def litter(i):
    sc = reset()
    random.seed(14)
    mats = [flat('ticket', (0.55, 0.16, 0.02)), flat('ticket2', (0.5, 0.12, 0.04)), flat('cup', (0.55, 0.53, 0.48)),
            flat('wrap', (0.32, 0.03, 0.03)), flat('paper', (0.42, 0.4, 0.33)), flat('stripe', (0.45, 0.06, 0.05))]
    for k in range(16):
        m = random.choice(mats)
        w, h = (0.1, 0.05) if 'ticket' in m.name else (random.uniform(0.06, 0.16), random.uniform(0.05, 0.12))
        card(sc, m, (w, h), at=(random.uniform(-0.38, 0.38), random.uniform(-0.38, 0.38), 0.01 + k * 0.001), rot=random.uniform(0, 6.3))
    # a crushed popcorn box: red and white stripes
    for k in range(4):
        card(sc, mats[5] if k % 2 == 0 else mats[2], (0.04, 0.16), at=(0.1 + k * 0.04, 0.05, 0.03), rot=0.4)
    render(sc, i)


blotch(0, (0.006, 0.006, 0.007), seed=1.0, dark=(0.02, 0.012, 0.02))
blotch(1, (0.008, 0.007, 0.006), edge=0.38, warp=0.4, seed=5.0, stretch=(1.0, 0.7))
cracks(2, 5.0, 2.0)
cracks(3, 8.0, 6.0)
blotch(4, (0.05, 0.032, 0.016), edge=0.44, warp=0.35, mottle=6.0, seed=8.0, dark=(0.02, 0.013, 0.007))
blotch(5, (0.035, 0.022, 0.012), edge=0.36, warp=0.5, mottle=14.0, seed=11.0, inner=0.75)
tyres(6)
drain(7)
graffiti(8, 'LAST\nRIDE', (0.6, 0.03, 0.02), 0.26, 8.0, drips=8, rot=0.06)
graffiti(9, 'RUN', (0.75, 0.74, 0.7), 0.42, 9.0, drips=7, rot=-0.08)
smiley(10, (0.75, 0.6, 0.04), 10.0)
poster(11, 'GRAND\nOPENING', 'WONDERLAND PARK', (0.3, 0.02, 0.015), (0.05, 0.02, 0.015), 11.0)
poster(12, 'CIRCUS\nTONIGHT', 'RIDES  GAMES  PRIZES', (0.03, 0.08, 0.25), (0.25, 0.02, 0.01), 12.0)
stencil(13)
litter(14)
blotch(15, (0.05, 0.004, 0.003), edge=0.4, warp=0.3, mottle=8.0, seed=15.0, stretch=(0.45, 1.25), dark=(0.015, 0.002, 0.002))
print('DECALS done', flush=True)
