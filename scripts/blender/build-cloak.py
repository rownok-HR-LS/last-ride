# The wraith's cloak (src/cloak.js): a tattered robe that frays into rags below the waist, a hood with a cape down
# the back, and ragged forearm sleeves. Each piece is simulated as cloth once, in a wind rising and swirling round a
# floating ghost, and baked like the bunting (scripts/blender/bake-motion.py): rest shape + seamless 4 s of flutter.
# Pieces are modelled around their attachment point, in Blender's z-up (the game turns them y-up):
#   robe_skirt   origin at the hips, hanging down (-z), facing +y
#   robe_hood    origin at the head's centre, the face opening toward +y, the cape down the back (-y)
#   robe_sleeve  origin at the elbow, hanging along -z (the game turns -z along the forearm)
#
#   blender --background --factory-startup --python scripts/blender/build-cloak.py -- public/models/motion
import importlib.util
import math
import os
import random
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bake_motion', os.path.join(HERE, 'bake-motion.py'))
bm_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bm_mod)
reset, cloth, bake = bm_mod.reset, bm_mod.cloth, bm_mod.bake


def ghost_wind(strength, turb):
    """Air rising past a floating ghost, swirling: a wind from below and behind, gusting, plus turbulence."""
    bpy.ops.object.effector_add(type='WIND', location=(0, 0.6, -1.6))
    w = bpy.context.object
    # blow up (+z) and a little forward (+y): the rags trail back and lift
    w.rotation_euler = (math.radians(-25), 0, 0)
    w.field.strength = strength
    w.field.noise = 2.0
    w.field.seed = 11
    w.field.keyframe_insert('strength', frame=1)
    action = w.animation_data.action
    curves = action.layers[0].strips[0].channelbags[0].fcurves if hasattr(action, 'layers') and action.layers else action.fcurves
    for fc in curves:
        mod = fc.modifiers.new('NOISE')
        mod.scale, mod.strength, mod.phase = 10.0, strength * 1.4, 2.2
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 0))
    t = bpy.context.object
    t.field.strength = turb
    t.field.size = 0.4
    t.field.flow = 0.6
    t.location = (-3, -3, -1)
    t.keyframe_insert('location', frame=1)
    t.location = (3, 3, 1)
    t.keyframe_insert('location', frame=bm_mod.START + bm_mod.LOOP + 2)


def finish(name, bm, pins_fn, mass, bend, wind, turb):
    """Mesh from bmesh (with a simple UV: u round, v down), pinned, simulated and baked."""
    uvl = bm.loops.layers.uv.active
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    tris = []
    for p in me.polygons:
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris += [vs[0], vs[k], vs[k + 1]]
    # per-vertex uv (averaged over its corners)
    uv = [[0.0, 0.0, 0] for _ in me.vertices]
    if me.uv_layers:
        for loop in me.loops:
            u = me.uv_layers.active.data[loop.index].uv
            e = uv[loop.vertex_index]
            e[0] += u[0]
            e[1] += u[1]
            e[2] += 1
    uvs = []
    for e in uv:
        uvs += [e[0] / max(1, e[2]), e[1] / max(1, e[2])]
    cloth(o, [v.index for v in me.vertices if pins_fn(v.co)], mass=mass, bend=bend)
    ghost_wind(wind, turb)
    bake(name, o, tris, uvs)


def tube(name, rings, around, radius_at, z_at, jag=0.0, seed=1, ellipse=1.0, gap=None):
    """A hanging tube of rings x around, radius and height per row (t 0 top .. 1 bottom); the bottom rows jagged."""
    rng = random.Random(seed)
    jagged = [1 + rng.uniform(-jag, jag) * (1.5 if rng.random() < 0.2 else 1) for _ in range(around)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    grid = []
    for r in range(rings + 1):
        t = r / rings
        row = []
        for a in range(around):
            ang = a / around * math.tau
            rad = radius_at(t)
            # the hem: each column hangs a different length
            zz = z_at(t) * (1 + (jagged[a] - 1) * t ** 2)
            row.append(bm.verts.new((math.cos(ang) * rad, math.sin(ang) * rad * ellipse, zz)))
        grid.append(row)
    for r in range(rings):
        for a in range(around):
            if gap and gap(a / around, r / rings):
                continue
            b = (a + 1) % around
            f = bm.faces.new((grid[r][a], grid[r][b], grid[r + 1][b], grid[r + 1][a]))
            for loop, (u, v) in zip(f.loops, ((a, r), (a + 1, r), (a + 1, r + 1), (a, r + 1))):
                loop[uvl].uv = (u / around, 1 - v / rings)
    return bm


def skirt():
    reset()
    L = 1.15
    bm = tube('robe_skirt', 14, 28, lambda t: 0.19 + 0.26 * t ** 1.2, lambda t: -L * t, jag=0.28, seed=4, ellipse=0.82,
              # a tear up the front and two at the sides, so it hangs in strips
              gap=lambda u, v: v > 0.45 and (abs(u - 0.25) < 0.018 or abs(u - 0.62) < 0.02 or abs(u - 0.9) < 0.018))
    finish('robe_skirt', bm, lambda c: c.z > -0.12, mass=0.18, bend=0.08, wind=55, turb=260)


def hood():
    reset()
    rng = random.Random(9)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    R = 0.17
    rows, cols = 10, 22
    grid = []
    # a shell round the head, open at the face (+y); its back pulls down into the cape
    for r in range(rows + 1):
        t = r / rows
        row = []
        for c in range(cols + 1):
            s = c / cols
            # angle round the head, leaving a 60 degree opening for the face (centred on +y, at 90 degrees)
            ang = math.radians(120) + s * math.radians(300)
            # the hood: a peaked dome; lower rows become the cape falling down the back and over the shoulders
            if t < 0.55:
                k = t / 0.55
                el = math.radians(80) - k * math.radians(120)
                rad = R * (1.15 + 0.15 * k)
                x = math.cos(ang) * math.cos(el) * rad
                y = math.sin(ang) * math.cos(el) * rad
                z = math.sin(el) * rad
            else:
                k = (t - 0.55) / 0.45
                spread = 0.2 + 0.12 * k
                x = math.cos(ang) * (R * 1.3 + spread)
                y = math.sin(ang) * (R * 1.3 + spread * 0.7) - 0.04 * k
                drop = 0.62 * k * (1 + rng.uniform(-0.25, 0.25) * k)
                z = -R * 0.68 - drop
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for r in range(rows):
        for c in range(cols):
            f = bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
            for loop, (u, v) in zip(f.loops, ((c, r), (c + 1, r), (c + 1, r + 1), (c, r + 1))):
                loop[uvl].uv = (u / cols, 1 - v / rows)
    finish('robe_hood', bm, lambda co: co.z > -0.14, mass=0.12, bend=0.06, wind=45, turb=220)


def sleeve():
    reset()
    L = 0.55
    bm = tube('robe_sleeve', 9, 14, lambda t: 0.065 + 0.08 * t ** 1.4, lambda t: -L * t, jag=0.35, seed=12)
    finish('robe_sleeve', bm, lambda c: c.z > -0.07, mass=0.05, bend=0.03, wind=90, turb=520)


skirt()
hood()
sleeve()
