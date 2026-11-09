# Shared modelling helpers for the Blender kit scripts (build-kit.py, build-rides.py): geometry is gathered per
# material in game coordinates (x right, y up, z toward the gate) and written out as one mesh per material, each
# named after one of the game's materials (src/world.js MATS, or a '#rrggbb' paint).
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


class Kit:
    """Geometry gathered per material, then turned into one mesh per material."""

    def __init__(self):
        self.parts = {}

    def _take(self, mat, bm, M=None, recalc=True):
        if M is not None:
            bm.transform(M)
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        verts, faces = self.parts.setdefault(mat, ([], []))
        base = len(verts)
        verts.extend(tuple(v.co) for v in bm.verts)
        idx = {v: i for i, v in enumerate(bm.verts)}
        faces.extend(tuple(base + idx[v] for v in f.verts) for f in bm.faces)
        bm.free()

    def box(self, mat, at, size, rot=(0, 0, 0), bevel=0.02, segs=1):
        """A box size (w, h, d) centred at 'at', turned by rot (x, y, z radians, applied y, x, z)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        if bevel > 0:
            b = min(bevel, min(size) * 0.45)
            bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=b, segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
        M = Matrix.Translation(Vector(at)) @ Euler(rot, 'YXZ').to_matrix().to_4x4()
        self._take(mat, bm, M)

    def cyl(self, mat, at, r, h, axis='y', segs=10, r2=None, rot=None):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
        # the cone is made along z; point it along the asked axis
        R = {'y': Euler((-math.pi / 2, 0, 0)), 'x': Euler((0, math.pi / 2, 0)), 'z': Euler((0, 0, 0))}[axis].to_matrix().to_4x4()
        if rot is not None:
            R = Euler(rot, 'YXZ').to_matrix().to_4x4() @ R
        self._take(mat, bm, Matrix.Translation(Vector(at)) @ R)

    def ball(self, mat, at, r, segs=8):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(4, segs // 2), radius=r)
        self._take(mat, bm, Matrix.Translation(Vector(at)))

    def prism(self, mat, outline, z0, depth, bevel=0.03):
        """An outline in the x-y plane (game), pushed out in z from z0 to z0 + depth, with softened edges."""
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, z0)) for x, y in outline]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=(0, 0, depth), verts=moved)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
        # the outline is concave: cut its faces into triangles the careful way, or the exporter leaves holes
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='EAR_CLIP')
        self._take(mat, bm)

    def sweep(self, mat, pts, frames, profile, closed=True):
        """A profile (list of (across, up) offsets) carried along pts, using each point's (right, up) frame."""
        bm = bmesh.new()
        rings = []
        for p, (rt, up) in zip(pts, frames):
            p, rt, up = Vector(p), Vector(rt), Vector(up)
            rings.append([bm.verts.new(p + rt * a + up * b) for a, b in profile])
        n = len(profile)
        last = len(rings) if closed else len(rings) - 1
        for i in range(last):
            r0, r1 = rings[i], rings[(i + 1) % len(rings)]
            for k in range(n):
                bm.faces.new((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]))
        if not closed:
            bm.faces.new(rings[0][::-1])
            bm.faces.new(rings[-1])
        self._take(mat, bm)

    def export(self, path, smooth=None):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        total = 0
        for mat, (verts, faces) in self.parts.items():
            me = bpy.data.meshes.new(mat)
            # game (x, y, z) -> Blender (x, -z, y): a proper rotation, so faces keep their winding
            me.from_pydata([(x, -z, y) for x, y, z in verts], [], faces)
            me.validate()
            me.update()
            if smooth:
                # round parts shade smooth; edges sharper than this angle stay crisp
                me.shade_smooth()
                me.set_sharp_from_angle(angle=smooth)
            m = bpy.data.materials.get(mat) or bpy.data.materials.new(mat)
            me.materials.append(m)
            o = bpy.data.objects.new(mat, me)
            scene.collection.objects.link(o)
            total += sum(len(p.vertices) - 2 for p in me.polygons)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                                  export_materials='EXPORT', export_normals=True, export_texcoords=False)
        print(f'KIT {path}: {len(self.parts)} materials, {total} triangles', flush=True)



def rod(K, mat, a, b, r, segs=6):
    """A round bar from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_euler('YXZ')
    K.cyl(mat, tuple((a + b) / 2), r, d.length, axis='y', segs=segs, rot=(q.x, q.y, q.z))

