# The moving scares inside the walk-in buildings (src/scares.js): each is a short motion keyed in Blender on an empty
# standing in for the moving piece's pivot, using Blender's own easing between keys (bounce for a drop on a chain or a
# slammed lid, elastic for a head snapping round, back for a jolt), then sampled 30 times a second into
# public/models/motion/scares.json: for each scare, the piece's offset from its pivot and its rotation at every
# frame, in game coordinates (x right, y up, z toward the gate; Blender's are x, -z, y).
#
#   blender --background --factory-startup --python scripts/blender/build-scares.py -- public/models/motion
import json
import math
import os
import sys

import bpy

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1:][0])
FPS = 30


def curves(o):
    action = o.animation_data.action
    if hasattr(action, 'layers') and action.layers:
        return action.layers[0].strips[0].channelbags[0].fcurves
    return action.fcurves


def record(name, frames, loc=(), rot=()):
    """
    Key an empty and sample it. loc / rot: [(frame, (x, y, z), interpolation, easing)] in Blender's axes; the
    interpolation named on a key shapes the move from that key to the next.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = frames
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    o.rotation_mode = 'XYZ'
    how = {}
    for path, keys in (('location', loc), ('rotation_euler', rot)):
        for f, v, interp, easing in keys:
            setattr(o, path, v)
            o.keyframe_insert(path, frame=f)
            how[(path, f)] = (interp, easing)
    for fc in curves(o):
        for kp in fc.keyframe_points:
            interp, easing = how.get((fc.data_path, round(kp.co.x)), ('BEZIER', 'AUTO'))
            kp.interpolation = interp
            kp.easing = easing
    pos, quat = [], []
    for f in range(frames + 1):
        scene.frame_set(f)
        m = o.matrix_world
        t = m.translation
        q = m.to_quaternion()
        pos.append([round(t.x, 4), round(t.z, 4), round(-t.y, 4)])
        quat.append([round(q.x, 5), round(q.z, 5), round(-q.y, 5), round(q.w, 5)])
    print(f'SCARE {name}: {frames} frames ({frames / FPS:.1f} s)', flush=True)
    return {'frames': frames, 'pos': pos, 'quat': quat}


S, B = 'SINE', 'BEZIER'
IO, EO, EI = 'EASE_IN_OUT', 'EASE_OUT', 'EASE_IN'
out = {'fps': FPS, 'scares': {}}

# A skeleton tucked up under the ceiling drops 2.2 m on its chain, bounces at the end of it, swings, hangs there,
# and is slowly winched back up. (Swinging about the game's z axis is turning about Blender's y.)
out['scares']['skeleton'] = record('skeleton', 250, loc=[
    (0, (0, 0, 2.2), 'BOUNCE', EO), (26, (0, 0, 0), B, 'AUTO'), (150, (0, 0, 0), S, IO), (240, (0, 0, 2.2), B, 'AUTO'),
    (250, (0, 0, 2.2), B, 'AUTO'),
], rot=[
    (0, (0, 0, 0), S, IO), (8, (0, -0.4, 0), S, IO), (21, (0, 0.32, 0), S, IO), (35, (0, -0.24, 0), S, IO),
    (50, (0, 0.17, 0), S, IO), (66, (0, -0.11, 0), S, IO), (84, (0, 0.06, 0), S, IO), (104, (0, -0.03, 0), S, IO),
    (126, (0, 0, 0), B, 'AUTO'), (250, (0, 0, 0), B, 'AUTO'),
])

# A coffin lid lifts a crack, creaks slowly open on its hinge, shudders, waits... and slams.
# (The hinge runs along the game's z: opening is a turn about it, Blender's -y.)
out['scares']['coffin_lid'] = record('coffin_lid', 160, rot=[
    (0, (0, 0, 0), 'BACK', EO), (10, (0, -0.14, 0), S, IO), (52, (0, -1.0, 0), S, IO), (57, (0, -0.93, 0), S, IO),
    (62, (0, -1.02, 0), B, 'AUTO'), (122, (0, -1.02, 0), 'BOUNCE', EO), (140, (0, 0, 0), B, 'AUTO'), (160, (0, 0, 0), B, 'AUTO'),
])

# A stalled ride car jolts forward along its track (the game's +z, Blender's -y), nose dipping, then rolls back.
out['scares']['ridecar'] = record('ridecar', 100, loc=[
    (0, (0, 0, 0), 'BACK', EO), (7, (0, -0.42, 0), B, 'AUTO'), (22, (0, -0.42, 0), S, IO), (90, (0, 0, 0), B, 'AUTO'),
    (100, (0, 0, 0), B, 'AUTO'),
], rot=[
    (0, (0, 0, 0), S, EO), (4, (0.07, 0, 0), 'ELASTIC', EO), (30, (0, 0, 0), B, 'AUTO'), (100, (0, 0, 0), B, 'AUTO'),
])

# The fortune teller's head twitches, snaps round to face you (turning about the game's y, Blender's z), nods, and
# slowly turns back.
out['scares']['fortune_head'] = record('fortune_head', 170, rot=[
    (0, (0, 0, 0), S, IO), (5, (0, 0, 0.22), S, IO), (10, (0, 0, 0.16), 'ELASTIC', EO), (34, (0, 0, 0.9), B, 'AUTO'),
    (64, (0, 0, 0.9), S, IO), (72, (0.32, 0, 0.9), S, IO), (82, (0, 0, 0.9), B, 'AUTO'), (112, (0, 0, 0.9), S, IO),
    (160, (0, 0, 0), B, 'AUTO'), (170, (0, 0, 0), B, 'AUTO'),
])

path = os.path.join(OUT, 'scares.json')
json.dump(out, open(path, 'w'), separators=(',', ':'))
print(f'SCARES -> {path} ({os.path.getsize(path) // 1024} KB)')
