# The park's shipping crate (the stacks of them are its main cover): planked sides in a braced frame, a planked lid,
# iron corner straps. One crate, 1.6 x 1.4 x 1.6 m standing on the origin; the game stretches copies of it to each
# stack's size and layers (src/world.js crate()), and scripts/fracture-props.mjs cuts it into the pieces it breaks
# into. Materials are named 'tex:<key>', so the game paints them with the world's own (src/models.js).
#
#   blender --background --factory-startup --python scripts/blender/build-crate.py -- out.glb
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kitlib import Kit  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1:][0]
W, H = 1.6, 1.4
PLANK, TRIM, IRON = 'tex:crate', 'tex:trim', 'tex:iron'
K = Kit()
rr = random.Random(21)
e = W / 2
# the sides: six upright planks each, a little uneven, standing just proud of an inner box (so no gap shows through)
K.box(PLANK, (0, H / 2, 0), (W - 0.1, H - 0.06, W - 0.1), bevel=0.0)
n = 6
pw = (W - 0.16) / n
for side in range(4):
    for i in range(n):
        u = -e + 0.08 + pw * (i + 0.5)
        t = 0.03 + rr.random() * 0.012
        h = H - 0.1 - rr.random() * 0.02
        if side == 0:
            K.box(PLANK, (u, H / 2, e - 0.035), (pw - 0.012, h, t), bevel=0.0)
        elif side == 1:
            K.box(PLANK, (u, H / 2, -e + 0.035), (pw - 0.012, h, t), bevel=0.0)
        elif side == 2:
            K.box(PLANK, (e - 0.035, H / 2, u), (t, h, pw - 0.012), bevel=0.0)
        else:
            K.box(PLANK, (-e + 0.035, H / 2, u), (t, h, pw - 0.012), bevel=0.0)
# the lid: planks across, one sprung at a corner
for i in range(n):
    u = -e + 0.08 + pw * (i + 0.5)
    K.box(PLANK, (u, H - 0.02, 0), (pw - 0.012, 0.035, W - 0.08), rot=(0.05 if i == 4 else 0, 0, 0), bevel=0.0)
# the frame: corner posts, rims top and bottom, a brace across each side
for sx in (-1, 1):
    for sz in (-1, 1):
        K.box(TRIM, (sx * (e - 0.04), H / 2, sz * (e - 0.04)), (0.1, H, 0.1), bevel=0.0)
for y in (0.05, H - 0.05):
    for s in (-1, 1):
        K.box(TRIM, (0, y, s * (e - 0.02)), (W, 0.1, 0.06), bevel=0.0)
        K.box(TRIM, (s * (e - 0.02), y, 0), (0.06, 0.1, W), bevel=0.0)
import math  # noqa: E402
diag = math.atan2(H - 0.2, W - 0.2)
length = math.hypot(H - 0.2, W - 0.2)
for s in (-1, 1):
    K.box(TRIM, (0, H / 2, s * (e + 0.005)), (length, 0.09, 0.04), rot=(0, 0, s * diag), bevel=0.0)
    K.box(TRIM, (s * (e + 0.005), H / 2, 0), (0.04, 0.09, length), rot=(s * diag, 0, 0), bevel=0.0)
# iron straps on the corners
for sx in (-1, 1):
    for sz in (-1, 1):
        for y in (0.22, H - 0.22):
            K.box(IRON, (sx * (e - 0.035), y, sz * (e - 0.035)), (0.125, 0.07, 0.125), bevel=0.0)
K.export(OUT)
