"""Northern Command structures, "living diorama" pass.

Twenty original buildings in a heroic Nordic Cold War style: red board-and-batten
timber, slate and zinc roofs under snow, stone plinths, brick chimneys, iron
trusses, numbered hangar doors, floodlights, crates and flags.

Every model is assembled from a small modular kit (walls, windows, roofs with
snow caps, chimneys, trusses and props) straight into per-surface meshes. Colour
lives in one vertex-colour layer ('Col'): the paint of each part multiplied by a
Cycles ambient-occlusion bake and procedural weathering, so the browser needs no
textures. Surfaces with a different physical response keep their own material:
painted (matte), metal, warm-lit glass, lamps and `culture_trim`, which the game
tints with each commander's colour.

Rig contract (docs-rebuild.md): models face +Z (Blender -Y), origin at ground
centre. Nodes the renderer animates: `turret` (yaw), `barrel` (recoil along local
-Z), `muzzle` (empty at the tip), `radar_dish` (spin Y), `flag` (mesh, waves),
`door` (lifts while producing), `smoke_*` (chimney tops), `light_*` (lamps).

Run:  pnpm art:tactical buildings
  or  Blender -b --factory-startup -P art/blender/diorama_buildings.py
Environment:
  DIORAMA_ONLY=hq,factory   build a subset (still writes their GLBs/portraits)
  DIORAMA_SHEET=<dir>       also render game-camera contact tiles and an overview
  DIORAMA_NO_BLEND=1        skip saving art/diorama-buildings.blend
  DIORAMA_EXPORT=1          re-export GLBs from art/diorama-buildings.blend
                            (keeps manual edits; nothing is regenerated)
"""
import bpy, bmesh, math, os, random, zlib
from pathlib import Path
from mathutils import Vector, Matrix, Euler
from mathutils.noise import noise as pnoise

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/tactical'
ICONS = ROOT / 'public/art/tactical'
BLEND = ROOT / 'art/diorama-buildings.blend'
KINDS = ['hq', 'reactor', 'refinery', 'barracks', 'factory', 'airfield', 'lab', 'outpost',
         'turret', 'battery', 'bunker', 'flak', 'radar', 'plant', 'workshop', 'hospital',
         'camp', 'armory', 'depot', 'watchtower', 'boathouse', 'cannon', 'airstrip', 'launcher',
         'weathermast']
RIG_SEP = '~'
STATS = {} if os.environ.get('DIORAMA_STATS') else None   # Blender names must be unique; '<rig>~<kind>' is exported as '<rig>'.


def lin(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def hexcol(h):
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


PAL = {k: hexcol(v) for k, v in {
    'timber': '8e2f25', 'timber_dk': '6a2019', 'batten': '7b2820',
    'slate': '3b4450', 'slate_dk': '2b323b', 'slate_lt': '4a5461', 'zinc': '8d97a0',
    'snow': 'f3efe6', 'ice': 'cfdbe6',
    'stone': '8b877d', 'stone_dk': '66635c', 'stone_lt': 'a8a397', 'concrete': 'a3a197',
    'asphalt': '4a4a48', 'gravel': '7e776a',
    'brick': '7e3a2a', 'wood': '80603f', 'wood_dk': '4f3b29', 'wood_lt': 'a98a5f',
    'iron': '30363c', 'steel': '5d6870', 'steel_lt': '8a949b', 'rust': '7c4a2c',
    'cream': 'e9dfc6', 'ochre': 'c9953e', 'frame': '2c2a27',
    'glass': '2a3440', 'glass_warm': '8a5a2e', 'lamp': 'fff0c8',
    'orange': 'ff8f3a', 'olive': '58623f', 'canvas': 'c2b490', 'canvas_dk': '8f8468',
    'rubber': '1e2124', 'brass': 'c49a4a', 'turf': '5d6a3a', 'spruce': '2f4a3a',
    'hazard': 'e3b23c', 'medic': 'c8392b', 'white': 'eeeae2', 'tar': '2e2a26',
    'trim': 'ffffff', 'trim_dk': '5a5a5a', 'ember': 'ff7a2e', 'water': '3d5566',
}.items()}

SURFACES = {
    # name: (material name, roughness, metallic, emission colour, strength)
    'matte': ('painted', .82, 0., None, 0),
    'metal': ('metal', .5, .35, None, 0),
    'glass': ('glass', .22, 0., (1., .6, .26), .38),
    'lamp': ('lamp', .4, 0., (1., .88, .62), 1.0),
    'trim': ('culture_trim', .6, 0., None, 0),
}
TRIM_PREVIEW = hexcol('3f86b8')   # neutral blue for portraits; the game tints it.


# ---------------------------------------------------------------- kit
class Kit:
    """Accumulates world-space geometry per (rig group, surface)."""

    def __init__(self, kind):
        self.kind = kind
        self.rng = random.Random(zlib.crc32(kind.encode()))
        self.acc = {}
        self.M = Matrix.Identity(4)
        self.stack = []
        self.group = 'root'
        self.groups = {'root': (None, Vector((0, 0, 0)))}   # name: (parent, world pivot)
        self.empties = []   # (name, world pos, group)
        self.counts = {}

    # -- frames and groups
    def push(self, at=(0, 0, 0), rz=0.0):
        self.stack.append(self.M.copy())
        self.M = self.M @ Matrix.Translation(Vector(at)) @ Matrix.Rotation(rz, 4, 'Z')
        return self

    def pop(self):
        self.M = self.stack.pop()

    def rig(self, name, pivot):
        """Start a rig group whose origin is `pivot` (local coords); returns previous group."""
        prev = self.group
        self.groups[name] = (prev, self.M @ Vector(pivot))
        self.group = name
        return prev

    def end(self, prev):
        self.group = prev

    def empty(self, prefix, at, numbered=True):
        n = self.counts.get(prefix, 0)
        self.counts[prefix] = n + 1
        name = f'{prefix}_{n}' if numbered else prefix
        self.empties.append((name, self.M @ Vector(at), self.group))
        return name

    # -- colour
    def colour(self, paint, vary):
        if isinstance(paint, str):
            c = PAL[paint]
        else:
            c = paint
        k = 1 + self.rng.uniform(-vary, vary)
        return (c[0] * k, c[1] * k, c[2] * k, 1.0)

    def _bm(self, surf, group):
        key = (group, surf)
        if key not in self.acc:
            b = bmesh.new()
            b.loops.layers.float_color.new('Col')
            self.acc[key] = b
        return self.acc[key]

    def emit(self, tmp, local, paint, surf, vary=.05, group=None, flat=False):
        if STATS is not None:
            import inspect
            names = [f.function for f in inspect.stack()[1:4]]
            key = next((n for n in names if n not in ('box', 'cyl', 'tube', 'bar', 'ball', 'poly', 'arch', 'text', 'emit')), names[0])
            STATS[key] = STATS.get(key, 0) + sum(len(f.verts) - 2 for f in tmp.faces)
        m = self.M @ local
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        if m.determinant() < 0:
            bmesh.ops.reverse_faces(tmp, faces=tmp.faces)
        dst = self._bm(surf, group or self.group)
        lay = dst.loops.layers.float_color['Col']
        col = self.colour(paint, vary)
        vm = {v: dst.verts.new(v.co) for v in tmp.verts}
        for f in tmp.faces:
            try:
                nf = dst.faces.new([vm[v] for v in f.verts])
            except ValueError:
                continue
            nf.smooth = not flat
            for l in nf.loops:
                l[lay] = col
        tmp.free()

    # -- primitives (all coordinates local to the current frame)
    def box(self, size, at, paint='timber', surf='matte', bevel=.04, seg=1, rot=(0, 0, 0),
            dense=0.0, vary=.05, taper=None, group=None):
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1)
        sx, sy, sz = size
        for v in t.verts:
            v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
        if taper:
            for v in t.verts:
                if v.co.z > 0:
                    v.co.x *= taper[0]
                    v.co.y *= taper[1]
        if dense:
            for axis in range(3):
                edges = [e for e in t.edges if abs((e.verts[0].co - e.verts[1].co)[axis]) > 1e-4
                         and abs((e.verts[0].co - e.verts[1].co)[axis]) > dense * 1.4]
                if edges:
                    cuts = int(abs((edges[0].verts[0].co - edges[0].verts[1].co)[axis]) / dense)
                    if cuts > 0:
                        bmesh.ops.subdivide_edges(t, edges=edges, cuts=min(cuts, 12), use_grid_fill=True)
        if bevel > 0:
            w = min(bevel, min(sx, sy, sz) * .45)
            edges = [e for e in t.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > .6]
            bmesh.ops.bevel(t, geom=edges, offset=w, segments=seg, profile=.5, affect='EDGES',
                            clamp_overlap=True)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, paint, surf, vary, group)

    def cyl(self, r, h, at, paint='steel', surf='matte', n=12, r2=None, rot=(0, 0, 0),
            bevel=.02, vary=.04, group=None, caps=True):
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=caps, cap_tris=False, segments=n, radius1=r,
                              radius2=r if r2 is None else r2, depth=h)
        if bevel > 0 and caps:
            edges = [e for e in t.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > .9]
            bmesh.ops.bevel(t, geom=edges, offset=min(bevel, h * .3), segments=1, profile=.5,
                            affect='EDGES', clamp_overlap=True)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, paint, surf, vary, group)

    def _between(self, a, b):
        a, b = Vector(a), Vector(b)
        d = b - a
        q = d.to_track_quat('Z', 'Y')
        return Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), d.length

    def tube(self, a, b, r, paint='steel', surf='metal', n=8, vary=.04, group=None):
        L, length = self._between(a, b)
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=True, cap_tris=False, segments=n, radius1=r, radius2=r,
                              depth=length)
        self.emit(t, L, paint, surf, vary, group)

    def bar(self, a, b, w, paint='iron', surf='metal', vary=.04, group=None, d=None):
        L, length = self._between(a, b)
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1)
        for v in t.verts:
            v.co = Vector((v.co.x * w, v.co.y * (d or w), v.co.z * length))
        self.emit(t, L, paint, surf, vary, group)

    def ball(self, at, r, paint='snow', surf='matte', scale=(1, 1, 1), n=12, rings=6,
             hemi=False, rot=(0, 0, 0), vary=.03, group=None):
        t = bmesh.new()
        bmesh.ops.create_uvsphere(t, u_segments=n, v_segments=rings * (1 if hemi else 1) + (0 if hemi else 0), radius=r)
        if hemi:
            bmesh.ops.delete(t, geom=[v for v in t.verts if v.co.z < -1e-4], context='VERTS')
            # close the base
            edges = [e for e in t.edges if e.is_boundary]
            if edges:
                bmesh.ops.edgeloop_fill(t, edges=edges)
        for v in t.verts:
            v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, paint, surf, vary, group)

    def poly(self, pts, y0, y1, at=(0, 0, 0), paint='timber', surf='matte', rot=(0, 0, 0),
             vary=.04, group=None):
        """Extrude a polygon drawn in local XZ (x right, z up) along Y from y0 to y1."""
        t = bmesh.new()
        front = [t.verts.new((x, y0, z)) for x, z in pts]
        back = [t.verts.new((x, y1, z)) for x, z in pts]
        n = len(pts)
        t.faces.new(list(reversed(back)))
        t.faces.new(front)
        for i in range(n):
            j = (i + 1) % n
            t.faces.new((front[i], back[i], back[j], front[j]))
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, paint, surf, vary, group)

    def arch(self, r0, r1, y0, y1, at=(0, 0, 0), a0=0.0, a1=math.pi, seg=12, paint='zinc',
             surf='matte', rot=(0, 0, 0), vary=.04, group=None, ends=True):
        """Annular sector in local XZ (angle from +X towards +Z), extruded along Y."""
        t = bmesh.new()
        ring = []
        for i in range(seg + 1):
            a = a0 + (a1 - a0) * i / seg
            c, s = math.cos(a), math.sin(a)
            ring.append([t.verts.new((r * c, y, r * s)) for r in (r0, r1) for y in (y0, y1)])
        # ring[i] = [inner y0, inner y1, outer y0, outer y1]
        for i in range(seg):
            A, B = ring[i], ring[i + 1]
            t.faces.new((A[2], B[2], B[3], A[3]))   # outer
            t.faces.new((A[1], B[1], B[0], A[0]))   # inner
            t.faces.new((A[0], B[0], B[2], A[2]))   # y0 side
            t.faces.new((A[3], B[3], B[1], A[1]))   # y1 side
        if ends:
            for R in (ring[0], ring[-1]):
                t.faces.new((R[0], R[2], R[3], R[1]))
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, paint, surf, vary, group)

    def text(self, s, at, size, paint='cream', surf='matte', depth=.04, rot=(0, 0, 0), group=None):
        """Raised lettering facing -Y, centred on `at`."""
        cu = bpy.data.curves.new('lettering', 'FONT')
        cu.body = s
        cu.size = size
        cu.extrude = depth / 2
        cu.resolution_u = 2
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.space_character = 1.05
        ob = bpy.data.objects.new('lettering', cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        t = bmesh.new()
        t.from_mesh(me)
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        bpy.data.meshes.remove(me)
        bmesh.ops.triangulate(t, faces=t.faces)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Rotation(math.pi / 2, 4, 'X')
        self.emit(t, L, paint, surf, 0, group, flat=True)

    # ------------------------------------------------------------ building blocks
    def slab(self, w, d, h, at=(0, 0, 0), paint='concrete', bevel=.08):
        self.box((w, d, h), (at[0], at[1], at[2] + h / 2), paint, bevel=bevel, seg=2, dense=1.4)

    def plinth(self, w, d, h, at=(0, 0, 0), paint='stone', cap='stone_lt'):
        """Stone base with a projecting cap and irregular corner blocks."""
        x, y, z = at
        self.box((w, d, h), (x, y, z + h / 2), paint, bevel=.06, seg=1, dense=1.2)
        self.box((w + .16, d + .16, .14), (x, y, z + h - .02), cap, bevel=.04)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for i in range(2):
                    zz = z + .15 + i * (h - .15) / 2
                    self.box((.46, .46, (h - .2) / 2 - .02), (x + sx * (w / 2 - .2), y + sy * (d / 2 - .2), zz + (h - .2) / 4),
                             'stone_lt' if i % 2 == 0 else 'stone', bevel=0, vary=.08)

    def timber_body(self, w, d, h, at=(0, 0, 0), paint='timber', corner='cream', spacing=.44,
                    faces=(True, True, True, True), sill='stone_dk'):
        """Board-and-batten walls. Local frame: centre of the footprint at ground `at`."""
        x, y, z = at
        self.box((w, d, h), (x, y, z + h / 2), paint, bevel=.03, dense=1.1, vary=.03)
        # battens: front(-y), back(+y), left(-x), right(+x)
        for fi, (ok, n, length) in enumerate(zip(faces, [(0, -1), (0, 1), (-1, 0), (1, 0)], [w, w, d, d])):
            if not ok:
                continue
            count = int(length / spacing)
            for i in range(count):
                u = -length / 2 + (i + .5) * length / count
                if n[1] != 0:
                    p = (x + u, y + n[1] * (d / 2 + .025), z + h / 2 + .05)
                    self.box((.075, .05, h - .3), p, 'batten', bevel=0, vary=.07)
                else:
                    p = (x + n[0] * (w / 2 + .025), y + u, z + h / 2 + .05)
                    self.box((.05, .075, h - .3), p, 'batten', bevel=0, vary=.07)
        for sx in (-1, 1):
            for sy in (-1, 1):
                self.box((.2, .2, h + .02), (x + sx * (w / 2 + .02), y + sy * (d / 2 + .02), z + h / 2),
                         corner, bevel=.03)
        self.box((w + .12, d + .12, .22), (x, y, z + .11), sill, bevel=.03)
        self.box((w + .1, d + .1, .12), (x, y, z + h - .06), corner, bevel=0)

    def roof(self, w, d, rise, eave, at=(0, 0, 0), over=.45, end_over=.35, th=.2, paint='slate',
             snow=.24, trim=True, gable=True, gable_paint='timber', courses=True, finial=True):
        """Gable roof, ridge along local Y. `w` is the span (X), `d` the length (Y)."""
        x0, y0, _ = at
        a = math.atan2(rise, w / 2)
        slope = (w / 2 + over) / math.cos(a)
        length = d + 2 * end_over
        for s in (-1, 1):
            ex, ez = s * (w / 2 + over), eave - over * math.tan(a)
            mx, mz = (ex + 0) / 2, (ez + eave + rise) / 2
            n = Vector((s * math.sin(a), 0, math.cos(a)))
            c = Vector((x0 + mx, y0, mz)) + n * (th / 2)
            self.box((slope + .05, length, th), c, paint, bevel=.035, rot=(0, s * a, 0), dense=2.2, vary=.03)
            if courses:
                rows = int(slope / .5)
                for i in range(1, rows):
                    t = i / rows
                    p = Vector((x0 + ex * (1 - t), y0, ez * (1 - t) + (eave + rise) * t)) + n * (th + .02)
                    self.box((.07, length - .05, .05), p, 'slate_dk' if i % 2 else 'slate_lt',
                             bevel=0, rot=(0, s * a, 0), vary=.06)
            if snow > 0:
                sl = slope * snow
                t0 = 1 - snow
                p0 = Vector((x0 + ex * (1 - t0 - snow / 2), y0, 0))
                # snow sheet from the ridge down `snow` of the slope
                mid_t = 1 - snow / 2
                p = Vector((x0 + ex * (1 - mid_t), y0, ez * (1 - mid_t) + (eave + rise) * mid_t)) + n * (th + .09)
                self.box((sl, length - .25, .16), p, 'snow', bevel=.07, seg=1, rot=(0, s * a, 0),
                         dense=2.5, vary=.02)
                # lumpy lower lip
                q = Vector((x0 + ex * snow, y0, ez * snow + (eave + rise) * (1 - snow))) + n * (th + .1)
                self.box((.3, length - .4, .2), q, 'snow', bevel=.09, seg=1, rot=(0, s * a, 0), vary=.02)
                e = Vector((x0 + ex * .93, y0, ez * .93 + (eave + rise) * .07)) + n * (th + .05)
                self.box((.34, length - .15, .12), e, 'snow', bevel=.05, seg=1, rot=(0, s * a, 0), vary=.02)
        self.box((.3, length + .05, .22), (x0, y0, eave + rise + th * .9), 'snow' if snow else 'zinc',
                 bevel=.09, seg=1)
        if gable:
            for sy in (-1, 1):
                yy = y0 + sy * d / 2
                self.poly([(-w / 2, eave), (w / 2, eave), (0, eave + rise)], -.1, .1,
                          at=(x0, yy, 0), paint=gable_paint)
                for i in range(int(w / .44)):
                    u = -w / 2 + (i + .5) * w / int(w / .44)
                    top = eave + rise * (1 - abs(u) / (w / 2)) - .12
                    if top - eave > .25:
                        self.box((.075, .05, top - eave - .1), (x0 + u, yy + sy * .12, (eave + top) / 2),
                                 'batten', bevel=0, vary=.07)
        if trim:
            # Faction-painted barge boards on both gables and an eave fascia.
            for sy in (-1, 1):
                yy = y0 + sy * (d / 2 + end_over - .06)
                for s in (-1, 1):
                    ex, ez = s * (w / 2 + over), eave - over * math.tan(a)
                    a3 = Vector((x0 + ex, yy, ez)); b3 = Vector((x0, yy, eave + rise))
                    nn = Vector((s * math.sin(a), 0, math.cos(a)))
                    self.bar(a3 + nn * .02, b3 + nn * .02 + Vector((0, 0, .1)), .34, 'trim', 'trim', d=.12)
                if finial:
                    self.cyl(.1, .9, (x0, yy, eave + rise + .65), 'trim_dk', 'trim', n=6, r2=.01)
            for s in (-1, 1):
                ex, ez = s * (w / 2 + over), eave - over * math.tan(a)
                self.box((.1, length, .26), (x0 + ex, y0, ez + .02), 'cream', bevel=.02)

    def hip_cap(self, x, y, z, w, d, h, paint='slate'):
        """Pyramid roof with a snow cap."""
        self.poly_pyramid(x, y, z, w, d, h, paint)

    def poly_pyramid(self, x, y, z, w, d, h, paint='slate', snow=True):
        t = bmesh.new()
        vs = [t.verts.new(p) for p in [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0)]]
        top = t.verts.new((0, 0, h))
        t.faces.new(list(reversed(vs)))
        for i in range(4):
            t.faces.new((vs[i], vs[(i + 1) % 4], top))
        self.emit(t, Matrix.Translation((x, y, z)), paint, 'matte', .03)
        if snow:
            t = bmesh.new()
            k = .55
            vs = [t.verts.new(p) for p in [(-w * k / 2, -d * k / 2, 0), (w * k / 2, -d * k / 2, 0), (w * k / 2, d * k / 2, 0), (-w * k / 2, d * k / 2, 0)]]
            top = t.verts.new((0, 0, h * k + .12))
            t.faces.new(list(reversed(vs)))
            for i in range(4):
                t.faces.new((vs[i], vs[(i + 1) % 4], top))
            self.emit(t, Matrix.Translation((x, y, z + h * (1 - k) + .07)), 'snow', 'matte', .02)

    # facade parts: the current frame's local -Y is the outward normal, y=0 the wall face
    def window(self, u, z, w=1.0, h=1.3, frame='cream', lit=True, bars=True, shutters=None, sill=True):
        g = .1
        self.box((w, .04, h), (u, -.05, z), 'glass_warm' if lit else 'glass', 'glass' if lit else 'matte', bevel=0, vary=.1)
        for sx in (-1, 1):
            self.box((g, .12, h + 2 * g), (u + sx * (w / 2 + g / 2), -.07, z), frame, bevel=0)
        for sz in (-1, 1):
            self.box((w + 2 * g, .12, g), (u, -.07, z + sz * (h / 2 + g / 2)), frame, bevel=0)
        if bars:
            self.box((.05, .08, h), (u, -.08, z), frame, bevel=0)
            if h > 1.15:
                self.box((w, .08, .05), (u, -.08, z + h * .15), frame, bevel=0)
        if sill:
            self.box((w + .36, .24, .08), (u, -.13, z - h / 2 - g - .02), frame, bevel=0)
            self.box((w + .3, .14, .16), (u, -.08, z + h / 2 + g + .08), frame, bevel=0)
            self.box((w + .1, .2, .06), (u, -.15, z - h / 2 - g + .04), 'snow', bevel=0, vary=.01)
        if shutters:
            for sx in (-1, 1):
                self.box((w * .5, .06, h + .1), (u + sx * (w * .75 + g + .04), -.06, z), shutters, bevel=.02)

    def door(self, u, w, h, z0=0.0, paint='wood_dk', frame='cream', double=True, stripe=True, glass=True):
        self.box((w, .1, h), (u, -.04, z0 + h / 2), paint, bevel=.02)
        if double:
            self.box((.05, .13, h - .1), (u, -.06, z0 + h / 2), 'frame', bevel=0)
        for sx in (-1, 1):
            self.box((.16, .16, h + .16), (u + sx * (w / 2 + .08), -.07, z0 + h / 2 + .04), frame, bevel=.02)
        self.box((w + .5, .2, .22), (u, -.08, z0 + h + .14), frame, bevel=.03)
        if glass:
            for sx in (-1, 1) if double else (0,):
                self.box((w * .28, .04, h * .22), (u + sx * w * .24, -.1, z0 + h * .76), 'glass_warm', 'glass', bevel=0)
        if stripe:
            self.box((w - .06, .06, .2), (u, -.11, z0 + h * .45), 'trim', 'trim', bevel=0)

    def lamp(self, at, bracket=True):
        x, y, z = at
        if bracket:
            self.box((.06, .38, .06), (x, y - .19, z + .12), 'iron', 'metal', bevel=0)
        self.box((.24, .24, .07), (x, y - .38, z + .16), 'iron', 'metal', bevel=.01)
        self.box((.16, .16, .16), (x, y - .38, z + .05), 'lamp', 'lamp', bevel=.02)
        self.empty('light', (x, y - .38, z - .05))

    def post_lamp(self, at, h=3.2):
        x, y, z = at
        self.cyl(.07, h, (x, y, z + h / 2), 'iron', 'metal', n=6, bevel=0)
        self.cyl(.16, .2, (x, y, z + .1), 'iron', 'metal', n=8)
        self.box((.3, .3, .1), (x, y, z + h + .28), 'iron', 'metal', bevel=.02)
        self.box((.22, .22, .3), (x, y, z + h + .1), 'lamp', 'lamp', bevel=.02)
        self.empty('light', (x, y, z + h + .1))

    def floodlight(self, at, h=5.0, face=0.0):
        x, y, z = at
        self.box((.14, .14, h), (x, y, z + h / 2), 'iron', 'metal', bevel=.02)
        for i in range(int(h / .5)):
            self.box((.28, .04, .04), (x, y - .1, z + .4 + i * .5), 'iron', 'metal', bevel=0)
        self.box((1.0, .12, .1), (x, y, z + h), 'iron', 'metal', bevel=0)
        for sx in (-1, 1):
            self.push((x + sx * .32, y, z + h + .22), face)
            self.box((.34, .3, .3), (0, 0, 0), 'iron', 'metal', bevel=.03, rot=(-.5, 0, 0))
            self.box((.26, .04, .22), (0, -.17, -.07), 'lamp', 'lamp', bevel=0, rot=(-.5, 0, 0))
            self.empty('light', (0, -.3, -.1))
            self.pop()

    def chimney(self, x, y, z0, z1, w=.72, d=.72):
        self.box((w, d, z1 - z0), (x, y, (z0 + z1) / 2), 'brick', bevel=.03, dense=1.0)
        for i in range(int((z1 - z0) / .5)):
            zz = z0 + .3 + i * .5
            self.box((w + .02, d + .02, .04), (x, y, zz), 'brick' if i % 2 else 'timber_dk', bevel=0, vary=.1)
        self.box((w + .2, d + .2, .16), (x, y, z1 + .02), 'stone_lt', bevel=.03)
        self.box((w * .8, d * .8, .1), (x, y, z1 + .14), 'snow', bevel=.04)
        for sx in (-1, 1):
            self.cyl(.1, .32, (x + sx * w * .22, y, z1 + .26), 'brick', n=8, bevel=0)
        self.empty('smoke', (x, y, z1 + .5))

    def flag(self, at, pole=5.0, fw=1.8, fh=1.15, base='stone'):
        """Flagpole with a `flag` mesh (origin on the pole) carrying a Nordic cross."""
        x, y, z = at
        if base:
            self.box((.5, .5, .35), (x, y, z + .17), base, bevel=.04)
        self.cyl(.06, pole, (x, y, z + pole / 2), 'steel_lt', 'metal', n=8, bevel=0)
        self.ball((x, y, z + pole + .08), .12, 'brass', 'metal', n=8, rings=4)
        top = z + pole - .1
        prev = self.rig('flag', (x, y, top))
        # flag in local XZ plane, extending +X from the pole, cross darkened by vertex colour
        th = .05
        cx = fw * .36
        cz = fh * .5
        bw = fw * .12
        for (u0, u1) in ((0.06, cx - bw / 2), (cx + bw / 2, fw)):
            for (v0, v1) in ((0, cz - bw / 2), (cz + bw / 2, fh)):
                self.box((u1 - u0, th, v1 - v0), (x + (u0 + u1) / 2, y, top - fh + (v0 + v1) / 2),
                         'trim', 'trim', bevel=0, vary=0, dense=.3)
        self.box((fw - .06, th * 1.3, bw), (x + .06 + (fw - .06) / 2, y, top - fh + cz), 'trim_dk', 'trim', bevel=0, vary=0, dense=.3)
        self.box((bw, th * 1.3, fh), (x + cx, y, top - fh / 2), 'trim_dk', 'trim', bevel=0, vary=0, dense=.3)
        self.end(prev)

    def banner(self, u, z_top, w=.9, h=2.4):
        """Hanging faction banner on the current wall face (outward -Y)."""
        self.box((w + .3, .12, .1), (u, -.12, z_top), 'iron', 'metal', bevel=0)
        self.box((w, .05, h), (u, -.14, z_top - h / 2 - .05), 'trim', 'trim', bevel=0, dense=.5)
        t = bmesh.new()
        vs = [t.verts.new(p) for p in [(-w / 2, 0, 0), (w / 2, 0, 0), (0, 0, -.45)]]
        t.faces.new(vs)
        bmesh.ops.solidify(t, geom=t.faces[:], thickness=.05)
        self.emit(t, Matrix.Translation((u, -.14, z_top - h - .05)), 'trim', 'trim', 0)
        self.box((w * .45, .06, w * .45), (u, -.17, z_top - h * .38), 'cream', bevel=0, rot=(0, math.pi / 4, 0))

    def awning(self, u, z, w, depth=1.0):
        self.box((w, depth, .1), (u, -depth / 2 - .05, z), 'trim', 'trim', bevel=.02, rot=(-.28, 0, 0), dense=.6)
        for i in range(int(w / .5) + 1):
            self.box((.06, depth, .12), (-w / 2 + i * w / int(w / .5) + u, -depth / 2 - .05, z + .06),
                     'cream', bevel=0, rot=(-.28, 0, 0))
        self.box((w, .06, .28), (u, -depth - .02, z - .3), 'trim', 'trim', bevel=0)
        self.box((w - .2, depth * .8, .08), (u, -depth / 2, z + .1), 'snow', bevel=.04, rot=(-.28, 0, 0))

    # props (world-local, not facade)
    def crate(self, at, s=.8, rz=0.0, paint='wood'):
        x, y, z = at
        self.box((s, s, s), (x, y, z + s / 2), paint, bevel=.04, rot=(0, 0, rz), vary=.1)
        self.box((s + .04, s * .16, s + .04), (x, y, z + s / 2), 'wood_dk', bevel=0, rot=(0, 0, rz))

    def crates(self, at, rz=0.0):
        x, y, z = at
        self.push((x, y, z), rz)
        self.crate((0, 0, 0), .85)
        self.crate((.95, .1, 0), .75, .2)
        self.crate((.4, .05, .85), .7, -.15, 'olive')
        self.crate((-.05, .95, 0), .8, .1, 'olive')
        self.pop()

    def drums(self, at, n=3, paint='olive'):
        x, y, z = at
        spots = [(0, 0), (.62, .1), (.3, .55), (-.1, .62), (.8, .66)]
        for i in range(n):
            dx, dy = spots[i]
            p = paint if i % 3 else 'orange'
            self.cyl(.29, .9, (x + dx, y + dy, z + .45), p, n=10, bevel=.02, vary=.08)
            self.cyl(.3, .04, (x + dx, y + dy, z + .6), 'iron', n=10, bevel=0)
            self.cyl(.24, .04, (x + dx, y + dy, z + .91), 'snow', n=10, bevel=0)

    def sandbags(self, a, b, rows=2):
        a, b = Vector(a), Vector(b)
        d = b - a
        n = max(1, int(d.length / .55))
        rz = math.atan2(d.y, d.x)
        for r in range(rows):
            for i in range(n - (r % 2)):
                t = (i + .5 + (r % 2) * .5) / n
                p = a + d * t
                self.box((.58, .34, .24), (p.x, p.y, a.z + .12 + r * .22), 'canvas', bevel=.09, seg=1,
                         rot=(0, 0, rz), vary=.1)

    def fence(self, a, b, h=1.1, paint='wood'):
        a, b = Vector(a), Vector(b)
        d = b - a
        n = max(1, int(d.length / 1.6))
        for i in range(n + 1):
            p = a + d * (i / n)
            self.box((.14, .14, h + .1), (p.x, p.y, a.z + (h + .1) / 2), 'wood_dk', bevel=.02, vary=.1)
            self.box((.2, .2, .08), (p.x, p.y, a.z + h + .14), 'snow', bevel=.03)
        for zz in (h * .45, h * .85):
            self.bar(a + Vector((0, 0, zz)), b + Vector((0, 0, zz)), .08, paint, 'matte', d=.12)

    def ladder(self, at, h, rz=0.0):
        x, y, z = at
        self.push((x, y, z), rz)
        for sx in (-1, 1):
            self.box((.06, .06, h), (sx * .22, 0, h / 2), 'iron', 'metal', bevel=0)
        for i in range(int(h / .35)):
            self.box((.44, .04, .04), (0, 0, .25 + i * .35), 'iron', 'metal', bevel=0)
        self.pop()

    def mast(self, at, h, guy=True, top='lamp'):
        x, y, z = at
        self.cyl(.09, h, (x, y, z + h / 2), 'steel_lt', 'metal', n=6, r2=.05, bevel=0)
        for i, zz in enumerate((h * .55, h * .8)):
            self.box((1.2 - i * .3, .05, .05), (x, y, z + zz), 'steel_lt', 'metal', bevel=0)
        self.box((.14, .14, .14), (x, y, z + h + .07), 'orange', 'lamp', bevel=0)
        self.empty('light', (x, y, z + h + .1))
        if guy:
            for a in (0.3, 2.4, 4.5):
                self.tube((x, y, z + h * .7), (x + math.cos(a) * h * .16, y + math.sin(a) * h * .16, z + .05), .015, 'iron', 'metal', n=4)

    def drift(self, at, sx, sy, h=.35):
        x, y, z = at
        self.ball((x, y, z - .05), 1.0, 'snow', scale=(sx, sy, min(h, .2)), n=10, rings=3, hemi=True, vary=.02)
        self.ball((x + sx * .45, y - sy * .3, z - .05), 1.0, 'snow', scale=(sx * .6, sy * .7, min(h, .2) * .8), n=8,
                  rings=3, hemi=True, vary=.02)

    def truss(self, a, b, h, w=.12, n=6, paint='iron'):
        """Flat Warren truss between a and b (bottom chord), height h upwards."""
        a, b = Vector(a), Vector(b)
        up = Vector((0, 0, h))
        self.bar(a, b, w, paint)
        self.bar(a + up, b + up, w, paint)
        for i in range(n + 1):
            p = a + (b - a) * (i / n)
            self.bar(p, p + up, w * .8, paint)
            if i < n:
                q = a + (b - a) * ((i + 1) / n)
                if i % 2:
                    self.bar(p, q + up, w * .7, paint)
                else:
                    self.bar(p + up, q, w * .7, paint)

    def rivets(self, a, b, n, r=.05, paint='steel_lt'):
        a, b = Vector(a), Vector(b)
        for i in range(n):
            p = a + (b - a) * ((i + .5) / n)
            self.box((r * 2, r * 2, r * 2), p, paint, 'metal', bevel=0)


# ---------------------------------------------------------------- buildings
def build_hq(k):
    """Command station: a grand two-storey timber hall on a stone plinth, a cross-gabled
    entrance with a tall arched window, and a watch tower with clock faces and the flag."""
    # ground court
    k.slab(12.8, 11.2, .14, (0, -.25, 0), 'gravel', bevel=.06)
    k.slab(3.6, 2.2, .06, (-1.2, -4.8, .14), 'stone_lt', bevel=.03)
    # plinth and main hall
    k.plinth(9.0, 6.8, .75, (-1.1, .9, .14))
    z0 = .89
    k.push((-1.1, .9, z0))
    k.timber_body(8.2, 6.0, 5.0)
    k.pop()
    # roof: ridge along X -> rotate the frame
    k.push((-1.1, .9, z0), math.pi / 2)
    k.roof(6.0, 8.2, 3.0, 5.0, over=.55, end_over=.45)
    k.pop()
    # front wing (entrance)
    k.plinth(4.6, 3.6, .75, (-1.1, -2.9, .14))
    k.push((-1.1, -2.6, z0))
    k.timber_body(3.9, 3.1, 5.0)
    k.roof(3.9, 3.1, 3.2, 5.0, over=.4, end_over=.5)
    k.pop()
    # windows on the main hall
    k.push((-1.1, .9 - 3.0, z0))           # front face of main hall
    for u in (-3.3, -2.2, 2.4, 3.4):
        k.window(u, 1.8, .7, 1.25)
        k.window(u, 3.9, .7, 1.1)
    k.pop()
    k.push((-1.1, .9 + 3.0, z0), math.pi)  # back
    for u in (-2.9, -1.0, 1.0, 2.9):
        k.window(u, 1.8, .75, 1.25)
        k.window(u, 3.9, .75, 1.1)
    k.pop()
    for side in (-1, 1):
        k.push((-1.1 + side * 4.1, .9, z0), side * math.pi / 2)
        for u in (-1.6, 0, 1.6):
            k.window(u, 1.8, .75, 1.25)
            k.window(u, 3.9, .75, 1.1)
        k.window(0, 6.4, .6, .7, bars=False)
        k.pop()
    # entrance front: arched window up into the gable, double door, awning, banners
    k.push((-1.1, -4.15, z0))
    k.door(0, 1.8, 2.5)
    k.awning(0, 2.95, 2.8, 1.3)
    aw, zs = 1.3, 4.6
    k.box((aw * 2, .05, 1.2), (0, -.05, 3.9), 'glass_warm', 'glass', bevel=0)
    k.arch(0, aw, -.07, -.03, at=(0, 0, zs), seg=10, paint='glass_warm', surf='glass')
    k.arch(aw, aw + .16, -.2, .02, at=(0, 0, zs), seg=12, paint='cream')
    for sx in (-1, 1):
        k.box((.16, .22, 1.35), (sx * (aw + .08), -.09, 3.95), 'cream', bevel=.02)
    for u in (-.65, 0, .65):
        k.box((.06, .1, 1.2 + (aw if u == 0 else .9)), (u, -.09, 3.9 + (aw if u == 0 else .9) / 2 - .05), 'cream', bevel=0)
    k.box((aw * 2, .1, .06), (0, -.09, 4.6), 'cream', bevel=0)
    k.box((aw * 2 + .4, .24, .1), (0, -.14, 3.25), 'cream', bevel=.02)
    for sx in (-1, 1):
        k.banner(sx * 1.55, 4.8, .7, 2.3)
    k.text('STAB', (0, -.13, 7.35), .38, 'cream')
    k.pop()
    # steps
    for i in range(3):
        k.box((3.0 - i * .1, .5, .3), (-1.1, -4.85 + i * .38, .14 + .15 + i * .25), 'stone_lt' if i % 2 else 'stone', bevel=.04)
    for sx in (-1, 1):
        k.box((.4, 1.4, .9), (-1.1 + sx * 1.7, -4.6, .59), 'stone', bevel=.05)
        k.post_lamp((-1.1 + sx * 1.7, -5.05, 1.04), 1.6)
    # dormers on the front slope
    for u in (-4.0, 1.8):
        k.push((u, -.6, z0 + 5.0))
        k.box((1.3, 1.6, 1.5), (0, 0, .75), 'timber', bevel=.03)
        k.roof(1.3, 1.6, .7, 1.5, over=.18, end_over=.15, snow=.6, courses=False, finial=False)
        k.push((0, -.8, 0))
        k.window(0, .7, .6, .75, sill=False)
        k.pop()
        k.pop()
    # chimneys
    k.chimney(-4.3, 2.4, 5.8, 9.6)
    k.chimney(1.7, 2.4, 5.8, 9.6)
    # watch tower (front right)
    tx, ty = 4.35, -2.2
    k.plinth(3.0, 3.0, 1.9, (tx, ty, .14), 'stone')
    k.push((tx, ty, 2.04))
    k.timber_body(2.5, 2.5, 6.6, spacing=.4)
    for rz in (0, math.pi / 2, math.pi, -math.pi / 2):
        k.push((0, 0, 0), rz)
        k.push((0, -1.25, 0))
        k.window(0, 1.7, .5, 1.0)
        k.window(0, 3.3, .5, 1.0)
        # clock face
        k.cyl(.62, .12, (0, -.1, 5.3), 'cream', n=14, rot=(math.pi / 2, 0, 0), bevel=0)
        k.cyl(.7, .08, (0, -.07, 5.3), 'trim', 'trim', n=14, rot=(math.pi / 2, 0, 0), bevel=0)
        k.box((.06, .06, .42), (0, -.2, 5.45), 'frame', bevel=0)
        k.box((.3, .06, .06), (.12, -.2, 5.3), 'frame', bevel=0)
        k.pop()
        k.pop()
    # watch room: posts, glazing, gallery
    k.box((3.2, 3.2, .22), (0, 0, 6.7), 'stone_lt', bevel=.05)
    k.box((2.3, 2.3, 1.4), (0, 0, 7.5), 'glass_warm', 'glass', bevel=.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.18, .18, 1.6), (sx * 1.2, sy * 1.2, 7.5), 'cream', bevel=.02)
    for rz in (0, math.pi / 2, math.pi, -math.pi / 2):
        k.push((0, 0, 0), rz)
        k.box((2.5, .1, .1), (0, -1.2, 7.55), 'cream', bevel=0)
        k.box((3.1, .08, .08), (0, -1.55, 7.25), 'iron', 'metal', bevel=0)
        k.box((3.1, .12, .3), (0, -1.55, 6.95), 'trim', 'trim', bevel=0)
        k.pop()
    k.poly_pyramid(0, 0, 8.2, 3.3, 3.3, 2.6)
    k.cyl(.08, .8, (0, 0, 10.9), 'brass', 'metal', n=6)
    k.pop()
    k.flag((tx, ty, 2.04 + 10.9), 2.4, 2.0, 1.3, base=None)
    # yard dressing
    k.crates((4.2, 1.3, .14), .2)
    k.drums((5.4, 3.4, .14), 3)
    k.sandbags((3.4, -4.6, .14), (5.8, -4.6, .14), rows=1)
    k.fence((-6.2, -5.6, .14), (-3.4, -5.6, .14))
    k.fence((-6.2, -5.6, .14), (-6.2, -1.0, .14))
    k.mast((-5.2, 4.6, .14), 7.5)
    k.box((1.4, 1.0, 1.3), (-3.6, 4.95, .79), 'olive', bevel=.05)   # generator
    k.cyl(.08, .9, (-3.2, 4.95, 1.8), 'iron', 'metal', n=6)
    k.drift((-5.3, 0, .14), 1.0, 1.0)
    k.drift((5.8, -.4, .14), 1.0, 1.4)
    k.drift((-2.0, 4.9, .14), 2.0, .7, .3)
    k.post_lamp((2.9, -5.2, .14), 3.2)


FACES = {'f': (0, -1, 0.0), 'b': (0, 1, math.pi), 'l': (-1, 0, -math.pi / 2), 'r': (1, 0, math.pi / 2)}


def face(k, cx, cy, w, d, z0, f):
    """Push a facade frame (outward -Y) on face f of a body; returns the face width."""
    sx, sy, rz = FACES[f]
    k.push((cx + sx * w / 2, cy + sy * d / 2, z0), rz)
    return w if f in 'fb' else d


def house(k, cx, cy, w, d, h, rise, z0=0.0, ridge='x', faces='fblr', rows=None, win=(.8, 1.1),
          door=None, paint='timber', roof='slate', snow=.3, over=.4, end_over=.35, spacing=1.9,
          skip=None, gable_paint=None, trim=True, frame='cream'):
    """Timber body, gable roof and a regular window pattern. door=(u, w, h) on the front."""
    k.push((cx, cy, z0))
    k.timber_body(w, d, h, paint=paint)
    k.pop()
    if ridge == 'y':
        k.push((cx, cy, z0))
        k.roof(w, d, rise, h, over=over, end_over=end_over, paint=roof, snow=snow, trim=trim,
               gable_paint=gable_paint or paint)
    else:
        k.push((cx, cy, z0), math.pi / 2)
        k.roof(d, w, rise, h, over=over, end_over=end_over, paint=roof, snow=snow, trim=trim,
               gable_paint=gable_paint or paint)
    k.pop()
    rows = rows or ([h * .55] if h < 4 else [1.6, h - 1.35])
    for f in faces:
        width = face(k, cx, cy, w, d, z0, f)
        n = max(1, int(width / spacing))
        for i in range(n):
            u = -width / 2 + (i + .5) * width / n
            if f == 'f' and door and abs(u - door[0]) < door[1] / 2 + win[0] / 2 + .25:
                continue
            if skip and (f, i) in skip:
                continue
            for z in rows:
                k.window(u, z, win[0], win[1], frame=frame)
        if f == 'f' and door:
            k.door(door[0], door[1], door[2])
        k.pop()


def yard(k, w, d, cx=0.0, cy=0.0, paint='gravel'):
    k.slab(w, d, .14, (cx, cy, 0), paint, bevel=.06)


def hazard(k, a, b, z, w=.3, n=None):
    """Yellow/black stripes painted along a line on the ground."""
    a, b = Vector(a), Vector(b)
    n = n or max(2, int((b - a).length / .5))
    for i in range(n):
        p = a + (b - a) * ((i + .5) / n)
        k.box(((b - a).length / n, w, .02), (p.x, p.y, z), 'hazard' if i % 2 else 'iron', bevel=0,
              rot=(0, 0, math.atan2((b - a).y, (b - a).x)), vary=.02)


def gun(k, pivot, length, r, elev=.12, twin=0.0, shield=None, muzzle_brake=True):
    """barrel group (recoils along -Y in Blender = local -Z in glTF... handled by export axes)
    starting at `pivot` inside the current turret group, with a muzzle empty at the tip."""
    prev = k.rig('barrel', pivot)
    px, py, pz = pivot
    dy = -math.cos(elev) * length
    dz = math.sin(elev) * length
    for sx in ((-twin, twin) if twin else (0,)):
        a = (px + sx, py, pz)
        b = (px + sx, py + dy, pz + dz)
        k.tube(a, b, r, 'iron', 'metal', n=10)
        k.tube((px + sx, py + dy * .92, pz + dz * .92), (px + sx, py + dy * 1.02, pz + dz * 1.02), r * 1.6,
               'iron', 'metal', n=10)
        k.tube((px + sx, py + dy * .1, pz + dz * .1), (px + sx, py + dy * .35, pz + dz * .35), r * 1.35,
               'steel', 'metal', n=10)
    k.empty('muzzle', (px, py + dy * 1.05, pz + dz * 1.05), numbered=False)
    k.end(prev)


def build_reactor(k):
    """Geothermal plant: wellheads in a steaming pool, insulated pipe runs with an expansion
    loop, heat exchangers, a turbine house and a tall banded vent tower."""
    yard(k, 8.2, 8.2)
    # steaming pool with stone ring
    k.cyl(1.75, .35, (-1.9, -1.9, .3), 'stone', n=18, bevel=.06)
    k.cyl(1.45, .06, (-1.9, -1.9, .47), 'water', 'glass', n=18, bevel=0)
    for a in range(9):
        t = a / 9 * math.tau
        k.box((.55, .4, .3), (-1.9 + math.cos(t) * 1.7, -1.9 + math.sin(t) * 1.7, .45), 'stone_lt', bevel=.08,
              rot=(0, 0, t), vary=.1)
    for i, (x, y) in enumerate(((-2.3, -1.6), (-1.4, -2.3))):
        k.cyl(.3, 1.5, (x, y, 1.0), 'iron', 'metal', n=10)
        k.cyl(.42, .16, (x, y, 1.3), 'steel', 'metal', n=10)
        k.cyl(.26, .08, (x, y, 1.8), 'orange', 'matte', n=10, rot=(0, 0, 0))
        k.cyl(.36, .06, (x + .35, y, 1.4), 'orange', n=10, rot=(0, math.pi / 2, 0), bevel=0)
        k.empty('smoke', (x, y, 2.0))
    # insulated pipe run with an expansion loop to the exchangers
    zp = 1.55
    run = [(-2.3, -1.6, zp), (-2.3, .2, zp), (-.2, .2, zp), (-.2, .2, 3.4), (1.0, .2, 3.4), (1.0, .2, zp),
           (2.4, .2, zp), (2.4, -1.4, zp)]
    for a, b in zip(run, run[1:]):
        k.tube(a, b, .2, 'zinc', 'metal', n=10)
    for p in run[1:-1]:
        k.ball(p, .24, 'zinc', 'metal', n=10, rings=5)
    for p in [(-2.3, -.8), (-1.2, .2), (1.8, .2), (2.4, -.6)]:
        k.box((.14, .14, zp), (p[0], p[1], zp / 2 + .07), 'iron', 'metal', bevel=0)
        k.box((.6, .14, .12), (p[0], p[1], zp - .2), 'iron', 'metal', bevel=0)
    for i in range(6):
        t = i / 5
        k.cyl(.24, .07, (-2.3 + 0 * t, -1.2 + 1.2 * t, zp), 'trim', 'trim', n=10, rot=(math.pi / 2, 0, 0), bevel=0)
    # heat exchangers on saddles
    for y in (-1.3, -2.8):
        k.cyl(.75, 3.0, (2.3, y, 1.2), 'zinc', 'metal', n=16, rot=(0, math.pi / 2, 0), bevel=.06)
        for x in (1.3, 3.3):
            k.box((.35, 1.2, .7), (x, y, .45), 'concrete', bevel=.04)
            k.cyl(.8, .1, (x, y, 1.2), 'iron', 'metal', n=16, rot=(0, math.pi / 2, 0), bevel=0)
        k.cyl(.77, .3, (2.3, y, 1.2), 'trim', 'trim', n=16, rot=(0, math.pi / 2, 0), bevel=0)
        k.ball((2.3 - 1.5, y, 1.2), .74, 'zinc', 'metal', scale=(.35, 1, 1), n=12, rings=6)
        k.ball((2.3 + 1.5, y, 1.2), .74, 'zinc', 'metal', scale=(.35, 1, 1), n=12, rings=6)
    # vent tower
    vx, vy = 1.9, 2.1
    k.cyl(1.55, .5, (vx, vy, .39), 'concrete', n=16, bevel=.05)
    k.cyl(1.35, 7.0, (vx, vy, 4.1), 'concrete', n=18, r2=.95, bevel=0)
    for i, z in enumerate((1.6, 3.4, 5.2, 7.0)):
        r = 1.35 - (z - .6) / 7.0 * .4
        k.cyl(r + .06, .22, (vx, vy, z), 'trim' if i == 1 else 'iron', 'trim' if i == 1 else 'metal', n=18, bevel=0)
    k.cyl(1.08, .3, (vx, vy, 7.7), 'iron', 'metal', n=18, bevel=.03)
    k.cyl(.85, .12, (vx, vy, 7.8), 'tar', n=16, bevel=0)
    k.empty('smoke', (vx, vy, 8.1))
    k.empty('smoke', (vx + .3, vy - .2, 8.1))
    k.push((vx - .9, vy - 1.05, .64), -.6)
    k.ladder((0, 0, 0), 6.6)
    k.pop()
    k.box((1.6, .12, .9), (vx, vy - 1.33, 2.6), 'cream', bevel=0, rot=(0, 0, 0))
    k.text('GEO', (vx, vy - 1.41, 2.6), .5, 'timber_dk')
    # turbine house
    house(k, -1.9, 2.3, 3.6, 2.8, 3.2, 1.6, z0=.14, ridge='x', faces='fl', door=(.6, 1.1, 2.1), spacing=1.6)
    k.chimney(-2.9, 2.9, 3.6, 6.0, .55, .55)
    k.lamp((-1.9 + .6, 2.3 - 1.4 - .1, 2.9))
    k.floodlight((-3.7, -3.7, .14), 4.2, face=.8)
    k.drums((3.0, 3.2, .14), 3)
    k.drift((-3.4, .9, .14), 1.0, 1.4, .3)
    k.drift((3.6, -3.7, .14), 1.1, .6, .25)


def build_refinery(k):
    """Ore refinery: harvester unloading bay with a grate and hopper at the front, an inclined
    conveyor into the crushing hall, three silos and a smelter stack."""
    yard(k, 11.4, 12.2, 0, .7, 'concrete')
    # unloading bay (front, towards the production exit)
    k.box((5.4, 3.4, .06), (0, -3.8, .17), 'asphalt', bevel=0)
    hazard(k, (-2.7, -5.45, .2), (2.7, -5.45, .2), .2)
    for sx in (-1, 1):
        hazard(k, (sx * 2.7, -5.4, .2), (sx * 2.7, -2.2, .2), .2, 7)
    k.box((2.6, 1.6, .05), (0, -3.6, .21), 'iron', 'metal', bevel=0)
    for i in range(9):
        k.box((.06, 1.6, .06), (-1.2 + i * .3, -3.6, .25), 'steel', 'metal', bevel=0)
    # receiving hopper on legs over the grate
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.2, .2, 4.0), (sx * 1.5, -3.2 + sy * 1.1, 2.1), 'iron', 'metal', bevel=0)
        k.bar((sx * 1.5, -4.3, .4), (sx * 1.5, -2.1, 3.6), .1)
    k.box((3.4, 2.8, 1.5), (0, -3.2, 4.6), 'rust', bevel=.04, taper=None)
    k.box((2.2, 1.6, 1.0), (0, -3.2, 3.5), 'rust', bevel=.03, taper=None)
    k.box((3.5, 2.9, .16), (0, -3.2, 5.38), 'iron', 'metal', bevel=0)
    k.box((3.5, .16, .5), (0, -4.66, 4.4), 'trim', 'trim', bevel=0)
    k.box((1.1, .12, .7), (0, -4.7, 4.95), 'cream', bevel=0)
    k.text('01', (0, -4.78, 4.95), .5, 'timber_dk')
    for i in range(6):
        k.ball((-1.1 + i * .45, -3.2 + (i % 2) * .5, 5.35), .35, 'rust', scale=(1, 1, .6), n=8, rings=4, vary=.15)
    # conveyor from the hopper up into the hall
    a, b = Vector((0, -1.7, 4.2)), Vector((0, 1.4, 6.2))
    for sx in (-1, 1):
        k.bar(a + Vector((sx * .45, 0, 0)), b + Vector((sx * .45, 0, 0)), .12, 'iron')
    k.bar(a + Vector((0, 0, .15)), b + Vector((0, 0, .15)), .8, 'rubber', 'matte', d=.08)
    # covered conveyor gallery: timber walls under a zinc roof, bridging hopper and hall
    k.bar(a + Vector((0, 0, .7)), b + Vector((0, 0, .7)), 2.3, 'timber', 'matte', d=1.1)
    k.bar(a + Vector((0, 0, 1.33)), b + Vector((0, 0, 1.33)), 2.6, 'zinc', 'metal', d=.16)
    k.bar(a + Vector((0, 0, 1.43)), b + Vector((0, 0, 1.43)), .9, 'snow', 'matte', d=.08)
    k.bar(a + Vector((0, 0, .3)), b + Vector((0, 0, .3)), 2.4, 'trim', 'trim', d=.14)
    for t in (.3, .7):
        p = a + (b - a) * t
        k.box((.14, .14, p.z), (p.x - .45, p.y, p.z / 2), 'iron', 'metal', bevel=0)
        k.box((.14, .14, p.z), (p.x + .45, p.y, p.z / 2), 'iron', 'metal', bevel=0)
    # crushing hall
    house(k, -1.0, 3.6, 6.4, 4.4, 5.2, 2.2, z0=.14, ridge='x', faces='flb', door=(-1.8, 1.4, 2.4), spacing=1.8)
    k.chimney(-3.3, 4.8, 5.0, 9.4, .75, .75)
    k.push((-1.0, 1.4, .14))
    k.banner(1.6, 4.6, .8, 2.2)
    k.lamp((-.6, 0, 3.0))
    k.pop()
    # silos
    for i, (x, y, h) in enumerate(((4.1, 4.9, 7.4), (4.1, 2.3, 6.6), (4.1, -.3, 5.6))):
        k.cyl(1.05, .5, (x, y, .39), 'concrete', n=16, bevel=.05)
        k.cyl(.95, h, (x, y, .64 + h / 2), 'zinc', 'metal', n=18, bevel=0)
        for j in range(int(h / 1.4)):
            k.cyl(.98, .07, (x, y, 1.2 + j * 1.4), 'steel', 'metal', n=18, bevel=0)
        k.cyl(.99, .45, (x, y, .64 + h * .72), 'trim', 'trim', n=18, bevel=0)
        k.cyl(.97, .7, (x, y, .64 + h + .35), 'zinc', 'metal', n=18, r2=.2, bevel=0)
        k.cyl(.7, .35, (x, y, .64 + h + .3), 'snow', n=14, r2=.25, bevel=0)
        k.push((x - 1.0, y, .64), 0)
        k.ladder((0, 0, 0), h, math.pi / 2)
        k.pop()
    k.bar((1.9, 3.3, 6.3), (4.1, 3.3, 7.4), .5, 'zinc', 'metal', d=.5)
    k.bar((3.2, 5.3, 1.0), (3.2, -1.0, 1.0), .22, 'steel', 'metal')
    k.floodlight((-4.3, -4.9, .14), 5.5, face=-.4)
    k.floodlight((4.2, -4.9, .14), 5.5, face=.4)
    k.drums((-5.0, -1.0, .14), 4)
    k.crates((-4.8, .9, .14), .3)
    for i in range(5):
        k.ball((2.4 + (i % 3) * .5, -2.0 - (i // 3) * .5, .4), .45, 'rust', scale=(1, 1, .6), n=8, rings=4, vary=.15)
    k.drift((-5.0, 6.1, .14), 1.2, .7, .3)


def build_barracks(k):
    """Jæger hall: a long timber barracks with a porch, dormers and two chimneys behind a
    gravel drill yard with a flag, obstacle wall, log hurdles and targets."""
    yard(k, 12.2, 10.6, 0, -.4)
    k.plinth(11.0, 4.6, .45, (0, 2.3, .14))
    z0 = .59
    house(k, 0, 2.3, 10.4, 4.0, 3.6, 2.3, z0=z0, ridge='x', faces='fblr', door=(0, 1.9, 2.6), spacing=1.7)
    # the door lifts while training
    k.push((0, .3, z0))
    prev = k.rig('door', (0, -.1, 2.7))
    k.box((1.8, .1, 2.55), (0, -.1, 1.33), 'wood_dk', bevel=.02)
    for i in range(5):
        k.box((1.75, .12, .05), (0, -.16, .3 + i * .5), 'frame', bevel=0)
    k.box((1.75, .06, .25), (0, -.17, 1.3), 'trim', 'trim', bevel=0)
    k.end(prev)
    k.awning(0, 3.05, 3.4, 1.5)
    for sx in (-1, 1):
        k.box((.2, .2, 2.7), (sx * 1.6, -1.45, 1.35), 'cream', bevel=.03)
        k.banner(sx * 3.4, 3.3, .7, 2.0)
        k.lamp((sx * 1.2, 0, 2.7))
    k.text('JÆGER', (0, -.12, 4.1), .42, 'cream')
    k.pop()
    for u in (-3.4, 3.4):
        k.push((u, 1.2, z0 + 3.6))
        k.box((1.2, 1.4, 1.2), (0, 0, .6), 'timber', bevel=.03)
        k.roof(1.2, 1.4, .6, 1.2, over=.15, end_over=.12, snow=.5, courses=False, finial=False)
        k.push((0, -.7, 0))
        k.window(0, .6, .55, .6, sill=False)
        k.pop()
        k.pop()
    k.chimney(-2.0, 3.0, 4.6, 7.6)
    k.chimney(4.5, 3.0, 4.6, 7.4)
    # drill yard
    for i in range(4):
        k.box((.24, .24, .6), (-5.6 + i * 3.73, -5.3, .44), 'stone', bevel=.04)
    k.flag((-4.6, -2.2, .14), 6.0, 1.8, 1.15)
    # obstacle wall and log hurdles
    k.box((2.4, .3, 1.5), (2.8, -3.2, .89), 'wood', bevel=.03)
    for i in range(4):
        k.box((2.5, .34, .06), (2.8, -3.2, .3 + i * .38), 'wood_dk', bevel=0)
    for x in (.2, 1.1):
        k.cyl(.12, 2.0, (x - 1.0, -3.6, .6), 'wood', n=8, rot=(0, math.pi / 2, 0))
        for sx in (-1, 1):
            k.box((.12, .12, .6), (x - 1.0 + sx * .85, -3.6, .44), 'wood_dk', bevel=0)
    # rifle targets
    for i in range(3):
        x = 3.0 + i * 1.1
        k.box((.08, .08, 1.4), (x, -.9, .84), 'wood_dk', bevel=0)
        k.box((.8, .06, .8), (x, -.95, 1.3), 'cream', bevel=0)
        k.cyl(.26, .08, (x, -.99, 1.3), 'trim', 'trim', n=12, rot=(math.pi / 2, 0, 0), bevel=0)
    k.sandbags((-5.8, -4.8, .14), (-5.8, -1.6, .14))
    k.crates((4.6, -4.5, .14), .4)
    k.post_lamp((-1.8, -1.2, .14), 3.0)
    k.post_lamp((1.8, -1.2, .14), 3.0)
    k.drift((-3.0, -5.0, .14), 1.6, .6, .28)
    k.drift((5.5, 1.0, .14), .6, 1.5, .3)


def build_factory(k):
    """Vehicle works: a riveted iron-and-zinc arched hangar on a stone base with a huge numbered
    lifting door, a lean-to workshop, twin stacks and a gantry crane over the apron."""
    L0, L1 = -3.6, 6.4       # hangar from front (y) to back
    R, zs = 4.6, 1.3
    yard(k, 11.2, 17.2, 0, -2.0, 'concrete')
    # stone base walls and arched roof
    for sx in (-1, 1):
        k.box((.6, L1 - L0, zs), (sx * (R - .1), (L0 + L1) / 2, .14 + zs / 2), 'stone', bevel=.05, dense=1.2)
        k.box((.72, L1 - L0 + .1, .14), (sx * (R - .1), (L0 + L1) / 2, .14 + zs), 'stone_lt', bevel=.03)
    k.arch(R - .05, R + .15, L0 - .3, L1 + .2, at=(0, 0, .14 + zs), a0=0, a1=math.pi, seg=16, paint='slate')
    k.arch(R - .15, R - .05, L0, L1, at=(0, 0, .14 + zs), a0=0, a1=math.pi, seg=16, paint='iron')
    for i in range(11):
        y = L0 - .2 + i * (L1 - L0 + .3) / 10
        k.arch(R + .12, R + .28, y - .12, y + .12, at=(0, 0, .14 + zs), seg=16, paint='iron', surf='metal')
    # snow saddle and skylight bands
    k.arch(R + .33, R + .46, L0 - .1, L1, at=(0, 0, .14 + zs), a0=math.radians(78), a1=math.radians(102),
           seg=3, paint='snow')
    for sx in (-1, 1):
        a0 = math.radians(34) if sx > 0 else math.radians(128)
        for j in range(3):
            y = L0 + .9 + j * (L1 - L0 - 1.2) / 3
            k.arch(R + .14, R + .22, y, y + 1.1, at=(0, 0, .14 + zs), a0=a0, a1=a0 + math.radians(18), seg=3,
                   paint='glass_warm', surf='glass')
    # front and back gable ends (timber half discs)
    pts = [(math.cos(math.pi * i / 16) * (R - .1), zs + math.sin(math.pi * i / 16) * (R - .1)) for i in range(17)]
    for y in (L0, L1):
        k.poly(pts, -.12, .12, at=(0, y, .14), paint='timber')
        k.box((2 * R + .2, .3, .3), (0, y, .14 + zs + .1), 'stone_lt', bevel=.03)
    for i in range(18):
        x = -R + .4 + i * (2 * R - .8) / 17
        top = zs + math.sqrt(max(0, (R - .2) ** 2 - x * x)) - .1
        if abs(x) > 3.0:
            k.box((.08, .06, top - zs), (x, L0 - .14, .14 + zs + (top - zs) / 2), 'batten', bevel=0, vary=.07)
        k.box((.08, .06, top - zs), (x, L1 + .14, .14 + zs + (top - zs) / 2), 'batten', bevel=0, vary=.07)
    # door opening frame on the front gable, hazard jambs, lettering
    DW, DH = 5.6, 4.6
    k.push((0, L0 - .12, .14))
    k.box((DW + .1, .06, DH), (0, .08, DH / 2), 'tar', bevel=0)
    for sx in (-1, 1):
        k.box((.5, .4, DH + .4), (sx * (DW / 2 + .25), -.05, (DH + .4) / 2), 'iron', 'metal', bevel=.04)
        for i in range(6):
            k.box((.52, .42, .3), (sx * (DW / 2 + .25), -.05, .5 + i * .8), 'hazard', bevel=0)
    k.box((DW + 1.1, .5, .5), (0, -.05, DH + .3), 'iron', 'metal', bevel=.04)
    k.rivets((-DW / 2, -.32, DH + .3), (DW / 2, -.32, DH + .3), 12)
    k.box((DW + .9, .1, .32), (0, -.33, DH + .3), 'trim', 'trim', bevel=0)
    k.box((2.2, .1, 1.1), (0, -.1, DH + 1.3), 'cream', bevel=.02)
    k.text('03', (0, -.17, DH + 1.3), .95, 'timber_dk', depth=.06)
    k.pop()
    prev = k.rig('door', (0, L0 - .2, .14 + DH))
    for i in range(12):
        k.box((DW, .12, DH / 12 - .03), (0, L0 - .25, .14 + (i + .5) * DH / 12), 'steel' if i % 2 else 'steel_lt',
              'metal', bevel=0, vary=.03)
    k.box((DW - .1, .06, .5), (0, L0 - .33, .14 + DH * .52), 'trim', 'trim', bevel=0)
    k.text('WERK', (0, L0 - .37, .14 + DH * .52), .38, 'cream')
    k.box((DW, .18, .16), (0, L0 - .3, .22), 'iron', 'metal', bevel=0)
    k.end(prev)
    # lean-to workshop (right side) and stacks (left)
    k.push((R + .1, 1.4, .14))
    k.box((1.2, 4.2, 2.7), (.6, 0, 1.35), 'timber', bevel=.03, dense=1.1)
    for i in range(9):
        k.box((.05, .075, 2.4), (1.23, -1.9 + i * .47, 1.35), 'batten', bevel=0, vary=.07)
    k.box((1.6, 4.6, .16), (.65, 0, 2.95), 'zinc', 'metal', bevel=.02, rot=(0, .25, 0))
    k.box((1.3, 4.2, .1), (.6, 0, 3.08), 'snow', bevel=.04, rot=(0, .25, 0))
    k.push((1.2, 0, 0), math.pi / 2)
    k.window(-.9, 1.6, .7, .9)
    k.window(.9, 1.6, .7, .9)
    k.pop()
    k.pop()
    for y in (2.2, 4.4):
        k.cyl(.3, 8.2, (-R - .15, y, .14 + 4.1), 'iron', 'metal', n=10, bevel=0)
        k.cyl(.36, .5, (-R - .15, y, 8.1), 'rust', 'metal', n=10)
        k.cyl(.34, .25, (-R - .15, y, 5.8), 'trim', 'trim', n=10, bevel=0)
        k.empty('smoke', (-R - .15, y, 8.6))
        k.bar((-R - .15, y, 5.0), (-R + .5, y, 5.0), .1)
    # apron: guide lines, bollards, gantry crane
    A0, A1 = -10.4, -3.8
    for sx in (-1, 1):
        k.box((.14, A1 - A0, .02), (sx * 2.2, (A0 + A1) / 2, .15), 'hazard', bevel=0)
    hazard(k, (-2.2, A0 + .3, .15), (2.2, A0 + .3, .15), .3)
    for sx in (-1, 1):
        cx = sx * 4.9
        for y in (-7.4, -10.0):
            k.box((.3, .3, 6.2), (cx, y, 3.24), 'hazard', bevel=.03)
            k.box((.6, .6, .3), (cx, y, .29), 'concrete', bevel=.03)
        k.truss((cx, -10.0, 6.1), (cx, -7.4, 6.1), .5, .1, 3)
    k.truss((-4.9, -8.7, 6.4), (4.9, -8.7, 6.4), .6, .13, 8)
    k.box((10.2, .26, .26), (0, -8.7, 6.3), 'hazard', bevel=.02)
    k.box((1.0, .9, .6), (1.4, -8.7, 5.9), 'orange', bevel=.04)
    k.tube((1.4, -8.7, 5.6), (1.4, -8.7, 3.6), .03, 'iron', 'metal', n=4)
    k.box((.5, .3, .35), (1.4, -8.7, 3.45), 'iron', 'metal', bevel=.03)
    k.box((.26, .14, .14), (-4.9, -8.7, 6.9), 'lamp', 'lamp', bevel=0)
    k.empty('light', (-4.9, -8.7, 6.9))
    k.lamp((-3.4, L0 - .35, 4.0))
    k.lamp((3.4, L0 - .35, 4.0))
    k.crates((-5.3, -2.3, .14), 1.57)
    k.drums((4.8, -2.8, .14), 3)
    k.drift((-3.5, 6.9, .14), 1.4, .5, .25)


def build_airfield(k):
    """Air base: a painted helipad with edge lights, a small arched hangar with a rolling door,
    a timber control tower with a glass cab and beacon, and a striped windsock."""
    yard(k, 14.0, 11.0, 0, 0, 'concrete')
    px, py = -2.4, -1.4
    k.cyl(3.4, .08, (px, py, .18), 'asphalt', n=32, bevel=0)
    k.cyl(3.0, .02, (px, py, .23), 'hazard', n=32, bevel=0)
    k.cyl(2.75, .03, (px, py, .235), 'asphalt', n=32, bevel=0)
    k.box((.35, 2.0, .02), (px - .6, py, .26), 'white', bevel=0)
    k.box((.35, 2.0, .02), (px + .6, py, .26), 'white', bevel=0)
    k.box((1.2, .35, .02), (px, py, .26), 'white', bevel=0)
    for i in range(8):
        t = i / 8 * math.tau
        k.box((.18, .18, .16), (px + math.cos(t) * 3.2, py + math.sin(t) * 3.2, .3), 'lamp', 'lamp', bevel=0)
    k.empty('light', (px, py, .5))
    # hangar
    hx, hy, R = 3.9, 1.6, 2.8
    L0, L1 = -1.4, 3.6
    for sx in (-1, 1):
        k.box((.4, L1 - L0, .8), (hx + sx * (R - .1), hy + (L0 + L1) / 2, .54), 'stone', bevel=.04)
    k.arch(R - .05, R + .12, hy + L0 - .25, hy + L1 + .1, at=(hx, 0, .94), seg=12, paint='zinc', surf='metal')
    for i in range(5):
        y = hy + L0 - .1 + i * (L1 - L0) / 4
        k.arch(R + .1, R + .25, y - .09, y + .09, at=(hx, 0, .94), seg=12, paint='iron', surf='metal')
    k.arch(R + .12, R + .26, hy + L0, hy + L1, at=(hx, 0, .94), a0=math.radians(60), a1=math.radians(120), seg=4,
           paint='snow')
    pts = [(math.cos(math.pi * i / 12) * (R - .1), .8 + math.sin(math.pi * i / 12) * (R - .1)) for i in range(13)]
    k.poly(pts, -.1, .1, at=(hx, hy + L1, .14), paint='timber')
    k.poly(pts, -.1, .1, at=(hx, hy + L0, .14), paint='timber')
    k.box((3.8, .3, 3.0), (hx, hy + L0 - .02, 1.64), 'tar', bevel=0)
    prev = k.rig('door', (hx, hy + L0 - .2, 3.2))
    for i in range(8):
        k.box((3.6, .1, .36), (hx, hy + L0 - .24, .34 + i * .37), 'steel' if i % 2 else 'steel_lt', 'metal', bevel=0)
    k.box((3.5, .05, .4), (hx, hy + L0 - .3, 1.8), 'trim', 'trim', bevel=0)
    k.end(prev)
    k.box((1.7, .1, .8), (hx, hy + L0 - .2, 3.75), 'cream', bevel=0)
    k.text('07', (hx, hy + L0 - .28, 3.75), .65, 'timber_dk')
    # control tower
    tx, ty = -5.2, 3.6
    k.plinth(3.0, 3.0, .6, (tx, ty, .14))
    k.push((tx, ty, .74))
    k.timber_body(2.4, 2.4, 4.0)
    for f in 'fr':
        face(k, 0, 0, 2.4, 2.4, 0, f)
        k.window(0, 1.3, .7, .9)
        k.window(0, 2.9, .7, .9)
        k.pop()
    face(k, 0, 0, 2.4, 2.4, 0, 'l')
    k.door(0, .9, 2.0, double=False)
    k.pop()
    k.box((3.0, 3.0, .2), (0, 0, 4.1), 'stone_lt', bevel=.04)
    k.box((2.7, 2.7, 1.3), (0, 0, 4.85), 'glass_warm', 'glass', bevel=.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.14, .14, 1.4), (sx * 1.35, sy * 1.35, 4.85), 'cream', bevel=0)
    k.box((3.5, 3.5, .22), (0, 0, 5.6), 'slate', bevel=.04)
    k.box((3.4, 3.4, .12), (0, 0, 5.74), 'snow', bevel=.05)
    k.box((3.52, 3.52, .16), (0, 0, 5.5), 'trim', 'trim', bevel=0)
    k.cyl(.2, .3, (0, 0, 5.95), 'orange', 'lamp', n=8)
    k.empty('light', (0, 0, 6.1))
    k.mast((.9, .9, 5.7), 2.4, guy=False)
    k.pop()
    k.ladder((tx + 1.55, ty - .6, .74), 3.9, math.pi / 2)
    # windsock
    wx, wy = 6.1, -4.4
    k.cyl(.07, 4.2, (wx, wy, 2.24), 'steel_lt', 'metal', n=6, bevel=0)
    for i in range(4):
        k.cyl(.3 - i * .045, .38, (wx - .3 - i * .38, wy, 4.1 - i * .05), 'orange' if i % 2 == 0 else 'white',
              n=8, r2=.3 - (i + 1) * .045, rot=(0, -math.pi / 2 - .1, 0), bevel=0, caps=True)
    k.box((.3, .3, .06), (wx, wy, .2), 'concrete', bevel=0)
    # fuel bowser, drums, tie-downs
    k.box((2.2, 1.1, 1.0), (3.4, -3.8, .8), 'olive', bevel=.08)
    k.cyl(.5, 1.8, (3.6, -3.8, 1.45), 'olive', n=12, rot=(0, math.pi / 2, 0))
    for x in (2.7, 4.1):
        k.cyl(.3, 1.2, (x, -3.8, .44), 'rubber', n=10, rot=(math.pi / 2, 0, 0))
    k.drums((-6.3, -4.6, .14), 4)
    k.floodlight((6.5, 4.8, .14), 5.2, face=2.5)
    k.floodlight((-6.4, -1.0, .14), 5.2, face=-1.2)
    k.box((.4, 9.0, .03), (-6.7 + .2, 0, .16), 'trim', 'trim', bevel=0)
    k.drift((1.0, 5.1, .14), 1.4, .5, .25)


def build_lab(k):
    """Research station: a two-storey timber lab on a stone plinth, a round stone observatory
    with a slotted zinc dome and telescope, a glasshouse, a cryo tank and a dish antenna."""
    yard(k, 10.0, 10.0, 0, -.2)
    k.plinth(6.4, 4.8, .5, (-1.4, 1.6, .14))
    house(k, -1.4, 1.6, 5.8, 4.2, 4.8, 2.4, z0=.64, ridge='x', door=(-1.0, 1.4, 2.4), spacing=1.5)
    k.push((-1.4, 1.6 - 2.1, .64))
    k.awning(-1.0, 2.95, 2.2, 1.0)
    k.banner(1.2, 4.4, .6, 1.8)
    k.lamp((-2.0, 0, 2.7))
    k.pop()
    k.chimney(-3.4, 2.7, 5.2, 8.2, .6, .6)
    # observatory
    ox, oy = 2.8, 1.4
    k.cyl(2.0, .8, (ox, oy, .54), 'stone', n=20, bevel=.06)
    k.cyl(1.8, 4.2, (ox, oy, 3.0), 'stone_lt', n=20, bevel=0)
    for z in (1.8, 3.2):
        k.cyl(1.84, .12, (ox, oy, z), 'stone_dk', n=20, bevel=0)
    k.cyl(1.95, .3, (ox, oy, 5.2), 'trim', 'trim', n=20, bevel=0)
    k.ball((ox, oy, 5.3), 1.85, 'white', 'matte', n=20, rings=8, hemi=True)
    k.box((.6, 2.3, 1.9), (ox, oy - .8, 6.1), 'tar', bevel=0, rot=(-.7, 0, 0))
    for sx in (-1, 1):
        k.box((.1, 2.3, 1.95), (ox + sx * .35, oy - .8, 6.1), 'brass', 'metal', bevel=0, rot=(-.7, 0, 0))
    k.tube((ox, oy - .2, 6.2), (ox, oy - 1.7, 7.4), .2, 'brass', 'metal', n=10)
    k.ball((ox, oy, 7.12), .16, 'brass', 'metal', n=8, rings=4)
    for i in range(6):
        t = math.radians(-60 + i * 25)
        k.push((ox + math.cos(t - math.pi / 2) * 1.8, oy + math.sin(t - math.pi / 2) * 1.8, 0), t)
        k.window(0, 3.5, .45, .8, sill=False, bars=False)
        k.pop()
    k.ladder((ox + 1.95, oy - .4, .94), 4.3, math.pi / 2)
    # glasshouse
    gx, gy = -2.2, -2.9
    k.box((3.2, 2.0, .4), (gx, gy, .34), 'stone', bevel=.04)
    k.box((3.0, 1.8, 1.4), (gx, gy, 1.24), 'glass_warm', 'glass', bevel=0)
    for i in range(5):
        k.box((.07, 1.9, 1.5), (gx - 1.5 + i * .75, gy, 1.24), 'cream', bevel=0)
    k.poly([(-1.6, 1.94), (1.6, 1.94), (0, 2.7)], -1.0, 1.0, at=(gx, gy, 0), paint='glass_warm', surf='glass', rot=(0, 0, 0))
    k.box((3.3, .1, .1), (gx, gy, 2.72), 'cream', bevel=0)
    # cryo tank and pipes
    k.cyl(.8, 2.6, (-4.2, -1.3, 1.44), 'white', n=16)
    k.ball((-4.2, -1.3, 2.74), .8, 'white', n=16, rings=6, hemi=True)
    k.cyl(.83, .35, (-4.2, -1.3, 2.0), 'trim', 'trim', n=16, bevel=0)
    k.tube((-4.2, -.5, 1.2), (-4.2, .8, 1.2), .1, 'steel', 'metal')
    # dish antenna on the roof ridge end
    k.mast((-4.6, -3.6, .14), 6.0, guy=False)
    k.floodlight((4.4, -4.4, .14), 4.6, face=.7)
    k.crates((.8, -4.2, .14), .3)
    k.fence((-4.8, -4.9, .14), (-3.9, -4.9, .14))
    k.drift((4.4, 4.2, .14), 1.0, .6, .25)


def build_outpost(k):
    """Forward outpost: a log cabin in a sandbag ring with a lattice radio mast, radome,
    floodlight and flag."""
    yard(k, 7.0, 7.0)
    house(k, -.9, .8, 3.2, 2.6, 2.6, 1.4, z0=.14, ridge='x', faces='fl', door=(.6, .9, 2.0), spacing=1.6)
    k.chimney(-1.9, 1.3, 2.8, 4.6, .45, .45)
    k.push((-.9, .8 - 1.3, .14))
    k.lamp((.6, 0, 2.3))
    k.pop()
    # lattice mast
    mx, my = 2.1, 1.9
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.bar((mx + sx * .6, my + sy * .6, .14), (mx + sx * .15, my + sy * .15, 8.0), .08)
    for i, z in enumerate((1.4, 2.8, 4.2, 5.6, 7.0)):
        s = .6 - (z / 8.0) * .45
        for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            k.bar((mx + a[0] * s, my + a[1] * s, z), (mx + b[0] * s, my + b[1] * s, z), .05)
    k.ball((mx, my, 8.3), .45, 'white', n=12, rings=6)
    k.box((1.0, .05, .05), (mx, my, 7.4), 'steel_lt', 'metal', bevel=0)
    k.box((.16, .16, .16), (mx, my, 8.85), 'orange', 'lamp', bevel=0)
    k.empty('light', (mx, my, 8.9))
    k.cyl(.35, .35, (mx, my, 5.6), 'trim', 'trim', n=8, bevel=0)
    k.flag((-2.6, -2.4, .14), 4.4, 1.4, .9)
    k.sandbags((-3.2, -3.1, .14), (1.2, -3.1, .14))
    k.sandbags((3.1, -3.0, .14), (3.1, -.2, .14))
    k.floodlight((2.6, -2.4, .14), 3.4, face=.6)
    k.box((1.1, .8, .8), (.9, 2.9, .54), 'olive', bevel=.05)
    k.drums((-3.0, 2.2, .14), 2)
    k.drift((-3.0, -.4, .14), .5, 1.2, .25)


def build_turret(k):
    """Bofors sentry: a round concrete emplacement ringed with sandbags, an open twin 40 mm
    mount behind a shield (turret yaws, barrels recoil) and a ready-round locker."""
    k.cyl(3.9, .3, (0, 0, .15), 'concrete', n=24, bevel=.08)
    k.cyl(3.4, .06, (0, 0, .32), 'asphalt', n=24, bevel=0)
    for i in range(20):
        t = i / 20 * math.tau
        if abs(math.sin(t / 2 - math.pi / 4)) < .2:
            continue
        for r in range(2):
            k.box((.95, .45, .3), (math.cos(t) * 3.45, math.sin(t) * 3.45, .45 + r * .27), 'canvas', bevel=.1,
                  rot=(0, 0, t + math.pi / 2 + r * .08), vary=.1)
    k.box((1.1, .7, .8), (-2.0, 2.2, .7), 'olive', bevel=.05, rot=(0, 0, .6))
    k.box((1.14, .74, .08), (-2.0, 2.2, 1.14), 'snow', bevel=.03, rot=(0, 0, .6))
    k.cyl(1.4, 1.0, (0, 0, .8), 'concrete', n=16, bevel=.06)
    k.cyl(1.45, .18, (0, 0, 1.22), 'trim', 'trim', n=16, bevel=0)
    prev = k.rig('turret', (0, 0, 1.3))
    k.cyl(1.25, .35, (0, 0, 1.48), 'steel', 'metal', n=16)
    for sx in (-1, 1):
        k.box((.4, 1.9, 1.5), (sx * .95, .1, 2.35), 'steel', 'metal', bevel=.07)
        k.box((.7, .8, .5), (sx * 1.45, .7, 1.95), 'iron', 'metal', bevel=.04)
        k.box((.14, 1.5, .3), (sx * 1.18, .1, 2.6), 'trim', 'trim', bevel=0)
    k.box((2.9, .2, 1.7), (0, -1.05, 2.5), 'steel', 'metal', bevel=.07, rot=(-.15, 0, 0))
    k.box((2.94, .1, .36), (0, -1.17, 3.08), 'trim', 'trim', bevel=0, rot=(-.15, 0, 0))
    k.box((.9, .7, .7), (0, .2, 2.25), 'iron', 'metal', bevel=.05)
    k.box((.6, .7, .45), (.45, .75, 3.1), 'iron', 'metal', bevel=.04)
    k.box((.4, .06, .24), (.45, .38, 3.1), 'glass_warm', 'glass', bevel=0)
    gun(k, (0, -.3, 2.4), 3.1, .1, elev=.2, twin=.36)
    k.end(prev)
    k.drums((2.0, -2.4, .3), 3)
    k.drift((2.6, 2.6, .3), .8, .6, .2)


def build_battery(k):
    """Coastal battery: a heavy casemate turret with a long 152 mm gun on a raised concrete ring
    inside a turfed earth berm, rangefinder, ammunition bunker and sandbags."""
    k.cyl(5.4, .25, (0, 0, .12), 'concrete', n=28, bevel=.06)
    # earth berm ring (turf with drifted snow), open at the front for the gun
    k.cyl(5.3, 1.1, (0, 0, .75), 'turf', n=28, r2=4.1, bevel=0)
    for i in range(7):
        t = i / 7 * math.tau + .3
        k.ball((math.cos(t) * 4.6, math.sin(t) * 4.6, .6), 1.0, 'snow', scale=(1.0, .7, .3), n=8, rings=3,
               hemi=True, rot=(0, 0, t + math.pi / 2), vary=.02)
    k.cyl(3.9, 1.3, (0, 0, .75), 'concrete', n=24, bevel=.08)
    k.cyl(3.95, .2, (0, 0, 1.2), 'trim', 'trim', n=24, bevel=0)
    k.cyl(2.4, .1, (0, 0, 1.42), 'asphalt', n=20, bevel=0)
    # ammunition bunker at the back
    k.box((2.8, 1.6, 1.6), (0, 4.2, 1.2), 'concrete', bevel=.12)
    k.box((2.9, 1.7, .1), (0, 4.2, 2.05), 'snow', bevel=.04)
    k.push((0, 3.4, .4), math.pi)
    k.door(0, 1.0, 1.1, paint='iron', stripe=False, glass=False, double=False)
    k.pop()
    k.push((0, 0, .55))
    prev = k.rig('turret', (0, 0, .85))
    k.cyl(2.0, .4, (0, 0, 1.05), 'steel', 'metal', n=20, bevel=.04)
    k.box((3.2, 3.6, 1.6), (0, .3, 2.0), 'steel', 'metal', bevel=.3, seg=2, taper=(.85, .9))
    k.box((3.26, 3.3, .3), (0, .4, 1.7), 'trim', 'trim', bevel=0)
    k.box((2.6, 2.6, .1), (0, .5, 2.84), 'snow', bevel=.05)
    k.rivets((-1.5, -1.6, 2.6), (1.5, -1.6, 2.6), 10)
    for sx in (-1, 1):
        k.box((.9, .3, .3), (sx * 1.9, .2, 2.5), 'iron', 'metal', bevel=.04)
        k.cyl(.15, .8, (sx * 1.9, .2, 2.5), 'glass_warm', 'glass', n=8, rot=(math.pi / 2, 0, 0))
    k.box((1.0, .8, .5), (.9, 1.2, 3.05), 'steel_lt', 'metal', bevel=.06)
    k.box((1.2, .6, .7), (0, -1.6, 2.0), 'iron', 'metal', bevel=.08)
    gun(k, (0, -1.6, 2.05), 3.6, .17, elev=.1)
    k.end(prev)
    k.pop()
    k.sandbags((-4.9, -2.2, 1.4), (-3.6, -3.6, 1.4))
    k.sandbags((3.6, -3.6, 1.4), (4.9, -2.2, 1.4))
    k.crates((2.4, 2.2, 1.4), .6)


def build_bunker(k):
    """Pillbox: a hexagonal concrete casemate half sunk in turf, firing slits, a steel roof
    cupola with a machine gun (turret), blast door and sandbag wings."""
    k.cyl(3.9, .2, (0, 0, .1), 'gravel', n=6, bevel=.04)
    for i in range(12):
        t = i / 12 * math.tau
        k.ball((math.cos(t) * 3.2, math.sin(t) * 3.2, .2), .9, 'turf', scale=(1.1, 1.2, .6), n=8, rings=4,
               hemi=True, rot=(0, 0, t), vary=.08)
    k.cyl(2.6, 1.9, (0, 0, 1.15), 'concrete', n=6, r2=2.3, bevel=.12)
    k.cyl(2.7, .35, (0, 0, 2.2), 'concrete', n=6, bevel=.1)
    k.cyl(2.72, .16, (0, 0, 2.08), 'trim', 'trim', n=6, bevel=0)
    k.cyl(2.3, .12, (0, 0, 2.42), 'snow', n=6, bevel=.05)
    for j in range(6):
        t = j / 6 * math.tau + math.pi / 6
        if j == 1:
            continue
        k.push((math.cos(t) * 2.35, math.sin(t) * 2.35, 0), t + math.pi / 2)
        k.box((1.4, .3, .3), (0, -.05, 1.45), 'tar', bevel=0)
        k.box((1.7, .5, .16), (0, -.18, 1.7), 'concrete', bevel=.03)
        k.pop()
    # blast door at the back
    k.push((0, 2.3, 0), math.pi)
    k.box((1.2, .2, 1.6), (0, -.1, 1.0), 'iron', 'metal', bevel=.03)
    k.box((1.2, .06, .22), (0, -.22, 1.3), 'hazard', bevel=0)
    k.pop()
    k.cyl(.9, .3, (0, 0, 2.55), 'iron', 'metal', n=12)
    prev = k.rig('turret', (0, 0, 2.7))
    k.ball((0, 0, 2.7), .8, 'steel', 'metal', scale=(1, 1, .75), n=12, rings=5, hemi=True)
    k.box((.5, .3, .2), (0, -.62, 2.95), 'tar', bevel=0)
    gun(k, (0, -.5, 3.0), 1.3, .06, elev=.02)
    k.end(prev)
    k.cyl(.07, .8, (1.2, .8, 2.8), 'steel', 'metal', n=6, bevel=0)
    k.box((.26, .16, .16), (1.2, .78, 3.2), 'glass_warm', 'glass', bevel=0)
    k.sandbags((-3.7, -1.2, .2), (-2.0, -3.4, .2))
    k.sandbags((2.0, -3.4, .2), (3.7, -1.2, .2))


def build_flak(k):
    """Flak tower: an octagonal banded concrete tower with a sandbagged gun deck, a twin
    autocannon on a yawing ring, a searchlight and ammunition lockers."""
    k.cyl(4.2, .2, (0, 0, .1), 'gravel', n=8, bevel=.04)
    k.cyl(2.7, 4.2, (0, 0, 2.3), 'concrete', n=8, r2=2.4, bevel=0)
    for z in (1.2, 2.6):
        k.cyl(2.72 - z * .07, .14, (0, 0, z), 'stone_dk', n=8, bevel=0)
    k.cyl(3.1, .4, (0, 0, 4.5), 'concrete', n=8, bevel=.08)
    k.cyl(3.12, .2, (0, 0, 4.4), 'trim', 'trim', n=8, bevel=0)
    for i in range(8):
        t = i / 8 * math.tau + math.pi / 8
        k.push((math.cos(t) * 2.3, math.sin(t) * 2.3, 0), t + math.pi / 2)
        k.box((.7, 1.0, 4.1), (0, -.3, 2.2), 'concrete', bevel=.05, taper=(1, .6))
        k.pop()
        k.box((1.1, .5, .5), (math.cos(t) * 2.8, math.sin(t) * 2.8, 4.95), 'canvas', bevel=.12, rot=(0, 0, t + math.pi / 2),
              vary=.1)
    k.push((0, -2.45, 0))
    k.door(0, 1.1, 2.1, paint='iron')
    k.pop()
    k.ladder((2.2, 1.6, .2), 4.3, .6)
    k.box((1.0, .7, .7), (-2.9, 2.2, .55), 'olive', bevel=.05)
    k.box((1.0, .7, .7), (-2.9, 1.3, .55), 'olive', bevel=.05)
    # searchlight on the deck edge
    k.cyl(.12, .6, (-2.0, 1.4, 5.0), 'iron', 'metal', n=8, bevel=0)
    k.cyl(.42, .5, (-2.0, 1.2, 5.45), 'iron', 'metal', n=12, rot=(math.pi / 2 - .3, 0, 0))
    k.cyl(.34, .06, (-2.0, .93, 5.53), 'lamp', 'lamp', n=12, rot=(math.pi / 2 - .3, 0, 0), bevel=0)
    k.empty('light', (-2.0, .9, 5.5))
    prev = k.rig('turret', (0, 0, 4.7))
    k.cyl(1.5, .35, (0, 0, 4.88), 'steel', 'metal', n=16)
    for sx in (-1, 1):
        k.box((.42, 1.7, 1.4), (sx * 1.0, .15, 5.7), 'steel', 'metal', bevel=.07)
        k.box((.12, 1.4, .3), (sx * 1.22, .15, 6.0), 'trim', 'trim', bevel=0)
        k.cyl(.42, .6, (sx * 1.45, .5, 5.4), 'olive', n=10, rot=(0, math.pi / 2, 0))
    k.box((2.4, .16, 1.2), (0, -.85, 5.6), 'steel', 'metal', bevel=.06, rot=(-.3, 0, 0))
    k.box((2.44, .08, .3), (0, -.97, 6.08), 'trim', 'trim', bevel=0, rot=(-.3, 0, 0))
    k.box((.8, .6, .6), (0, .5, 5.5), 'iron', 'metal', bevel=.04)
    gun(k, (0, -.1, 5.75), 2.8, .1, elev=.75, twin=.34)
    k.end(prev)


def build_radar(k):
    """Radar mast: a tapered lattice tower on a concrete pad with a crew hut; the big mesh dish
    (radar_dish) spins on its bearing above the platform."""
    yard(k, 8.0, 8.0, 0, 0, 'concrete')
    house(k, -2.0, 2.2, 3.4, 2.4, 2.6, 1.3, z0=.14, ridge='x', faces='fr', door=(.9, .9, 2.0), spacing=1.6)
    k.chimney(-3.0, 2.8, 2.8, 4.8, .45, .45)
    k.push((-2.0, 2.2 - 1.2, .14))
    k.lamp((.9, 0, 2.35))
    k.pop()
    top = 6.4
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.5, .5, .4), (sx * 1.3, sy * 1.3, .34), 'concrete', bevel=.04)
            k.bar((sx * 1.3, sy * 1.3, .5), (sx * .45, sy * .45, top), .14, 'iron')
    for z in (1.7, 3.0, 4.3, 5.5):
        s = 1.3 - (z / top) * .85
        for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            k.bar((a[0] * s, a[1] * s, z), (b[0] * s, b[1] * s, z), .07, 'iron')
        s2 = 1.3 - ((z + 1.3) / top) * .85
        if z < 5:
            k.bar((-s, -s, z), (s2, -s2, z + 1.3), .05, 'iron')
            k.bar((s, s, z), (-s2, s2, z + 1.3), .05, 'iron')
    k.box((1.8, 1.8, .2), (0, 0, top + .1), 'steel', 'metal', bevel=.03)
    k.box((1.84, 1.84, .12), (0, 0, top - .02), 'trim', 'trim', bevel=0)
    for sx in (-1, 1):
        k.box((1.8, .05, .5), (0, sx * .9, top + .45), 'iron', 'metal', bevel=0)
    k.ladder((1.0, -.6, .14), top, math.pi / 2 + .12)
    k.cyl(.35, .5, (0, 0, top + .45), 'iron', 'metal', n=12)
    prev = k.rig('radar_dish', (0, 0, top + .7))
    k.cyl(.28, .5, (0, 0, top + .95), 'steel', 'metal', n=10)
    k.box((.7, .5, .5), (0, .4, top + 1.3), 'iron', 'metal', bevel=.04)
    # parabolic dish tilted up, facing -Y
    k.push((0, -.15, top + 2.4))
    k.ball((0, 0, 0), 2.3, 'white', 'matte', scale=(1, .38, .75), n=18, rings=8, hemi=True, rot=(math.pi / 2 - .35, 0, 0))
    k.pop()
    k.box((4.6, .1, .12), (0, .15, top + 2.3), 'iron', 'metal', bevel=0, rot=(-.35, 0, 0))
    k.box((.12, .1, 3.4), (0, .15, top + 2.3), 'iron', 'metal', bevel=0, rot=(-.35, 0, 0))
    k.box((4.4, .06, .2), (0, .22, top + 2.3), 'trim', 'trim', bevel=0, rot=(-.35, 0, 0))
    k.tube((0, -.3, top + 2.3), (0, -1.4, top + 2.7), .04, 'iron', 'metal', n=4)
    k.ball((0, -1.5, top + 2.75), .16, 'iron', 'metal', n=8, rings=4)
    k.end(prev)
    k.box((.16, .16, .16), (.8, .8, top + .3), 'orange', 'lamp', bevel=0)
    k.empty('light', (.8, .8, top + .4))
    k.box((1.2, .8, 1.2), (2.6, -2.6, .74), 'olive', bevel=.05)
    k.box((.6, .06, .3), (2.6, -3.02, .9), 'lamp', 'lamp', bevel=0)
    k.sandbags((-3.6, -3.4, .14), (-.8, -3.4, .14))
    k.drift((3.4, 2.0, .14), .6, 1.4, .3)


def build_plant(k):
    """Thermal power station: a brick-and-timber turbine hall, twin tall brick stacks with
    smoke, a hyperbolic cooling tower, coal bunker and a transformer yard."""
    yard(k, 11.0, 11.0)
    # turbine hall
    k.plinth(7.0, 4.2, .5, (-1.4, -2.4, .14))
    house(k, -1.4, -2.4, 6.4, 3.6, 4.4, 2.0, z0=.64, ridge='x', door=(-1.6, 1.5, 2.6), spacing=1.4,
          rows=[2.6], win=(.8, 2.4))
    k.push((-1.4, -4.2, .64))
    k.text('KRAFT', (1.2, -.12, 4.0), .45, 'cream')
    k.lamp((-1.6, 0, 2.9))
    k.pop()
    for x in (-3.6, -2.2):
        k.box((1.2, 1.2, 1.0), (x, -.2, .64), 'brick', bevel=.04)
        k.cyl(.55, 11.0, (x, -.2, 6.1), 'brick', n=12, r2=.42, bevel=0)
        for z in (3.0, 6.0, 9.0):
            k.cyl(.58 - z * .012, .18, (x, -.2, z), 'iron', 'metal', n=12, bevel=0)
        k.cyl(.62, .45, (x, -.2, 10.4), 'trim', 'trim', n=12, bevel=0)
        k.cyl(.5, .3, (x, -.2, 11.7), 'tar', n=12, bevel=0)
        k.empty('smoke', (x, -.2, 12.0))
    # cooling tower: hyperbolic profile
    cx, cy = 2.6, 2.6
    prof = [(2.6, 0), (2.25, 1.5), (1.95, 3.0), (1.85, 4.2), (1.95, 5.2), (2.1, 6.0)]
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        k.cyl(r0, z1 - z0, (cx, cy, .14 + (z0 + z1) / 2), 'concrete', n=20, r2=r1, bevel=0, caps=False)
    k.cyl(2.12, .2, (cx, cy, 6.2), 'concrete', n=20, bevel=0)
    k.cyl(1.9, .1, (cx, cy, 6.1), 'tar', n=20, bevel=0)
    k.cyl(2.28, .3, (cx, cy, 1.0), 'trim', 'trim', n=20, r2=2.2, bevel=0)
    for i in range(10):
        t = i / 10 * math.tau
        k.bar((cx + math.cos(t) * 2.7, cy + math.sin(t) * 2.7, .14), (cx + math.cos(t + .4) * 2.45, cy + math.sin(t + .4) * 2.45, 1.2), .12, 'concrete', 'matte')
    k.empty('smoke', (cx, cy, 6.4))
    k.empty('smoke', (cx + .6, cy - .4, 6.4))
    # coal bunker and conveyor
    k.box((2.2, 2.4, 1.6), (-3.6, 3.4, .94), 'wood_dk', bevel=.04)
    for i in range(6):
        k.ball((-4.2 + (i % 3) * .6, 3.0 + (i // 3) * .7, 1.8), .5, 'tar', scale=(1, 1, .6), n=8, rings=4, vary=.12)
    k.bar((-3.0, 2.6, 1.6), (-2.2, -.6, 4.8), .5, 'zinc', 'metal', d=.4)
    # transformer yard
    k.box((3.0, 2.2, .2), (2.8, -3.2, .24), 'concrete', bevel=.03)
    for x in (2.0, 3.6):
        k.box((1.1, .9, 1.3), (x, -3.2, .99), 'olive', bevel=.05)
        for i in range(4):
            k.box((.05, .9, 1.1), (x - .4 + i * .27, -3.7, .99), 'iron', 'metal', bevel=0)
        for i in range(3):
            k.cyl(.07, .6, (x - .3 + i * .3, -3.0, 1.95), 'white', n=6, bevel=0)
    for x in (1.4, 4.4):
        k.box((.16, .16, 3.4), (x, -4.4, 1.84), 'iron', 'metal', bevel=0)
    k.box((3.3, .14, .14), (2.9, -4.4, 3.5), 'iron', 'metal', bevel=0)
    k.fence((1.2, -4.9, .14), (4.9, -4.9, .14), .9, 'steel')
    k.bar((-1.4 + 3.2, -2.4, 3.6), (cx - 1.9, cy - 1.0, 3.6), .4, 'steel', 'metal')
    k.drift((4.8, 5.0, .14), 1.0, .5, .25)


def build_workshop(k):
    """Field workshop: an open-sided timber repair shed on iron posts with a travelling hoist over
    a lifted engine, tyre stacks, welding bay, office hut and a work lamp mast."""
    yard(k, 11.0, 11.0, 0, 0, 'concrete')
    k.box((6.0, 6.4, .05), (-.4, .2, .17), 'asphalt', bevel=0)
    W, D, H = 6.6, 6.4, 4.2
    cx, cy = -.4, .6
    for sx in (-1, 1):
        for i in range(4):
            y = cy - D / 2 + i * D / 3
            k.box((.3, .3, H), (cx + sx * W / 2, y, .14 + H / 2), 'iron', 'metal', bevel=.03)
            k.box((.5, .5, .3), (cx + sx * W / 2, y, .29), 'concrete', bevel=.03)
            k.bar((cx + sx * W / 2, y, .14 + H - 1.0), (cx + sx * W / 2 - sx * .9, y, .14 + H - .05), .12)
        k.box((.34, D + .3, .4), (cx + sx * W / 2, cy, .14 + H), 'iron', 'metal', bevel=.02)
    k.push((cx, cy, .14))
    k.roof(W, D, 1.8, H + .1, over=.5, end_over=.4, paint='zinc', snow=.4, gable=False, gable_paint='timber')
    k.pop()
    # back wall (timber) with tool board
    k.push((cx, cy + D / 2 - .1, .14))
    k.timber_body(W - .3, .3, H, faces=(True, False, False, False), corner='cream')
    k.pop()
    k.box((3.6, .15, 1.4), (cx, cy + D / 2 - .35, 1.9), 'wood', bevel=.02)
    for i in range(7):
        k.box((.08, .1, .5), (cx - 1.5 + i * .5, cy + D / 2 - .45, 2.0), 'steel_lt', 'metal', bevel=0)
    k.box((2.8, .8, .9), (cx + 1.2, cy + D / 2 - .8, .59), 'wood_dk', bevel=.03)
    # gantry hoist rails with trolley and engine
    for sy in (-1, 1):
        k.box((W, .2, .24), (cx, cy + sy * 1.2, .14 + H - .3), 'hazard', bevel=0)
    prev = None
    k.box((.6, 2.8, .3), (cx - .6, cy, .14 + H - .55), 'orange', bevel=.03)
    k.tube((cx - .6, cy, .14 + H - .7), (cx - .6, cy, 2.3), .03, 'iron', 'metal', n=4)
    k.box((.3, .3, .3), (cx - .6, cy, 2.2), 'iron', 'metal', bevel=.03)
    k.box((1.4, 1.0, .9), (cx - .6, cy, 1.5), 'olive', bevel=.05)
    k.box((1.6, 1.2, .1), (cx - .6, cy, .95), 'steel', 'metal', bevel=0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.12, .12, .8), (cx - .6 + sx * .6, cy + sy * .45, .55), 'hazard', bevel=0)
    # office hut
    house(k, 3.9, 3.4, 2.4, 2.8, 2.6, 1.2, z0=.14, ridge='y', faces='fl', door=(0, .9, 2.0), spacing=1.4)
    k.chimney(4.4, 4.2, 2.9, 4.6, .4, .4)
    k.push((3.9, 3.4 - 1.4, .14))
    k.lamp((.7, 0, 2.3))
    k.pop()
    # tyres, drums, welding bay, crates
    for i in range(4):
        k.cyl(.48, .3, (4.2, -1.2, .3 + i * .3), 'rubber', n=12, bevel=.05)
    for i in range(3):
        k.cyl(.48, .3, (4.2, -.1, .3 + i * .3), 'rubber', n=12, bevel=.05)
    k.drums((-4.7, -3.8, .14), 4)
    k.crates((3.6, -4.4, .14), .2)
    k.box((.6, .5, 1.1), (-4.7, 2.2, .69), 'orange', bevel=.04)
    k.cyl(.2, 1.2, (-4.7, 2.8, .74), 'rust', 'metal', n=8)
    k.box((.2, .2, .2), (-4.4, 2.2, 1.35), 'lamp', 'lamp', bevel=0)
    k.empty('light', (-4.4, 2.2, 1.4))
    k.floodlight((-4.9, -1.5, .14), 5.0, face=-1.3)
    k.box((.3, 6.2, .02), (cx - 3.0, cy - .2, .2), 'hazard', bevel=0)
    k.box((.3, 6.2, .02), (cx + 2.4, cy - .2, .2), 'hazard', bevel=0)
    for u in (-2.0, 1.4):
        k.push((cx + u, cy - D / 2 - .5, .14 + H + .2))
        k.box((1.2, .1, .5), (0, 0, 0), 'trim', 'trim', bevel=0)
        k.pop()
    k.text('VERKSTED', (cx, cy - D / 2 - .7, .14 + H - .05), .38, 'cream')
    k.box((3.4, .08, .5), (cx, cy - D / 2 - .62, .14 + H - .05), 'trim', 'trim', bevel=0)


def build_hospital(k):
    """Aid station: a long timber ward with white-cross panels, a canvas triage tent with an
    ambulance canopy, stove chimney, stretchers, supply crates and a lantern."""
    yard(k, 10.6, 9.0)
    k.plinth(7.0, 3.8, .4, (-1.2, 2.0, .14))
    house(k, -1.2, 2.0, 6.4, 3.2, 3.0, 1.8, z0=.54, ridge='x', faces='fblr', door=(0, 1.4, 2.3), spacing=1.6,
          rows=[1.7], win=(.8, 1.0))
    k.push((-1.2, .4, .54))
    k.awning(0, 2.6, 2.4, 1.2)
    for u in (-2.2, 2.2):
        k.box((1.3, .1, 1.3), (u, -.08, 3.5), 'white', bevel=.02)
        k.box((.95, .08, .3), (u, -.14, 3.5), 'medic', bevel=0)
        k.box((.3, .08, .95), (u, -.14, 3.5), 'medic', bevel=0)
    k.lamp((-1.0, 0, 2.4))
    k.pop()
    k.chimney(1.0, 2.6, 3.6, 6.2, .5, .5)
    # canvas triage tent
    tx, ty = 2.8, -1.8
    k.box((4.2, 3.2, .1), (tx, ty, .19), 'wood', bevel=0)
    for s in (-1, 1):
        k.box((2.0, 3.4, .1), (tx + s * .95, ty, 1.55), 'canvas', bevel=.02, rot=(0, s * .88, 0), dense=.8)
    k.poly([(-1.8, .2), (1.8, .2), (0, 2.55)], -.05, .05, at=(tx, ty + 1.65, 0), paint='canvas_dk')
    k.poly([(-1.8, .2), (-.5, .2), (0, 2.55)], -.05, .05, at=(tx, ty - 1.65, 0), paint='canvas_dk')
    k.box((.1, 3.6, .1), (tx, ty, 2.6), 'wood_dk', bevel=0)
    for s in (-1, 1):
        k.box((1.2, .6, .1), (tx + s * .9, ty, 2.0), 'white', bevel=0, rot=(0, s * .88, 0))
        k.box((.8, .62, .12), (tx + s * .92, ty, 2.02), 'medic', bevel=0, rot=(0, s * .88, 0))
    # ambulance canopy (culture paint) on posts
    k.box((3.0, 2.4, .12), (-2.6, -2.4, 2.8), 'trim', 'trim', bevel=.02, dense=.8)
    k.box((2.8, 2.2, .1), (-2.6, -2.4, 2.9), 'snow', bevel=.04)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.12, .12, 2.7), (-2.6 + sx * 1.35, -2.4 + sy * 1.05, 1.49), 'iron', 'metal', bevel=0)
    for i in range(2):
        k.box((.6, 1.9, .1), (-3.2 + i * 1.1, -2.6, .7), 'canvas', bevel=.02)
        for sy in (-1, 1):
            k.box((.08, .08, .5), (-3.2 + i * 1.1, -2.6 + sy * .8, .4), 'iron', 'metal', bevel=0)
    for i in range(3):
        k.box((.8, .6, .5), (-4.6, 3.6 - i * .75, .39), 'white', bevel=.04)
        k.box((.4, .62, .12), (-4.6, 3.6 - i * .75, .4), 'medic', bevel=0)
    k.box((1.0, 1.0, 1.2), (4.3, 2.8, .74), 'steel', 'metal', bevel=.05)
    k.post_lamp((-.2, -3.9, .14), 2.6)
    k.flag((4.6, -4.0, .14), 4.0, 1.4, .9)
    k.drift((-4.8, -.2, .14), .6, 1.3, .25)


def build_camp(k):
    """Strandhogg raiding camp (Fjordborn): a tarred longhouse with dragon-head gables and
    shields, a ridge tent, fire pit, ski rack and a snowmobile lean-to around a yard facing
    the exit."""
    yard(k, 11.0, 11.0, 0, -.3, 'gravel')
    # longhouse, tarred timber with a steep turf-and-shingle roof
    lx, ly = -.6, 2.6
    k.box((8.0, 3.4, .3), (lx, ly, .29), 'stone', bevel=.06)
    k.push((lx, ly, .44))
    k.timber_body(7.6, 3.0, 2.4, paint='tar', corner='wood', sill='stone_dk')
    k.pop()
    k.push((lx, ly, .44), math.pi / 2)
    k.roof(3.0, 7.6, 2.6, 2.4, over=.6, end_over=.4, paint='wood_dk', snow=.35, gable_paint='tar', finial=False)
    k.pop()
    for sx in (-1, 1):
        # carved dragon heads on the gable peaks
        x = lx + sx * (3.8 + .4)
        k.bar((x, ly, 5.3), (x + sx * .6, ly - .2, 6.3), .2, 'trim', 'trim', d=.25)
        k.box((.25, .6, .3), (x + sx * .7, ly - .45, 6.35), 'trim', 'trim', bevel=.05)
    k.push((lx, ly - 1.5, .44))
    k.door(0, 1.4, 2.0, paint='wood', stripe=True, glass=False)
    for u in (-3.0, -1.9, 1.9, 3.0):
        k.cyl(.42, .1, (u, -.1, 1.5), 'trim', 'trim', n=10, rot=(math.pi / 2, 0, 0), bevel=.02)
        k.cyl(.12, .14, (u, -.16, 1.5), 'brass', 'metal', n=8, rot=(math.pi / 2, 0, 0), bevel=0)
    k.lamp((-1.0, 0, 2.2))
    k.pop()
    k.chimney(lx + 2.0, ly + .6, 3.0, 5.6, .5, .5)
    # ridge tent (left front)
    tx, ty = -3.4, -1.6
    for s in (-1, 1):
        k.box((1.9, 2.8, .08), (tx + s * .7, ty, 1.0), 'canvas', bevel=.02, rot=(0, s * .95, 0), dense=.8)
    k.poly([(-1.3, .15), (1.3, .15), (0, 1.8)], -.04, .04, at=(tx, ty + 1.4, 0), paint='canvas_dk')
    k.box((.1, 3.2, .1), (tx, ty, 1.82), 'wood_dk', bevel=0)
    k.box((.5, 2.6, .1), (tx, ty, 1.76), 'trim', 'trim', bevel=0)
    # fire pit with embers (glow and smoke)
    fx, fy = .4, -1.4
    for i in range(8):
        t = i / 8 * math.tau
        k.box((.35, .3, .25), (fx + math.cos(t) * .7, fy + math.sin(t) * .7, .26), 'stone', bevel=.07, rot=(0, 0, t))
    k.cyl(.5, .1, (fx, fy, .2), 'ember', 'lamp', n=10, bevel=0)
    for t in (0, 2.1, 4.2):
        k.bar((fx + math.cos(t) * .5, fy + math.sin(t) * .5, .2), (fx - math.cos(t) * .2, fy - math.sin(t) * .2, .5), .1, 'wood_dk', 'matte')
    k.empty('smoke', (fx, fy, .7))
    k.empty('light', (fx, fy, .6))
    for t in (.5, 2.3, 4.0):
        k.cyl(.12, 1.0, (fx + math.cos(t) * 1.4, fy + math.sin(t) * 1.4, .35), 'wood', n=8, rot=(0, math.pi / 2, t + math.pi / 2))
    # ski rack
    k.box((2.2, .1, .1), (3.0, .4, 1.6), 'wood_dk', bevel=0)
    for sx in (-1, 1):
        k.box((.1, .1, 1.6), (3.0 + sx * 1.0, .4, .94), 'wood_dk', bevel=0)
    for i in range(7):
        k.box((.08, .04, 1.9), (2.2 + i * .26, .5, 1.1), 'white' if i % 2 else 'wood_lt', bevel=0, rot=(.15, 0, 0))
    # snowmobile lean-to (right)
    sx0, sy0 = 3.8, 3.4
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.14, .14, 2.2 - sy * .3), (sx0 + sx * 1.2, sy0 + sy * 1.1, 1.24 - sy * .15), 'wood_dk', bevel=0)
    k.box((2.8, 2.8, .12), (sx0, sy0, 2.3), 'wood', bevel=.02, rot=(-.2, 0, 0))
    k.box((2.6, 2.4, .1), (sx0, sy0, 2.4), 'snow', bevel=.04, rot=(-.2, 0, 0))
    k.box((.9, 1.9, .5), (sx0, sy0, .55), 'olive', bevel=.12)
    k.box((.8, .6, .3), (sx0, sy0 - .5, .95), 'rubber', bevel=.06)
    k.box((.7, .12, .3), (sx0, sy0 - 1.0, .5), 'trim', 'trim', bevel=0)
    k.flag((-4.8, -4.4, .14), 4.6, 1.5, 1.0)
    k.drums((4.2, -.9, .14), 2, 'tar')
    k.crates((-4.9, .4, .14), .5)
    k.fence((-5.2, 5.0, .14), (5.2, 5.0, .14), 1.0)
    k.drift((1.8, -4.6, .14), 1.4, .5, .25)


def build_armory(k):
    """Bergverk armory (Ironclad): a riveted concrete bunker dug into a rock outcrop, a huge
    hazard-striped blast door, a forge stack with an ember-lit furnace and a rail with an ore cart."""
    yard(k, 10.6, 10.6, 0, 0, 'concrete')
    # rock outcrop behind
    for (x, y, s, h) in ((-3.0, 3.2, 2.2, 1.9), (.2, 3.4, 2.5, 2.3), (3.3, 3.1, 2.1, 2.0), (-4.3, .6, 1.3, 1.6),
                         (4.4, .8, 1.4, 1.7), (-1.6, 4.4, 1.3, 1.5), (2.0, 4.4, 1.2, 1.4)):
        k.ball((x, y, .14), s, 'stone_dk' if x < 0 else 'stone', scale=(1.0, .75, h), n=7, rings=4, hemi=True, vary=.12)
        k.ball((x + .1, y + .15, s * h * .72), s * .55, 'snow', scale=(1.0, .8, .5), n=7, rings=3, hemi=True, vary=.02)
    # bunker block
    k.box((7.4, 4.6, 3.6), (0, .6, 1.94), 'concrete', bevel=.2, seg=2, dense=1.2, taper=(.94, .94))
    k.box((7.8, 5.0, .5), (0, .6, 3.9), 'concrete', bevel=.12, seg=1, dense=1.5)
    k.box((7.6, 4.8, .12), (0, .6, 4.2), 'snow', bevel=.05, dense=2.0)
    k.box((7.82, 5.02, .2), (0, .6, 3.72), 'trim', 'trim', bevel=0)
    for sx in (-1, 1):
        k.box((1.0, 1.4, 3.4), (sx * 3.3, -1.6, 1.84), 'concrete', bevel=.12, taper=(.8, .7))
        k.box((.2, .12, 2.6), (sx * 2.6, -1.72, 1.6), 'iron', 'metal', bevel=0)
    for z in (1.0, 2.3):
        k.rivets((-3.0, -1.72, z), (3.0, -1.72, z), 16, .05)
    # blast door frame + door rig
    k.box((4.2, .4, 3.2), (0, -1.6, 1.74), 'iron', 'metal', bevel=.06)
    k.box((3.4, .1, 2.7), (0, -1.82, 1.5), 'tar', bevel=0)
    prev = k.rig('door', (0, -1.9, 3.0))
    k.box((3.3, .2, 2.7), (0, -1.9, 1.5), 'steel', 'metal', bevel=.05)
    for i in range(8):
        x0 = -1.5 + i * .43
        k.box((.22, .24, 1.0), (x0, -1.97, .7), 'hazard', bevel=0, rot=(0, .7, 0))
    k.cyl(.45, .12, (0, -2.02, 2.0), 'iron', 'metal', n=12, rot=(math.pi / 2, 0, 0))
    k.box((1.6, .06, .3), (0, -2.03, 2.65), 'trim', 'trim', bevel=0)
    k.end(prev)
    k.text('BERGVERK', (0, -1.84, 3.35), .36, 'cream')
    # forge stack and furnace glow
    fx, fy = 2.6, 1.8
    k.box((1.8, 1.6, 1.0), (fx, fy, 4.5), 'brick', bevel=.05)
    k.cyl(.45, 5.4, (fx, fy, 7.0), 'iron', 'metal', n=10, r2=.36)
    for z in (5.8, 7.4, 8.8):
        k.cyl(.48 - (z - 5) * .02, .16, (fx, fy, z), 'rust', 'metal', n=10, bevel=0)
    k.cyl(.5, .4, (fx, fy, 9.6), 'trim', 'trim', n=10, bevel=0)
    k.empty('smoke', (fx, fy, 10.0))
    k.cyl(.7, 2.8, (-2.6, 1.4, 5.2), 'rust', 'metal', n=10, r2=.5)
    k.empty('smoke', (-2.6, 1.4, 6.7))
    k.box((1.0, .1, .6), (-3.0, -1.72, .9), 'ember', 'lamp', bevel=0)
    k.empty('light', (-3.0, -2.0, .9))
    k.lamp((2.4, -1.4, 3.0))
    k.lamp((-2.4, -1.4, 3.0))
    # rail and ore cart
    for sx in (-.45, .45):
        k.box((.08, 5.5, .08), (-4.4 + sx, -2.4, .2), 'steel_lt', 'metal', bevel=0)
    for i in range(10):
        k.box((1.2, .2, .08), (-4.4, -5.0 + i * .55, .16), 'wood_dk', bevel=0)
    k.box((1.1, 1.4, .8), (-4.4, -3.2, .8), 'rust', bevel=.05, taper=(1.15, 1.1))
    for i in range(3):
        k.ball((-4.5 + i * .25, -3.2, 1.2), .35, 'stone_dk', scale=(1, 1, .6), n=8, rings=4)
    k.sandbags((3.6, -4.8, .14), (5.0, -3.2, .14))
    k.crates((3.4, -3.0, .14), -.3)
    k.drift((-1.5, -4.8, .14), 1.2, .5, .25)


def build_depot(k):
    """Lade storehouse (Hearthkin): a two-storey stabbur on staddle stones with an overhanging
    loft, turf roof and hoist, beside a hay stack, cart, sacks and barrels."""
    yard(k, 10.6, 10.6, 0, 0, 'gravel')
    sx0, sy0 = -.6, 1.4
    for x in (-2.4, -.8, .8, 2.4):
        for y in (-1.4, 1.4):
            k.cyl(.3, .7, (sx0 + x, sy0 + y, .49), 'stone', n=8, r2=.2, bevel=.04)
            k.box((.8, .8, .14), (sx0 + x, sy0 + y, .9), 'stone_lt', bevel=.03)
    k.box((5.8, 3.6, .3), (sx0, sy0, 1.12), 'wood_dk', bevel=.03)
    k.push((sx0, sy0, 1.27))
    k.timber_body(5.4, 3.2, 2.2, paint='timber', corner='wood')
    k.pop()
    # overhanging loft
    k.box((6.4, 4.2, .3), (sx0, sy0, 3.62), 'wood_dk', bevel=.03)
    k.push((sx0, sy0, 3.77))
    k.timber_body(6.2, 4.0, 1.8, paint='timber', corner='wood', sill='wood_dk')
    k.pop()
    k.push((sx0, sy0, 3.77), math.pi / 2)
    k.roof(4.0, 6.2, 2.0, 1.8, over=.55, end_over=.4, paint='turf', snow=.45, courses=False, gable_paint='timber')
    k.pop()
    k.push((sx0, sy0 - 1.6, 1.27))
    k.door(0, 1.3, 1.9, paint='wood', double=True, glass=False)
    k.lamp((1.1, 0, 1.9))
    k.pop()
    k.push((sx0, sy0 - 2.0, 3.77))
    k.window(-1.8, .9, .6, .6)
    k.window(1.8, .9, .6, .6)
    k.box((1.3, .1, 1.3), (0, -.04, .8), 'wood_dk', bevel=.02)
    k.pop()
    # steps up to the door
    for i in range(3):
        k.box((1.4, .5, .3), (sx0, sy0 - 2.1 - i * .45, 1.0 - i * .3), 'wood', bevel=.03)
    # hoist beam over the loft door with a crate on the rope
    k.box((.2, 1.6, .2), (sx0, sy0 - 2.6, 5.4), 'wood_dk', bevel=0)
    k.cyl(.15, .2, (sx0, sy0 - 3.3, 5.25), 'iron', 'metal', n=8, rot=(0, math.pi / 2, 0))
    k.tube((sx0, sy0 - 3.4, 5.2), (sx0, sy0 - 3.4, 2.5), .025, 'wood_lt', 'matte', n=4)
    k.crate((sx0, sy0 - 3.4, 1.7), .75)
    # banners on the gable ends
    for s in (-1, 1):
        k.push((sx0 + s * 3.1, sy0, 3.77), s * math.pi / 2)
        k.banner(0, 1.6, .8, 1.2)
        k.pop()
    # hay stack, cart, sacks, barrels
    k.ball((3.6, 3.4, .14), 1.2, 'ochre', scale=(1, 1, 1.3), n=12, rings=6, hemi=True, vary=.05)
    k.ball((3.6, 3.4, 1.2), .8, 'snow', scale=(1, 1, .5), n=10, rings=4, hemi=True)
    k.box((1.6, 2.4, .5), (3.4, -2.2, .85), 'wood', bevel=.04)
    for sy in (-1, 1):
        k.cyl(.5, .12, (3.4 - .85, -2.2 + sy * .7, .6), 'wood_dk', n=10, rot=(0, math.pi / 2, 0))
        k.cyl(.5, .12, (3.4 + .85, -2.2 + sy * .7, .6), 'wood_dk', n=10, rot=(0, math.pi / 2, 0))
    k.bar((3.4, -3.4, .8), (3.4, -4.8, .5), .1, 'wood_dk', 'matte')
    for i in range(4):
        k.ball((3.1 + (i % 2) * .55, -1.8 - (i // 2) * .6, 1.25), .3, 'canvas', scale=(1, .8, .9), n=8, rings=4, vary=.08)
    for i in range(3):
        k.cyl(.35, .8, (-4.2 + i * .75, -2.6, .54), 'wood', n=10, bevel=.04)
        k.cyl(.37, .06, (-4.2 + i * .75, -2.6, .75), 'iron', 'metal', n=10, bevel=0)
    k.fence((-5.2, -4.9, .14), (-1.8, -4.9, .14))
    k.fence((-5.2, -4.9, .14), (-5.2, -.4, .14))
    k.flag((-4.4, 4.2, .14), 4.4, 1.4, .9)
    k.drift((4.6, .6, .14), .6, 1.2, .25)


def build_watchtower(k):
    """Varde watchtower (Ashwalkers): a braced timber fire-watch tower on a stone cairn with a
    beacon brazier, lookout platform, ladder, ash-grey banners and a small ranger hut."""
    yard(k, 8.6, 8.6)
    # cairn base
    for i, (r, z) in enumerate(((2.4, .14), (2.0, .7), (1.6, 1.2))):
        for j in range(10 - i * 2):
            t = j / (10 - i * 2) * math.tau + i * .4
            k.box((1.0 - i * .1, .8, .6), (math.cos(t) * (r - .5), math.sin(t) * (r - .5), z + .3), 'stone' if j % 2 else 'stone_lt',
                  bevel=.12, rot=(0, 0, t), vary=.1)
    k.cyl(1.7, .9, (0, 0, .9), 'stone_dk', n=10, r2=1.3, bevel=.05)
    top = 8.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.bar((sx * 1.2, sy * 1.2, 1.3), (sx * .8, sy * .8, top), .22, 'wood_dk', 'matte')
    for z in (3.0, 5.0, 7.0):
        s = 1.2 - (z - 1.3) / (top - 1.3) * .4
        for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            k.bar((a[0] * s, a[1] * s, z), (b[0] * s, b[1] * s, z), .12, 'wood', 'matte')
        s2 = 1.2 - (z + 2.0 - 1.3) / (top - 1.3) * .4
        if z < 7:
            k.bar((-s, -s, z), (s2, -s2, z + 2.0), .09, 'wood', 'matte')
            k.bar((s, s, z), (-s2, s2, z + 2.0), .09, 'wood', 'matte')
            k.bar((-s, s, z), (-s2, -s2, z + 2.0), .09, 'wood', 'matte')
    # platform and lookout hut
    k.box((3.0, 3.0, .25), (0, 0, top), 'wood_dk', bevel=.03)
    k.box((2.2, 2.2, 1.4), (0, 0, top + .8), 'timber', bevel=.03)
    for rz in (0, math.pi / 2, math.pi, -math.pi / 2):
        k.push((0, 0, 0), rz)
        k.box((1.6, .06, .5), (0, -1.12, top + 1.1), 'glass_warm', 'glass', bevel=0)
        k.box((3.0, .08, .6), (0, -1.5, top + .5), 'trim', 'trim', bevel=0)
        k.box((3.0, .1, .1), (0, -1.5, top + .9), 'wood', bevel=0)
        k.pop()
    k.poly_pyramid(0, 0, top + 1.5, 3.0, 3.0, 1.4, 'slate')
    # beacon brazier on the roof peak
    k.cyl(.14, .5, (0, 0, top + 3.0), 'iron', 'metal', n=8, bevel=0)
    k.cyl(.55, .5, (0, 0, top + 3.4), 'iron', 'metal', n=10, r2=.7, bevel=.02)
    k.cyl(.5, .1, (0, 0, top + 3.62), 'ember', 'lamp', n=10, bevel=0)
    k.empty('light', (0, 0, top + 3.9))
    k.empty('smoke', (0, 0, top + 4.0))
    k.ladder((0, -1.3, 1.3), top - 1.2, 0)
    for s in (-1, 1):
        k.box((.12, .9, 3.2), (s * 1.02, -.5, top - 2.4), 'trim', 'trim', bevel=0, rot=(0, 0, 0), dense=.5)
    # ranger hut
    house(k, 2.6, 2.4, 2.4, 2.0, 2.0, 1.1, z0=.14, ridge='y', faces='f', door=(0, .8, 1.7), spacing=1.4,
          paint='timber_dk', roof='turf')
    k.chimney(3.2, 2.9, 2.2, 3.8, .35, .35)
    k.push((2.6, 1.4, .14))
    k.lamp((.6, 0, 1.9))
    k.pop()
    # firewood stacks and a beacon cairn
    for i in range(3):
        k.cyl(.12, 1.4, (-2.8, 2.6 - i * .3, .3 + (i % 2) * .2), 'wood', n=6, rot=(0, math.pi / 2, 0))
    k.box((1.6, .9, .7), (-2.8, 2.4, .49), 'wood_dk', bevel=.02)
    k.flag((-3.2, -3.2, .14), 4.2, 1.4, .9)
    k.drift((3.2, -2.8, .14), .9, .7, .25)


# ---------------------------------------------------------------- superweapons
def storm_boat(k, at, rz=0.0, length=6.0, beam=1.5, trim=True):
    """A clinker-built storm-boat: tarred hull, faction sheer strake, carved prow, oar ports."""
    x, y, z = at
    k.push((x, y, z), rz)
    n = 6
    for i in range(n):
        t = i / (n - 1)
        w = beam * (1 - (abs(t - .5) * 2) ** 2.2 * .82)
        yy = -length / 2 + t * length
        k.box((w, length / n + .05, .7), (0, yy, .45), 'tar', bevel=.12, taper=(1.15, 1.0))
        k.box((w * .82, length / n + .06, .12), (0, yy, .8), 'wood_lt', bevel=.02)
    for sx in (-1, 1):
        # faction sheer strake and a row of round shields along each side
        k.box((.08, length * .7, .16), (sx * beam * .52, 0, .74), 'trim' if trim else 'wood', 'trim' if trim else 'matte', bevel=0)
        for i in range(5):
            k.cyl(.2, .06, (sx * beam * .56, -length * .28 + i * length * .14, .9), 'wood' if i % 2 else 'cream', n=8,
                  rot=(0, math.pi / 2, 0), bevel=0)
    for s in (-1, 1):
        # prow and stern posts curling up
        k.bar((0, s * length / 2 * .92, .5), (0, s * length / 2 * 1.06, 1.6), .2, 'wood_dk', 'matte', d=.24)
        k.box((.22, .5, .3), (0, s * length / 2 * 1.12, 1.7), 'trim', 'trim', bevel=.05)
    for i in range(4):
        yy = -length * .3 + i * length * .2
        for s in (-1, 1):
            k.cyl(.07, .7, (s * beam * .55, yy, .62), 'wood_lt', n=5, rot=(0, s * 1.25, 0), bevel=0)
    k.box((.08, .08, 2.2), (0, -length * .1, 1.9), 'wood_dk', bevel=0)
    k.pop()


def build_boathouse(k):
    """Naust storm-boat house (Fjordborn superweapon): a long tarred boat shed with a steep turf
    roof open to the front, a storm-boat on the greased slipway, a second hull on trestles,
    oar racks, beacon and a hoisted raiding banner."""
    yard(k, 12.4, 12.4, 0, 0, 'gravel')
    # the naust: stone side walls, timber gable, open front
    bx, by = -1.2, 1.4
    for s in (-1, 1):
        k.box((.6, 7.6, 1.6), (bx + s * 2.6, by, .94), 'stone', bevel=.12, dense=1.2, vary=.08)
        k.push((bx + s * 2.6, by, 1.74))
        k.timber_body(.5, 7.4, 1.6, paint='tar', corner='wood', faces=(False, False, s < 0, s > 0))
        k.pop()
    k.push((bx, by + 3.6, .14))
    k.timber_body(5.6, .4, 3.2, paint='tar', corner='wood', faces=(False, True, False, False))
    k.pop()
    k.push((bx, by, .14))
    k.roof(5.8, 7.6, 3.0, 3.2, over=.55, end_over=.45, paint='turf', snow=.4, courses=False, gable_paint='tar')
    k.pop()
    # carved dragon on the front gable
    k.bar((bx, by - 4.0, 6.0), (bx, by - 4.6, 6.9), .22, 'trim', 'trim', d=.28)
    k.box((.3, .7, .35), (bx, by - 4.85, 7.0), 'trim', 'trim', bevel=.06)
    # slipway rails out of the shed and the launched storm-boat
    for s in (-1, 1):
        k.box((.18, 11.0, .12), (bx + s * .8, by - 1.6, .22), 'wood_dk', bevel=0)
    for i in range(9):
        k.box((2.2, .22, .1), (bx, by + 3.2 - i * 1.3, .2), 'wood', bevel=0)
    storm_boat(k, (bx, by - 4.2, .28), 0.0, 6.0, 1.7)
    # second hull, upturned on trestles to the right
    hx, hy = 4.2, 1.6
    for yy in (-1.6, 1.6):
        for s in (-1, 1):
            k.bar((hx + s * .7, hy + yy, .14), (hx + s * .3, hy + yy, 1.3), .14, 'wood_dk', 'matte')
        k.box((1.6, .16, .14), (hx, hy + yy, 1.3), 'wood_dk', bevel=0)
    k.push((hx, hy, 2.25))
    k.push((0, 0, 0), 0)
    storm_boat(k, (0, 0, 0), 0.0, 4.6, 1.2, trim=True)
    k.pop()
    k.pop()
    # oar rack and sea chests
    k.box((2.6, .12, .12), (4.0, -2.6, 1.7), 'wood_dk', bevel=0)
    for s in (-1, 1):
        k.box((.12, .12, 1.7), (4.0 + s * 1.2, -2.6, .99), 'wood_dk', bevel=0)
    for i in range(8):
        k.box((.08, .05, 2.4), (3.0 + i * .28, -2.5, 1.3), 'wood_lt', bevel=0, rot=(.12, 0, 0))
    for i in range(3):
        k.box((.9, .6, .55), (-5.4 + i * 1.0, -4.6, .42), 'wood', bevel=.05)
        k.box((.92, .62, .1), (-5.4 + i * 1.0, -4.6, .72), 'trim', 'trim', bevel=0)
    # signal beacon
    k.cyl(.12, 3.0, (-5.2, 4.6, 1.6), 'wood_dk', n=6, bevel=0)
    k.cyl(.5, .45, (-5.2, 4.6, 3.3), 'iron', 'metal', n=10, r2=.65)
    k.cyl(.45, .1, (-5.2, 4.6, 3.5), 'ember', 'lamp', n=10, bevel=0)
    k.empty('light', (-5.2, 4.6, 3.8))
    k.empty('smoke', (-5.2, 4.6, 3.9))
    k.flag((4.4, 5.0, .14), 5.0, 1.8, 1.1)
    k.drums((-5.4, 1.6, .14), 2, 'tar')
    k.drift((5.2, -5.2, .14), .9, .7, .25)
    k.drift((-5.6, -1.6, .14), .6, 1.2, .25)


def build_cannon(k):
    """Fjell railway gun (Ironclad superweapon, the Mountain Gun): a super-heavy rail carriage on
    twin bogies in a concrete cutting, its long barrel raised toward the front, a shell hoist,
    ammunition bunker and a riveted crew shelter."""
    yard(k, 9.6, 16.4, 0, 0, 'concrete')
    # track: two rails on sleepers, front to back
    for s in (-1, 1):
        k.box((.12, 16.2, .14), (s * .9, 0, .28), 'steel_lt', 'metal', bevel=0)
    for i in range(18):
        k.box((2.6, .3, .12), (0, -7.65 + i * .9, .19), 'wood_dk', bevel=0, vary=.08)
    # cutting walls along the sides
    for s in (-1, 1):
        k.box((.8, 10.0, 1.4), (s * 4.2, 1.6, .84), 'concrete', bevel=.1, dense=1.4, taper=(.8, 1))
        k.box((.84, 10.0, .14), (s * 4.2, 1.6, 1.55), 'snow', bevel=.05)
        hazard(k, (s * 3.7, -3.2, .16), (s * 3.7, 6.4, .16), .16, .2)
    # carriage on two bogies
    for yb in (-3.0, 3.0):
        k.box((2.3, 2.6, .7), (0, yb, .75), 'iron', 'metal', bevel=.08)
        for yy in (-.8, .8):
            for s in (-1, 1):
                k.cyl(.42, .22, (s * .95, yb + yy, .58), 'steel', 'metal', n=12, rot=(0, math.pi / 2, 0))
    k.box((3.0, 8.6, .9), (0, 0, 1.55), 'steel', 'metal', bevel=.12, dense=1.6)
    k.box((3.04, 8.64, .2), (0, 0, 1.3), 'trim', 'trim', bevel=0)
    k.rivets((-1.5, -4.32, 1.75), (1.5, -4.32, 1.75), 8, .06)
    # cradle, trunnions and the barrel raised toward the front (-Y)
    k.box((2.6, 3.4, 1.6), (0, .8, 2.75), 'steel', 'metal', bevel=.14, taper=(.85, .9))
    for s in (-1, 1):
        k.cyl(.55, .4, (s * 1.35, .4, 3.2), 'iron', 'metal', n=12, rot=(0, math.pi / 2, 0))
    elev = .55
    length = 9.6
    a = Vector((0, 1.8, 3.2))
    d = Vector((0, -math.cos(elev), math.sin(elev)))
    k.tube(a, a + d * length, .42, 'steel', 'metal', n=14)
    k.tube(a - d * 1.6, a + d * 3.2, .62, 'iron', 'metal', n=14)
    k.tube(a + d * (length - .6), a + d * (length + .2), .55, 'iron', 'metal', n=14)
    for t in (2.2, 4.4, 6.6):
        k.tube(a + d * t, a + d * (t + .22), .5, 'trim', 'trim', n=14)
    # recoil cylinders under the barrel
    for s in (-1, 1):
        k.tube(a + Vector((s * .5, 0, -.45)), a + Vector((s * .5, 0, -.45)) + d * 3.0, .14, 'steel_lt', 'metal', n=8)
    # breech house with a stencilled number
    k.box((2.4, 2.0, 1.6), (0, 3.4, 3.0), 'olive', bevel=.1)
    k.box((2.44, 2.04, .16), (0, 3.4, 3.72), 'trim', 'trim', bevel=0)
    k.text('MG-1', (0, 4.42, 2.8), .4, 'cream', rot=(0, 0, math.pi))
    # shell hoist and shells on a cart behind
    k.bar((2.0, 6.2, .3), (1.2, 4.6, 4.2), .16, 'iron')
    k.bar((-2.0, 6.2, .3), (-1.2, 4.6, 4.2), .16, 'iron')
    k.box((2.8, .2, .2), (0, 4.6, 4.2), 'iron', 'metal', bevel=0)
    k.box((1.6, 1.4, .5), (0, 6.6, .6), 'rust', bevel=.05)
    for i in range(3):
        k.cyl(.26, 1.4, (-.5 + i * .5, 6.6, 1.15), 'brass', 'metal', n=10, rot=(math.pi / 2, 0, 0))
        k.cyl(.26, .4, (-.5 + i * .5, 5.75, 1.15), 'steel', 'metal', n=10, r2=.04, rot=(math.pi / 2, 0, 0))
    # crew shelter and ammunition bunker
    k.box((2.4, 2.6, 2.0), (3.4, -5.6, 1.14), 'concrete', bevel=.15, taper=(.9, .9))
    k.box((2.5, 2.7, .16), (3.4, -5.6, 2.2), 'snow', bevel=.05)
    k.box((1.0, .1, 1.3), (3.4, -6.92, .8), 'iron', 'metal', bevel=0)
    k.lamp((3.4, -6.9, 1.8))
    k.box((2.6, 2.2, 1.4), (-3.3, -5.8, .84), 'concrete', bevel=.15)
    k.box((2.64, 2.24, .12), (-3.3, -5.8, 1.6), 'trim', 'trim', bevel=0)
    k.sandbags((-4.4, -7.6, .14), (-1.8, -7.6, .14))
    k.floodlight((3.9, 6.8, .14), 4.4, math.pi)
    k.drift((-3.4, 7.4, .14), 1.2, .6, .25)


def cargo_plane(k, at, rz=0.0, scale=1.0):
    """A high-wing twin-engine transport parked on skis."""
    x, y, z = at
    k.push((x, y, z), rz)
    k.M = k.M @ Matrix.Scale(scale, 4)
    k.box((1.4, 7.0, 1.4), (0, 0, 1.55), 'olive', bevel=.4, seg=2, dense=1.8)
    k.ball((0, -3.5, 1.55), .7, 'olive', scale=(1, 1.3, 1), n=12, rings=6)
    k.box((1.0, .4, .5), (0, -3.95, 1.95), 'glass', 'matte', bevel=.08)
    k.box((.9, 2.2, .9), (0, 4.4, 1.9), 'olive', bevel=.3, taper=(.5, .7))
    k.box((10.8, 1.4, .18), (0, -.8, 2.4), 'olive', bevel=.06)
    k.box((10.9, .3, .2), (0, -1.45, 2.4), 'trim', 'trim', bevel=0)
    for s in (-1, 1):
        k.cyl(.36, 1.6, (s * 2.2, -1.5, 2.15), 'iron', 'metal', n=10, rot=(math.pi / 2, 0, 0))
        k.box((.08, .1, 1.8), (s * 2.2, -2.36, 2.15), 'iron', 'metal', bevel=0)
        k.box((1.8, .1, .08), (s * 2.2, -2.36, 2.15), 'iron', 'metal', bevel=0)
        k.box((.25, 3.2, .14), (s * .9, -.4, .32), 'steel_lt', 'metal', bevel=.05)
        k.bar((s * .9, -.4, .38), (s * .5, -.4, 1.0), .1, 'iron')
    k.box((3.6, .9, .14), (0, 4.9, 2.1), 'olive', bevel=.04)
    k.box((.14, 1.0, 1.4), (0, 5.0, 2.8), 'olive', bevel=.04, taper=(1, .6))
    k.box((.16, .5, .5), (0, 5.2, 3.2), 'trim', 'trim', bevel=0)
    k.box((.6, 1.3, .06), (0, -1.1, 2.52), 'snow', bevel=.02)
    k.pop()


def build_airstrip(k):
    """Vinterveg airstrip (Hearthkin superweapon, the Winter Convoy): a packed-snow strip with
    marker flags, a parked transport, a timber control hut with a windsock, and pallets of
    supply crates under parachute canopies."""
    yard(k, 14.0, 12.8, 0, 0, 'gravel')
    # the packed strip runs left to right across the front
    k.box((13.8, 4.4, .08), (0, -2.6, .18), 'snow', bevel=.02, dense=2.0, vary=.01)
    for i in range(7):
        k.box((.9, .2, .03), (-5.4 + i * 1.8, -2.6, .23), 'hazard', bevel=0)
    for x in (-6.4, 6.4):
        for yy in (-4.6, -.6):
            k.cyl(.04, .9, (x, yy, .6), 'wood_dk', n=4, bevel=0)
            k.box((.36, .03, .26), (x + .18, yy, .9), 'orange', bevel=0)
    cargo_plane(k, (-.4, -2.2, .14), math.pi / 2 - .08, .74)
    # control hut and windsock
    house(k, -4.6, 3.6, 3.4, 2.8, 2.4, 1.2, z0=.14, ridge='x', faces='fr', door=(.8, .9, 1.9), spacing=1.6, roof='turf')
    k.chimney(-5.6, 4.2, 2.6, 4.2, .4, .4)
    k.box((1.6, 1.6, .9), (-4.6, 3.6, 4.4), 'glass_warm', 'glass', bevel=.04)
    k.box((1.8, 1.8, .14), (-4.6, 3.6, 4.9), 'slate', bevel=.04)
    k.cyl(.05, 4.4, (-2.4, 5.6, 2.34), 'steel', 'metal', n=6, bevel=0)
    k.cyl(.3, 1.2, (-2.4, 5.0, 4.4), 'orange', n=8, r2=.14, rot=(math.pi / 2 - .2, 0, 0))
    k.box((.3, .3, .1), (-2.4, 5.6, 4.6), 'trim', 'trim', bevel=0)
    # supply pallets with parachute canopies
    for i, (px, py) in enumerate(((2.4, 2.4), (4.6, 3.6), (2.6, 4.8))):
        k.box((1.4, 1.4, .14), (px, py, .21), 'wood', bevel=0)
        k.crate((px - .3, py - .3, .28), .65, i * .3)
        k.crate((px + .35, py + .3, .28), .65, -i * .2)
        k.box((1.3, 1.3, .06), (px, py, .98), 'trim', 'trim', bevel=0)
    k.ball((5.0, .8, .14), 1.2, 'canvas', scale=(1.2, .9, .35), n=12, rings=5, hemi=True, vary=.06)
    k.box((1.0, 1.0, .9), (5.0, .8, .6), 'trim', 'trim', bevel=.05)
    # fuel drums and a snow plough blade
    k.drums((5.8, 5.4, .14), 3, 'olive')
    k.box((2.2, .3, .7), (1.2, 5.8, .5), 'hazard', bevel=.05, rot=(.3, 0, 0))
    k.flag((5.0, -5.4, .14), 4.4, 1.5, 1.0)
    k.post_lamp((-6.4, 1.2, .14))
    k.drift((-6.0, 6.0, .14), .8, .5, .25)


def build_launcher(k):
    """Brann rocket battery (Ashwalker superweapon, the Firestorm): an earth-bermed pit with a
    tall multi-rail incendiary launcher raised toward the front, ember-tipped rockets on the
    rails, a reload cart, an ash-grey observation hut and glowing braziers."""
    yard(k, 11.2, 11.2, 0, 0, 'gravel')
    # earth berm ring
    for i in range(12):
        t = i / 12 * math.tau
        if abs(math.sin(t)) > .85 and math.sin(t) < 0:
            continue   # gap at the front for the reload cart
        k.box((2.0, 1.2, .9), (math.cos(t) * 4.4, math.sin(t) * 4.4, .5), 'turf', bevel=.3, rot=(0, 0, t + math.pi / 2), vary=.1)
        k.box((1.8, .9, .16), (math.cos(t) * 4.4, math.sin(t) * 4.4, 1.0), 'snow', bevel=.07, rot=(0, 0, t + math.pi / 2))
    # turntable and launcher frame raised toward -Y
    k.cyl(1.8, .4, (0, .4, .34), 'concrete', n=16, bevel=.05)
    k.cyl(1.4, .3, (0, .4, .66), 'iron', 'metal', n=16)
    k.box((2.6, 2.2, .9), (0, .6, 1.2), 'steel', 'metal', bevel=.1)
    k.box((2.64, 2.24, .16), (0, .6, 1.0), 'trim', 'trim', bevel=0)
    elev = .75
    k.push((0, .6, 2.2))
    rot = (-elev, 0, 0)
    # rail pack: 3 x 4 tubes in a frame
    k.box((3.4, 5.0, .16), (0, -.6, 0), 'iron', 'metal', bevel=.03, rot=rot)
    for col in range(4):
        for row in range(3):
            x = -1.2 + col * .8
            zz = .35 + row * .62
            c = Vector((x, -.6, 0)) + Vector((0, math.sin(elev) * zz, math.cos(elev) * zz))
            k.cyl(.26, 4.8, c, 'olive', 'matte', n=8, rot=(math.pi / 2 - elev, 0, 0), bevel=0)
            tip = c + Vector((0, -math.cos(elev) * 2.45, math.sin(elev) * 2.45))
            k.cyl(.2, .5, tip, 'ember', 'lamp', n=8, r2=.02, rot=(math.pi / 2 - elev, 0, 0), bevel=0)
    for s in (-1, 1):
        k.box((.2, 5.0, 2.2), (s * 1.75, -.6, 1.0), 'steel', 'metal', bevel=.03, rot=rot)
        k.box((.22, 5.0, .3), (s * 1.78, -.6, 1.0), 'trim', 'trim', bevel=0, rot=rot)
    k.pop()
    k.bar((0, 2.0, .9), (0, 1.0, 3.6), .3, 'steel_lt')
    # reload cart in the gap and spare rockets
    k.box((1.6, 2.2, .5), (.2, -4.2, .55), 'wood', bevel=.05)
    for i in range(4):
        k.cyl(.2, 2.0, (-.3 + i * .32, -4.2, .98), 'olive', n=8, rot=(math.pi / 2, 0, 0), bevel=0)
        k.cyl(.16, .3, (-.3 + i * .32, -5.3, .98), 'ember', 'lamp', n=8, r2=.02, rot=(math.pi / 2, 0, 0), bevel=0)
    # observation hut, ash-grey with a turf roof
    house(k, -3.4, 3.0, 2.4, 2.0, 2.0, 1.0, z0=.14, ridge='y', faces='f', door=(0, .8, 1.7), spacing=1.4,
          paint='timber_dk', roof='turf')
    k.box((2.5, .08, .4), (-3.4, 1.95, 2.0), 'trim', 'trim', bevel=0)
    # braziers
    for (bx, by) in ((3.6, 3.4), (-4.4, -2.2)):
        k.cyl(.12, 1.2, (bx, by, .74), 'iron', 'metal', n=6, bevel=0)
        k.cyl(.45, .4, (bx, by, 1.5), 'iron', 'metal', n=10, r2=.6)
        k.cyl(.42, .1, (bx, by, 1.68), 'ember', 'lamp', n=10, bevel=0)
        k.empty('light', (bx, by, 2.0))
        k.empty('smoke', (bx, by, 2.1))
    k.flag((3.8, -4.4, .14), 4.0, 1.4, .9)
    k.crates((3.4, -1.0, .14), .4)
    k.drift((-1.6, 5.0, .14), 1.2, .5, .25)


def build_weathermast(k):
    """Weather Mast (garrison superweapon): a tall guyed lattice mast on a frozen concrete pad,
    crowned with a cloud-seeding coil and spinning anemometer cups (radar_dish), a humming
    generator hut, frosted pipework and ice-crusted drums."""
    yard(k, 9.0, 9.0, 0, 0, 'concrete')
    top = 11.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.6, .6, .5), (sx * 1.2, sy * 1.2, .39), 'concrete', bevel=.05)
            k.bar((sx * 1.2, sy * 1.2, .6), (sx * .4, sy * .4, top), .15, 'iron')
            # guy wires to ground anchors
            k.tube((sx * .45, sy * .45, top * .78), (sx * 4.0, sy * 4.0, .3), .03, 'steel_lt', 'metal', n=4)
            k.box((.4, .4, .3), (sx * 4.0, sy * 4.0, .29), 'concrete', bevel=.04)
    for z in (2.0, 4.0, 6.0, 8.0, 10.0):
        s = 1.2 - (z / top) * .8
        for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            k.bar((a[0] * s, a[1] * s, z), (b[0] * s, b[1] * s, z), .07, 'iron')
        s2 = 1.2 - ((z + 2.0) / top) * .8
        if z < 10:
            k.bar((-s, -s, z), (s2, -s2, z + 2.0), .05, 'iron')
            k.bar((s, s, z), (-s2, s2, z + 2.0), .05, 'iron')
        k.box((2 * s + .1, .06, .2), (0, -s, z + .3), 'trim', 'trim', bevel=0)
    # the seeding coil: stacked insulator discs under a frosted globe
    k.box((1.4, 1.4, .2), (0, 0, top + .1), 'steel', 'metal', bevel=.03)
    for i in range(5):
        k.cyl(.55 - i * .05, .16, (0, 0, top + .4 + i * .3), 'white', 'matte', n=12, bevel=.03)
    k.cyl(.12, 1.6, (0, 0, top + .9), 'brass', 'metal', n=8, bevel=0)
    k.ball((0, 0, top + 2.3), .55, 'ice', 'metal', n=14, rings=7)
    k.ball((0, 0, top + 2.3), .3, 'lamp', 'lamp', n=10, rings=5)
    k.empty('light', (0, 0, top + 2.3))
    # anemometer cups on their own spindle (spins like a radar dish)
    prev = k.rig('radar_dish', (0, 0, top + 3.0))
    k.cyl(.06, .7, (0, 0, top + 3.25), 'steel', 'metal', n=6, bevel=0)
    for i in range(3):
        t = i / 3 * math.tau
        k.bar((0, 0, top + 3.5), (math.cos(t) * .9, math.sin(t) * .9, top + 3.5), .06, 'iron')
        k.ball((math.cos(t) * .9, math.sin(t) * .9, top + 3.5), .2, 'trim', 'trim', n=8, rings=4, hemi=True,
               rot=(0, math.pi / 2, t + math.pi / 2))
    k.end(prev)
    k.ladder((.9, -.5, .64), top - .6, math.pi / 2 + .1)
    # generator hut with frosted exhaust
    house(k, 2.6, 2.6, 2.6, 2.2, 2.0, 1.0, z0=.14, ridge='x', faces='f', door=(-.5, .8, 1.7), spacing=1.4,
          paint='timber_dk', roof='slate')
    k.chimney(3.4, 3.0, 2.4, 3.8, .4, .4)
    k.tube((1.6, 1.6, 1.0), (.8, .8, 1.0), .14, 'ice', 'metal', n=8)
    k.tube((.8, .8, 1.0), (.8, .8, 2.6), .14, 'ice', 'metal', n=8)
    # ice-crusted drums, cable reel and frost drifts
    k.drums((-3.0, 2.8, .14), 3, 'steel')
    for i in range(3):
        k.ball((-3.0 + (i - 1) * .7, 2.8, 1.05), .32, 'ice', scale=(1, 1, .4), n=8, rings=3, hemi=True)
    k.cyl(.7, .6, (-3.0, -2.8, .84), 'wood', n=12, rot=(math.pi / 2, 0, 0))
    k.cyl(.45, .62, (-3.0, -2.8, .84), 'iron', 'metal', n=12, rot=(math.pi / 2, 0, 0))
    for (dx, dy) in ((2.8, -3.2), (-3.6, .2), (.6, 3.8)):
        k.ball((dx, dy, .14), .9, 'ice', scale=(1.4, 1, .45), n=10, rings=4, hemi=True, vary=.05)
    k.flag((3.4, -3.6, .14), 4.0, 1.4, .9)


BUILDERS = {k: globals()['build_' + k] for k in KINDS}
FOOTPRINT = {}   # filled from measured bounds


# ---------------------------------------------------------------- scene assembly
def materials():
    mats = {}
    for surf, (name, rough, metal, emit, strength) in SURFACES.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        m.use_backface_culling = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit:
            bsdf.inputs['Emission Color'].default_value = (*emit, 1)
            bsdf.inputs['Emission Strength'].default_value = strength
        if surf == 'trim':
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            mix.inputs[7].default_value = (*TRIM_PREVIEW, 1)
            nt.links.new(attr.outputs['Color'], mix.inputs[6])
            nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
            bsdf.inputs['Emission Color'].default_value = (*TRIM_PREVIEW, 1)
            bsdf.inputs['Emission Strength'].default_value = .06
        else:
            nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        m.diffuse_color = (*TRIM_PREVIEW, 1) if surf == 'trim' else (.8, .8, .8, 1)
        mats[surf] = m
    return mats


def realise(k, mats):
    """Turn the kit's accumulators into a root empty, rig empties and meshes."""
    # The root is 'structure_<kind>' so a rig node can be called 'turret' inside the turret.
    root = bpy.data.objects.new(f'structure_{k.kind}', None)
    bpy.context.scene.collection.objects.link(root)
    root['tactical_kind'] = k.kind
    nodes = {'root': root}
    # rig empties (except the flag, which is its own mesh)
    order = ['root']
    while len(order) < len(k.groups):
        for g, (parent, _) in k.groups.items():
            if g not in order and parent in order:
                order.append(g)
    for g in order[1:]:
        parent, pivot = k.groups[g]
        if g == 'flag':
            continue
        e = bpy.data.objects.new(f'{g}{RIG_SEP}{k.kind}', None)
        bpy.context.scene.collection.objects.link(e)
        e.parent = nodes[parent]
        e.location = pivot - k.groups[parent][1]
        e.empty_display_size = .5
        nodes[g] = e
    meshes = []
    for (g, surf), b in sorted(k.acc.items()):
        pivot = k.groups[g][1]
        bmesh.ops.translate(b, vec=-pivot, verts=b.verts)
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-5)
        me = bpy.data.meshes.new(f'{k.kind}_{g}_{surf}')
        b.to_mesh(me)
        b.free()
        me.set_sharp_from_angle(angle=math.radians(48))
        me.materials.append(mats[surf])
        if g == 'flag':
            name = f'flag{RIG_SEP}{k.kind}'
            parent = nodes[k.groups[g][0]]
            loc = pivot - k.groups[k.groups[g][0]][1]
        else:
            name = f'{k.kind}_{g}_{surf}'
            parent = nodes[g]
            loc = Vector((0, 0, 0))
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = parent
        o.location = loc
        meshes.append(o)
    for name, pos, g in k.empties:
        e = bpy.data.objects.new(f'{name}{RIG_SEP}{k.kind}', None)
        bpy.context.scene.collection.objects.link(e)
        parent = nodes.get(g) or nodes['root']
        e.parent = parent
        e.location = pos - k.groups[g][1]
        e.empty_display_size = .25
    k.acc.clear()
    return root, meshes


def ground_for_bake():
    me = bpy.data.meshes.new('bake_ground')
    b = bmesh.new()
    bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=40)
    b.to_mesh(me)
    b.free()
    o = bpy.data.objects.new('bake_ground', me)
    bpy.context.scene.collection.objects.link(o)
    return o


def bake(root, meshes):
    """Cycles AO to vertex colours, then weather the paint in the 'Col' layer."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.world.light_settings.distance = 2.2
    ground = ground_for_bake()
    for o in meshes:
        me = o.data
        ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO')
    bpy.data.objects.remove(ground)
    for o in meshes:
        me = o.data
        col = me.color_attributes['Col']
        ao = me.color_attributes['AO']
        mw = o.matrix_world
        surf = me.materials[0].name
        for poly in me.polygons:
            nz = (mw.to_3x3() @ poly.normal).normalized().z
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                p = mw @ v
                a = max(0.0, min(1.0, ao.data[li].color[0]))
                c = col.data[li].color
                r, g, b = c[0], c[1], c[2]
                snow = r > .8 and g > .8 and b > .75
                shade = .42 + .58 * (a ** .85)
                if surf in ('glass', 'lamp'):
                    shade = .75 + .25 * a
                n1 = pnoise(Vector((p.x * .9, p.y * .9, p.z * .6)))
                n2 = pnoise(p * 5.3)
                if snow:
                    k = shade * (.97 + .03 * n1)
                    r, g, b = r * k, g * k, b * (k * .98 + .02)
                elif surf == 'trim':
                    k = (.55 + .45 * a) * (.94 + .05 * n1) * (r if r < .99 else 1)
                    r = g = b = k
                else:
                    weather = .93 + .08 * n1 + .025 * n2
                    grime = max(0.0, 1 - p.z / 1.4) * .22
                    k = shade * weather * (1 - grime)
                    r, g, b = r * k, g * k * (1 - grime * .15), b * k * (1 - grime * .3)
                    if nz > .55 and surf == 'matte' and a > .6 and n1 > .15:
                        # frost settles on upward faces in the open
                        f = min(.55, (n1 - .15) * 1.6) * nz
                        r, g, b = r + (0.86 - r) * f, g + (0.84 - g) * f, b + (0.80 - b) * f
                col.data[li].color = (r, g, b, 1)
        me.color_attributes.remove(ao)
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.active_color_index


def select_tree(root):
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root


def export(root):
    """Export with rig names stripped of their '~kind' suffix."""
    renamed = []
    for o in root.children_recursive:
        if RIG_SEP in o.name:
            renamed.append((o, o.name))
    for o, n in renamed:
        o.name = n.split(RIG_SEP)[0]
    loc = root.location.copy()
    root.location = (0, 0, 0)
    select_tree(root)
    bpy.ops.export_scene.gltf(filepath=str(OUT / f"{root['tactical_kind']}.glb"), export_format='GLB',
                              use_selection=True, export_extras=True, export_yup=True,
                              export_texcoords=False, export_vertex_color='ACTIVE',
                              export_apply=False, export_materials='EXPORT')
    root.location = loc
    for o, n in renamed:
        o.name = n
    compact_glb(OUT / f"{root['tactical_kind']}.glb")


def compact_glb(path):
    """Quantise normals (KHR_mesh_quantization) and vertex colours (normalised
    unsigned shorts, core glTF) to cut the download by about a third."""
    import json, struct
    data = path.read_bytes()
    jlen = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack_from('<I', data, off)[0]
    src = data[off + 8:off + 8 + blen]
    size = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    role = {}
    for mesh in j.get('meshes', []):
        for prim in mesh['primitives']:
            for key, idx in prim['attributes'].items():
                if key == 'NORMAL':
                    role[idx] = 'normal'
                elif key.startswith('COLOR_'):
                    role[idx] = 'color'
    out = bytearray()
    views = []
    quantised = False
    for i, acc in enumerate(j['accessors']):
        bv = j['bufferViews'][acc['bufferView']]
        n, c = acc['count'], comps[acc['type']]
        cs = size[acc['componentType']]
        start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = bv.get('byteStride', c * cs)
        if stride != c * cs:
            raise RuntimeError('interleaved buffer views are not expected')
        raw = src[start:start + n * c * cs]
        new_stride = None
        if role.get(i) == 'normal' and acc['componentType'] == 5126:
            vals = struct.unpack(f'<{n * c}f', raw)
            buf = bytearray(n * 4)
            for k in range(n):
                struct.pack_into('<bbb', buf, k * 4, *(max(-127, min(127, round(vals[k * 3 + q] * 127))) for q in range(3)))
            acc['componentType'] = 5120
            acc['normalized'] = True
            new_stride = 4
            quantised = True
        elif role.get(i) == 'color' and acc['componentType'] == 5126:
            vals = struct.unpack(f'<{n * c}f', raw)
            buf = bytearray(n * 8)
            for k in range(n):
                struct.pack_into('<HHH', buf, k * 8, *(max(0, min(65535, round(vals[k * c + q] * 65535))) for q in range(3)))
            acc['componentType'] = 5123
            acc['normalized'] = True
            acc['type'] = 'VEC3'
            acc.pop('min', None)
            acc.pop('max', None)
            new_stride = 8
        else:
            buf = bytearray(raw)
        while len(out) % 4:
            out.append(0)
        view = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(buf)}
        if new_stride:
            view['byteStride'] = new_stride
        if 'target' in bv:
            view['target'] = bv['target']
        out += buf
        acc['bufferView'] = len(views)
        acc.pop('byteOffset', None)
        views.append(view)
    while len(out) % 4:
        out.append(0)
    j['bufferViews'] = views
    j['buffers'][0]['byteLength'] = len(out)
    if quantised:
        for key in ('extensionsUsed', 'extensionsRequired'):
            j[key] = sorted(set(j.get(key, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js
                     + struct.pack('<II', len(out), 0x004E4942) + bytes(out))


def bounds(root):
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        for v in o.data.vertices:
            p = o.matrix_world @ v.co - root.location
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def triangles(root):
    n = 0
    for o in root.children_recursive:
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


# ---------------------------------------------------------------- rendering
def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception:
        sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Punchy'
    except Exception:
        pass
    sc.view_settings.exposure = .15
    world = sc.world or bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (.42, .55, .78, 1)
    bg.inputs['Strength'].default_value = .75
    nt.links.new(bg.outputs[0], out.inputs[0])
    sun = bpy.data.lights.new('golden sun', 'SUN')
    sun.energy = 5.5
    sun.color = (1.0, .78, .55)
    sun.angle = math.radians(4)
    so = bpy.data.objects.new('golden sun', sun)
    sc.collection.objects.link(so)
    # low sun from the front-left: lit facades, long shadows to the back right
    so.rotation_euler = (Vector((0, 0, 0)) - Vector((-.62, -1.0, .62))).to_track_quat('-Z', 'Y').to_euler()
    rim = bpy.data.lights.new('cool rim', 'SUN')
    rim.energy = 1.1
    rim.color = (.62, .74, 1.0)
    rim.angle = math.radians(10)
    ro = bpy.data.objects.new('cool rim', rim)
    sc.collection.objects.link(ro)
    ro.rotation_euler = (Vector((0, 0, 0)) - Vector((.7, 1.0, .5))).to_track_quat('-Z', 'Y').to_euler()
    # diorama ground: snowy earth fading into a soft haze
    gm = bpy.data.materials.new('diorama_ground')
    gm.use_nodes = True
    g = gm.node_tree
    bsdf = g.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = .95
    tex = g.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = .06
    tex.inputs['Detail'].default_value = 4
    tc = g.nodes.new('ShaderNodeTexCoord')
    g.links.new(tc.outputs['Object'], tex.inputs['Vector'])
    ramp = g.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .42
    ramp.color_ramp.elements[0].color = (*hexcol('8a7c62'), 1)
    ramp.color_ramp.elements[1].position = .62
    ramp.color_ramp.elements[1].color = (*hexcol('e9e4d8'), 1)
    g.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    g.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    gme = bpy.data.meshes.new('diorama_ground')
    b = bmesh.new()
    bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=400)
    b.to_mesh(gme)
    b.free()
    gme.materials.append(gm)
    go = bpy.data.objects.new('diorama_ground', gme)
    sc.collection.objects.link(go)
    go.location.z = -.01
    cam = bpy.data.cameras.new('camera')
    co = bpy.data.objects.new('camera', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co, go


def fit_portrait(cam, root):
    lo, hi = bounds(root)
    lo += root.location
    hi += root.location
    centre = (lo + hi) / 2
    d = Vector((1, -1.35, .95)).normalized()
    cam.data.type = 'ORTHO'
    cam.location = centre + d * 60
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    xs, ys = [], []
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        m = inv @ o.matrix_world
        for v in o.data.vertices:
            p = m @ v.co
            xs.append(p.x)
            ys.append(p.y)
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    cam.data.ortho_scale = max(w, h * 256 / 192) * 1.1
    cam.data.shift_x = (max(xs) + min(xs)) / 2 / cam.data.ortho_scale
    cam.data.shift_y = (max(ys) + min(ys)) / 2 / cam.data.ortho_scale


def render_portrait(cam, root):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 256, 192
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.cycles.samples = 64
    fit_portrait(cam, root)
    sc.render.filepath = str(ICONS / f"{root['tactical_kind']}.png")
    bpy.ops.render.render(write_still=True)


def render_game_view(cam, target, path, dist=58.0, res=(800, 600), yaw=0.0, lens=40):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.cycles.samples = 48
    cam.data.type = 'PERSP'
    cam.data.lens = lens
    cam.data.shift_x = cam.data.shift_y = 0
    pitch = math.radians(50)
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = Vector(target) + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    only = [s for s in os.environ.get('DIORAMA_ONLY', '').split(',') if s]
    kinds = [k for k in KINDS if k in BUILDERS and (not only or k in only)]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = materials()
    OUT.mkdir(parents=True, exist_ok=True)
    ICONS.mkdir(parents=True, exist_ok=True)
    cam, ground = setup_render()
    roots = []
    report = []
    for i, kind in enumerate(kinds):
        k = Kit(kind)
        BUILDERS[kind](k)
        root, meshes = realise(k, mats)
        ground.hide_render = True
        bake(root, meshes)
        ground.hide_render = False
        export(root)
        lo, hi = bounds(root)
        size = (OUT / f'{kind}.glb').stat().st_size
        report.append(f'{kind:11s} tris={triangles(root):6d} bytes={size:7d} '
                      f'x[{lo.x:.2f},{hi.x:.2f}] gltfZ[{-hi.y:.2f},{-lo.y:.2f}] h={hi.z:.2f} meshes={len(meshes)}')
        print(report[-1], flush=True)
        if STATS is not None:
            print(sorted(STATS.items(), key=lambda kv: -kv[1])[:14])
            STATS.clear()
        for other in roots:
            for o in [other, *other.children_recursive]:
                o.hide_render = True
        render_portrait(cam, root)
        roots.append(root)
    sheet = os.environ.get('DIORAMA_SHEET')
    if sheet:
        Path(sheet).mkdir(parents=True, exist_ok=True)
        for root in roots:
            for other in roots:
                for o in [other, *other.children_recursive]:
                    o.hide_render = other is not root
            render_game_view(cam, (0, 0, 2), Path(sheet) / f"{root['tactical_kind']}.png", 46,
                             yaw=float(os.environ.get('DIORAMA_YAW', '0.35')))
    # lay the library out in a grid for the .blend
    for i, root in enumerate(roots):
        root.location = ((i % 5) * 22.0, -(i // 5) * 22.0, 0)
        for o in [root, *root.children_recursive]:
            o.hide_render = False
    if sheet and len(roots) > 1:
        render_game_view(cam, (44, -33, 0), Path(sheet) / 'overview.png', 150, res=(1600, 1200), lens=40)
    if not os.environ.get('DIORAMA_NO_BLEND'):
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    print('\n'.join(report))


def export_only():
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    for kind in KINDS:
        root = bpy.data.objects.get(f'structure_{kind}')
        if root:
            export(root)
    print('Exported diorama buildings from', BLEND)


# Importable as a kit (art/blender/tech_sites.py); runs only as a script.
if __name__ == '__main__':
    if os.environ.get('DIORAMA_EXPORT'):
        export_only()
    else:
        main()
