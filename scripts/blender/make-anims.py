# New animations for the riders, keyed in Blender on the Mixamo skeleton the game's clips use: a spike stab, an
# overhead mallet whack, a chainsaw hold and revving thrust, a ghost's limp float, flailing on a long fall (off the
# bus), and two deaths (to the knees and forward; a twisting fall sideways).
#
#   blender --background --factory-startup --python scripts/blender/make-anims.py -- <mixamo anims folder> <out folder> [clip ...]
#
# Each clip starts from a Mixamo clip's pose (kept breathing underneath) and is posed on top of it: hand and foot
# targets reached with two-bone IK, and turns of the hips, spine and head, all given in the body's own frame
# (metres forward, right, up from the ground under the hips). Exported as FBX like Mixamo's, so
# scripts/add-anims.mjs can put them through the same converter into public/models/anims.glb.
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
ONLY = set(args[2:])
FPS = 30
os.makedirs(OUT, exist_ok=True)
P = 'mixamorig:'


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def track(keys, t):
    """Value at time t of keys [(time, value), ...]: eased between keys; values are numbers or tuples."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, a), (t1, b) in zip(keys, keys[1:]):
        if t <= t1:
            u = smooth((t - t0) / (t1 - t0))
            if isinstance(a, tuple):
                return tuple(x + (y - x) * u for x, y in zip(a, b))
            return a + (b - a) * u
    return keys[-1][1]


class Rig:
    def __init__(self, base):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, base), automatic_bone_orientation=False, ignore_leaf_bones=False)
        self.arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        self.base = self.arm.animation_data.action
        self.base_range = tuple(int(v) for v in self.base.frame_range)
        self.sc = bpy.context.scene
        self.sc.render.fps = FPS
        for pb in self.arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        self.sc.frame_set(self.base_range[0])
        self.update()
        lh, rh = self.head('LeftUpLeg'), self.head('RightUpLeg')
        right = rh - lh
        right.z = 0
        self.right = right.normalized()
        self.up = Vector((0, 0, 1))
        self.fwd = self.up.cross(self.right).normalized()
        hips = self.head('Hips')
        self.origin = Vector((hips.x, hips.y, 0))
        print('RIG', base, 'hips', tuple(round(v, 2) for v in self.body_of(hips)), 'R hand', tuple(round(v, 2) for v in self.body_of(self.head('RightHand'))),
              'R shoulder', tuple(round(v, 2) for v in self.body_of(self.head('RightArm'))), 'R foot', tuple(round(v, 2) for v in self.body_of(self.head('RightFoot'))), flush=True)

    def update(self):
        bpy.context.view_layer.update()

    def pb(self, name):
        return self.arm.pose.bones[P + name]

    def head(self, name):
        return self.arm.matrix_world @ self.pb(name).head

    def body(self, f, r, u):
        return self.origin + self.fwd * f + self.right * r + self.up * u

    def body_of(self, p):
        d = p - self.origin
        return (d.dot(self.fwd), d.dot(self.right), d.dot(self.up))

    def rotate(self, name, q, pivot=None):
        """Turn a bone (and everything under it) by world rotation q about pivot (default: its head)."""
        pb = self.pb(name)
        pivot = self.head(name) if pivot is None else pivot
        M = self.arm.matrix_world @ pb.matrix
        R = Matrix.Translation(pivot) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pivot)
        pb.matrix = self.arm.matrix_world.inverted() @ (R @ M)
        self.update()

    def move(self, name, offset):
        pb = self.pb(name)
        M = self.arm.matrix_world @ pb.matrix
        pb.matrix = self.arm.matrix_world.inverted() @ (Matrix.Translation(offset) @ M)
        self.update()

    def euler(self, pitch=0.0, yaw=0.0, roll=0.0):
        """Body-frame turn: pitch leans forward, yaw turns to the left, roll leans to the right."""
        q = Quaternion(-self.right, pitch)
        q = Quaternion(self.up, yaw) @ q
        return Quaternion(self.fwd, roll) @ q

    def ik(self, upper, lower, end, target, pole):
        """Two-bone IK: put the end joint (wrist / ankle) on target, the middle joint bending toward pole."""
        S, E0, H0 = self.head(upper), self.head(lower), self.head(end)
        l1, l2 = (E0 - S).length, (H0 - E0).length
        d = target - S
        dist = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, d.length))
        n = d.normalized()
        b = (pole - S) - n * (pole - S).dot(n)
        b = b.normalized() if b.length > 1e-6 else self.fwd
        a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
        h = math.sqrt(max(0.0, l1 * l1 - a * a))
        E = S + n * a + b * h
        self.rotate(upper, (E0 - S).normalized().rotation_difference((E - S).normalized()), S)
        E1, H1 = self.head(lower), self.head(end)
        T = S + n * dist
        self.rotate(lower, (H1 - E1).normalized().rotation_difference((T - E1).normalized()), E1)

    def bake(self, name, dur, pose_at, loop=False):
        """Sample pose_at(t) at 30 fps on top of the base clip, key it as a new action, export the FBX."""
        frames = int(round(dur * FPS))
        b0, b1 = self.base_range
        bones = list(self.arm.pose.bones)
        saved = []
        for f in range(frames + 1):
            t = f / FPS
            if loop and f == frames:
                saved.append(saved[0])
                break
            self.sc.frame_set(b0 + (f % max(1, b1 - b0)))
            self.update()
            pose_at(self, t)
            saved.append([(pb.location.copy(), pb.rotation_quaternion.copy()) for pb in bones])
        self.arm.animation_data.action = None
        act = bpy.data.actions.new(name)
        self.arm.animation_data.action = act
        for f, pose in enumerate(saved):
            for pb, (loc, rot) in zip(bones, pose):
                pb.location = loc
                pb.rotation_quaternion = rot
                pb.keyframe_insert('rotation_quaternion', frame=f + 1)
                if pb.name == P + 'Hips':
                    pb.keyframe_insert('location', frame=f + 1)
        self.sc.frame_start = 1
        self.sc.frame_end = frames + 1
        bpy.ops.object.select_all(action='DESELECT')
        self.arm.select_set(True)
        bpy.context.view_layer.objects.active = self.arm
        path = os.path.join(OUT, f'{name}.fbx')
        bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={'ARMATURE'}, add_leaf_bones=False, bake_anim=True,
                                 bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False, bake_anim_simplify_factor=0.0,
                                 armature_nodetype='NULL')
        print(f'ANIM {name}: {frames + 1} frames ({dur:.2f} s) -> {path}', flush=True)


def spine(rig, pitch=0.0, yaw=0.0, roll=0.0):
    for bone, k in (('Spine', 0.3), ('Spine1', 0.35), ('Spine2', 0.35)):
        rig.rotate(bone, rig.euler(pitch * k, yaw * k, roll * k))


def headturn(rig, pitch=0.0, yaw=0.0, roll=0.0):
    rig.rotate('Neck', rig.euler(pitch * 0.4, yaw * 0.4, roll * 0.4))
    rig.rotate('Head', rig.euler(pitch * 0.6, yaw * 0.6, roll * 0.6))


def arm_to(rig, side, target, pole):
    rig.ik(f'{side}Arm', f'{side}ForeArm', f'{side}Hand', rig.body(*target), rig.body(*pole))


def leg_to(rig, side, target, pole):
    rig.ik(f'{side}UpLeg', f'{side}Leg', f'{side}Foot', rig.body(*target), rig.body(*pole))


# ------------------------------------------------------------------ the clips

def spike_stab():
    rig = Rig('m_idle.fbx')
    R = [(0.0, (0.28, 0.24, 1.12)), (0.3, (-0.08, 0.3, 1.02)), (0.45, (0.78, 0.1, 1.36)), (0.7, (0.4, 0.22, 1.18)), (0.9, (0.28, 0.24, 1.12))]
    yaw = [(0.0, 0.0), (0.3, -0.35), (0.45, 0.5), (0.7, 0.15), (0.9, 0.0)]
    pitch = [(0.0, 0.0), (0.3, -0.05), (0.45, 0.2), (0.9, 0.0)]

    def pose(r, t):
        spine(r, track(pitch, t), track(yaw, t))
        arm_to(r, 'Right', track(R, t), (-0.3, 0.6, 0.8))
    rig.bake('spike_stab', 0.9, pose)


def mallet_whack():
    rig = Rig('m_idle.fbx')
    R = [(0.0, (0.28, 0.24, 1.12)), (0.35, (-0.12, 0.22, 1.98)), (0.55, (0.7, 0.08, 0.86)), (0.8, (0.45, 0.2, 1.0)), (1.0, (0.28, 0.24, 1.12))]
    pitch = [(0.0, 0.0), (0.35, -0.2), (0.55, 0.5), (0.8, 0.25), (1.0, 0.0)]
    yaw = [(0.0, 0.0), (0.35, -0.2), (0.55, 0.2), (1.0, 0.0)]

    def pose(r, t):
        spine(r, track(pitch, t), track(yaw, t))
        headturn(r, -track(pitch, t) * 0.4)
        arm_to(r, 'Right', track(R, t), (-0.4, 0.7, 0.9))
    rig.bake('mallet_whack', 1.0, pose)


def saw(name, dur, reach):
    rig = Rig('m_idle.fbx')

    def pose(r, t):
        # the motor shakes everything; the thrust pushes the bar out and back
        s = math.sin(t * 2 * math.pi / dur)
        j = (math.sin(t * 91.0) * 0.012, math.sin(t * 73.0 + 1.0) * 0.012, math.sin(t * 107.0 + 2.0) * 0.012)
        push = reach * (0.5 - 0.5 * math.cos(t * 2 * math.pi / dur))
        spine(r, 0.12 + push * 0.4 + j[0] * 2, 0.25 + s * 0.04, j[1] * 2)
        arm_to(r, 'Right', (0.32 + push + j[0], 0.2 + j[1], 0.98 + j[2]), (-0.4, 0.6, 0.6))
        arm_to(r, 'Left', (0.55 + push + j[1], 0.02 + j[2], 1.1 + j[0]), (-0.2, -0.6, 0.7))
    rig.bake(name, dur, pose, loop=True)


def ghost_float():
    rig = Rig('breath_idle.fbx')
    dur = 3.2

    def pose(r, t):
        w = 2 * math.pi * t / dur
        spine(r, 0.18 + math.sin(w) * 0.04, math.sin(w * 0.5) * 0.08, math.sin(w + 1.2) * 0.06)
        headturn(r, 0.45 + math.sin(w + 0.6) * 0.06, math.sin(w * 0.5 + 1) * 0.15, 0.12)
        arm_to(r, 'Right', (0.14 + math.sin(w) * 0.05, 0.32, 0.74 + math.sin(w + 0.5) * 0.04), (-0.4, 0.5, 1.1))
        arm_to(r, 'Left', (0.12 + math.sin(w + 2) * 0.05, -0.32, 0.72 + math.sin(w + 2.4) * 0.04), (-0.4, -0.5, 1.1))
        # legs hang: knees a little bent, toes trailing
        leg_to(r, 'Right', (-0.12 + math.sin(w + 1) * 0.04, 0.1, 0.2), (0.8, 0.12, 0.6))
        leg_to(r, 'Left', (-0.06 + math.sin(w + 2.5) * 0.04, -0.11, 0.16), (0.8, -0.12, 0.6))
    rig.bake('ghost_float', dur, pose, loop=True)


def fall_flail():
    rig = Rig('breath_idle.fbx')
    dur = 1.1

    def pose(r, t):
        w = 2 * math.pi * t / dur
        spine(r, -0.2, math.sin(w) * 0.15, math.sin(w * 2) * 0.05)
        headturn(r, -0.25, math.sin(w + 1) * 0.2)
        # arms wheel round, out of step with each other
        arm_to(r, 'Right', (0.15 + math.cos(w) * 0.4, 0.5, 1.55 + math.sin(w) * 0.4), (-0.6, 0.8, 1.2))
        arm_to(r, 'Left', (0.15 + math.cos(w + math.pi) * 0.4, -0.5, 1.55 + math.sin(w + math.pi) * 0.4), (-0.6, -0.8, 1.2))
        # legs kick as if pedalling the air
        leg_to(r, 'Right', (0.15 + math.cos(w) * 0.25, 0.12, 0.3 + math.sin(w) * 0.18), (1.0, 0.15, 0.6))
        leg_to(r, 'Left', (0.15 + math.cos(w + math.pi) * 0.25, -0.12, 0.3 + math.sin(w + math.pi) * 0.18), (1.0, -0.15, 0.6))
    rig.bake('fall_flail', dur, pose, loop=True)


def death_kneel():
    rig = Rig('breath_idle.fbx')
    hips_down = [(0.0, 0.0), (0.35, 0.0), (1.0, -0.42), (1.6, -0.5), (2.15, -0.86), (2.6, -0.88)]
    hips_fwd = [(0.0, 0.0), (0.35, -0.05), (1.0, 0.12), (1.6, 0.14), (2.15, 0.62), (2.6, 0.64)]
    hips_pitch = [(0.0, 0.0), (1.6, 0.1), (2.15, 1.35), (2.6, 1.4)]
    pitch = [(0.0, 0.0), (0.35, -0.3), (1.0, 0.35), (1.6, 0.6), (2.15, 0.1), (2.6, 0.05)]
    head = [(0.0, 0.0), (0.35, -0.35), (1.0, 0.3), (1.6, 0.5), (2.15, 0.0)]
    head_yaw = [(0.0, 0.0), (1.6, 0.0), (2.15, 0.6)]
    R = [(0.0, (0.1, 0.3, 0.85)), (0.35, (0.25, 0.08, 1.28)), (1.0, (0.3, 0.06, 0.98)), (1.6, (0.32, 0.26, 0.4)), (2.15, (0.95, 0.5, 0.06)), (2.6, (0.97, 0.52, 0.04))]
    L = [(0.0, (0.1, -0.3, 0.85)), (0.35, (0.25, -0.1, 1.24)), (1.0, (0.3, -0.06, 0.95)), (1.6, (0.3, -0.26, 0.38)), (2.15, (0.85, -0.55, 0.06)), (2.6, (0.86, -0.57, 0.04))]
    RF = [(0.0, (0.0, 0.11, 0.08)), (1.6, (0.0, 0.11, 0.08)), (2.15, (-0.4, 0.14, 0.06))]
    LF = [(0.0, (0.0, -0.11, 0.08)), (1.6, (0.0, -0.11, 0.08)), (2.15, (-0.42, -0.16, 0.06))]

    def pose(r, t):
        r.rotate('Hips', r.euler(track(hips_pitch, t)))
        r.move('Hips', r.fwd * track(hips_fwd, t) + r.up * track(hips_down, t))
        spine(r, track(pitch, t))
        headturn(r, track(head, t), track(head_yaw, t))
        arm_to(r, 'Right', track(R, t), (-0.3, 0.8, 0.6))
        arm_to(r, 'Left', track(L, t), (-0.3, -0.8, 0.6))
        leg_to(r, 'Right', track(RF, t), (1.2, 0.2, 0.5))
        leg_to(r, 'Left', track(LF, t), (1.2, -0.2, 0.5))
    rig.bake('death_kneel', 2.6, pose)


def death_twist():
    rig = Rig('breath_idle.fbx')
    hips_yaw = [(0.0, 0.0), (0.3, 0.3), (0.9, 1.1), (1.5, 1.5), (2.2, 1.55)]
    hips_roll = [(0.0, 0.0), (0.9, 0.2), (1.5, 1.35), (2.2, 1.45)]
    hips_down = [(0.0, 0.0), (0.3, 0.0), (0.9, -0.28), (1.5, -0.8), (2.2, -0.86)]
    hips_side = [(0.0, 0.0), (0.9, 0.1), (1.5, 0.55), (2.2, 0.6)]
    yaw = [(0.0, 0.0), (0.3, 0.6), (0.9, 0.3), (1.5, 0.1)]
    roll = [(0.0, 0.0), (0.9, 0.25), (1.5, 0.3)]
    head = [(0.0, (0.0, 0.0)), (0.3, (-0.3, 0.5)), (0.9, (0.2, 0.2)), (1.5, (0.1, -0.3))]
    R = [(0.0, (0.1, 0.3, 0.85)), (0.3, (0.1, 0.72, 1.3)), (0.9, (0.0, 0.7, 0.9)), (1.5, (0.1, 1.15, 0.08)), (2.2, (0.12, 1.18, 0.05))]
    L = [(0.0, (0.1, -0.3, 0.85)), (0.3, (0.26, -0.05, 1.2)), (0.9, (0.3, 0.05, 0.95)), (1.5, (0.55, 0.45, 0.15)), (2.2, (0.56, 0.47, 0.08))]
    RF = [(0.0, (0.0, 0.11, 0.08)), (0.9, (0.0, 0.11, 0.08)), (1.5, (0.15, 0.3, 0.08)), (2.2, (0.16, 0.32, 0.06))]
    LF = [(0.0, (0.0, -0.11, 0.08)), (0.9, (0.05, -0.1, 0.08)), (1.5, (0.35, 0.05, 0.1)), (2.2, (0.36, 0.06, 0.08))]

    def pose(r, t):
        r.rotate('Hips', r.euler(0.0, track(hips_yaw, t), track(hips_roll, t)))
        r.move('Hips', r.right * track(hips_side, t) + r.up * track(hips_down, t))
        spine(r, 0.1, track(yaw, t), track(roll, t))
        hp, hy = track(head, t)
        headturn(r, hp, hy)
        arm_to(r, 'Right', track(R, t), (-0.3, 0.8, 0.4))
        arm_to(r, 'Left', track(L, t), (-0.3, -0.8, 0.4))
        leg_to(r, 'Right', track(RF, t), (1.2, 0.3, 0.5))
        leg_to(r, 'Left', track(LF, t), (1.2, -0.1, 0.5))
    rig.bake('death_twist', 2.2, pose)


def possess_ride():
    """A ghost inside a bumper car or a coaster car: hunched into it, both hands clawed round the front as if
    gripping the wheel, head thrown back, the whole body shuddering with the stolen power."""
    rig = Rig('breath_idle.fbx')
    dur = 1.6

    def pose(r, t):
        w = 2 * math.pi * t / dur
        jit = math.sin(w * 9) * 0.5 + math.sin(w * 13 + 1.1) * 0.5  # the shudder (whole cycles in the loop)
        spine(r, 0.55 + math.sin(w) * 0.05 + jit * 0.02, math.sin(w * 2) * 0.05, jit * 0.03)
        headturn(r, -0.55 + math.sin(w + 0.8) * 0.08, math.sin(w) * 0.12, jit * 0.05)
        for side, s in (('Right', 1), ('Left', -1)):
            ph = 0 if s > 0 else 2.1
            arm_to(r, side, (0.5 + math.sin(w + ph) * 0.03, 0.26 * s, 0.82 + jit * 0.015 * s), (-0.3, 0.9 * s, 1.0))
            # knees drawn up, sunk into the seat
            leg_to(r, side, (0.18, 0.14 * s, 0.42), (0.9, 0.15 * s, 0.7))
    rig.bake('possess_ride', dur, pose, loop=True)


def possess_wheel():
    """A ghost at the foot of the Ferris wheel it has taken: floating, back arched, both arms raised high toward the
    wheel, fingers spread, swaying as it drags the wheel round."""
    rig = Rig('breath_idle.fbx')
    dur = 3.0

    def pose(r, t):
        w = 2 * math.pi * t / dur
        jit = math.sin(w * 11) * 0.5 + math.sin(w * 17 + 0.7) * 0.5
        spine(r, -0.3 + math.sin(w) * 0.06, math.sin(w * 0.5) * 0.1, math.sin(w + 1.0) * 0.06)
        headturn(r, -0.6 + math.sin(w + 0.4) * 0.07, math.sin(w * 0.5 + 0.5) * 0.12, 0.0)
        for side, s in (('Right', 1), ('Left', -1)):
            ph = 0 if s > 0 else math.pi
            arm_to(r, side, (0.22 + math.sin(w + ph) * 0.06, 0.5 * s, 1.95 + math.sin(w * 2 + ph) * 0.05 + jit * 0.01),
                   (-0.5, 0.8 * s, 1.2))
            # legs trail below, a little apart
            leg_to(r, side, (-0.16 + math.sin(w + ph + 1) * 0.04, 0.13 * s, 0.08), (0.8, 0.15 * s, 0.55))
    rig.bake('possess_wheel', dur, pose, loop=True)


CLIPS = {
    'possess_ride': possess_ride, 'possess_wheel': possess_wheel,
    'spike_stab': spike_stab, 'mallet_whack': mallet_whack,
    'saw_idle': lambda: saw('saw_idle', 0.6, 0.0), 'saw_rev': lambda: saw('saw_rev', 0.8, 0.22),
    'ghost_float': ghost_float, 'fall_flail': fall_flail, 'death_kneel': death_kneel, 'death_twist': death_twist,
}
for name, fn in CLIPS.items():
    if ONLY and name not in ONLY:
        continue
    fn()
print('ANIMS done', flush=True)
