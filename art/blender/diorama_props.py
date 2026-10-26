"""Living-diorama set pieces: map props, a Scots pine and a stone railway viaduct.

Hand-painted tabletop miniatures of a Nordic Cold War front. Chunky silhouettes,
bevelled edges, a light baked snow cap that lives in its own `snow` material (so a
snow-free map can hide it), and a Cycles ambient-occlusion bake multiplied into
COLOR_0 together with grime near the ground.

Props (public/models/props/<kind>.glb)
  Metres, origin at the ground centre of the footprint, model faces +Z (Blender -Y).
  Surfaces keep named MeshStandard-friendly materials (red_timber, slate, zinc, ...);
  the paint lives in baseColorFactor (<= .78 per channel) and COLOR_0 carries only
  occlusion, grime and small tint variation. The root has `ambient_only = true`.
  Nodes the renderer animates (components/game/world/props.tsx):
    rotor_pivot  windmill sails, spins about its local Z (the windshaft)
    radar_dish   radio mast dish, spins about its local Y (vertical)
    smoke_*      chimney / exhaust tops (empties)
    light_*      lamps (empties)

Landscape (public/models/landscape/)
  pine_tall, pine_tall_lod  one mesh, one vertex-colour material, same bounds
  bridge_viaduct            10.5 m (X) x 16 m (Z) deck section, deck top y = .6,
                            water at y = 0, piers down to y = -6.3

Run:  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        -P art/blender/diorama_props.py
Environment:
  PROPS_ONLY=lighthouse,boat,pine_tall   build a subset
  PROPS_PREVIEW=<dir>                    render a 3/4 preview PNG of every asset
"""
import bpy, bmesh, math, os, random, zlib, json, struct
from pathlib import Path
from mathutils import Vector, Matrix, Euler
from mathutils.noise import noise as pnoise

ROOT = Path(__file__).resolve().parents[2]
PROPS = ROOT / 'public/models/props'
LAND = ROOT / 'public/models/landscape'
ONLY = set(filter(None, os.environ.get('PROPS_ONLY', '').split(',')))
PREVIEW = os.environ.get('PROPS_PREVIEW')
TAU = math.tau


def lin(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def hexcol(h):
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


# name: (paint, roughness, metallic, emissive)
MATS = {
    'red_timber': ('8e2f25', .86, 0., None),
    'signal_red': ('b3382b', .7, 0., None),
    'white_paint': ('e8e3d8', .8, 0., None),
    'slate': ('3b4450', .78, 0., None),
    'zinc': ('8d97a0', .55, .3, None),
    'iron': ('343a40', .62, .35, None),
    'signal_orange': ('ff8f3a', .65, 0., None),
    'concrete': ('9a9890', .92, 0., None),
    'stone': ('8a8781', .92, 0., None),
    'rust': ('7a4a2e', .88, .1, None),
    'bronze': ('6d5a3a', .45, .55, None),
    'wood': ('6b5a45', .88, 0., None),
    'canvas': ('d8cdb4', .92, 0., None),
    'olive': ('58623f', .86, 0., None),
    'glass': ('2a3440', .15, .1, None),
    'snow': ('f3efe6', .92, 0., None),
    'lamp': ('ffcf7a', .4, 0., 'ffcf7a'),
}


def factor(hexstr):
    """Linear paint scaled so no channel exceeds .78 (keeps baked snow off white)."""
    c = hexcol(hexstr)
    m = max(c)
    k = min(1., .78 / m) if m > 0 else 1.
    return tuple(max(.004, v * k) for v in c)


# ---------------------------------------------------------------- kit
class Kit:
    """Accumulates geometry per (rig group, material) in prop space."""

    def __init__(self, name, single=None):
        self.name = name
        self.single = single          # land assets: one material, paint in the vertex colour
        self.rng = random.Random(zlib.crc32(name.encode()))
        self.acc = {}
        self.M = Matrix.Identity(4)
        self.stack = []
        self.group = 'root'
        self.groups = {'root': (None, Vector((0, 0, 0)))}
        self.empties = []
        self.burn = 0.            # soot patches (wrecks)
        self.grime = 1.3          # height of ground grime
        self.post = None          # land assets: per-loop recolour(p, n, rgb) -> rgb

    # -- frames and rig groups
    def push(self, at=(0, 0, 0), rz=0., rx=0., ry=0.):
        self.stack.append(self.M.copy())
        self.M = self.M @ Matrix.Translation(Vector(at)) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()

    def pop(self):
        self.M = self.stack.pop()

    def rig(self, name, pivot):
        prev = self.group
        self.groups[name] = (prev, self.M @ Vector(pivot))
        self.group = name
        return prev

    def end(self, prev):
        self.group = prev

    def empty(self, name, at):
        self.empties.append((name, self.M @ Vector(at), self.group))

    # -- colour
    def tint(self, t, vary):
        if t is None or t == 'keep':
            t = (1., 1., 1.)
        elif isinstance(t, str):
            t = hexcol(t)
        elif isinstance(t, (int, float)):
            t = (t, t, t)
        k = 1 + self.rng.uniform(-vary, vary)
        return tuple(min(1., c * k) for c in t) + (1.,)

    def _bm(self, mat):
        key = (self.group, self.single or mat)
        if key not in self.acc:
            b = bmesh.new()
            b.loops.layers.float_color.new('Col')
            self.acc[key] = b
        return self.acc[key]

    def emit(self, tmp, L, mat, tint=None, vary=.05, smooth=True):
        m = self.M @ L
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        if m.determinant() < 0:
            bmesh.ops.reverse_faces(tmp, faces=tmp.faces)
        tmp.normal_update()
        col = self.tint(tint, vary)
        keep = tmp.loops.layers.float_color.get('Col') if tint == 'keep' else None
        maps = {}
        for f in tmp.faces:
            name = mat(f.calc_center_median(), f.normal) if callable(mat) else mat
            dst = self._bm(name)
            vm = maps.setdefault(id(dst), {})
            vs = []
            for v in f.verts:
                if v not in vm:
                    vm[v] = dst.verts.new(v.co)
                vs.append(vm[v])
            try:
                nf = dst.faces.new(vs)
            except ValueError:
                continue
            nf.smooth = smooth
            lay = dst.loops.layers.float_color['Col']
            if keep is not None:
                for l, src in zip(nf.loops, f.loops):
                    l[lay] = src[keep]
            else:
                for l in nf.loops:
                    l[lay] = col
        tmp.free()

    # -- primitives (coordinates in the current frame)
    def box(self, size, at, mat, bevel=.05, seg=1, rot=(0, 0, 0), tint=None, vary=.05,
            taper=None, dense=0.):
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1)
        sx, sy, sz = size
        for v in t.verts:
            v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
            if taper and v.co.z > 0:
                v.co.x *= taper[0]
                v.co.y *= taper[1]
        if dense:
            for axis in range(3):
                length = size[axis]
                cuts = min(10, int(length / dense))
                if cuts > 0:
                    edges = [e for e in t.edges
                             if abs((e.verts[0].co - e.verts[1].co)[axis]) > length * .5]
                    bmesh.ops.subdivide_edges(t, edges=edges, cuts=cuts, use_grid_fill=True)
        if bevel > 0:
            w = min(bevel, min(sx, sy, sz) * .45)
            edges = [e for e in t.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > .6]
            bmesh.ops.bevel(t, geom=edges, offset=w, segments=seg, profile=.5, affect='EDGES',
                            clamp_overlap=True)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, mat, tint, vary, smooth=seg > 1)

    def cyl(self, r, h, at, mat, n=12, r2=None, rot=(0, 0, 0), bevel=.03, caps=True, tint=None,
            vary=.04):
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=caps, cap_tris=False, segments=n, radius1=r,
                              radius2=r if r2 is None else r2, depth=h)
        if bevel > 0 and caps:
            edges = [e for e in t.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > .9]
            bmesh.ops.bevel(t, geom=edges, offset=min(bevel, h * .3, r * .3), segments=1,
                            profile=.5, affect='EDGES', clamp_overlap=True)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, mat, tint, vary)

    def beam(self, a, b, r, mat, n=6, r2=None, tint=None, vary=.03, caps=True):
        a, b = Vector(a), Vector(b)
        d = b - a
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=caps, cap_tris=False, segments=n, radius1=r,
                              radius2=r if r2 is None else r2, depth=d.length)
        L = Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        self.emit(t, L, mat, tint, vary)

    def ball(self, at, r, mat, scale=(1, 1, 1), sub=1, jitter=0., rot=(0, 0, 0), tint=None,
             vary=.05, hemi=False, uv=None, seed=0.):
        t = bmesh.new()
        if uv:
            bmesh.ops.create_uvsphere(t, u_segments=uv[0], v_segments=uv[1], radius=r)
        else:
            bmesh.ops.create_icosphere(t, subdivisions=sub, radius=r)
        for v in t.verts:
            if jitter:
                k = 1 + jitter * (pnoise(v.co * (2.2 / r) + Vector((seed, seed * .7, 3.1))) * .8
                                  + self.rng.uniform(-.5, .5))
                v.co *= k
            v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
            if hemi and v.co.z < 0:
                v.co.z *= .08
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, mat, tint, vary)

    def prism(self, pts, depth, at, mat, rot=(0, 0, 0), tint=None, vary=.04, bevel=0., res=0.):
        """Extrude a polygon given in the XZ plane along Y (centred). `res` subdivides the
        sides so baked soot and occlusion have vertices to live on."""
        if res:
            dense = []
            for i, a in enumerate(pts):
                b = pts[(i + 1) % len(pts)]
                n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / res))
                dense += [(a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n) for j in range(n)]
            n = max(1, int(depth / res))
            rings = [[(x, -depth / 2 + depth * i / n, z) for x, z in dense] for i in range(n + 1)]
            self.push(at)
            self.push((0, 0, 0), rz=rot[2], rx=rot[0], ry=rot[1])
            self.loft(rings, mat, tint=tint, vary=vary, smooth=False)
            self.pop()
            self.pop()
            return
        t = bmesh.new()
        front = [t.verts.new((x, -depth / 2, z)) for x, z in pts]
        back = [t.verts.new((x, depth / 2, z)) for x, z in pts]
        n = len(pts)
        t.faces.new(front)
        t.faces.new(list(reversed(back)))
        for i in range(n):
            j = (i + 1) % n
            t.faces.new((front[i], back[i], back[j], front[j]))
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        if bevel:
            edges = [e for e in t.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > .6]
            bmesh.ops.bevel(t, geom=edges, offset=bevel, segments=1, profile=.5, affect='EDGES',
                            clamp_overlap=True)
        L = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        self.emit(t, L, mat, tint, vary)

    def loft(self, rings, mat, caps=(True, True), tint=None, vary=.04, closed=True, cap_mat=None,
             smooth=True):
        """Skin consecutive rings of equal length; optional caps (outward normals fixed)."""
        t = bmesh.new()
        vr = [[t.verts.new(Vector(p)) for p in ring] for ring in rings]
        n = len(rings[0])
        for a, b in zip(vr, vr[1:]):
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                try:
                    t.faces.new((a[i], a[j], b[j], b[i]))
                except ValueError:
                    pass
        capfaces = []
        if caps[0]:
            try:
                capfaces.append(t.faces.new(list(reversed(vr[0]))))
            except ValueError:
                pass
        if caps[1]:
            try:
                capfaces.append(t.faces.new(vr[-1]))
            except ValueError:
                pass
        bmesh.ops.remove_doubles(t, verts=t.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        if cap_mat:
            caps_set = set(f for f in capfaces if f.is_valid)
            base = mat
            mat = None
            t2 = t
            # split caps into their own emit so they take cap_mat
            capbm = bmesh.new()
            vm = {}
            for f in list(caps_set):
                vs = []
                for v in f.verts:
                    if v not in vm:
                        vm[v] = capbm.verts.new(v.co)
                    vs.append(vm[v])
                capbm.faces.new(vs)
                t2.faces.remove(f)
            self.emit(capbm, Matrix.Identity(4), cap_mat, tint, vary, smooth=False)
            self.emit(t2, Matrix.Identity(4), base, tint, vary, smooth=smooth)
            return
        self.emit(t, Matrix.Identity(4), mat, tint, vary, smooth=smooth)

    def frustum(self, r0, r1, z0, z1, mat, n=8, phase=None, sx=1., sy=1., tint=None,
                vary=.04, caps=(True, True), cx=0., cy=0.):
        phase = math.pi / n if phase is None else phase
        rings = []
        for r, z in ((r0, z0), (r1, z1)):
            rings.append([(cx + math.cos(phase + i * TAU / n) * r * sx,
                           cy + math.sin(phase + i * TAU / n) * r * sy, z) for i in range(n)])
        self.loft(rings, mat, caps=caps, tint=tint, vary=vary, smooth=n > 10)

    # -- composites
    def snow(self, size, at, rot=(0, 0, 0), bevel=.05):
        big = size[0] * size[1] > 2.
        self.box(size, at, 'snow', bevel=min(bevel, size[2] * .45), seg=2 if big else 1, rot=rot, vary=.02)

    def drift(self, at, sx, sy, h, rz=0.):
        """Soft snow lump (flattened hemisphere) for wreck decks, wings and ledges."""
        self.ball(at, 1., 'snow', scale=(sx / 2, sy / 2, h), sub=2, hemi=True, rot=(0, 0, rz),
                  vary=.02, jitter=.08)

    def roof(self, w, d, z, rise, mat='slate', wall='red_timber', over=.35, end_over=.3,
             snow=.55, th=.14, barge='white_paint', at=(0, 0), rz=0.):
        """Gable roof spanning X (width w) running along Y; eave height z."""
        self.push((at[0], at[1], 0), rz=rz)
        half = w / 2
        th_a = math.atan2(rise, half)
        L = (half + over) / math.cos(th_a)
        length = d + 2 * end_over
        for s in (1, -1):
            nrm = Vector((s * math.sin(th_a), 0, math.cos(th_a)))
            mid = Vector((s * L / 2 * math.cos(th_a), 0, z + rise - L / 2 * math.sin(th_a)))
            self.box((L, length, th), mid + nrm * th / 2, mat, bevel=.03, rot=(0, s * th_a, 0))
            if snow:
                sl = L * snow
                c = Vector((s * sl / 2 * math.cos(th_a), 0, z + rise - sl / 2 * math.sin(th_a)))
                self.snow((sl, length - .12, .13), c + nrm * (th + .05), rot=(0, s * th_a, 0))
            if barge:
                for e in (-1, 1):
                    y = e * (d / 2 + end_over - .03)
                    a = Vector((0, y, z + rise + th * 1.2))
                    b = Vector((s * (half + over) * .98, y,
                                z + rise - (half + over) * math.tan(th_a) + th * 1.2))
                    self.beam(a, b, .07, barge, n=4)
        # ridge
        self.box((.26, length + .04, .18), (0, 0, z + rise + th * .9), 'snow' if snow else mat,
                 bevel=.06, seg=2 if snow else 1)
        if wall:
            for e in (-1, 1):
                self.prism([(-half, 0), (half, 0), (0, rise)], .16,
                           (0, e * (d / 2 - .08), z), wall)
        self.pop()

    def rail(self, pts, h, mat='wood', post=.06, r=.035, closed=False, step=1.2):
        """Railing along a polyline of (x, y, z) points: posts plus a top rail."""
        pts = [Vector(p) for p in pts]
        segs = list(zip(pts, pts[1:] + ([pts[0]] if closed else [])))
        for a, b in segs:
            n = max(1, int((b - a).length / step))
            for i in range(n + (0 if closed else 1)):
                p = a.lerp(b, i / n)
                self.box((post, post, h), p + Vector((0, 0, h / 2)), mat, bevel=.01, vary=.02)
            self.beam(a + Vector((0, 0, h)), b + Vector((0, 0, h)), r, mat, n=4)
            self.beam(a + Vector((0, 0, h * .5)), b + Vector((0, 0, h * .5)), r * .8, mat, n=4)


# ---------------------------------------------------------------- props
def build_lighthouse(k):
    # granite outcrop
    rocks = [((-1.9, -1.4, .2), 1.3), ((2.0, -1.2, .1), 1.1), ((1.6, 1.9, .2), 1.3),
             ((-1.8, 1.7, .1), 1.2), ((0, -2.5, 0), .9), ((-2.7, .1, 0), .8), ((2.7, .4, 0), .8)]
    for i, (p, r) in enumerate(rocks):
        k.ball(p, r, 'stone', scale=(1.2, 1.0, .75), sub=1, jitter=.18, rot=(0, 0, i),
               vary=.08, seed=i)
    k.snow((1.2, .9, .12), (-1.8, 1.7, .95), rot=(.1, -.15, .4))
    k.snow((1.0, .8, .12), (1.7, 1.9, 1.05), rot=(-.15, .1, -.3))
    # concrete plinth and door steps
    k.frustum(2.7, 2.55, .2, 1.6, 'concrete', n=8)
    k.frustum(2.62, 2.62, 1.6, 1.72, 'snow', n=8)
    for i in range(3):
        k.box((1.3, .45, .22), (0, -2.75 - i * .38 + .38, 1.45 - i * .45), 'concrete', bevel=.03)
    # banded tower
    z0, z1, r0, r1 = 1.6, 12.2, 1.7, 1.15
    bands = 6
    for i in range(bands):
        a, b = z0 + (z1 - z0) * i / bands, z0 + (z1 - z0) * (i + 1) / bands
        ra = r0 + (r1 - r0) * i / bands
        rb = r0 + (r1 - r0) * (i + 1) / bands
        k.frustum(ra, rb, a, b, 'signal_red' if i % 2 else 'white_paint', n=16,
                  caps=(i == 0, i == bands - 1), vary=.02)
    # door and windows
    k.box((.9, .3, 1.6), (0, -1.62, 2.4), 'wood', bevel=.03, tint=.8)
    k.box((1.15, .25, .18), (0, -1.66, 3.28), 'white_paint', bevel=.03)
    for z, a in ((5.2, .0), (8.4, math.pi), (10.5, .0)):
        r = r0 + (r1 - r0) * (z - z0) / (z1 - z0)
        k.push((0, 0, z), rz=a)
        k.box((.45, .3, .7), (0, -r + .05, 0), 'glass', bevel=.02)
        k.box((.62, .34, .12), (0, -r + .04, .42), 'white_paint', bevel=.02)
        k.pop()
    # gallery, railing, lantern
    k.frustum(1.2, 2.05, 11.8, 12.2, 'iron', n=16)
    k.frustum(2.05, 2.05, 12.2, 12.45, 'iron', n=16)
    k.frustum(2.0, 2.0, 12.45, 12.52, 'snow', n=16)
    ring = [(math.cos(i * TAU / 16) * 1.95, math.sin(i * TAU / 16) * 1.95, 12.45) for i in range(16)]
    k.rail(ring, .9, 'iron', post=.07, r=.04, closed=True, step=1.0)
    k.frustum(1.05, 1.05, 12.45, 12.8, 'iron', n=8)
    k.frustum(.95, .95, 12.8, 14.1, 'lamp', n=8, caps=(False, False))
    for i in range(8):
        a = math.pi / 8 + i * TAU / 8
        k.box((.1, .1, 1.35), (math.cos(a) * .97, math.sin(a) * .97, 13.45), 'iron', bevel=.01,
              rot=(0, 0, a))
    k.frustum(1.2, 1.15, 14.1, 14.25, 'iron', n=8)
    k.frustum(1.15, .25, 14.25, 15.1, 'signal_red', n=8)
    k.frustum(.95, .3, 14.52, 15.05, 'snow', n=8, caps=(False, True))
    k.ball((0, 0, 15.25), .22, 'iron', sub=1)
    k.beam((0, 0, 15.3), (0, 0, 16.0), .035, 'iron', n=4)
    k.empty('light_lantern', (0, 0, 13.4))
    # keeper's store against the tower
    k.push((2.1, .9, 1.6), rz=.35)
    k.box((1.8, 2.0, 1.5), (0, 0, .75), 'white_paint', bevel=.04)
    k.roof(1.8, 2.0, 1.5, .55, mat='slate', wall='white_paint', over=.15, end_over=.12, snow=.6,
           barge=None)
    k.box((.6, .1, 1.05), (0, -1.02, .55), 'red_timber', bevel=.02)
    k.pop()


def stone_arch(k, x, width, spring, thick):
    """Round arch of chunky voussoirs in the wall's local XZ plane, centred at x."""
    r = width / 2 + .22
    n = 7
    for i in range(n):
        a = math.pi * (i + .5) / n
        key = i == n // 2
        k.box((.42 if key else .36, thick + (.12 if key else .06), .62 if key else .5),
              (x + math.cos(a) * r, 0, spring + math.sin(a) * r), 'stone', bevel=.05,
              rot=(0, math.pi / 2 - a, 0), tint=1.08 if i % 2 else .98, vary=.03)
    k.snow((.4, thick - .1, .08), (x, 0, spring + r + .34))


def ruin_wall(k, a, b, profile, thick=.8, openings=()):
    """Broken masonry wall from a to b: chunky segments of varying width with a stepped,
    jagged top following `profile` [(t, height)], and optional arched openings
    [(t0, t1, sill, spring)]."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length

    def h_at(t):
        for (t0, h0), (t1, h1) in zip(profile, profile[1:]):
            if t0 <= t <= t1:
                return h0 + (h1 - h0) * (t - t0) / (t1 - t0 or 1)
        return profile[-1][1]

    cuts = sorted({0., L} | {o[0] * L for o in openings} | {o[1] * L for o in openings})
    k.push((a.x, a.y, 0), rz=math.atan2(d.y, d.x))
    for u0, u1 in zip(cuts, cuts[1:]):
        opening = next((o for o in openings if abs(o[0] * L - u0) < 1e-6), None)
        if opening:
            w = u1 - u0
            h = h_at((u0 + u1) / 2 / L)
            _, _, sill, spring = opening
            if sill > .05:
                k.box((w, thick, sill), ((u0 + u1) / 2, 0, sill / 2), 'stone', bevel=.06, vary=.06)
                k.snow((w - .1, thick - .14, .07), ((u0 + u1) / 2, 0, sill + .03))
            top = spring + w / 2 + .22 + .5
            if h > top:
                k.box((w + .5, thick, h - top + .3), ((u0 + u1) / 2, 0, (h + top - .3) / 2), 'stone',
                      bevel=.06, vary=.06)
                k.snow((w + .4, thick - .14, .08), ((u0 + u1) / 2, 0, h + .03))
            stone_arch(k, (u0 + u1) / 2, w, spring, thick)
            continue
        u = u0
        while u < u1 - .05:
            w = min(u1 - u, k.rng.uniform(.9, 1.9))
            if u1 - (u + w) < .6:
                w = u1 - u
            c = u + w / 2
            h = max(.25, h_at(c / L) + k.rng.uniform(-.25, .25))
            tint = 1 + k.rng.uniform(-.08, .06)
            k.box((w + .02, thick, h), (c, k.rng.uniform(-.03, .03), h / 2), 'stone', bevel=.07,
                  tint=tint, vary=.02)
            top = h
            if h > .9 and k.rng.random() < .6:
                sw = w * k.rng.uniform(.35, .6)
                sx = c + (w - sw) / 2 * k.rng.choice((-1, 1))
                sh = k.rng.uniform(.3, .55)
                k.box((sw, thick * .92, sh), (sx, 0, h + sh / 2), 'stone', bevel=.06, tint=tint * .97,
                      vary=.02)
                k.snow((sw - .1, thick * .92 - .14, .07), (sx, 0, h + sh + .03))
            k.snow((w - .12, thick - .16, .08), (c, 0, top + .03))
            u += w
    k.pop()


def build_ruin(k):
    # chapel nave 7 (X) x 10 (Y); the gable front faces the viewer (-Y) with its door arch
    ruin_wall(k, (-3.5, -5), (3.5, -5), [(0, 2.4), (.3, 3.6), (.5, 4.9), (.62, 4.4), (.75, 2.6), (1, 1.8)],
              openings=[(.38, .62, 0., 1.9)])
    ruin_wall(k, (-3.5, -4.6), (-3.5, 4.6), [(0, 3.3), (.3, 3.0), (.55, 2.0), (.8, .8), (1, 1.2)],
              openings=[(.2, .36, 1.0, 1.9)])
    ruin_wall(k, (3.5, -4.6), (3.5, 4.6), [(0, 2.7), (.25, .9), (.45, .35), (.62, 1.8), (1, 3.1)],
              openings=[(.7, .86, 1.0, 1.9)])
    ruin_wall(k, (-3.5, 5), (3.5, 5), [(0, 1.0), (.4, .5), (.7, 1.6), (1, 3.4)])
    # corner buttresses
    for x, y, h in ((-3.9, -5.4, 3.0), (3.9, -5.4, 2.2), (-3.9, 5.4, 1.4), (3.9, 5.4, 3.8)):
        k.box((1.1, 1.1, h), (x, y, h / 2), 'stone', bevel=.08, taper=(.8, .8), tint=.9)
        k.snow((.78, .78, .09), (x, y, h + .04))
    k.box((2.4, 1.0, .22), (0, -5.75, .11), 'stone', bevel=.05, tint=.85)
    # rubble where the walls fell: boulders and dressed blocks
    spots = [(4.2, -.4, 1.2), (4.8, .8, .9), (3.0, .6, .9), (-4.3, 3.0, 1.0), (-2.6, 2.6, .8),
             (.6, 5.9, .9), (-1.0, 5.6, .7), (1.8, -1.6, .7), (-1.4, -2.4, .6)]
    for i, (x, y, s) in enumerate(spots):
        k.ball((x, y, s * .12), s * .6, 'stone', scale=(1.25, 1, .6), sub=1, jitter=.2,
               rot=(0, 0, i), seed=i * 3, vary=.1)
        for j in range(2):
            p = (x + k.rng.uniform(-.8, .8), y + k.rng.uniform(-.8, .8), s * .18)
            k.box((s * .7, s * .45, s * .38), p, 'stone', bevel=.06, vary=.1,
                  rot=(k.rng.uniform(-.3, .3), k.rng.uniform(-.3, .3), k.rng.uniform(0, 3)))
        if i % 3 == 0:
            k.ball((x, y, s * .4), s * .45, 'snow', scale=(1.2, 1, .35), sub=2, hemi=True, vary=.02)
    # charred roof beams fallen across the nave
    k.beam((-3.1, -1.5, 2.6), (2.2, 1.4, .15), .17, 'wood', n=6, tint=.45)
    k.beam((-2.8, 2.2, .15), (1.8, 3.8, 1.0), .15, 'wood', n=6, tint=.5)
    # gravestones and a stone cross outside
    for x, y in ((-5.1, 1.6), (-5.3, 3.2)):
        k.box((.6, .22, .85), (x, y, .42), 'stone', bevel=.1, seg=2, rot=(0, .06, .1), tint=.9)
        k.snow((.5, .18, .06), (x, y, .86))
    k.box((.24, .24, 1.7), (5.3, -3.4, .85), 'stone', bevel=.04)
    k.box((.95, .24, .24), (5.3, -3.4, 1.2), 'stone', bevel=.04)


def build_windmill(k):
    k.frustum(3.4, 3.2, 0, 1.3, 'stone', n=8, phase=math.pi / 8)
    k.frustum(3.26, 3.26, 1.3, 1.38, 'snow', n=8, phase=math.pi / 8)
    k.frustum(3.0, 1.9, 1.3, 8.6, 'red_timber', n=8, phase=math.pi / 8, vary=.02)
    # white corner posts
    for i in range(8):
        a = math.pi / 8 + i * TAU / 8
        p0 = Vector((math.cos(a) * 3.02, math.sin(a) * 3.02, 1.3))
        p1 = Vector((math.cos(a) * 1.92, math.sin(a) * 1.92, 8.6))
        k.beam(p0, p1, .1, 'white_paint', n=4)
    # stage (gallery) with railing
    k.frustum(3.9, 3.9, 2.35, 2.55, 'wood', n=8, phase=math.pi / 8)
    k.frustum(3.85, 3.85, 2.55, 2.61, 'snow', n=8, phase=math.pi / 8)
    ring = [(math.cos(math.pi / 8 + i * TAU / 8) * 3.8, math.sin(math.pi / 8 + i * TAU / 8) * 3.8, 2.55)
            for i in range(8)]
    k.rail(ring, .95, 'wood', closed=True, step=1.4)
    for i in range(8):
        a = math.pi / 8 + i * TAU / 8
        k.beam((math.cos(a) * 3.6, math.sin(a) * 3.6, 2.4), (math.cos(a) * 2.75, math.sin(a) * 2.75, 1.5),
               .07, 'wood', n=4)
    # door and windows
    k.box((1.0, .4, 1.8), (0, -2.95, 2.2 - .6), 'wood', bevel=.03, tint=.75)
    k.box((1.3, .4, .16), (0, -2.98, 2.55 - .03), 'white_paint', bevel=.03)
    for z, a in ((4.2, 0), (6.1, math.pi / 2), (4.8, math.pi), (6.6, -math.pi / 2)):
        r = 3.0 + (1.9 - 3.0) * (z - 1.3) / 7.3
        k.push((0, 0, z), rz=a)
        k.box((.5, .3, .62), (0, -r * .93, 0), 'glass', bevel=.02)
        k.box((.7, .32, .1), (0, -r * .93, .38), 'white_paint', bevel=.02)
        k.pop()
    # boat-shaped cap
    arc = [(math.cos(math.pi * i / 10) * 2.35, .2 + math.sin(math.pi * i / 10) * 1.9) for i in range(11)]
    k.frustum(2.25, 2.25, 8.5, 8.8, 'white_paint', n=8, phase=math.pi / 8)
    k.prism(arc, 4.4, (0, .15, 8.6), 'slate', vary=.02)
    snow_outer = [(math.cos(math.pi * i / 10) * 2.42, .2 + math.sin(math.pi * i / 10) * 1.98) for i in range(3, 8)]
    snow_inner = [(math.cos(math.pi * i / 10) * 2.25, .2 + math.sin(math.pi * i / 10) * 1.8) for i in range(7, 2, -1)]
    k.prism(snow_outer + snow_inner, 4.3, (0, .15, 8.6), 'snow', vary=.02)
    # windshaft, fantail pole at the back
    k.beam((0, 1.5, 9.35), (0, -2.7, 9.35), .28, 'iron', n=8)
    k.beam((0, 2.3, 9.0), (0, 5.4, 1.6), .12, 'wood', n=6)
    k.beam((.6, 2.3, 9.0), (.2, 5.2, 1.7), .08, 'wood', n=4)
    k.beam((-.6, 2.3, 9.0), (-.2, 5.2, 1.7), .08, 'wood', n=4)
    k.box((.4, .5, .5), (0, 5.45, 1.35), 'wood', bevel=.04)
    # sails: spin about the windshaft (Blender -Y = glTF +Z)
    hub = (0, -2.8, 9.35)
    prev = k.rig('rotor_pivot', hub)
    k.cyl(.5, .7, hub, 'iron', n=10, rot=(math.pi / 2, 0, 0))
    k.cyl(.3, .3, (0, -3.25, 9.35), 'white_paint', n=10, rot=(math.pi / 2, 0, 0))
    for i in range(4):
        k.push(hub, ry=math.pi / 4 + i * math.pi / 2)
        k.box((6.0, .22, .26), (3.0, -.3, 0), 'wood', bevel=.03, tint=.85)
        x0, x1, zw = 1.1, 5.85, 1.35
        k.box((x1 - x0, .08, .1), ((x0 + x1) / 2, -.35, zw), 'wood', bevel=.02)
        k.box((.1, .08, zw), (x1, -.35, zw / 2), 'wood', bevel=.02)
        for j in range(7):
            x = x0 + (x1 - x0) * j / 6
            k.box((.07, .07, zw + .1), (x, -.38, zw / 2), 'wood', bevel=.01)
        k.box(((x1 - x0) * .92, .04, zw * .92), ((x0 + x1) / 2 + .1, -.3, zw * .5), 'canvas',
              bevel=0, vary=.02)
        k.pop()
    k.end(prev)


def lattice_mast(k, h, w0, w1, section, band_mat):
    legs = [math.pi / 2 + i * TAU / 3 for i in range(3)]

    def pt(i, z):
        w = w0 + (w1 - w0) * z / h
        r = w / math.sqrt(3)
        return Vector((math.cos(legs[i]) * r, math.sin(legs[i]) * r, z))

    n = int(round(h / section))
    for s in range(n):
        za, zb = s * h / n, (s + 1) * h / n
        mat = band_mat(za)
        for i in range(3):
            j = (i + 1) % 3
            k.beam(pt(i, za), pt(i, zb), .085, mat, n=6)
            k.beam(pt(i, zb), pt(j, zb), .04, mat, n=4)
            k.beam(pt(i, za) if s % 2 else pt(j, za), pt(j, zb) if s % 2 else pt(i, zb), .035, mat, n=4)
    return pt


def build_radio_mast(k):
    H = 19.2
    k.box((3.0, 3.0, .4), (0, 0, .2), 'concrete', bevel=.06)
    k.snow((2.7, 2.7, .08), (0, 0, .42))

    def band(z):
        return 'signal_red' if int(z / (H / 7)) % 2 == 0 else 'white_paint'

    pt = lattice_mast(k, H, 1.5, .8, 1.6, band)
    # guy wires to three concrete anchors
    for i in range(3):
        a = math.pi / 2 + i * TAU / 3
        anchor = Vector((math.cos(a) * 8.5, math.sin(a) * 8.5, .45))
        k.box((.9, .9, .6), (anchor.x, anchor.y, .3), 'concrete', bevel=.06, rot=(0, 0, a))
        k.snow((.8, .8, .08), (anchor.x, anchor.y, .62), rot=(0, 0, a))
        for z in (8.0, 15.5):
            k.beam(anchor, pt(i, z), .03, 'iron', n=3, caps=False)
    # top platform and beacons
    k.frustum(1.3, 1.3, H, H + .18, 'iron', n=6)
    k.frustum(1.25, 1.25, H + .18, H + .22, 'snow', n=6)
    for i in range(3):
        a = math.pi / 2 + i * TAU / 3
        p = (math.cos(a) * 1.05, math.sin(a) * 1.05, H + .35)
        k.cyl(.12, .28, p, 'lamp', n=8, bevel=.01)
    k.empty('light_beacon', (0, 0, H + .4))
    # dish on a slewing post: spins about its vertical axis (glTF Y)
    pivot = (0, 0, H + .22)
    prev = k.rig('radar_dish', pivot)
    k.cyl(.28, .5, (0, 0, H + .47), 'iron', n=10)
    k.box((.4, .9, .35), (0, .1, H + .9), 'zinc', bevel=.04)
    k.push((0, -.35, H + 1.55), rx=-math.radians(78))
    R, f = 1.25, 1.1
    front, back = [], []
    for j in range(1, 7):
        r = R * j / 6
        front.append([(math.cos(i * TAU / 16) * r, math.sin(i * TAU / 16) * r, r * r / (4 * f)) for i in range(16)])
    for j in range(6, 0, -1):
        r = R * j / 6 * .92
        back.append([(math.cos(i * TAU / 16) * r, math.sin(i * TAU / 16) * r, r * r / (4 * f) - .12) for i in range(16)])
    k.loft(front + back, 'white_paint', caps=(True, True))
    k.beam((0, 0, 0), (0, 0, .95), .05, 'iron', n=4)
    k.beam((.9, 0, .25), (0, 0, .95), .03, 'iron', n=3)
    k.beam((-.9, 0, .25), (0, 0, .95), .03, 'iron', n=3)
    k.cyl(.12, .22, (0, 0, 1.0), 'signal_orange', n=8)
    k.pop()
    k.end(prev)
    # equipment hut
    k.push((3.4, 2.4, 0), rz=-.2)
    k.box((3.2, 2.4, .25), (0, 0, .12), 'concrete', bevel=.04)
    k.box((2.8, 2.0, 2.3), (0, 0, 1.4), 'red_timber', bevel=.04, dense=1.0)
    for x in (-1.4, 1.4):
        k.box((.14, 2.06, 2.3), (x, 0, 1.4), 'white_paint', bevel=.02)
    k.box((3.2, 2.5, .16), (0, 0, 2.62), 'zinc', bevel=.03, rot=(.08, 0, 0))
    k.snow((3.0, 2.2, .12), (0, 0, 2.74), rot=(.08, 0, 0))
    k.box((.85, .12, 1.7), (-.6, -1.02, 1.1), 'iron', bevel=.02)
    k.box((.9, .5, .7), (.8, -1.2, .65), 'zinc', bevel=.04)
    k.cyl(.26, .06, (.8, -1.47, .7), 'iron', n=10, rot=(math.pi / 2, 0, 0), bevel=0)
    k.box((.08, .08, .08), (-1.1, -1.08, 2.2), 'lamp', bevel=0)
    k.pop()
    k.beam((2.2, 1.6, 2.0), (.45, .3, 3.5), .06, 'iron', n=4)


def build_wreck_tank(k):
    k.burn = 1.
    # tracks: the left one burst, its front run peeled off onto the ground
    track = [(-3.25, .5), (-2.75, .05), (2.75, .05), (3.3, .55), (2.95, .98), (-2.95, .98)]
    track_l = [(-1.3, .4), (-.9, .05), (2.75, .05), (3.3, .55), (2.95, .98), (-1.0, .98)]
    for x, prof in ((1.45, track), (-1.45, track_l)):
        k.prism(prof, .64, (x, 0, 0), 'iron', rot=(0, 0, math.pi / 2), bevel=.04, tint=.8)
        ys = [-2.4, -1.45, -.5, .45, 1.4, 2.35] if x > 0 else [-.5, .45, 1.4, 2.35]
        for y in ys:
            k.cyl(.38, .12, (x * 1.2, y, .45), 'rust', n=10, rot=(0, math.pi / 2, 0), bevel=.02)
    for i in range(7):
        k.box((.6, .42, .08), (-1.6 - i * .05, -2.0 - i * .43, .04), 'iron', bevel=.015,
              rot=(0, 0, .12 + i * .03), tint=.8)
    k.cyl(.38, .12, (-2.6, -1.6, .2), 'rust', n=10, rot=(math.pi / 2 - .3, 0, .6))
    # hull with glacis
    hull = [(-3.3, 1.0), (-2.3, 1.65), (2.95, 1.65), (3.2, 1.05), (2.95, .5), (-2.9, .5)]
    k.prism(hull, 3.5, (0, 0, 0), 'rust', rot=(0, 0, math.pi / 2), tint=.85, res=.5)
    for i, y in enumerate((-1.6, -.2, 1.2)):
        if i == 0:
            continue
        k.box((.08, 1.3, .5), (1.8, y, 1.2), 'olive', bevel=.02, rot=(0, .05 * i, 0), tint=.75)
    k.box((.08, 1.3, .5), (-1.8, 1.6, 1.2), 'olive', bevel=.02, tint=.7)
    k.box((.08, 1.1, .45), (-2.1, -.8, .25), 'olive', bevel=.02, rot=(.3, 1.2, .4), tint=.65)
    k.box((3.3, 1.5, .2), (0, 1.9, 1.72), 'rust', bevel=.04)  # engine deck
    for i in range(4):
        k.box((2.8, .08, .1), (0, 1.3 + i * .4, 1.84), 'iron', bevel=0)
    k.cyl(.95, .08, (0, .05, 1.66), 'iron', n=14, bevel=0, tint=.35)  # empty turret ring
    for sx in (-1, 1):   # track fenders, one torn
        k.box((.7, 5.6 if sx > 0 else 3.4, .08), (sx * 1.45, .2 if sx > 0 else 1.3, 1.02), 'rust', bevel=.02,
              rot=(0, sx * .06, 0), tint=.8)
    for x in (-.8, .8):  # exhausts and a stowage bin
        k.cyl(.12, .5, (x, 3.05, 1.35), 'iron', n=8, rot=(math.pi / 2, 0, 0), tint=.5)
    k.box((1.0, .6, .45), (1.2, 2.3, 1.95), 'rust', bevel=.04, rot=(0, 0, .2), tint=.7)
    # turret blown askew onto the rear deck
    k.push((.55, 1.0, 1.72), rz=.62, rx=.1, ry=-.2)
    outline = [(1.15, -1.5), (1.3, -.2), (1.1, 1.2), (-1.1, 1.2), (-1.3, -.2), (-1.15, -1.5)]
    rings = [[(x, y, 0) for x, y in outline], [(x * .82, y * .85, .78) for x, y in outline]]
    k.loft(rings, 'rust', vary=.05)
    k.box((.9, .5, .5), (0, -1.55, .38), 'rust', bevel=.05)
    k.beam((0, -1.7, .38), (.2, -4.5, -.25), .11, 'iron', n=8)
    k.cyl(.17, .4, (.2, -4.45, -.24), 'iron', n=8, rot=(math.pi / 2 - .22, 0, .07))
    k.cyl(.35, .12, (.45, .3, .84), 'iron', n=10)
    k.drift((-.35, .45, .78), 1.3, 1.0, .12)
    k.pop()
    k.box((.7, .7, .06), (-2.3, 2.9, .03), 'iron', bevel=.01, rot=(.1, .3, .7))   # hatch lid
    k.drift((-.6, 2.3, 1.82), 1.8, 1.0, .14, rz=.15)
    # scattered debris
    for i in range(6):
        p = (k.rng.uniform(-3.2, 3.2), k.rng.uniform(-3.8, 3.8), .08)
        if abs(p[0]) < 2.1 and abs(p[1]) < 3.3:
            continue
        k.box((.4, .3, .16), p, 'rust', bevel=.03, rot=(0, 0, k.rng.uniform(0, 3)))


def build_wreck_plane(k):
    k.burn = .8

    def fuselage(y):
        """radius, centre height along the fuselage (nose at -Y)."""
        t = (y + 7.5) / 15
        if t < .12:
            r = .5 + (1.25 - .5) * math.sin(t / .12 * math.pi / 2)
        elif t < .62:
            r = 1.25
        else:
            r = 1.25 - (1.25 - .35) * ((t - .62) / .38) ** 1.3
        cz = .95 + max(0., t - .62) * 2.2
        return r, cz

    def section(ys, jag=None):
        rings = []
        for idx, y in enumerate(ys):
            r, cz = fuselage(y)
            ring = []
            for i in range(12):
                a = i * TAU / 12
                yy = y + (k.rng.uniform(-.35, .35) if jag == idx else 0)
                ring.append((math.cos(a) * r, yy, cz + math.sin(a) * r * .95))
            rings.append(ring)
        return rings

    # forward fuselage (nose buried a little)
    k.push((0, 0, -.25), rx=.03)
    ys = [-7.5, -7.2, -6.6, -5.8, -4.0, -2.0, 0.0, 1.0]
    k.loft(section(ys, jag=len(ys) - 1), 'zinc', caps=(True, True), cap_mat='iron')
    for s in (-1, 1):
        k.box((.35, .8, .35), (s * .45, -6.35, 1.95), 'glass', bevel=.05, rot=(-.5, 0, s * .25))
    for i in range(5):
        k.box((.08, .35, .35), (1.24, -4.0 + i * 1.0, 1.35), 'glass', bevel=.02)
    k.box((.1, 1.1, 1.6), (-1.26, -1.2, .9), 'iron', bevel=.02, tint=.6)   # cargo door
    k.drift((0, -3.0, 2.1), 1.2, 4.2, .16)
    # wing roots and the intact right wing with its engine
    k.push((0, 0, .55))
    wing = [(0, -1.4, .1), (0, -1.1, .32), (0, 1.1, .2), (0, 1.3, .05), (0, -1.2, -.08)]
    k.loft([[(1.0, y, z) for _, y, z in wing],
            [(9.8, y * .55 - .2, z * .6 + .75) for _, y, z in wing]], 'zinc')
    k.loft([[(-1.0, y, z) for _, y, z in wing],
            [(-3.4, y * .9 + k.rng.uniform(-.2, .2), z * .9 + .18) for _, y, z in wing]], 'zinc',
           cap_mat='iron')
    k.drift((5.0, -.1, .66), 4.4, 1.4, .1)
    for x, lost in ((3.6, False), (-3.6, True)):
        if lost:
            continue
        k.loft([[(x + math.cos(i * TAU / 10) * .55, y, .3 + math.sin(i * TAU / 10) * .55) for i in range(10)]
                for y in (-2.6, -1.8, 1.4)], 'iron')
        k.cyl(.55, .1, (x, -2.62, .3), 'zinc', n=10, rot=(math.pi / 2, 0, 0), bevel=0)
        k.cyl(.22, .5, (x, -2.85, .3), 'signal_red', n=8, r2=.02, rot=(math.pi / 2, 0, 0), bevel=0)
        for b in range(3):
            a = b * TAU / 3 + .4
            bend = .4 if b == 1 else 0
            k.push((x, -2.9, .3), ry=a)
            k.box((1.4, .06, .22), (.75, 0, 0), 'iron', bevel=.01, rot=(bend, .0, 0))
            k.pop()
    k.pop()
    k.pop()
    # broken tail section, twisted aside
    k.push((.9, .9, -.2), rz=.28, ry=.08)
    ys = [1.9, 2.8, 4.5, 6.0, 7.5]
    k.loft(section(ys, jag=0), 'zinc', caps=(True, True), cap_mat='iron')
    fin = [(0, 1.8), (0, 4.3), (1.2, 4.3), (2.5, 1.6)]
    k.prism([(y, z) for y, z in fin], .22, (0, 5.9, 0), 'zinc', rot=(0, 0, math.pi / 2))
    k.prism([(.9, 3.6), (.9, 4.3), (1.25, 4.3), (1.55, 3.6)], .26, (0, 5.9, 0), 'signal_red',
            rot=(0, 0, math.pi / 2))
    k.box((6.0, 1.3, .12), (0, 6.6, 1.9), 'zinc', bevel=.03, taper=(.9, .8))
    k.drift((1.4, 6.55, 1.95), 2.0, 1.0, .1)
    k.pop()
    # the snapped outer left wing and a torn-off engine
    k.push((-7.4, 1.6, .15), rz=.5, rx=.15)
    k.loft([[(0, y, z) for _, y, z in wing],
            [(-5.5, y * .6 - .15, z * .65 + .2) for _, y, z in wing]], 'zinc', cap_mat='iron')
    k.pop()
    k.push((-4.6, -3.6, .45), rz=1.1, ry=.5)
    k.loft([[(math.cos(i * TAU / 10) * .55, y, math.sin(i * TAU / 10) * .55) for i in range(10)]
            for y in (-1.2, -.4, 1.4)], 'iron')
    k.pop()
    for i in range(7):
        p = (k.rng.uniform(-8, 8), k.rng.uniform(-8, 8), .05)
        k.box((.7, .5, .06), p, 'zinc', bevel=.01, rot=(k.rng.uniform(-.3, .3), .1, k.rng.uniform(0, 3)))


def build_fishing_hut(k):
    W, D, H = 4.0, 6.0, 2.6
    k.box((W + .3, D + .3, .45), (0, 0, .22), 'stone', bevel=.06, dense=1.2)
    k.box((W, D, H - .45), (0, 0, .45 + (H - .45) / 2), 'red_timber', bevel=.04, dense=.9)
    for s in (-1, 1):
        for i in range(12):
            y = -D / 2 + .35 + i * (D - .7) / 11
            k.box((.08, .1, H - .5), (s * (W / 2 + .03), y, .45 + (H - .45) / 2), 'red_timber',
                  bevel=.015, tint=.85)
        for e in (-1, 1):
            k.box((.18, .18, H - .45), (s * (W / 2 + .02), e * (D / 2 + .02), .45 + (H - .45) / 2),
                  'white_paint', bevel=.03)
    k.roof(W, D, H, 1.7, mat='slate', wall='red_timber', over=.35, end_over=.35, snow=.55)
    # boat doors on the water gable
    for s in (-1, 1):
        k.box((1.3, .12, 2.0), (s * .67, -D / 2 - .05, 1.45), 'wood', bevel=.03, tint=.7)
        k.beam((s * .15, -D / 2 - .12, .6), (s * 1.2, -D / 2 - .12, 2.3), .05, 'wood', n=4, tint=.6)
    k.box((2.9, .16, .16), (0, -D / 2 - .07, 2.5), 'white_paint', bevel=.03)
    for s in (-1, 1):
        k.box((.16, .16, 2.1), (s * 1.42, -D / 2 - .07, 1.45), 'white_paint', bevel=.03)
    k.box((.6, .12, .6), (0, -D / 2 - .03, 3.4), 'glass', bevel=.02)
    k.box((.76, .14, .1), (0, -D / 2 - .04, 3.74), 'white_paint', bevel=.02)
    # side door with its lamp, and a window
    k.box((.12, .95, 1.85), (W / 2 + .06, -1.2, 1.37), 'wood', bevel=.02, tint=.75)
    k.box((.16, 1.2, .14), (W / 2 + .08, -1.2, 2.35), 'white_paint', bevel=.02)
    k.box((.5, .9, .2), (W / 2 + .3, -1.2, .1), 'stone', bevel=.03)
    k.box((.2, .12, .12), (W / 2 + .12, -1.2, 2.55), 'iron', bevel=0)
    k.box((.16, .16, .2), (W / 2 + .26, -1.2, 2.45), 'lamp', bevel=.02)
    k.empty('light_door', (W / 2 + .4, -1.2, 2.4))
    k.box((.1, .9, .75), (W / 2 + .05, 1.4, 1.75), 'glass', bevel=.02)
    k.box((.14, 1.06, .1), (W / 2 + .07, 1.4, 2.18), 'white_paint', bevel=.02)
    k.box((.14, 1.06, .1), (W / 2 + .07, 1.4, 1.34), 'white_paint', bevel=.02)
    k.box((.12, .06, .75), (W / 2 + .08, 1.4, 1.75), 'white_paint', bevel=0)
    # stone chimney through the back of the roof
    k.box((.6, .6, 2.1), (.9, 1.9, 4.0), 'stone', bevel=.04, tint=.9)
    k.box((.76, .76, .14), (.9, 1.9, 5.1), 'stone', bevel=.03, tint=.8)
    k.box((.36, .36, .1), (.9, 1.9, 5.2), 'iron', bevel=0, tint=.3)
    k.empty('smoke_chimney', (.9, 1.9, 5.35))
    # slipway, barrels, crates, firewood and a net rack
    for s in (-1, 1):
        k.box((.22, 2.6, .14), (s * .7, -D / 2 - 1.3, .07), 'wood', bevel=.02, tint=.8)
    for i, (x, y) in enumerate(((-W / 2 - .5, -1.8), (-W / 2 - .5, -1.1))):
        k.cyl(.3, .85, (x, y, .43), 'wood' if i else 'signal_red', n=10, bevel=.03)
        k.cyl(.26, .05, (x, y, .88), 'snow', n=10, bevel=0)
    k.box((.7, .5, .4), (-W / 2 - .45, -.3, .2), 'wood', bevel=.03, tint=1.1)
    k.box((.7, .5, .4), (-W / 2 - .5, -.25, .6), 'signal_orange', bevel=.03)
    for i in range(3):
        k.cyl(.12, 1.8, (-.8 + i * .0, D / 2 + .3, .14 + i * .22), 'wood', n=6,
              rot=(0, math.pi / 2, 0), tint=.9)
    k.box((2.0, .5, .75), (-.4, D / 2 + .35, .38), 'wood', bevel=.05, tint=.85)
    k.snow((2.0, .5, .1), (-.4, D / 2 + .35, .8))
    for y in (1.2, 3.0):
        k.beam((-W / 2 - 1.2, y, 0), (-W / 2 - 1.2, y, 1.9), .06, 'wood', n=5)
    k.beam((-W / 2 - 1.2, 1.2, 1.85), (-W / 2 - 1.2, 3.0, 1.85), .05, 'wood', n=4)
    k.box((.08, 1.6, .9), (-W / 2 - 1.2, 2.1, 1.35), 'olive', bevel=.02)


def build_boat(k):
    k.grime = 0.
    # stations from stern (+Y) to bow (-Y): y, half beam, gunwale height, keel depth
    stations = [(3.9, 1.05, 1.0, -.3), (3.3, 1.22, .97, -.5), (2.2, 1.32, .95, -.6),
                (.6, 1.33, .96, -.62), (-1.0, 1.26, 1.0, -.6), (-2.4, 1.02, 1.1, -.5),
                (-3.4, .62, 1.26, -.3), (-4.05, .08, 1.42, .1)]
    rings = []
    for y, b, g, kz in stations:
        d = max(.62, g - .34)
        bi = max(.03, b - .12)
        pr = [(.45 * b, kz * .85), (.85 * b, kz * .3 + .0), (.97 * b, 0.0), (b, .38), (b, g),
              (bi, g), (bi, d)]
        ring = [(0, kz)] + pr + [(0, d)] + [(-x, z) for x, z in reversed(pr)]
        rings.append([(x, y, z) for x, z in ring])

    def hull_mat(c, n):
        if n.z > .6 and c.z < 1.3:
            return 'wood' if c.z < .95 or abs(c.x) < .3 else 'wood'
        outward = c.x * n.x > 0
        if not outward and c.z > .5:
            return 'white_paint'
        return 'white_paint' if c.z > .37 else 'red_timber'

    k.loft(rings, hull_mat, caps=(True, True), vary=.02)
    # rubbing strake and gunwale capping
    for s in (-1, 1):
        pts = [Vector((s * (b + .03), y, .4)) for y, b, g, kz in stations]
        top = [Vector((s * (b - .05), y, g + .03)) for y, b, g, kz in stations]
        for a, bb in zip(pts, pts[1:]):
            k.beam(a, bb, .06, 'wood', n=4, tint=.7)
        for a, bb in zip(top, top[1:]):
            k.beam(a, bb, .06, 'wood', n=4, tint=.8)
    # wheelhouse aft
    k.box((1.7, 1.6, 1.55), (0, 1.9, .65 + .78), 'white_paint', bevel=.04)
    k.box((1.72, 1.62, .42), (0, 1.9, 1.75), 'glass', bevel=.03)
    for x in (-.5, 0, .5):
        k.box((.08, 1.64, .44), (x, 1.9, 1.75), 'white_paint', bevel=0)
    k.box((2.0, 1.95, .14), (0, 1.9, 2.25), 'slate', bevel=.03)
    k.snow((1.8, 1.75, .1), (0, 1.9, 2.35))
    k.cyl(.1, .9, (.55, 2.4, 2.7), 'iron', n=8)
    k.empty('smoke_stack', (.55, 2.4, 3.2))
    k.box((.8, .12, 1.1), (0, 1.06, 1.2), 'wood', bevel=.02, tint=.8)
    # mast, boom, lamp
    k.beam((0, -1.9, .6), (0, -1.9, 5.2), .09, 'wood', n=6)
    k.beam((-.6, -1.9, 4.2), (.6, -1.9, 4.2), .05, 'wood', n=4)
    k.beam((0, -1.9, 1.6), (0, .6, 2.4), .06, 'wood', n=4)
    k.box((.16, .16, .22), (0, -1.9, 5.3), 'lamp', bevel=.02)
    k.empty('light_mast', (0, -1.9, 5.35))
    k.beam((0, -1.9, 5.1), (0, -4.0, 1.5), .015, 'iron', n=3, caps=False)
    k.beam((0, -1.9, 5.1), (0, 3.7, 1.1), .015, 'iron', n=3, caps=False)
    # deck gear: fish boxes, net pile, buoys along the rail
    for i, (x, y) in enumerate(((-.5, -.4), (.35, -.5), (-.4, .2))):
        k.box((.6, .45, .3), (x, y, .78 + (.3 if i == 2 else 0)), 'signal_orange' if i != 1 else 'wood',
              bevel=.03)
    k.ball((.3, -3.0, .9), .55, 'olive', scale=(1, 1.1, .45), sub=1, jitter=.15, seed=2)
    k.snow((.9, .8, .08), (0, .5, .75))
    for s in (-1, 1):
        for y in (-1.2, .1, 2.8):
            k.ball((s * 1.36, y, .72), .15, 'signal_orange', sub=1)
    k.box((.8, 1.6, .2), (0, 3.3, .78), 'wood', bevel=.03, tint=.8)


def build_crane(k):
    # rail stubs under the portal
    for x in (-2.6, 2.6):
        k.box((.14, 6.6, .12), (x, 0, .06), 'iron', bevel=0)
    for x in (-2.6, 2.6):
        for y in (-2.1, 2.1):
            k.box((.7, 1.4, .5), (x, y, .42), 'iron', bevel=.04)
            for dy in (-.4, .4):
                k.cyl(.22, .16, (x, y + dy, .3), 'iron', n=10, rot=(0, math.pi / 2, 0), bevel=0)
            k.box((.55, .55, 4.4), (x, y, 2.85), 'signal_orange', bevel=.05, taper=(.75, .75))
    for y in (-2.1, 2.1):
        k.box((5.8, .6, .7), (0, y, 5.1), 'signal_orange', bevel=.05)
        k.snow((5.6, .5, .08), (0, y, 5.49))
    for x in (-2.6, 2.6):
        k.box((.6, 4.8, .7), (x, 0, 5.1), 'signal_orange', bevel=.05)
        k.beam((x, -2.0, 1.2), (x, 2.0, 4.6), .08, 'signal_orange', n=4)
    # slewing ring and machinery house
    k.cyl(2.2, .4, (0, 0, 5.65), 'zinc', n=16)
    k.box((3.2, 4.0, 2.4), (0, .6, 7.05), 'zinc', bevel=.05, dense=1.1)
    k.box((3.3, 4.1, .2), (0, .6, 8.3), 'signal_orange', bevel=.04)
    k.snow((3.1, 3.9, .12), (0, .6, 8.45))
    for i in range(3):
        k.box((.08, 1.0, .6), (1.62, -.2 + i * 1.2, 7.2), 'iron', bevel=0)
    k.box((2.8, 1.0, 1.8), (0, 3.0, 6.6), 'concrete', bevel=.05)   # counterweight
    k.snow((2.6, .9, .1), (0, 3.0, 7.55))
    # cab with glass
    k.box((1.4, 1.3, 1.6), (-.8, -1.95, 6.8), 'signal_orange', bevel=.04)
    k.box((1.42, 1.1, .7), (-.8, -2.05, 7.0), 'glass', bevel=.02)
    k.box((1.5, 1.4, .12), (-.8, -1.95, 7.66), 'zinc', bevel=.02)
    k.empty('light_cab', (-.8, -2.7, 7.7))
    k.box((.14, .14, .14), (-.8, -2.62, 7.62), 'lamp', bevel=0)
    # A-frame
    for x in (-1.1, 1.1):
        k.beam((x, 1.8, 8.4), (x * .2, .4, 11.4), .13, 'signal_orange', n=6)
        k.beam((x, -.8, 8.4), (x * .2, .4, 11.4), .13, 'signal_orange', n=6)
    k.box((.7, .5, .4), (0, .4, 11.5), 'iron', bevel=.04)
    # lattice jib, luffed up toward the harbour side (-Y)
    base = Vector((0, -1.3, 7.2))
    ang = math.radians(42)
    Ljib = 10.5
    dirv = Vector((0, -math.cos(ang), math.sin(ang)))
    up = Vector((0, math.sin(ang), math.cos(ang)))
    segs = 7

    def chord(i, sx, sz):
        t = i / segs
        w = .75 * (1 - t) + .3 * t
        return base + dirv * (Ljib * t) + Vector((sx * w, 0, 0)) + up * (sz * w)

    for sx, sz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        for i in range(segs):
            k.beam(chord(i, sx, sz), chord(i + 1, sx, sz), .07, 'signal_orange', n=4)
    for i in range(segs):
        for sx in (-1, 1):
            k.beam(chord(i, sx, -1), chord(i + 1, sx, 1), .04, 'signal_orange', n=3)
        for sz in (-1, 1):
            k.beam(chord(i, -1, sz), chord(i + 1, 1, sz), .04, 'signal_orange', n=3)
    tip = base + dirv * Ljib
    k.box((.5, .6, .5), tip, 'iron', bevel=.04)
    for x in (-.25, .25):
        k.beam((x, .4, 11.4), tip + Vector((x, 0, .2)), .025, 'iron', n=3, caps=False)
    hook = tip - Vector((0, 0, 5.2))
    for x in (-.12, .12):
        k.beam(tip + Vector((x, 0, 0)), hook + Vector((x, 0, .4)), .02, 'iron', n=3, caps=False)
    k.box((.5, .3, .6), hook + Vector((0, 0, .15)), 'signal_orange', bevel=.05)
    k.beam(hook - Vector((0, 0, .15)), hook - Vector((0, .2, .55)), .06, 'iron', n=4)


def build_fuel_tanks(k):
    # bund wall
    k.box((12.0, 11.0, .12), (0, .3, .06), 'concrete', bevel=.03, dense=2.0)
    for (x, y, sx, sy) in ((0, -5.1, 12.0, .4), (0, 5.7, 12.0, .4), (-5.8, .3, .4, 11.0), (5.8, .3, .4, 11.0)):
        k.box((sx, sy, .6), (x, y, .3), 'concrete', bevel=.05)
        k.snow((max(.3, sx - .1), max(.3, sy - .1), .08), (x, y, .63))
    tanks = [(-2.6, -1.8, 4.4), (2.6, -1.8, 4.4), (0, 2.6, 3.6)]
    for i, (x, y, h) in enumerate(tanks):
        k.cyl(2.0, h, (x, y, .12 + h / 2), 'white_paint', n=20, bevel=.05, vary=.02)
        k.cyl(2.03, .45, (x, y, .12 + h - .5), 'signal_orange', n=20, bevel=0, caps=False)
        k.cyl(2.04, .12, (x, y, .5), 'iron', n=20, bevel=0, caps=False, tint=.8)
        k.cyl(2.05, .5, (x, y, .12 + h + .25), 'zinc', n=20, r2=.35, bevel=0)
        k.cyl(1.6, .3, (x, y, .12 + h + .36), 'snow', n=20, r2=.3, bevel=0)
        k.cyl(.3, .25, (x, y, .12 + h + .6), 'zinc', n=8)
        # outlet pipe and valve to the front manifold
        k.beam((x, y - 1.95, .6), (x, -4.2, .6), .13, 'zinc', n=8)
        k.cyl(.26, .05, (x, -3.4, .95), 'signal_orange', n=10, bevel=0)
        k.beam((x, -3.4, .6), (x, -3.4, .92), .04, 'iron', n=4)
    k.beam((-4.2, -4.2, .6), (4.2, -4.2, .6), .16, 'zinc', n=8)
    for x in (-3.5, 0, 3.5):
        k.box((.3, .3, .5), (x, -4.2, .25), 'concrete', bevel=.03)
    # straight stair up the side of tank A, catwalk to tank B
    x0, y0, h = -2.6, -1.8, 4.4
    steps = 14
    for i in range(steps):
        t = i / (steps - 1)
        k.box((.7, .26, .06), (x0 - 2.4 + t * 2.2, y0 - 2.15 + .0, .3 + t * (h - .2)), 'iron',
              bevel=0, rot=(0, 0, 0))
    for dy in (-.35, .35):
        a = Vector((x0 - 2.4, y0 - 2.15 + dy, .1))
        b = Vector((x0 - .2, y0 - 2.15 + dy, h + .15))
        k.beam(a, b, .05, 'iron', n=4)
        k.beam(a + Vector((0, 0, .95)), b + Vector((0, 0, .95)), .03, 'iron', n=4)
    k.box((1.2, 1.0, .08), (x0 - .1, y0 - 2.0, h + .15), 'iron', bevel=0)
    k.box((4.0, .8, .1), (0, -1.8, h + .52), 'iron', bevel=.02)
    k.rail([(-2.0, -2.2, h + .57), (2.0, -2.2, h + .57)], .9, 'signal_orange', post=.05, r=.03, step=1.0)
    k.rail([(-2.0, -1.4, h + .57), (2.0, -1.4, h + .57)], .9, 'signal_orange', post=.05, r=.03, step=1.0)
    # little pump house
    k.box((1.6, 1.3, 1.5), (4.3, 3.9, .87), 'red_timber', bevel=.04)
    k.box((1.9, 1.6, .14), (4.3, 3.9, 1.7), 'zinc', bevel=.03, rot=(.1, 0, 0))
    k.snow((1.7, 1.4, .1), (4.3, 3.9, 1.8), rot=(.1, 0, 0))
    k.box((.1, .6, 1.0), (3.47, 3.9, .75), 'wood', bevel=.02, tint=.7)


def build_rail_wagon(k):
    # a short length of track (rail top at .15)
    for i in range(19):
        y = -5.85 + i * .65
        k.box((2.5, .24, .1), (0, y, .05), 'wood', bevel=.02, tint=.75 + .1 * ((i * 7) % 3) / 2)
    for x in (-.72, .72):
        k.box((.1, 12.4, .07), (x, 0, .115), 'iron', bevel=.01)
    # bogies and wheels
    for yb in (-3.3, 3.3):
        k.box((2.0, 2.6, .35), (0, yb, .72), 'iron', bevel=.04)
        for dy in (-.85, .85):
            for x in (-.74, .74):
                k.cyl(.42, .12, (x, yb + dy, .57), 'iron', n=12, rot=(0, math.pi / 2, 0), bevel=.02,
                      tint=.85)
            k.beam((-.9, yb + dy, .57), (.9, yb + dy, .57), .07, 'rust', n=6)
        for x in (-1.05, 1.05):
            k.box((.12, 1.0, .35), (x, yb, .8), 'rust', bevel=.02)
    # underframe, buffers, couplers
    k.box((2.6, 10.2, .34), (0, 0, 1.12), 'iron', bevel=.04)
    for e in (-1, 1):
        for x in (-.9, .9):
            k.cyl(.17, .5, (x, e * 5.3, 1.1), 'iron', n=8, rot=(math.pi / 2, 0, 0))
            k.cyl(.24, .06, (x, e * 5.55, 1.1), 'iron', n=10, rot=(math.pi / 2, 0, 0), bevel=0)
        k.box((.25, .5, .18), (0, e * 5.3, 1.1), 'iron', bevel=.02)
    # red boxcar body, battens, doors
    k.box((3.0, 10.0, 1.75), (0, 0, 1.29 + .875), 'red_timber', bevel=.04, dense=1.0)
    for s in (-1, 1):
        for i in range(17):
            y = -4.8 + i * .6
            if abs(y) < 1.1:
                continue
            k.box((.07, .09, 1.7), (s * 1.52, y, 2.15), 'red_timber', bevel=.01, tint=.82)
        for y in (-4.95, 4.95, -1.15, 1.15):
            k.box((.1, .16, 1.78), (s * 1.53, y, 2.16), 'iron', bevel=.01)
        k.box((.1, 2.1, 1.65), (s * 1.56, 0, 2.1), 'red_timber', bevel=.02, tint=.7)
        k.beam((s * 1.62, -1.0, 1.4), (s * 1.62, 1.0, 2.9), .04, 'iron', n=4)
        k.beam((s * 1.62, 1.0, 1.4), (s * 1.62, -1.0, 2.9), .04, 'iron', n=4)
        k.box((.08, 4.4, .08), (s * 1.6, 0, 3.0), 'iron', bevel=0)
        k.box((.08, 4.4, .08), (s * 1.6, 0, 1.32), 'iron', bevel=0)
        k.box((.06, .5, .3), (s * 1.56, -3.2, 2.5), 'white_paint', bevel=0)   # chalk board
    # end ladders
    for e in (-1, 1):
        for x in (1.0, 1.35):
            k.box((.05, .05, 1.8), (x, e * 5.05, 2.15), 'iron', bevel=0)
        for i in range(6):
            k.box((.4, .04, .04), (1.18, e * 5.05, 1.45 + i * .3), 'iron', bevel=0)
    # arched zinc roof with a snow strip
    arc = [(math.cos(math.pi * i / 8) * 1.62, 3.02 + math.sin(math.pi * i / 8) * .18) for i in range(9)]
    k.prism(arc + [(-1.62, 2.96), (1.62, 2.96)], 10.3, (0, 0, 0), 'zinc', vary=.02)
    so = [(math.cos(math.pi * i / 8) * 1.1, 3.1 + math.sin(math.pi * i / 8) * .12) for i in range(3, 6)]
    k.prism(so + [(x, z - .09) for x, z in reversed(so)], 8.6, (0, 0, .03), 'snow', vary=.02)


def build_statue(k):
    # stepped plinth
    k.box((3.2, 3.2, .4), (0, 0, .2), 'stone', bevel=.06)
    k.snow((3.1, 3.1, .06), (0, 0, .42))
    k.box((2.6, 2.6, .32), (0, 0, .56), 'stone', bevel=.05, tint=.95)
    k.snow((2.5, 2.5, .06), (0, 0, .74))
    k.box((1.9, 1.9, 1.1), (0, 0, 1.27), 'stone', bevel=.05, taper=(.94, .94), tint=1.04, dense=.8)
    k.box((2.2, 2.2, .2), (0, 0, 1.92), 'stone', bevel=.05, tint=.9)
    k.snow((2.1, 2.1, .06), (0, 0, 2.04))
    k.box((1.0, .08, .6), (0, -.93, 1.25), 'bronze', bevel=.02)
    for x in (-.9, .9):   # wreath stones
        k.ball((x * 1.1, -1.35, .52), .18, 'olive', scale=(1, .6, 1), sub=1, jitter=.2)
    # bronze soldier in a greatcoat, rifle grounded, arm raised forward
    Z = 2.02
    k.box((1.1, .9, .14), (0, 0, Z + .07), 'bronze', bevel=.03)
    for x in (-.2, .2):
        k.box((.28, .42, .3), (x, -.06, Z + .28), 'bronze', bevel=.05)       # boots
        k.beam((x, 0, Z + .3), (x * .9, 0, Z + 1.05), .14, 'bronze', n=8)   # legs
    def ell(r, z, sx=1.18, sy=.9, oy=0.):
        return [(math.cos(i * TAU / 10) * r * sx, oy + math.sin(i * TAU / 10) * r * sy, z) for i in range(10)]
    k.loft([ell(.55, Z + .72, oy=.04), ell(.46, Z + 1.35), ell(.4, Z + 1.75),
            ell(.5, Z + 2.25, sx=1.28), ell(.38, Z + 2.47, sx=1.3), ell(.16, Z + 2.52)], 'bronze')
    k.ball((0, 0, Z + 2.62), .15, 'bronze', sub=1)   # neck
    k.ball((0, -.02, Z + 2.78), .21, 'bronze', sub=2)   # head
    k.ball((0, .03, Z + 2.8), .3, 'bronze', scale=(1, 1.08, .85), uv=(12, 6), hemi=True)   # helmet
    k.cyl(.31, .1, (0, .05, Z + 2.78), 'bronze', n=12, r2=.3, bevel=0)
    k.drift((0, .03, Z + 3.03), .36, .36, .06)
    # greatcoat collar and shoulder snow
    k.ball((.42, 0, Z + 2.38), .17, 'bronze', sub=1)
    k.ball((-.42, 0, Z + 2.38), .17, 'bronze', sub=1)
    k.snow((.22, .22, .05), (-.44, 0, Z + 2.54), bevel=.02)
    # right arm raised, pointing forward
    sh = Vector((.46, 0, Z + 2.34))
    el = Vector((.74, -.28, Z + 2.86))
    ha = Vector((.86, -.62, Z + 3.5))
    k.beam(sh, el, .12, 'bronze', n=8)
    k.beam(el, ha, .1, 'bronze', n=8)
    k.ball(ha, .11, 'bronze', sub=1)
    # left arm down to the grounded rifle
    sl = Vector((-.46, 0, Z + 2.34))
    hl = Vector((-.62, -.3, Z + 1.55))
    k.beam(sl, (-.58, -.12, Z + 1.9), .12, 'bronze', n=8)
    k.beam((-.58, -.12, Z + 1.9), hl, .1, 'bronze', n=8)
    k.ball(hl, .11, 'bronze', sub=1)
    k.box((.1, .16, 1.7), (-.66, -.34, Z + 1.0), 'bronze', bevel=.02, rot=(.05, 0, 0))
    k.beam((-.66, -.36, Z + 1.85), (-.66, -.38, Z + 2.3), .03, 'bronze', n=4)


def build_watch_hut(k):
    P = 1.25
    for x in (-P, P):
        for y in (-P, P):
            k.beam((x * 1.08, y * 1.08, 0), (x, y, 3.0), .13, 'wood', n=6, tint=.85)
            k.box((.45, .45, .2), (x * 1.08, y * 1.08, .1), 'concrete', bevel=.03)
    for (a, b) in (((-P, -P), (P, -P)), ((P, -P), (P, P)), ((P, P), (-P, P)), ((-P, P), (-P, -P))):
        k.beam((a[0], a[1], .5), (b[0], b[1], 2.7), .06, 'wood', n=4, tint=.8)
        k.beam((b[0], b[1], .5), (a[0], a[1], 2.7), .06, 'wood', n=4, tint=.8)
    k.box((3.1, 3.1, .2), (0, 0, 3.0), 'wood', bevel=.03)
    k.snow((3.0, .45, .07), (0, -1.3, 3.13))
    k.snow((.45, 3.0, .07), (1.3, 0, 3.13))
    k.rail([(-.6, -1.5, 3.1), (-1.5, -1.5, 3.1), (-1.5, 1.5, 3.1), (1.5, 1.5, 3.1), (1.5, -1.5, 3.1),
            (.6, -1.5, 3.1)], .95, 'wood', post=.08, r=.04, step=1.0)
    # hut
    k.box((2.1, 2.1, 1.9), (0, .2, 3.1 + .95), 'red_timber', bevel=.04, dense=.8)
    for s in (-1, 1):
        for e in (-1, 1):
            k.box((.14, .14, 1.9), (s * 1.05, .2 + e * 1.05, 4.05), 'white_paint', bevel=.02)
    k.box((2.14, .3, .32), (0, .2, 4.35), 'glass', bevel=.02)
    k.box((.3, 2.14, .32), (0, .2, 4.35), 'glass', bevel=.02)
    k.box((.7, .1, 1.5), (-.45, -.87, 3.85), 'wood', bevel=.02, tint=.7)
    k.roof(2.1, 2.1, 5.0, .9, mat='slate', wall='red_timber', over=.3, end_over=.3, snow=.6,
           at=(0, .2), rz=math.pi / 2)
    k.box((.25, .25, .6), (.6, .6, 5.6), 'stone', bevel=.03)
    # ladder
    for x in (-.35, .35):
        k.beam((x, -2.4, 0), (x, -1.55, 3.15), .05, 'wood', n=4)
    for i in range(8):
        t = (i + .5) / 8
        k.box((.7, .05, .05), (0, -2.4 + .85 * t, 3.15 * t), 'wood', bevel=0)
    # lamp on a bracket, searchlight on the platform
    k.beam((1.12, -.9, 4.7), (1.5, -1.2, 4.7), .03, 'iron', n=4)
    k.box((.2, .2, .26), (1.5, -1.2, 4.55), 'lamp', bevel=.03)
    k.box((.26, .26, .06), (1.5, -1.2, 4.72), 'iron', bevel=0)
    k.empty('light_lamp', (1.5, -1.2, 4.45))
    k.cyl(.22, .4, (-1.2, -1.2, 3.55), 'iron', n=10, rot=(math.pi / 2 - .3, 0, .6))
    k.cyl(.19, .04, (-1.31, -1.39, 3.63), 'lamp', n=10, rot=(math.pi / 2 - .3, 0, .6), bevel=0)
    k.beam((-1.2, -1.2, 3.1), (-1.2, -1.2, 3.4), .05, 'iron', n=4)
    # sandbags around the stilts
    for i in range(5):
        k.ball((-1.6 + i * .5, -1.9, .18), .3, 'canvas', scale=(1, .6, .5), sub=1, jitter=.1, tint=.75)


PROP_BUILDERS = {
    'lighthouse': build_lighthouse, 'ruin': build_ruin, 'windmill': build_windmill,
    'radio_mast': build_radio_mast, 'wreck_tank': build_wreck_tank, 'wreck_plane': build_wreck_plane,
    'fishing_hut': build_fishing_hut, 'boat': build_boat, 'crane': build_crane,
    'fuel_tanks': build_fuel_tanks, 'rail_wagon': build_rail_wagon, 'statue': build_statue,
    'watch_hut': build_watch_hut,
}


# ---------------------------------------------------------------- Scots pine
PINE_CLUMPS = [((0.0, 0.05, 3.58), .82, .42), ((.78, .28, 3.22), .62, .46),
               ((-.74, .48, 3.3), .6, .44), ((.18, -.82, 3.15), .6, .46),
               ((-.42, -.6, 3.46), .56, .42), ((.56, .88, 3.5), .52, .42),
               ((-1.0, -.22, 2.92), .5, .48), ((1.02, -.48, 2.85), .48, .48),
               ((-.24, .98, 2.88), .5, .46), ((.3, .1, 2.62), .44, .5)]


def pine_axis(z):
    return Vector((.07 * math.sin(z * 1.1), .05 * math.sin(z * .7 + 1), z))


def build_pine(k, lod):
    bark_lo, bark_hi = hexcol('4a3c31'), hexcol('b0673a')

    def bark(z):
        t = max(0., min(1., (z - 1.0) / 1.4))
        return tuple(a + (b - a) * t for a, b in zip(bark_lo, bark_hi))

    segs = 3 if lod else 7
    n = 5 if lod else 8
    top = 3.45
    zs = [-.08 + (top + .08) * i / segs for i in range(segs + 1)]
    rad = lambda z: .17 * (1 - z / 4.3) ** .8 + .025
    rings = []
    for z in zs:
        c = pine_axis(z)
        rings.append([(c.x + math.cos(i * TAU / n) * rad(z), c.y + math.sin(i * TAU / n) * rad(z), z)
                      for i in range(n)])
    for a, b, z in zip(rings, rings[1:], zs):
        k.loft([a, b], 'x', caps=(z == zs[0], False), tint=bark(z + .25), vary=.02)
    if not lod:
        k.frustum(.27, .19, -.08, .28, 'x', n=8, tint=bark_lo, caps=(True, False))
    for i, (c, r, fl) in enumerate(PINE_CLUMPS):
        c = Vector(c)
        if not lod:
            start = pine_axis(c.z - .5)
            k.beam(start, c - Vector((0, 0, .12)), .05, 'x', n=5, r2=.03, tint=bark(3.0))
        shade = hexcol(('2f4a3a', '34503d', '2a4434')[i % 3])
        k.ball(c, r, 'x', scale=(1, 1, fl), sub=2 if lod else 3, jitter=.15, tint=shade, vary=.05,
               seed=i * 1.7, rot=(0, 0, i))
        if not lod:
            for j in range(2):
                a = i * 2.1 + j * 2.6
                p = c + Vector((math.cos(a) * r * .85, math.sin(a) * r * .85, -r * fl * .25))
                k.ball(p, r * .42, 'x', scale=(1, 1, .6), sub=2, jitter=.2, tint=shade, vary=.06,
                       seed=i + j * 5.3, rot=(0, 0, a))

    snow = hexcol('f3efe6')

    def post(p, nrm, rgb):
        # snow settles on the upper cap of each clump (ideal ellipsoid, not the jittered facets)
        best = None
        for c, r, fl in PINE_CLUMPS:
            q = Vector(((p.x - c[0]) / r, (p.y - c[1]) / r, (p.z - c[2]) / (r * fl)))
            if best is None or q.length < best.length:
                best = q
        up = best.normalized().z if best.length > 1e-6 else 0.
        if up > .5 and nrm.z > .2 and p.z > 2.4:
            f = min(1., (up - .5) / .3) * max(0., min(1., .7 + 1.2 * pnoise(p * 1.6 + Vector((4, 1, 0)))))
            f = max(0., min(.75, f))
            return tuple(c + (s - c) * f for c, s in zip(rgb, snow))
        return rgb

    k.post = post
    k.grime = 0.


# ---------------------------------------------------------------- viaduct
def build_viaduct(k):
    """Two granite arches on three piers; deck top at z = .6, piers to z = -6.3."""
    X = 5.0
    TOP, FOOT = .6, -6.3
    arches = [(-3.7, 2.9), (3.7, 2.9)]
    spring = -.55 - 2.9
    course = .62
    granite = [hexcol(h) for h in ('8a8781', '84888a', '908a80', '7d7a74', '96928a')]
    snow = hexcol('f3efe6')

    def block_col(row, y, z, cx=0.):
        # voussoir ring colour around the arches
        for c, R in arches:
            d = math.hypot(y - c, z - spring)
            if z > spring and R <= d <= R + .7:
                ang = math.atan2(z - spring, y - c)
                idx = int(ang / (math.pi / 11))
                base = granite[4] if idx % 2 else granite[1]
                return tuple(v * (1.02 if idx % 2 else .92) for v in base)
        bid = int(math.floor((y + (row % 2) * .55 + cx) / 1.1))
        h = zlib.crc32(f'{row}:{bid}:{cx:.1f}'.encode()) % 1000 / 1000
        base = granite[int(h * 4)]
        return tuple(v * (.9 + .16 * ((h * 7.3) % 1)) for v in base)

    # y samples along the length: (y, bottom of the masonry)
    def arc(c, R):
        return [(c + math.cos(math.pi - math.pi * i / 16) * R, spring + math.sin(math.pi - math.pi * i / 16) * R)
                for i in range(17)]
    cols = ([(-8., FOOT), (-7.3, FOOT), (-6.6, FOOT)] + arc(*arches[0])
            + [(-.8, FOOT), (0., FOOT), (.8, FOOT)] + arc(*arches[1])
            + [(6.6, FOOT), (7.3, FOOT), (8., FOOT)])

    b = bmesh.new()
    lay = b.loops.layers.float_color.new('Col')

    def face(pts, outward, col):
        vs = [b.verts.new(p) for p in pts]
        try:
            f = b.faces.new(vs)
        except ValueError:
            return
        f.normal_update()
        if f.normal.dot(Vector(outward)) < 0:
            f.normal_flip()
        for l in f.loops:
            l[lay] = col + (1.,)

    def clip(poly, lo, hi):
        def cut(pts, keep, zc):
            out = []
            for i in range(len(pts)):
                a, c = pts[i], pts[(i + 1) % len(pts)]
                ia, ic = keep(a[1]), keep(c[1])
                if ia:
                    out.append(a)
                if ia != ic:
                    t = (zc - a[1]) / (c[1] - a[1])
                    out.append((a[0] + (c[0] - a[0]) * t, zc))
            return out
        p = cut(poly, lambda z: z >= lo - 1e-9, lo)
        if len(p) < 3:
            return []
        p = cut(p, lambda z: z <= hi + 1e-9, hi)
        return p if len(p) >= 3 else []

    levels = [FOOT + i * course for i in range(int((TOP - FOOT) / course) + 2)]
    levels[-1] = max(levels[-1], TOP)
    # side walls (x = +-X)
    for (y0, b0), (y1, b1) in zip(cols, cols[1:]):
        if abs(y1 - y0) < 1e-6:
            continue
        poly = [(y0, b0), (y1, b1), (y1, TOP), (y0, TOP)]
        for r, (lo, hi) in enumerate(zip(levels, levels[1:])):
            part = clip(poly, lo, min(hi, TOP))
            if not part:
                continue
            yc = sum(p[0] for p in part) / len(part)
            zc = sum(p[1] for p in part) / len(part)
            for s in (-1, 1):
                col = block_col(r, yc, zc, cx=s * .3)
                face([(s * X, y, z) for y, z in part], (s, 0, 0), col)
    # underside: arch intrados strips, pier bottoms, vertical pier faces
    xs = [-X + 2 * X * i / 6 for i in range(7)]
    for (y0, b0), (y1, b1) in zip(cols, cols[1:]):
        for i, (xa, xb) in enumerate(zip(xs, xs[1:])):
            if abs(y1 - y0) < 1e-6:
                # vertical pier face between two bottoms, split in courses
                lo, hi = min(b0, b1), max(b0, b1)
                out = (0, 1 if b1 > b0 else -1, 0)
                for r, (za, zb) in enumerate(zip(levels, levels[1:])):
                    a, c = max(za, lo), min(zb, hi)
                    if c - a < 1e-4:
                        continue
                    col = block_col(r, y0 + xa * .37, (a + c) / 2, cx=xa)
                    face([(xa, y0, a), (xb, y0, a), (xb, y0, c), (xa, y0, c)], out, col)
            else:
                ym = (y0 + y1) / 2
                zm = (b0 + b1) / 2
                if zm > FOOT + .01:
                    # intrados faces downward, into the arch
                    seg = int((ym + 8) * 3)
                    base = granite[(seg + i) % 2 + 2]
                    col = tuple(v * .92 for v in base)
                    face([(xa, y0, b0), (xb, y0, b0), (xb, y1, b1), (xa, y1, b1)], (0, 0, -1), col)
                else:
                    face([(xa, y0, b0), (xb, y0, b0), (xb, y1, b1), (xa, y1, b1)], (0, 0, -1), granite[3])
    # abutment ends (y = +-8)
    for e in (-1, 1):
        for i, (xa, xb) in enumerate(zip(xs, xs[1:])):
            for r, (za, zb) in enumerate(zip(levels, levels[1:])):
                zb = min(zb, TOP)
                if zb - za < 1e-4:
                    continue
                col = block_col(r, e * 8 + xa, (za + zb) / 2, cx=xa)
                face([(xa, e * 8., za), (xb, e * 8., za), (xb, e * 8., zb), (xa, e * 8., zb)], (0, e, 0), col)
    # deck: ballast and sleepers down the middle, a snow line along the parapets
    dx = [-X, -4.35, -3.2, -1.6, 0., 1.6, 3.2, 4.35, X]
    ballast, sleeper = hexcol('66615a'), hexcol('4e4033')
    for j in range(32):
        ya, yb = -8 + j * .5, -8 + (j + 1) * .5
        for xa, xb in zip(dx, dx[1:]):
            xm = (xa + xb) / 2
            if abs(xm) < 1.6:
                col = sleeper if j % 2 else ballast
            else:
                col = block_col(j, xm * 1.7, 0., cx=round(xm))
                col = tuple(v * .9 for v in col)
                if abs(xm) > 4.3:
                    col = tuple(c + (s - c) * .65 for c, s in zip(col, snow))
            face([(xa, ya, TOP), (xb, ya, TOP), (xb, yb, TOP), (xa, yb, TOP)], (0, 0, 1), col)
    bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-4)
    k.emit(b, Matrix.Identity(4), 'x', tint='keep', vary=0., smooth=False)

    # string course, parapets with pilasters over the piers, coping with snow
    for s in (-1, 1):
        k.box((.42, 16.0, .2), (s * 5.04, 0, .44), 'x', bevel=.04, tint=granite[1], vary=.03)
        for i in range(8):
            y = -8 + 1 + i * 2
            k.box((.45, 2.0, .78), (s * 5.02, y, .6 + .39), 'x', bevel=.03, tint=block_col(i, y, 1., cx=s),
                  vary=.02)
        k.box((.56, 16.0, .12), (s * 5.02, 0, 1.44), 'x', bevel=.03, tint=granite[4], vary=.02)
        k.box((.46, 16.0, .08), (s * 5.02, 0, 1.52), 'x', bevel=.035, seg=2, tint=snow, vary=.01)
        for y in (-7.4, 0., 7.4):
            k.box((.7, .9, 1.1), (s * 5.04, y, 1.15), 'x', bevel=.04, tint=granite[2], vary=.02)
            k.box((.62, .82, .1), (s * 5.04, y, 1.75), 'x', bevel=.035, seg=2, tint=snow, vary=.01)
        # cutwater on the central pier, pointing up/down stream (+-X)
        tri = lambda z, w: [(s * X, -.8 * w, z), (s * (X + 1.0 * w), 0, z), (s * X, .8 * w, z)]
        k.loft([tri(FOOT, 1.), tri(-2.3, 1.), tri(-1.5, .05)], 'x', caps=(True, True),
               tint=granite[0], vary=.02)
    # rails
    for x in (-.72, .72):
        k.box((.09, 16.0, .1), (x, 0, TOP + .05), 'x', bevel=.01, tint=hexcol('4a4f55'), vary=0.)

    def post(p, nrm, rgb):
        if p.z < .1:
            wet = min(1., (.1 - p.z) / .6)
            rgb = tuple(c * (1 - .22 * wet) for c in rgb)
            rgb = (rgb[0] * .95, rgb[1], rgb[2] * .97)
        return rgb

    k.post = post
    k.grime = 0.


# ---------------------------------------------------------------- scene assembly
MATERIALS = {}


def material(name, single=False):
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    if single:
        bsdf.inputs['Roughness'].default_value = .9
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        paint, rough, metal, emit = MATS[name]
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.
        mix.inputs[7].default_value = (*factor(paint), 1.)
        nt.links.new(vc.outputs['Color'], mix.inputs[6])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit:
            bsdf.inputs['Emission Color'].default_value = (*hexcol(emit), 1.)
            bsdf.inputs['Emission Strength'].default_value = 1.
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    MATERIALS[name] = m
    return m


def realise(k, offset, single_name=None):
    root = bpy.data.objects.new(k.name, None)
    bpy.context.scene.collection.objects.link(root)
    root.location = offset
    root['ambient_only'] = True
    nodes = {'root': root}
    order = ['root']
    while len(order) < len(k.groups):
        for g, (parent, _) in k.groups.items():
            if g not in order and parent in order:
                order.append(g)
    for g in order[1:]:
        parent, pivot = k.groups[g]
        e = bpy.data.objects.new(g, None)
        assert e.name == g, f'duplicate rig name {g}'
        bpy.context.scene.collection.objects.link(e)
        e.parent = nodes[parent]
        e.location = pivot - k.groups[parent][1]
        e.empty_display_size = .6
        nodes[g] = e
    meshes = []
    for (g, mat), b in sorted(k.acc.items()):
        pivot = k.groups[g][1]
        bmesh.ops.translate(b, vec=-pivot, verts=b.verts)
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-5)
        name = f'{k.name}_mesh' if single_name else (f'{k.name}_{mat}' if g == 'root' else f'{k.name}_{g}_{mat}')
        me = bpy.data.meshes.new(name)
        b.to_mesh(me)
        b.free()
        me.set_sharp_from_angle(angle=math.radians(75 if k.name.startswith('pine') else 46))
        me.materials.append(material(single_name, True) if single_name else material(mat))
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = nodes[g]
        meshes.append(o)
    for name, pos, g in k.empties:
        e = bpy.data.objects.new(name, None)
        assert e.name == name, f'duplicate empty {name}'
        bpy.context.scene.collection.objects.link(e)
        e.parent = nodes[g]
        e.location = pos - k.groups[g][1]
        e.empty_display_size = .3
    k.acc.clear()
    return root, meshes


def bake(k, root, meshes, ground_z=0., distance=1.8):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 32
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.world.light_settings.distance = distance
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new('bake_ground')
    g = bmesh.new()
    bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=30)
    g.to_mesh(me)
    g.free()
    ground = bpy.data.objects.new('bake_ground', me)
    bpy.context.scene.collection.objects.link(ground)
    ground.location = root.location + Vector((0, 0, ground_z - .01))
    for o in meshes:
        ao = o.data.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        o.data.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO')
    bpy.data.objects.remove(ground)
    seed = Vector((zlib.crc32(k.name.encode()) % 97, 13.7, 5.1))
    for o in meshes:
        me = o.data
        col = me.color_attributes['Col']
        ao = me.color_attributes['AO']
        mw = o.matrix_world
        mat = me.materials[0].name
        rot = mw.to_3x3()
        for poly in me.polygons:
            nrm = (rot @ poly.normal).normalized()
            for li in poly.loop_indices:
                p = mw @ me.vertices[me.loops[li].vertex_index].co - root.location
                a = max(0., min(1., ao.data[li].color[0]))
                c = col.data[li].color
                rgb = (c[0], c[1], c[2])
                if mat in ('glass', 'lamp'):
                    k_ = .8 + .2 * a
                elif mat == 'snow':
                    k_ = (.62 + .38 * a ** .8) * (.97 + .03 * pnoise(p * .8))
                else:
                    shade = .42 + .58 * a ** .85
                    weather = .94 + .07 * pnoise(p * .7 + seed) + .02 * pnoise(p * 4.1)
                    grime = max(0., 1 - p.z / k.grime) * .24 if k.grime else 0.
                    k_ = shade * weather * (1 - grime)
                    if k.burn:
                        s = max(0., min(1., pnoise(p * .6 + seed) * 2.2 + .45))
                        s = max(s, max(0., 1 - p.z / .8) * .6)
                        k_ *= 1 - .72 * s * k.burn
                    if k.single is None and mat in ('bronze',):
                        # verdigris creeping into the creases
                        v = (1 - a) * .5
                        rgb = (rgb[0] * (1 - .35 * v), rgb[1] * (1 + .25 * v), rgb[2] * (1 + .35 * v))
                rgb = tuple(max(.02, min(1., v * k_)) for v in rgb)
                if k.post:
                    rgb = k.post(p, nrm, rgb)
                col.data[li].color = (*rgb, 1.)
        me.color_attributes.remove(ao)
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.active_color_index


def local_bounds(root):
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
    return sum(len(p.vertices) - 2 for o in root.children_recursive if o.type == 'MESH'
               for p in o.data.polygons)


def export(root, path, quantise):
    loc = root.location.copy()
    root.location = (0, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_extras=True, export_yup=True, export_texcoords=False,
                              export_vertex_color='ACTIVE', export_apply=False,
                              export_materials='EXPORT')
    root.location = loc
    finish_glb(path, quantise)


def finish_glb(path, quantise):
    """Pin baseColorFactor to the named paint; optionally quantise normals and colours."""
    data = path.read_bytes()
    jlen = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack_from('<I', data, off)[0]
    src = data[off + 8:off + 8 + blen]
    for m in j.get('materials', []):
        pbr = m.setdefault('pbrMetallicRoughness', {})
        pbr.pop('baseColorTexture', None)
        if m['name'] in MATS:
            paint, rough, metal, emit = MATS[m['name']]
            pbr['baseColorFactor'] = [*factor(paint), 1.]
            pbr['roughnessFactor'] = rough
            pbr['metallicFactor'] = metal
            if emit:
                m['emissiveFactor'] = list(hexcol(emit))
        else:
            pbr['baseColorFactor'] = [1., 1., 1., 1.]
            pbr['metallicFactor'] = 0.
            pbr['roughnessFactor'] = .9
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
        raw = src[start:start + n * c * cs]
        stride = None
        if quantise and role.get(i) == 'normal' and acc['componentType'] == 5126:
            vals = struct.unpack(f'<{n * c}f', raw)
            buf = bytearray(n * 4)
            for q in range(n):
                struct.pack_into('<bbb', buf, q * 4, *(max(-127, min(127, round(vals[q * 3 + e] * 127)))
                                                     for e in range(3)))
            acc['componentType'] = 5120
            acc['normalized'] = True
            stride = 4
            quantised = True
        elif quantise and role.get(i) == 'color' and acc['componentType'] in (5126, 5123):
            if acc['componentType'] == 5126:
                vals = struct.unpack(f'<{n * c}f', raw)
            else:
                vals = [v / 65535 for v in struct.unpack(f'<{n * c}H', raw)]
            buf = bytearray(n * 4)
            for q in range(n):
                struct.pack_into('<BBBB', buf, q * 4, *(max(0, min(255, round(vals[q * c + e] * 255)))
                                                       for e in range(3)), 255)
            acc['componentType'] = 5121
            acc['normalized'] = True
            acc['type'] = 'VEC4'
            acc.pop('min', None)
            acc.pop('max', None)
            stride = 4
        else:
            buf = bytearray(raw)
        while len(out) % 4:
            out.append(0)
        view = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(buf)}
        if stride:
            view['byteStride'] = stride
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
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A)
                     + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out))


def fit_bounds(root, lo_t, hi_t):
    """Affinely remap a mesh so its bounds equal the target bounds exactly."""
    lo, hi = local_bounds(root)
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        for v in o.data.vertices:
            p = v.co
            v.co = Vector(tuple(lo_t[i] + (p[i] - lo[i]) * (hi_t[i] - lo_t[i]) / (hi[i] - lo[i])
                                for i in range(3)))
        o.data.update()


# ---------------------------------------------------------------- preview
def preview(roots):
    out = Path(PREVIEW)
    out.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.eevee.taa_render_samples = 32
    sc.render.resolution_x = sc.render.resolution_y = 720
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    world = sc.world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (.55, .66, .8, 1)
    bg.inputs['Strength'].default_value = .45
    sun_data = bpy.data.lights.new('preview_sun', 'SUN')
    sun_data.energy = 2.2
    sun_data.color = (1., .88, .72)
    sun_data.angle = math.radians(4)
    sun = bpy.data.objects.new('preview_sun', sun_data)
    sc.collection.objects.link(sun)
    sun.rotation_euler = Euler((math.radians(52), 0, math.radians(35)), 'XYZ')
    cam_data = bpy.data.cameras.new('preview_cam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('preview_cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    gm = bpy.data.materials.new('preview_ground')
    gm.use_nodes = True
    gbsdf = gm.node_tree.nodes.get('Principled BSDF')
    gme = bpy.data.meshes.new('preview_ground')
    g = bmesh.new()
    bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=60)
    g.to_mesh(gme)
    g.free()
    gme.materials.append(gm)
    ground = bpy.data.objects.new('preview_ground', gme)
    sc.collection.objects.link(ground)
    lamp = MATERIALS.get('lamp')
    if lamp:
        for n in lamp.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs['Emission Strength'].default_value = 6.
    for root, path_name, ground_z in roots:
        for r, _, _ in roots:
            hide = r is not root
            r.hide_render = hide
            for o in r.children_recursive:
                o.hide_render = hide
        is_water = root.name in ('boat', 'bridge_viaduct')
        gbsdf.inputs['Base Color'].default_value = (.12, .2, .26, 1) if is_water else (.42, .43, .36, 1)
        gbsdf.inputs['Roughness'].default_value = .3 if is_water else .95
        ground.location = root.location + Vector((0, 0, ground_z - .005))
        lo, hi = local_bounds(root)
        centre = root.location + (lo + hi) / 2
        radius = (hi - lo).length / 2
        d = Vector((1.4, -.55, .5) if root.name == 'bridge_viaduct' else (.95, -1.3, 1.05)).normalized()
        dist = radius / math.tan(math.radians(19.8)) * 1.02
        cam.location = centre + d * dist
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        cam_data.clip_end = dist * 4
        sc.render.filepath = str(out / f'{path_name}.png')
        bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------- main
def want(name):
    return not ONLY or name in ONLY


def main():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    PROPS.mkdir(parents=True, exist_ok=True)
    LAND.mkdir(parents=True, exist_ok=True)
    done = []
    report = []
    slot = 0
    for kind, builder in PROP_BUILDERS.items():
        if not want(kind):
            continue
        k = Kit(kind)
        builder(k)
        root, meshes = realise(k, Vector((slot * 80., 0, 0)))
        slot += 1
        bake(k, root, meshes, distance=1.6)
        path = PROPS / f'{kind}.glb'
        export(root, path, quantise=True)
        done.append((root, kind, 0.))
        lo, hi = local_bounds(root)
        report.append((kind, triangles(root), lo, hi, path.stat().st_size))
    if want('pine_tall') or want('pine_tall_lod'):
        near = Kit('pine_tall', single='pine_tall_baked')
        build_pine(near, lod=False)
        rn, mn = realise(near, Vector((slot * 80., 0, 0)), single_name='pine_tall_baked')
        bake(near, rn, mn, distance=.8)
        far = Kit('pine_tall_lod', single='pine_tall_baked')
        build_pine(far, lod=True)
        rf, mf = realise(far, Vector((slot * 80., 20., 0)), single_name='pine_tall_baked')
        bake(far, rf, mf, distance=.8)
        lo, hi = local_bounds(rn)
        fit_bounds(rf, lo, hi)
        slot += 1
        for root in (rn, rf):
            path = LAND / f'{root.name}.glb'
            export(root, path, quantise=False)
            done.append((root, root.name, 0.))
            l, h = local_bounds(root)
            report.append((root.name, triangles(root), l, h, path.stat().st_size))
    if want('bridge_viaduct'):
        k = Kit('bridge_viaduct', single='bridge_viaduct_baked')
        build_viaduct(k)
        root, meshes = realise(k, Vector((slot * 80., 0, 0)), single_name='bridge_viaduct_baked')
        bake(k, root, meshes, ground_z=-6.3, distance=1.6)
        path = LAND / 'bridge_viaduct.glb'
        export(root, path, quantise=False)
        done.append((root, 'bridge_viaduct', -6.3))
        l, h = local_bounds(root)
        report.append(('bridge_viaduct', triangles(root), l, h, path.stat().st_size))
    for name, tris, lo, hi, size in report:
        # Blender Z-up -> glTF Y-up: (x, y, z) -> (x, z, -y)
        print(f'PROP {name:16s} tris={tris:5d} size={size / 1024:6.1f}KB '
              f'x[{lo.x:.2f},{hi.x:.2f}] y[{lo.z:.2f},{hi.z:.2f}] z[{-hi.y:.2f},{-lo.y:.2f}]')
    if PREVIEW:
        preview(done)


main()
