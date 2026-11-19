# A ghost's bare footprint for the footsteps power (src/rides.js): a left foot (heel, the outer edge of the arch, the
# ball and five toes), smeared as if it slid a little, rendered from straight above in white on clear. The game
# tints it the ghost's mint-green, mirrors it for the right foot and fades the older prints.
#
#   blender --background --factory-startup --python scripts/blender/make-footprint.py -- <out.png> [px=512]
#   (then: node scripts/pack-footprint.mjs, which softens it and writes public/tex/footprint.png)
import math
import random
import sys

import bmesh
import bpy
from mathutils import Matrix

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
PX = int(args[1]) if len(args) > 1 else 512
rnd = random.Random(31)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'SINGLE'
sc.display.shading.single_color = (1, 1, 1)
sc.render.film_transparent = True
sc.render.resolution_x = PX // 2
sc.render.resolution_y = PX
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'

# the print is drawn in a 0.13 x 0.26 box (a foot about 26 cm long), toes toward +y
bm = bmesh.new()


def oval(cx, cy, rx, ry, rot=0.0, segs=28):
    vs = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        x, y = math.cos(a) * rx, math.sin(a) * ry
        vs.append(bm.verts.new((cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot), 0)))
    bm.faces.new(vs)


def foot(dx, dy, s):
    # heel, the outer arch (a left foot: the outside edge is on the left, -x), the ball, five toes
    oval(dx + 0.002, dy - 0.085 * s, 0.03 * s, 0.038 * s)
    oval(dx - 0.02 * s, dy - 0.02 * s, 0.014 * s, 0.05 * s, rot=-0.12)
    oval(dx + 0.004, dy + 0.045 * s, 0.042 * s, 0.03 * s, rot=0.15)
    for i, (tx, ty, r) in enumerate(((0.032, 0.098, 0.0135), (0.012, 0.106, 0.0105), (-0.006, 0.103, 0.0095), (-0.022, 0.094, 0.0085), (-0.036, 0.08, 0.0075))):
        oval(dx + tx * s, dy + ty * s, r * s, r * 1.25 * s, segs=16)


# the print itself, and a few faint copies slid a little toward the heel: the smear of a foot set down damp
foot(0.0, 0.0, 1.0)
for k in range(3):
    foot(rnd.uniform(-0.003, 0.003), -0.004 * (k + 1), 1.0 - 0.02 * (k + 1))
me = bpy.data.meshes.new('print')
bm.to_mesh(me)
ob = bpy.data.objects.new('print', me)
sc.collection.objects.link(ob)

cam = bpy.data.cameras.new('cam')
cam.type = 'ORTHO'
cam.ortho_scale = 0.28
co = bpy.data.objects.new('cam', cam)
co.location = (0, 0, 1)
sc.collection.objects.link(co)
sc.camera = co
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f'FOOTPRINT {OUT} {PX // 2}x{PX}', flush=True)
