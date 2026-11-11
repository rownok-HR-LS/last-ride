# Pre-recorded storm motion: Blender's cloth simulation run once in a gusting wind, played back by the game
# (src/motion.js). Each piece's motion is written as a small texture, one column per vertex and one row per frame:
#   row 0      the settled shape (where the cloth hangs once gravity has had its way), as an offset from the rest
#              shape, always applied;
#   rows 1..L  each frame's flutter as an offset from that settled shape, which the game scales by the night's wind.
# The loop is seamless: its last frames are cross-faded into the frames just before its start.
# Offsets are in game coordinates (y up), metres, stored as rgb = offset / range * 0.5 + 0.5 (8-bit PNG); the
# .json beside it has the rest vertices (game coordinates), the triangles and the range.
#
#   blender --background --factory-startup --python scripts/blender/bake-motion.py -- public/models/motion
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1:][0])
os.makedirs(OUT, exist_ok=True)
FPS = 24
START = 96        # frames to settle before the loop
LOOP = 96         # 4 s of motion
FADE = 24         # cross-fade length at the loop's end


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start = 1
    sc.frame_end = START + LOOP + 2


def wind(strength, angle, noise, turb):
    """A wind blowing along +x turned by angle (radians, about z), plus turbulence for the gusts."""
    bpy.ops.object.effector_add(type='WIND', location=(0, 0, 0.6))
    w = bpy.context.object
    # a wind field blows along its own z axis: lay it flat, pointing along the angle
    w.rotation_euler = (0, math.pi / 2, angle)
    w.field.strength = strength
    w.field.noise = noise
    w.field.seed = 7
    # gusts: the strength swells and drops and the direction wanders (noise on the animation curves)
    w.field.keyframe_insert('strength', frame=1)
    w.keyframe_insert('rotation_euler', frame=1)
    for fc in w.animation_data.action.layers[0].strips[0].channelbags[0].fcurves if hasattr(w.animation_data.action, 'layers') else w.animation_data.action.fcurves:
        mod = fc.modifiers.new('NOISE')
        if fc.data_path.endswith('strength'):
            mod.scale, mod.strength, mod.phase = 9.0, strength * 1.6, 1.3
        elif fc.array_index == 2:
            mod.scale, mod.strength, mod.phase = 14.0, 0.9, 4.1
        else:
            fc.modifiers.remove(mod)
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 0.6))
    t = bpy.context.object
    t.field.strength = turb
    t.field.size = 0.6
    t.field.flow = 0.5
    t.field.seed = 3
    # the turbulence drifts through, so its eddies pass over the cloth
    t.location = (-6, -6, 0.6)
    t.keyframe_insert('location', frame=1)
    t.location = (6, 6, 0.6)
    t.keyframe_insert('location', frame=START + LOOP + 2)


def cloth(o, pins, mass, bend, quality=10):
    vg = o.vertex_groups.new(name='pin')
    vg.add(pins, 1.0, 'REPLACE')
    m = o.modifiers.new('cloth', 'CLOTH')
    s = m.settings
    s.quality = quality
    s.mass = mass
    s.tension_stiffness = 12
    s.compression_stiffness = 12
    s.shear_stiffness = 6
    s.bending_stiffness = bend
    s.air_damping = 1.2
    s.vertex_group_mass = 'pin'
    m.point_cache.frame_start = 1
    m.point_cache.frame_end = START + LOOP + 2
    return m


def to_game(v):
    return (v.x, v.z, -v.y)


def bake(name, o, tris, uvs=None):
    rest = [to_game(v.co) for v in o.data.vertices]
    n = len(rest)
    dg = bpy.context.evaluated_depsgraph_get()
    frames = []
    for f in range(1, START + LOOP + 1):
        bpy.context.scene.frame_set(f)
        ev = o.evaluated_get(dg)
        frames.append([to_game(ev.matrix_world @ v.co) for v in ev.data.vertices])
    # the loop, cross-faded at its end into the frames just before it
    loop = []
    for i in range(LOOP):
        a = frames[START + i - 1]
        if i >= LOOP - FADE:
            w = (i - (LOOP - FADE) + 1) / (FADE + 1)
            b = frames[START + i - 1 - LOOP]
            a = [tuple(pa[k] * (1 - w) + pb[k] * w for k in range(3)) for pa, pb in zip(a, b)]
        loop.append(a)
    mean = [tuple(sum(fr[j][k] for fr in loop) / LOOP for k in range(3)) for j in range(n)]
    rows = [[tuple(mean[j][k] - rest[j][k] for k in range(3)) for j in range(n)]]
    for fr in loop:
        rows.append([tuple(fr[j][k] - mean[j][k] for k in range(3)) for j in range(n)])
    rng = max(1e-4, max(abs(c) for row in rows for p in row for c in p))
    flutter = max(math.sqrt(sum(c * c for c in p)) for row in rows[1:] for p in row)
    settle = max(math.sqrt(sum(c * c for c in p)) for p in rows[0])
    W, H = n, len(rows)
    img = bpy.data.images.new(name, W, H, alpha=True, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    px = []
    for row in rows:  # row 0 is the image's bottom row
        for p in row:
            px.extend((p[0] / rng * 0.5 + 0.5, p[1] / rng * 0.5 + 0.5, p[2] / rng * 0.5 + 0.5, 1.0))
    img.pixels = px
    img.filepath_raw = os.path.join(OUT, name + '.png')
    img.file_format = 'PNG'
    img.save()
    info = {
        'name': name, 'fps': FPS, 'frames': LOOP, 'range': round(rng, 5),
        'verts': [round(c, 4) for p in rest for c in p], 'tris': tris,
    }
    if uvs:
        info['uvs'] = [round(c, 4) for c in uvs]
    json.dump(info, open(os.path.join(OUT, name + '.json'), 'w'))
    print(f'MOTION {name}: {n} verts, {LOOP} frames, range {rng:.3f} m, settle {settle:.3f} m, flutter {flutter:.3f} m')


# ------------------------------------------------------------------ a bunting pennant (top edge 26 cm, 30 cm long)

def pennant():
    reset()
    R = 6
    bm = bmesh.new()
    rows = []
    for r in range(R + 1):
        t = r / R
        k = R - r + 1
        half = 0.13 * (1 - t)
        row = []
        for i in range(k):
            x = 0.0 if k == 1 else -half + 2 * half * i / (k - 1)
            row.append(bm.verts.new((x, 0.0, -0.3 * t)))
        rows.append(row)
    for r in range(R):
        a, b = rows[r], rows[r + 1]
        for i in range(len(b)):
            bm.faces.new((a[i], a[i + 1], b[i]))
            if i + 1 < len(b):
                bm.faces.new((a[i + 1], b[i + 1], b[i]))
    me = bpy.data.meshes.new('pennant')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('pennant', me)
    bpy.context.scene.collection.objects.link(o)
    tris = [v for p in me.polygons for v in p.vertices]
    cloth(o, [v.index for v in me.vertices if v.co.z > -1e-4], mass=0.02, bend=0.02)
    wind(strength=float(os.environ.get("PW", 60)), angle=math.radians(80), noise=1.5, turb=float(os.environ.get("PT", 400)))
    bake('pennant', o, tris)


# ------------------------------------------------------------------ the police tape's two runs between three stakes
# (the same ribbons scripts/blender/story-props.py builds: 13 points a run, 7 cm wide, a slight twist)

def tape():
    reset()
    bm = bmesh.new()
    pins = []
    xs = (-2.3, 0.0, 2.3)
    width = 0.07
    for a, b in zip(xs, xs[1:]):
        rows = []
        for i in range(13):
            t = i / 12
            tw = math.sin(t * math.pi * 2) * 0.35
            p = Vector((a + (b - a) * t, math.sin(t * math.pi) * 0.04, 0.93 - 0.13 * math.sin(t * math.pi)))
            w = Vector((0, tw, 1)).normalized() * width / 2
            rows.append((bm.verts.new(p - w), bm.verts.new(p + w)))
        for r0, r1 in zip(rows, rows[1:]):
            bm.faces.new((r0[0], r1[0], r1[1], r0[1]))
        pins.extend([rows[0][0], rows[0][1], rows[-1][0], rows[-1][1]])
    bm.verts.index_update()
    pin_ids = [v.index for v in pins]
    me = bpy.data.meshes.new('tape')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('tape', me)
    bpy.context.scene.collection.objects.link(o)
    tris = []
    cloth(o, pin_ids, mass=0.03, bend=0.05)
    wind(strength=float(os.environ.get("TW", 60)), angle=math.radians(75), noise=1.5, turb=float(os.environ.get("TT", 400)))
    bake('tape', o, tris)


if __name__ == '__main__':
    pennant()
    tape()
