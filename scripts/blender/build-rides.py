# The rides' fixed parts, modelled in Blender in the park's 1980s style, abandoned but still standing: faded paint,
# rust at the joints, most bulbs dead. The Free Fall drop tower and the ring of seats that climbs it, the steel
# coaster's track (twin tube rails on a box spine, a chain lift with its catwalk, brake fins at the station) and its
# support columns, the coaster's loading station, the Ferris wheel's control booth and the bumper-car pavilion.
#
#   node scripts/export-kit-layout.mjs layout.json
#   blender --background --factory-startup --python scripts/blender/build-rides.py -- layout.json outdir [part ...]
#
# Writes kit_freefall.glb (the tower, centred on it), kit_freefall_seats.glb (the seat ring, centred on itself; the
# game moves it), kit_coaster.glb (track and supports in park coordinates), kit_station.glb, kit_control.glb and
# kit_arena.glb (each centred on its map prop). Geometry only, materials named after the game's (see kitlib.py).
# Everything stays inside the colliders shared/map.js gives these rides, so the models are what players bump into.
import json
import math
import os
import random
import sys

import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from kitlib import Kit, rod  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
LAYOUT, OUT = args[0], args[1]
ONLY = set(args[2:])
L = json.load(open(LAYOUT))
SMOOTH = math.radians(40)

RED = '#c8501e'      # the coaster's, the tower crown's and the rides' faded red
CREAM = '#e9e3d2'
YEL = '#f2b632'
TEAL = '#3d6b6b'
SUP = '#2f2a36'      # dark support paint
DEAD = '#3b3631'     # a dead bulb's glass
UP = Vector((0, 1, 0))


def obox(K, mat, c, rt, up, fw, size, bevel=0.01):
    """A box size (across, up, along) centred at c with its own axes rt, up, fw."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        b = min(bevel, min(size) * 0.45)
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=b, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    c, rt, up, fw = Vector(c), Vector(rt), Vector(up), Vector(fw)
    M = Matrix(((rt.x, up.x, fw.x, c.x), (rt.y, up.y, fw.y, c.y), (rt.z, up.z, fw.z, c.z), (0, 0, 0, 1)))
    K._take(mat, bm, M)


def bulb(K, at, alive, r=0.09, lit='bulb'):
    K.ball(lit if alive else DEAD, at, r, segs=6)


def circle(r, n, cx=0.0, cy=0.0):
    return [(cx + math.cos(k * 2 * math.pi / n) * r, cy + math.sin(k * 2 * math.pi / n) * r) for k in range(n)]


def rect(hw, hh, cx=0.0, cy=0.0, ch=0.0):
    """A rectangle (half width, half height) with its corners chamfered by ch, for sweeping."""
    if ch <= 0:
        return [(cx - hw, cy - hh), (cx + hw, cy - hh), (cx + hw, cy + hh), (cx - hw, cy + hh)]
    return [(cx - hw + ch, cy - hh), (cx + hw - ch, cy - hh), (cx + hw, cy - hh + ch), (cx + hw, cy + hh - ch),
            (cx + hw - ch, cy + hh), (cx - hw + ch, cy + hh), (cx - hw, cy + hh - ch), (cx - hw, cy - hh + ch)]


# ------------------------------------------------------------------ the Free Fall tower (collider r 2.2, 0 - 48 m)
H = 47.0     # top of the steel tower; the machine house sits on it
HALF = 1.5   # the square tower's half width (corners at 2.12 m, inside the collider)


def freefall():
    random.seed(11)
    K = Kit()
    # the octagonal concrete pad (collider r 5, 0.4 high), a hazard ring painted round the edge
    K.cyl('plinth', (0, 0.2, 0), 5.0, 0.4, segs=8)
    for k in range(24):
        a = k * 2 * math.pi / 24
        K.box(YEL if k % 2 == 0 else 'dark', (math.cos(a) * 4.55, 0.405, math.sin(a) * 4.55), (1.1, 0.012, 0.3),
              rot=(0, -a - math.pi / 2, 0), bevel=0)
    # a low queue rail round the pad, open at the front where the sign faces
    posts = [k * 2 * math.pi / 18 for k in range(18)]
    front = math.pi / 2
    near_front = lambda a: abs(math.atan2(math.sin(a - front), math.cos(a - front))) < 0.45  # noqa: E731
    for i, a in enumerate(posts):
        if near_front(a):
            continue
        x, z = math.cos(a) * 4.75, math.sin(a) * 4.75
        K.cyl('pipe', (x, 0.85, z), 0.04, 0.9, segs=6)
        b = posts[(i + 1) % len(posts)]
        if not near_front(b):
            for y in (0.75, 1.25):
                rod(K, 'pipe', (x, y, z), (math.cos(b) * 4.75, y, math.sin(b) * 4.75), 0.025, segs=5)
    corners = [(sx * HALF, sz * HALF) for sx in (-1, 1) for sz in (-1, 1)]
    # base plates and the four corner columns
    for x, z in corners:
        K.box('pipe', (x, 0.45, z), (0.7, 0.1, 0.7), bevel=0.02)
        for bx in (-0.25, 0.25):
            for bz in (-0.25, 0.25):
                K.cyl('rust', (x + bx, 0.52, z + bz), 0.035, 0.06, segs=6)
        K.cyl(CREAM, (x, (0.5 + H) / 2, z), 0.2, H - 0.5, segs=12)
    # the solid core the ride's brakes and cables run in, and a guide rail down the middle of each face
    K.box('metal', (0, (0.5 + H) / 2, 0), (1.7, H - 0.5, 1.7), bevel=0.04)
    for nx, nz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        K.box('metal', (nx * 1.6, (1.0 + H) / 2, nz * 1.6), (0.2 if nx else 0.24, H - 1.0, 0.24 if nx else 0.2), bevel=0.02)
    # girts every 3 m and X bracing on every face between them
    y = 2.5
    while y < H:
        for s in (-1, 1):
            K.box(CREAM, (0, y, s * HALF), (3.0, 0.14, 0.14), bevel=0.02)
            K.box(CREAM, (s * HALF, y, 0), (0.14, 0.14, 3.0), bevel=0.02)
            # flanged joints on the columns, some gone to rust
        for x, z in corners:
            K.cyl('rust' if random.random() < 0.35 else CREAM, (x, y, z), 0.26, 0.08, segs=12)
        if y + 3 < H:
            for s in (-1, 1):
                rod(K, CREAM, (-HALF, y, s * HALF), (HALF, y + 3, s * HALF), 0.05)
                rod(K, CREAM, (HALF, y, s * HALF), (-HALF, y + 3, s * HALF), 0.05)
                rod(K, CREAM, (s * HALF, y, -HALF), (s * HALF, y + 3, HALF), 0.05)
                rod(K, CREAM, (s * HALF, y, HALF), (s * HALF, y + 3, -HALF), 0.05)
        y += 3
    # chaser bulbs up the outside corners, most of them dead
    for x, z in corners:
        d = Vector((x, 0, z)).normalized() * 0.26
        y = 2.0
        while y < H - 0.5:
            bulb(K, (x + d.x, y, z + d.z), random.random() < 0.25)
            y += 1.5
    # a maintenance ladder up the +x face, and a conduit down the -x face
    for e in (-0.85, -1.25):
        K.box('iron', (HALF + 0.22, (0.5 + H) / 2, e), (0.04, H - 0.5, 0.05), bevel=0)
    y = 0.8
    while y < H:
        K.box('iron', (HALF + 0.22, y, -1.05), (0.03, 0.03, 0.42), bevel=0)
        y += 0.4
    K.cyl('pipe', (-HALF - 0.12, (0.5 + H) / 2, 0.95), 0.06, H - 0.5, segs=8)
    # the machine house on top: red with a cream band, a gallery floor under it, bulbs round its edges, a beacon
    K.box('pipe', (0, H - 0.05, 0), (4.8, 0.16, 4.8), bevel=0.02)
    K.box(RED, (0, H + 1.6, 0), (4.4, 3.2, 4.4), bevel=0.05)
    K.box(CREAM, (0, H + 2.35, 0), (4.46, 0.45, 4.46), bevel=0.02)
    K.box('roof', (0, H + 3.3, 0), (4.9, 0.2, 4.9), bevel=0.03)
    for s in (-1, 1):
        for k in range(10):
            t = -2.1 + k * 4.2 / 9
            for yy in (H + 0.15, H + 3.12):
                bulb(K, (t, yy, s * 2.28), random.random() < 0.3, lit='bulbRed' if yy > H + 1 else 'bulb')
                bulb(K, (s * 2.28, yy, t), random.random() < 0.3, lit='bulbRed' if yy > H + 1 else 'bulb')
    # louvres on the house's sides
    for s in (-1, 1):
        for k in range(4):
            K.box('dark', (-0.9 + k * 0.6, H + 1.1, s * 2.21), (0.4, 0.9, 0.02), bevel=0)
            K.box('dark', (s * 2.21, H + 1.1, -0.9 + k * 0.6), (0.02, 0.9, 0.4), bevel=0)
    K.cyl('pipe', (0, H + 3.8, 0), 0.06, 0.8, segs=6)
    K.ball('bulbRed', (0, H + 4.25, 0), 0.32, segs=10)
    # the board the FREE FALL neon hangs on (the neon itself is the game's, 9 m up on the +z side)
    K.box('dark', (0, 9.0, 2.06), (6.6, 1.5, 0.08), bevel=0.01)
    for yy in (8.22, 9.78):
        K.box(YEL, (0, yy, 2.08), (6.7, 0.1, 0.12), bevel=0.01)
    for x in (-1.2, 1.2):
        for yy in (8.6, 9.4):
            rod(K, 'iron', (x, yy, HALF + 0.1), (x, yy, 2.02), 0.04)
    return K


# ------------------------------------------------------------------ the Free Fall's seat ring (moves up and down)

def seat(K, base, fw, tg, state):
    """One outward-facing seat with an over-the-shoulder harness. state: 'down', 'up' (harness raised), 'gone'."""
    base, fw, tg = Vector(base), Vector(fw), Vector(tg)
    W = lambda a, u, f: base + tg * a + UP * u + fw * f  # noqa: E731
    # the bracket that holds it to the ring
    obox(K, RED, W(0, 0.0, 0.05), tg, UP, fw, (0.36, 0.22, 0.22))
    if state == 'gone':
        rod(K, 'rust', W(0, 0.1, 0.12), W(0.05, -0.4, 0.2), 0.03)
        return
    obox(K, 'rubber', W(0, 0.62, 0.12), tg, UP, fw, (0.56, 0.95, 0.12), bevel=0.03)
    obox(K, 'rubber', W(0, 0.12, 0.38), tg, UP, fw, (0.56, 0.1, 0.46), bevel=0.03)
    for s in (-1, 1):
        obox(K, CREAM, W(s * 0.3, 0.45, 0.2), tg, UP, fw, (0.05, 0.85, 0.36), bevel=0.01)
    # footrest
    rod(K, 'pipe', W(-0.24, -0.55, 0.5), W(0.24, -0.55, 0.5), 0.025, segs=5)
    for s in (-1, 1):
        rod(K, 'pipe', W(s * 0.24, 0.08, 0.5), W(s * 0.24, -0.55, 0.5), 0.022, segs=5)
    # the harness: yellow bars from the hinge above the head over the shoulders, and a padded chest bar
    if state == 'down':
        pts = [(1.18, 0.16), (1.12, 0.42), (0.78, 0.5), (0.42, 0.48)]
        pad = (0.62, 0.52)
    else:
        pts = [(1.18, 0.16), (1.55, 0.3), (1.78, 0.18), (1.82, -0.05)]
        pad = (1.75, 0.08)
    for s in (-1, 1):
        for (u0, f0), (u1, f1) in zip(pts, pts[1:]):
            rod(K, YEL, W(s * 0.17, u0, f0), W(s * 0.17, u1, f1), 0.035, segs=6)
    obox(K, 'rubber', W(0, pad[0], pad[1]), tg, UP, fw, (0.42, 0.34, 0.1), bevel=0.03)
    obox(K, 'iron', W(0, 1.2, 0.12), tg, UP, fw, (0.46, 0.1, 0.14))


def freefall_seats():
    random.seed(5)
    K = Kit()
    # the ring round the tower, outside the four guide rails (rail faces at 1.72 m), with shoes that run on them
    for s in (-1, 1):
        K.box(RED, (0, 0.1, s * 1.93), (4.14, 0.42, 0.3), bevel=0.04)
        K.box(RED, (s * 1.93, 0.1, 0), (0.3, 0.42, 3.56), bevel=0.04)
        K.box(CREAM, (0, 0.33, s * 1.93), (4.16, 0.06, 0.32), bevel=0.01)
        K.box(CREAM, (s * 1.93, 0.33, 0), (0.32, 0.06, 3.58), bevel=0.01)
        K.box('metal', (0, 0.1, s * 1.76), (0.5, 0.7, 0.06), bevel=0.01)
        K.box('metal', (s * 1.76, 0.1, 0), (0.06, 0.7, 0.5), bevel=0.01)
    states = ['down'] * 9 + ['up'] * 2 + ['gone']
    random.shuffle(states)
    k = 0
    for fw, tg in (((0, 0, 1), (1, 0, 0)), ((0, 0, -1), (-1, 0, 0)), ((1, 0, 0), (0, 0, -1)), ((-1, 0, 0), (0, 0, 1))):
        fw, tg = Vector(fw), Vector(tg)
        for j in (-1, 0, 1):
            seat(K, fw * 2.08 + tg * j * 1.2 + UP * -0.05, fw, tg, states[k])
            k += 1
    return K


# ------------------------------------------------------------------ the steel coaster (track in park coordinates)
GAUGE = 0.55   # rails either side of the centre line; the cars ride just above them


def track_frames(pts):
    out = []
    n = len(pts)
    for i in range(n):
        t = (Vector(pts[(i + 1) % n]) - Vector(pts[i - 1])).normalized()
        rt = Vector((-t.z, 0, t.x)).normalized()
        up = rt.cross(t).normalized()
        if up.y < 0:
            up = -up
        out.append((rt, up, t))
    return out


def coaster():
    random.seed(3)
    K = Kit()
    pts = [Vector(p) for p in L['track']['pts']]
    F = track_frames(pts)
    n = len(pts)
    fr = [(rt, up) for rt, up, _ in F]
    # the running rails and the box spine under them
    for s in (-1, 1):
        K.sweep('metal', pts, fr, circle(0.085, 8, s * GAUGE, 0.0))
    K.sweep(RED, pts, fr, rect(0.17, 0.24, 0, -0.48, 0.04))
    # ties every second point: a crossbar under the rails braced down to the spine
    for i in range(0, n, 2):
        p = pts[i]
        rt, up, t = F[i]
        obox(K, RED, p + up * -0.13, rt, up, t, (1.25, 0.08, 0.12))
        for s in (-1, 1):
            obox(K, 'metal', p + rt * (s * GAUGE) + up * -0.08, rt, up, t, (0.1, 0.06, 0.16), bevel=0)
            rod(K, RED, p + rt * (s * 0.52) + up * -0.16, p + rt * (s * 0.17) + up * -0.32, 0.03, segs=4)
    # the chain lift: a trough between the rails, and a catwalk with a handrail beside it up to the top
    lift = list(range(26, 97))
    lp = [pts[i] for i in lift]
    lf = [fr[i] for i in lift]
    K.sweep('dark', lp, lf, rect(0.09, 0.07, 0, -0.17), closed=False)
    K.sweep('pipe', lp, lf, rect(0.35, 0.025, 1.1, -0.34), closed=False)
    K.sweep('pipe', lp, lf, circle(0.03, 6, 1.43, 0.75), closed=False)
    K.sweep('pipe', lp, lf, circle(0.025, 6, 1.43, 0.35), closed=False)
    for i in lift[::3]:
        p = pts[i]
        rt, up, t = F[i]
        rod(K, 'pipe', p + rt * 1.43 + up * -0.32, p + rt * 1.43 + up * 0.75, 0.03, segs=5)
        rod(K, 'pipe', p + rt * 0.17 + up * -0.5, p + rt * 1.43 + up * -0.37, 0.03, segs=5)
    # chain dogs: little teeth along the chain
    for i in lift[::2]:
        rt, up, t = F[i]
        obox(K, 'iron', pts[i] + up * -0.09, rt, up, t, (0.1, 0.04, 0.08), bevel=0)
    # brake fins in the station straight
    for i in list(range(2, 23)) + list(range(372, 383)):
        rt, up, t = F[i]
        obox(K, 'metal', pts[i] + up * -0.16, rt, up, t, (0.03, 0.12, 0.55), bevel=0)
    # the support columns, on the very spots map.js gives them colliders (r 0.3)
    for sp in L['track']['supports']:
        x, z, ty = sp['x'], sp['z'], sp['y']
        th = Vector((sp['tx'], 0, sp['tz'])).normalized()
        yaw = math.atan2(th.x, th.z)
        top = ty - 0.8
        K.box('plinth', (x, 0.06, z), (1.0, 0.12, 1.0), rot=(0, yaw, 0), bevel=0.03)
        K.box('pipe', (x, 0.14, z), (0.62, 0.04, 0.62), rot=(0, yaw, 0), bevel=0.01)
        K.cyl(SUP, (x, (0.16 + top) / 2, z), 0.24, top - 0.16, segs=12)
        y = 4.0
        while y < top - 0.5:
            K.cyl('rust' if random.random() < 0.4 else SUP, (x, y, z), 0.3, 0.07, segs=12)
            y += 4.0
        # the saddle the spine sits in, and knee braces on the tall ones
        K.box(SUP, (x, top + 0.05, z), (0.95, 0.14, 0.42), rot=(0, yaw, 0), bevel=0.02)
        across = Vector((math.cos(yaw), 0, -math.sin(yaw)))
        for s in (-1, 1):
            c = Vector((x, top + 0.3, z)) + across * (s * 0.22)
            K.box(SUP, tuple(c), (0.04, 0.42, 0.36), rot=(0, yaw, 0), bevel=0)
            if top > 6:
                a = Vector((x, top - 1.5, z)) + across * (s * 0.2)
                b = Vector((x, top - 0.02, z)) + across * (s * 0.44)
                rod(K, SUP, tuple(a), tuple(b), 0.06, segs=6)
    # stub legs where the track runs low over the ground
    for i in range(0, n, 6):
        p = pts[i]
        if p.y > 2.6:
            continue
        top = p.y - 0.75
        K.box('plinth', (p.x, 0.04, p.z), (0.55, 0.08, 0.55), bevel=0.02)
        if top > 0.12:
            K.cyl(SUP, (p.x, top / 2 + 0.04, p.z), 0.11, top - 0.04, segs=8)
    return K


# ------------------------------------------------------------------ the coaster's loading station (track on -x)
# colliders: deck 5 x 22 (1 m), steps at x 3.2 (1.4 x 6, 0.5 m), roof 6 x 23 (4.6 - 4.9), posts at x 2.1,
# z -10/0/10 (r 0.2), the operator's booth at (1, 9.5) 2 x 2 from 1 to 3.4 m.

def station():
    random.seed(9)
    K = Kit()
    st = L['station']
    w, d = st['w'], st['d']
    K.box('plinth', (0.05, 0.44, 0), (w - 0.1, 0.88, d - 0.1), bevel=0.04)
    # a planked deck with gaps, a yellow safety edge, painted loading bays
    z = -d / 2 + 0.13
    while z < d / 2 - 0.1:
        K.box('wood' if random.random() > 0.06 else 'boards', (0, 0.93, z), (w, 0.1, 0.235), bevel=0.01)
        z += 0.255
    K.box(YEL, (-w / 2 + 0.22, 0.985, 0), (0.32, 0.012, d), bevel=0)
    for k in range(4):
        zc = -4.2 + k * 2.6
        for e in (-1.05, 1.05):
            K.box(CREAM, (-w / 2 + 0.85, 0.983, zc + e), (0.9, 0.008, 0.06), bevel=0)
    K.box('trim', (-w / 2 + 0.03, 0.75, 0), (0.08, 0.5, d), bevel=0.01)
    # concrete steps up from the path
    K.box('plinth', (3.2, 0.25, 0), (1.4, 0.5, 6), bevel=0.03)
    K.box('plinth', (2.75, 0.62, 0), (0.5, 0.24, 6), bevel=0.02)
    for s in (-1, 1):
        K.box(YEL, (3.2, 0.505, s * 2.9), (1.4, 0.01, 0.12), bevel=0)
    # three red steel posts with cantilevered beams reaching over the track, and braces
    for dz in (-10, 0, 10):
        K.box('pipe', (2.1, 1.02, dz), (0.45, 0.06, 0.45), bevel=0.01)
        K.cyl(RED, (2.1, 2.8, dz), 0.17, 3.6, segs=12)
        obox(K, RED, (-0.45, 4.48, dz), Vector((1, 0.04, 0)).normalized(), Vector((-0.04, 1, 0)).normalized(), (0, 0, 1), (5.4, 0.28, 0.16))
        rod(K, RED, (2.1, 3.0, dz), (0.0, 4.36, dz), 0.06, segs=8)
    # purlins, the corrugated roof (higher over the track, shedding water toward the back) and its fascia with bulbs
    for x in (-2.8, -1.4, 0.0, 1.4, 2.6):
        K.box('pipe', (x, 4.62 + -x * 0.04, 0), (0.1, 0.12, d + 1), bevel=0.01)
    K.box('roof', (0, 4.76, 0), (6.2, 0.06, d + 1.2), rot=(0, 0, 0.04), bevel=0)
    K.box(RED, (-3.1, 4.68, 0), (0.08, 0.42, d + 1.3), bevel=0.01)
    K.box(CREAM, (-3.15, 4.84, 0), (0.02, 0.06, d + 1.3), bevel=0)
    for s in (-1, 1):
        K.box(RED, (0, 4.68, s * (d + 1.3) / 2), (6.2, 0.42, 0.08), rot=(0, 0, 0.04), bevel=0.01)
    z = -d / 2
    while z <= d / 2:
        bulb(K, (-3.16, 4.6, z), random.random() < 0.2, r=0.08)
        z += 0.6
    # the board the THE LAST RIDE neon is fixed to, standing on the back of the roof
    K.box('dark', (2.62, 5.6, 0), (0.08, 1.3, 9.2), bevel=0.01)
    for yy in (4.92, 6.28):
        K.box(YEL, (2.64, yy, 0), (0.12, 0.08, 9.3), bevel=0.01)
    for zz in (-3.5, 0, 3.5):
        rod(K, 'iron', (2.5, 4.75, zz), (2.5, 5.9, zz), 0.04)
    # hand rails along the back, open where the steps come up
    for z0, z1 in ((-11, -3.4), (3.4, 11)):
        mid, ln = (z0 + z1) / 2, z1 - z0
        for yy in (1.55, 2.0):
            K.cyl('pipe', (w / 2 - 0.1, yy, mid), 0.03, ln, axis='z', segs=6)
        zz = z0
        while zz <= z1 + 0.01:
            K.cyl('pipe', (w / 2 - 0.1, 1.5, zz), 0.035, 1.0, segs=6)
            zz += ln / 4
    # the operator's booth at the far end: teal steel, a smashed window onto the track, a door at the back
    bx, bz = 1.0, 9.5
    K.box(TEAL, (bx, 1.65, bz), (2.0, 1.3, 2.0), bevel=0.02)
    K.box(CREAM, (bx, 3.25, bz), (2.04, 0.3, 2.04), bevel=0.02)
    for s in (-1, 1):
        K.box(TEAL, (bx + s * 0.97, 2.7, bz), (0.06, 0.8, 0.06), bevel=0)
        K.box(TEAL, (bx, 2.7, bz + s * 0.97), (0.06, 0.8, 0.06), bevel=0)
    K.box('dark', (bx - 0.99, 2.7, bz), (0.02, 0.8, 1.9), bevel=0)
    K.box('#2c4a3a', (bx - 1.0, 2.5, bz + 0.5), (0.02, 0.38, 0.8), bevel=0)
    K.box('dark', (bx, 2.7, bz - 0.99), (1.9, 0.8, 0.02), bevel=0)
    K.box('dark', (bx, 2.7, bz + 0.99), (1.9, 0.8, 0.02), bevel=0)
    K.box('shutter', (bx + 1.0, 2.0, bz), (0.04, 1.9, 0.8), bevel=0.01)
    K.box('roof', (bx, 3.46, bz), (2.4, 0.1, 2.4), bevel=0.02)
    K.box('iron', (bx - 0.6, 2.05, bz), (0.5, 0.12, 1.4), rot=(0, 0, 0.3), bevel=0.01)
    for k, lit in enumerate(('bulbRed', 'bulbGreen', 'bulb')):
        K.ball(lit if random.random() < 0.5 else DEAD, (bx - 0.7, 2.15, bz - 0.4 + k * 0.4), 0.05, segs=6)
    # a 'you must be this tall' board by the steps
    K.cyl('pipe', (3.6, 1.2, 3.55), 0.04, 1.4, segs=6)
    K.box(YEL, (3.6, 1.75, 3.55), (0.05, 0.6, 0.45), bevel=0.01)
    K.box(RED, (3.6, 1.35, 3.55), (0.06, 0.05, 0.6), bevel=0)
    return K


# ------------------------------------------------------------------ the Ferris wheel's control booth (2.4 x 2.2, 2.7)

def control():
    random.seed(4)
    K = Kit()
    K.box('plinth', (0, 0.1, 0), (2.6, 0.2, 2.4), bevel=0.03)
    K.box(TEAL, (0, 0.75, 0), (2.4, 1.1, 2.2), bevel=0.03)
    K.box(CREAM, (0, 1.35, 0), (2.42, 0.1, 2.22), bevel=0.01)
    # windows round three sides (toward the wheel at -z widest), a door on +z
    for sx in (-1, 1):
        K.box(TEAL, (sx * 1.17, 1.85, 0), (0.06, 0.9, 2.2), bevel=0)
        K.box('dark', (sx * 1.18, 1.85, 0), (0.02, 0.75, 1.8), bevel=0)
    K.box('dark', (0, 1.85, -1.08), (2.2, 0.85, 0.04), bevel=0)
    K.box('#2c4a3a', (-0.55, 1.75, -1.1), (0.9, 0.55, 0.02), bevel=0)
    for x in (-1.15, -0.38, 0.38, 1.15):
        K.box(TEAL, (x, 1.85, -1.09), (0.07, 0.9, 0.07), bevel=0)
    K.box(TEAL, (0.55, 1.85, 1.08), (1.3, 0.9, 0.06), bevel=0)
    K.box('shutter', (-0.55, 1.3, 1.11), (0.85, 2.0, 0.04), bevel=0.01)
    K.box('iron', (-0.25, 1.2, 1.14), (0.12, 0.04, 0.04), bevel=0)
    K.box(CREAM, (0, 2.42, 0), (2.42, 0.25, 2.22), bevel=0.01)
    K.box('roof', (0, 2.62, 0), (2.9, 0.14, 2.7), bevel=0.03)
    # a few bulbs round the roof's edge, a dead beacon, a cable conduit and a rusty fuse box
    for k in range(8):
        t = -1.3 + k * 2.6 / 7
        for s in (-1, 1):
            bulb(K, (t, 2.5, s * 1.38), random.random() < 0.25, r=0.06)
    K.cyl('iron', (0.8, 2.8, 0.6), 0.1, 0.22, segs=8)
    K.ball(DEAD, (0.8, 3.0, 0.6), 0.12, segs=8)
    K.cyl('pipe', (1.22, 1.3, -0.7), 0.05, 2.6, segs=6)
    K.box('rust', (1.23, 1.0, 0.4), (0.06, 0.6, 0.45), bevel=0.01)
    return K


# ------------------------------------------------------------------ the bumper-car pavilion (26 x 18)
# colliders: floor 0.18, rails 0.75 high and 0.5 thick (gaps of 6 m mid each long side), six columns r 0.3 at
# x -13/0/13, z -9/9 up to 6 m, the roof slab 6 - 6.4.

def arena():
    random.seed(8)
    K = Kit()
    a = L['arena']
    w, d = a['w'], a['d']
    # steel floor plates, seams on a 2 m grid, rust where the paint went
    K.box('pipe', (0, 0.09, 0), (w, 0.18, d), bevel=0.02)
    x = -w / 2 + 2
    while x < w / 2 - 0.1:
        K.box('dark', (x, 0.181, 0), (0.03, 0.003, d), bevel=0)
        x += 2
    z = -d / 2 + 2
    while z < d / 2 - 0.1:
        K.box('dark', (0, 0.181, z), (w, 0.003, 0.03), bevel=0)
        z += 2
    for _ in range(14):
        K.box('rust', (random.uniform(-w / 2 + 1, w / 2 - 1), 0.182, random.uniform(-d / 2 + 1, d / 2 - 1)),
              (random.uniform(0.6, 2.2), 0.003, random.uniform(0.6, 2.2)), rot=(0, random.uniform(0, 3), 0), bevel=0)

    def rail(cx, cz, ln, along_x, inward):
        """A bumper rail: yellow and black panels, a steel cap, a rubber strip on the inside."""
        k = 0
        t = -ln / 2
        while t < ln / 2 - 0.01:
            seg = min(1.0, ln / 2 - t)
            c = (cx + (t + seg / 2), 0.44, cz) if along_x else (cx, 0.44, cz + (t + seg / 2))
            K.box(YEL if k % 2 == 0 else 'dark', c, (seg, 0.52, 0.46) if along_x else (0.46, 0.52, seg), bevel=0.005)
            t += seg
            k += 1
        K.box('pipe', (cx, 0.73, cz), (ln, 0.05, 0.5) if along_x else (0.5, 0.05, ln), bevel=0.01)
        ix, iz = inward
        K.box('rubber', (cx + ix * 0.27, 0.42, cz + iz * 0.27), (ln, 0.24, 0.08) if along_x else (0.08, 0.24, ln), bevel=0.02)

    for sz in (-1, 1):
        for sx in (-1, 1):
            rail(sx * (w / 4 + 1.5), sz * d / 2, w / 2 - 3, True, (0, -sz))
    for sx in (-1, 1):
        rail(sx * w / 2, 0, d, False, (-sx, 0))
    # red columns on base plates, with capitals under the beams
    for sx in (-1, 0, 1):
        for sz in (-1, 1):
            cx, cz = sx * w / 2, sz * d / 2
            K.box('pipe', (cx, 0.2, cz), (0.62, 0.05, 0.62), bevel=0.01)
            K.cyl(RED, (cx, 3.1, cz), 0.27, 5.8, segs=12)
            K.box(RED, (cx, 5.6, cz), (0.5, 0.25, 0.5), bevel=0.02)
    # the roof's frame: main beams over the columns, an edge beam round it, joists, the pick-up mesh the poles touched
    for sx in (-1, 0, 1):
        K.box('pipe', (sx * w / 2, 5.82, 0), (0.3, 0.36, d + 0.6), bevel=0.02)
    for sz in (-1, 1):
        K.box('pipe', (0, 5.82, sz * d / 2), (w + 0.6, 0.36, 0.3), bevel=0.02)
    x = -w / 2 + 1.3
    while x < w / 2:
        K.box('iron', (x, 5.9, 0), (0.1, 0.16, d), bevel=0)
        x += 2.6
    x = -w / 2 + 1
    while x < w / 2:
        K.box('iron', (x, 5.6, 0), (0.025, 0.025, d - 1), bevel=0)
        x += 1.2
    z = -d / 2 + 1
    while z < d / 2:
        K.box('iron', (0, 5.59, z), (w - 1, 0.025, 0.025), bevel=0)
        z += 1.2
    # hanging work lamps under the joists
    for lx in (-6.5, 6.5):
        for lz in (-4, 4):
            K.cyl('iron', (lx, 5.3, lz), 0.32, 0.25, segs=10, r2=0.06)
            K.cyl('iron', (lx, 5.6, lz), 0.015, 0.4, segs=4)
            bulb(K, (lx, 5.16, lz), random.random() < 0.5, r=0.1)
    # roof deck and a cream fascia with marquee bulbs, blue and white
    K.box('roof', (0, 6.45, 0), (w + 1.2, 0.1, d + 1.2), bevel=0.02)
    for sz in (-1, 1):
        K.box(CREAM, (0, 6.2, sz * (d + 1.2) / 2), (w + 1.3, 0.5, 0.08), bevel=0.01)
    for sx in (-1, 1):
        K.box(CREAM, (sx * (w + 1.2) / 2, 6.2, 0), (0.08, 0.5, d + 1.3), bevel=0.01)
    per = 2 * (w + d)
    for i in range(int(per / 0.7)):
        t = i * 0.7
        if t < w:
            lx, lz = -w / 2 + t, -d / 2 - 0.66
        elif t - w < d:
            lx, lz = w / 2 + 0.66, -d / 2 + (t - w)
        elif t - w - d < w:
            lx, lz = w / 2 - (t - w - d), d / 2 + 0.66
        else:
            lx, lz = -w / 2 - 0.66, d / 2 - (t - 2 * w - d)
        bulb(K, (lx, 6.02, lz), random.random() < 0.25, r=0.08, lit='bulbCyan' if i % 3 == 0 else 'bulb')
    # the arched board the BUMPER CARS neon hangs on, over the front
    arch = [(-6.0, 6.5)] + [(6.0 * math.cos(math.pi - k * math.pi / 16), 7.5 + 1.5 * math.sin(k * math.pi / 16)) for k in range(17)] + [(6.0, 6.5)]
    K.prism('#2f9be0', arch, d / 2 + 0.3, 0.12)
    big = [(-6.25, 6.5)] + [(6.25 * math.cos(math.pi - k * math.pi / 16), 7.5 + 1.75 * math.sin(k * math.pi / 16)) for k in range(17)] + [(6.25, 6.5)]
    K.prism(CREAM, big, d / 2 + 0.2, 0.1)
    for k in range(1, 16):
        ang = math.pi - k * math.pi / 16
        bulb(K, (6.12 * math.cos(ang), 7.5 + 1.62 * math.sin(ang), d / 2 + 0.44), random.random() < 0.3, r=0.07)
    return K


PARTS = {
    'freefall': freefall, 'freefall_seats': freefall_seats, 'coaster': coaster,
    'station': station, 'control': control, 'arena': arena,
}
for name, fn in PARTS.items():
    if ONLY and name not in ONLY:
        continue
    fn().export(f'{OUT}/kit_{name}.glb', smooth=SMOOTH)
