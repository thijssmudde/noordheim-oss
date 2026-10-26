"""Living-diorama troops: seventeen chunky, heroic unit miniatures.

Builds every kind in TACTICAL_UNITS from scratch, bakes ambient occlusion and
weathering into the `Surface` vertex colours, exports one GLB per kind to
public/models/tactical, renders golden-hour UI portraits to public/art/tactical
and saves art/diorama-troops.blend.

    Blender -b --factory-startup -P art/blender/diorama_troops.py -- [kinds...]
        [--no-portraits] [--no-export] [--no-save] [--sheet=DIR]

Conventions (docs-rebuild.md rig contract):
- Authoring space is x right, y forward, z up; the exporter's Y-up conversion
  plus a 180 degree turn makes every model face glTF +Z.
- Rig pivots are empties with their geometry in a `geo_*` child mesh, so the
  renderer's rigid-part batching never merges an animated part:
  turret, barrel (recoils along its local -Z), muzzle (empty at the tip),
  torso, leg_left/leg_right, arm_left/arm_right, wheel_* (one node per axle,
  spins about local X), track_left/track_right, rotor_pivot*, tail_rotor_mount
  (holds rotor_pivot_tail, which spins about its local Y like the main rotor),
  cargo_fill (harvester load mesh; origin on the bin floor, scale Y).
- Colour lives in vertex colours over white materials (few draw calls);
  `culture_trim` keeps its own material for the commander's paint.
- Root extras: wheelRadius (m, for wheel spin), trackLength, category.
Blender keeps object names unique per file, so each unit is exported while its
names are exact and then prefixed `<kind>:` inside the saved .blend.
"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / 'public/models/tactical'
ICONS = ROOT / 'public/art/tactical'
BLEND = ROOT / 'art/diorama-troops.blend'
KINDS = ['ranger', 'rocket', 'harvester', 'lynx', 'tank', 'howitzer', 'jotun', 'drone', 'gunship',
         'raider', 'snowmobile', 'sapper', 'mortar', 'militia', 'bulwark', 'marksman', 'fenrir']
FACTION = {'raider': 'fjordborn', 'snowmobile': 'fjordborn', 'sapper': 'ironclad', 'mortar': 'ironclad',
           'militia': 'hearthkin', 'bulwark': 'hearthkin', 'marksman': 'ashwalkers', 'fenrir': 'ashwalkers'}
TRIM_PREVIEW = {'core': 'c4452c', 'fjordborn': '2f93b0', 'ironclad': '8c58a8', 'hearthkin': '86a832',
                'ashwalkers': 'e0782e'}

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
FLAGS = {a[2:].split('=')[0]: (a.split('=', 1)[1] if '=' in a else True) for a in argv if a.startswith('--')}
ONLY = [a for a in argv if not a.startswith('--')] or KINDS


def lin(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def rgb(h):
    return Vector(tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)))


T = {k: rgb(v) for k, v in dict(
    SNOW='e2ddd0', SLATE='5a6671', OLIVE='6e7049', KHAKI='948a60', SAND='b39b6c', ASH='8f8d86',
    STEEL='98a1a8', GUN='3a3f45', DARK='25282b', TYRE='34373a', CANVAS='82795a', WEB='4f4f40',
    LEATHER='6e4b33', BRASS='d0a84c', ORANGE='ff8f3a', RED='9a3326', HAZ='f0b93a', BOOT='302b26',
    FUR='dcd2bc', GHILLIE='6d6742', RUST='83503a', IRON='5e656e', WHITE='ffffff', SKIN='d9a782',
    GLASS='3f7ea0', LAMP='ffe2a6', BLUE='40627a', CREAM='efe6cf', UMBER='5a4331', MOSS='5d6a38',
).items()}
MUD = Vector((.74, .62, .47))
SCHEMES = {
    'winter': ('SNOW', 'SLATE', 'OLIVE'),
    'fjord': ('SNOW', 'BLUE', 'SLATE'),
    'iron': ('IRON', 'GUN', 'RUST'),
    'hearth': ('KHAKI', 'OLIVE', 'UMBER'),
    'ash': ('ASH', 'SAND', 'UMBER'),
}

# ---------------------------------------------------------------- materials
bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {}


def material(name, rough, metal=0., emit=0., base='ffffff'):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes['Principled BSDF']
    col = tuple(rgb(base)) + (1,)
    m.diffuse_color = col
    bs.inputs['Base Color'].default_value = col
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if emit:
        bs.inputs['Emission Color'].default_value = tuple(T['LAMP']) + (1,) if name == 'light' else col
        bs.inputs['Emission Strength'].default_value = emit
    attr = nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Surface'
    attr.name = 'Surface'
    if name == 'culture_trim':
        # The runtime tints this per commander; the GLB keeps a plain factor and
        # renders multiply the baked occlusion in only while previewing.
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.name = 'Preview multiply'
        mix.inputs['Factor'].default_value = 1
        links.new(attr.outputs['Color'], mix.inputs['B'])
    else:
        links.new(attr.outputs['Color'], bs.inputs['Base Color'])
    MATS[name] = m
    return m


material('paint', .6, .08)
material('metal', .42, .6)
material('rubber', .92)
material('cloth', .95)
material('skin', .7)
material('glass', .1, .35)
material('light', .3, 0, 3.0)
material('wood', .85)
material('culture_trim', .5, .05, .12, 'c4452c')
material('harvester_ore', .88, .12)


def trim_preview(on, hexc=None):
    m = MATS['culture_trim']
    nt = m.node_tree
    bs, mix = nt.nodes['Principled BSDF'], nt.nodes['Preview multiply']
    if hexc:
        c = tuple(rgb(hexc)) + (1,)
        mix.inputs['A'].default_value = c
        bs.inputs['Base Color'].default_value = c
        bs.inputs['Emission Color'].default_value = c
    for l in list(bs.inputs['Base Color'].links):
        nt.links.remove(l)
    if on:
        nt.links.new(mix.outputs['Result'], bs.inputs['Base Color'])


# ---------------------------------------------------------------- geometry
C = Matrix.Rotation(math.pi, 4, 'Z')
CI = C.inverted()
U = None  # the unit being authored


class Node:
    def __init__(self, name, parent=None, pivot=(0, 0, 0), rot=None, mesh=False, occluder=True):
        self.name, self.parent, self.mesh, self.occluder = name, parent, mesh, occluder
        R = Euler(rot).to_matrix().to_4x4() if rot else Matrix.Identity(4)
        self.W = Matrix.Translation(Vector(pivot)) @ R
        self.verts, self.faces, self.fmat, self.ftint = [], [], [], []
        U.nodes.append(self)


class Unit:
    def __init__(self, kind, category, scheme='winter', camo_scale=1., dirt=1.1, ao=1.3, ground=True):
        global U
        U = self
        self.kind, self.category = kind, category
        self.scheme, self.camo_scale, self.dirt, self.ao, self.ground = SCHEMES[scheme], camo_scale, dirt, ao, ground
        self.seed = sum(ord(c) for c in kind) * .37
        self.nodes, self.extras = [], {'category': category}
        self.root = Node(kind)


def camo_tint(p):
    k, s = U.camo_scale, U.seed
    x, y, z = p.x * k, p.y * k, p.z * k
    n = math.sin(.9 * x + s) + .9 * math.sin(.75 * y + 1.6 * z + 2 * s) + .8 * math.sin(.6 * (x - y) + 1.1 * z + 3 * s)
    base, a, b = U.scheme
    return T[a] if n > .7 else T[b] if n < -.85 else T[base]


def tint_of(mat, tint):
    if mat == 'culture_trim' or tint is None:
        return T['WHITE']
    return tint if isinstance(tint, Vector) else T[tint]


def emit(node, bm, M, mat, tint, camo=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.index_update()
    off = len(node.verts)
    node.verts += [M @ v.co for v in bm.verts]
    t = tint_of(mat, tint)
    for f in bm.faces:
        idx = [off + v.index for v in f.verts]
        node.faces.append(idx)
        node.fmat.append(mat)
        if camo and mat != 'culture_trim':
            node.ftint.append(camo_tint(sum((node.verts[i] for i in idx), Vector()) / len(idx)))
        else:
            node.ftint.append(t)
    bm.free()


def bevel(bm, w, segs=1, ang=.5):
    if w <= 0:
        return
    es = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > ang]
    if es:
        bmesh.ops.bevel(bm, geom=es, offset=w, offset_type='OFFSET', segments=segs, profile=.5,
                        affect='EDGES', clamp_overlap=True)


def place(c, rot=None):
    M = Matrix.Translation(Vector(c))
    return M @ Euler(rot).to_matrix().to_4x4() if rot else M


def box(node, mat, c, s, tint='SNOW', bw=.05, segs=1, taper=(1, 1), shift=(0, 0), rot=None, camo=False, cuts=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        x, y, z = v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]
        if v.co.z > 0:
            x, y = x * taper[0] + shift[0], y * taper[1] + shift[1]
        v.co = Vector((x, y, z))
    if cuts is None:
        cuts = min(3, int(max(s) / 1.0)) if camo else 0
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bevel(bm, min(bw, min(s) * .3), segs)
    emit(node, bm, place(c, rot), mat, tint, camo)


def cyl(node, mat, a, b, r, r2=None, tint='GUN', n=12, bw=0., camo=False):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r,
                          radius2=max(.002, r if r2 is None else r2), depth=d.length)
    bevel(bm, min(bw, r * .3), 1, .6)
    M = Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    emit(node, bm, M, mat, tint, camo)


def ball(node, mat, c, s, tint='SNOW', n=10, rings=6, rot=None, cut=None, camo=False):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=n, v_segments=rings, radius=1)
    if cut is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut - 1e-4], context='VERTS')
        bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)
    for v in bm.verts:
        v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
    emit(node, bm, place(c, rot), mat, tint, camo)


def prism(node, mat, prof, x0, x1, tint='SNOW', bw=.05, camo=False, c=(0, 0, 0), rot=None, cuts=0):
    """Extrude a (y, z) side profile across x0..x1: hull plates, blades, wedges."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in prof]
    b = [bm.verts.new((x1, y, z)) for y, z in prof]
    bm.faces.new(a)
    bm.faces.new(b)
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        bm.faces.new((a[i], a[j], b[j], b[i]))
    if camo and not cuts:
        cuts = 2
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bevel(bm, bw, 1, .45)
    emit(node, bm, place(c, rot), mat, tint, camo)


def ring(node, mat, c, ro, ri, h, tint='SNOW', n=16, rot=None):
    bm = bmesh.new()
    L = []
    for r, z in ((ro, -h / 2), (ro, h / 2), (ri, h / 2), (ri, -h / 2)):
        L.append([bm.verts.new((r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z)) for i in range(n)])
    for k in range(4):
        A, B = L[k], L[(k + 1) % 4]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((A[i], A[j], B[j], B[i]))
    emit(node, bm, place(c, rot), mat, tint)


def band(node, mat, path, x0, x1, th, tint):
    """Closed belt: path is [(y, z, ny, nz)] along the outside; th inward."""
    bm = bmesh.new()
    O0 = [bm.verts.new((x0, y, z)) for y, z, _, _ in path]
    O1 = [bm.verts.new((x1, y, z)) for y, z, _, _ in path]
    I0 = [bm.verts.new((x0, y - ny * th, z - nz * th)) for y, z, ny, nz in path]
    I1 = [bm.verts.new((x1, y - ny * th, z - nz * th)) for y, z, ny, nz in path]
    for i in range(len(path)):
        j = (i + 1) % len(path)
        for A, B in ((O0, O1), (O1, I1), (I1, I0), (I0, O0)):
            bm.faces.new((A[i], A[j], B[j], B[i]))
    emit(node, bm, Matrix.Identity(4), mat, tint)


def stadium(yf, yr, zf, zr, rf, rr, n=7):
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((yf + rf * math.cos(a), zf + rf * math.sin(a), math.cos(a), math.sin(a)))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((yr + rr * math.cos(a), zr + rr * math.sin(a), math.cos(a), math.sin(a)))
    return pts


# ---------------------------------------------------------------- kit parts
def track(side, x, w, L, r, wheels=5, z0=.03, parent=None, node=None, rise=.22):
    """Stadium track with cleats, road wheels, sprocket and raised idler."""
    node = node or Node('track_left' if side < 0 else 'track_right', parent or U.root, (x, 0, z0 + r))
    yf, yr = L / 2 - r * .8, -(L / 2 - r)
    rf = r * .8
    path = stadium(yf, yr, z0 + rf + rise, z0 + r, rf, r)
    band(node, 'rubber', path, x - w / 2, x + w / 2, .17, 'TYRE')
    # Cleats every ~0.36 m around the outside of the belt.
    pts = [(Vector((0, p[0], p[1])), Vector((0, p[2], p[3]))) for p in path]
    carry = 0.
    for i in range(len(pts)):
        (a, na), (b, nb) = pts[i], pts[(i + 1) % len(pts)]
        seg = (b - a).length
        t = carry
        while t < seg:
            p = a.lerp(b, t / seg)
            nrm = na.lerp(nb, t / seg).normalized()
            ang = math.atan2(b.z - a.z, b.y - a.y)
            box(node, 'rubber', (x, p.y + nrm.y * .03, p.z + nrm.z * .03), (w * 1.04, .15, .09), 'GUN', 0, rot=(ang, 0, 0))
            t += .36
        carry = t - seg
    zc = z0 + .17 + r * .72
    for i in range(wheels):
        y = yr + (yf - yr) * i / (wheels - 1)
        cyl(node, 'metal', (x - w * .44, y, zc), (x + w * .44, y, zc), r * .72, tint='STEEL', n=12, bw=.04)
        cyl(node, 'metal', (x, y, zc), (x + side * (w / 2 + .05), y, zc), r * .3, tint='GUN', n=8)
    cyl(node, 'metal', (x - w * .45, yr, z0 + r), (x + w * .45, yr, z0 + r), r * .78, tint='GUN', n=10, bw=.04)
    for k in range(8):
        a = k * math.pi / 4
        box(node, 'metal', (x, yr + math.cos(a) * r * .8, z0 + r + math.sin(a) * r * .8), (w * .5, .14, .14), 'GUN', 0, rot=(a, 0, 0))
    cyl(node, 'metal', (x - w * .42, yf, z0 + rf + rise), (x + w * .42, yf, z0 + rf + rise), rf * .78, tint='STEEL', n=10, bw=.04)
    U.extras['trackLength'] = round(L, 2)
    return node


def axle(name, y, z, r, w, xs, n=14, rim='STEEL'):
    node = Node(name, U.root, (0, y, z))
    for x in xs:
        side = 1 if x > 0 else -1
        cyl(node, 'rubber', (x - w / 2, y, z), (x + w / 2, y, z), r * .94, tint='TYRE', n=n, bw=.07)
        for i in range(n):
            a = 2 * math.pi * (i + .5) / n
            for half in (-1, 1):
                box(node, 'rubber', (x + half * w * .24, y + math.cos(a) * r * .93, z + math.sin(a) * r * .93),
                    (w * .46, .2, .13), 'DARK', 0, rot=(a + math.pi / 2 + half * .25, 0, 0))
        cyl(node, 'metal', (x, y, z), (x + side * (w / 2 + .04), y, z), r * .56, tint=rim, n=10, bw=.03)
        cyl(node, 'metal', (x, y, z), (x + side * (w / 2 + .12), y, z), r * .2, tint='GUN', n=6)
    U.extras['wheelRadius'] = round(r, 3)
    return node


def lamp(node, c, s=(.3, .08, .2)):
    box(node, 'metal', (c[0], c[1] - .06, c[2]), (s[0] + .08, .12, s[2] + .08), 'GUN', .02)
    box(node, 'light', c, s, 'LAMP', .02)


def jerrycan(node, c, tint='OLIVE', rz=0):
    box(node, 'paint', c, (.22, .5, .6), tint, .04, rot=(0, 0, rz))


def crate(node, c, s, tint='CANVAS', mat='cloth'):
    box(node, mat, c, s, tint, .06)
    box(node, 'cloth', (c[0], c[1], c[2] + s[2] * .02), (s[0] + .04, .08, s[2] + .04), 'WEB', 0)


def roll(node, a, b, r, tint='CANVAS'):
    cyl(node, 'cloth', a, b, r, tint=tint, n=10, bw=.03)
    for t in (.25, .75):
        p = Vector(a).lerp(Vector(b), t)
        d = (Vector(b) - Vector(a)).normalized() * .05
        cyl(node, 'cloth', p - d, p + d, r * 1.08, tint='WEB', n=10)


def antenna(node, base, h, r=.03):
    cyl(node, 'metal', base, (base[0], base[1] - .05, base[2] + h), r, r * .5, 'DARK', n=5)
    ball(node, 'metal', (base[0], base[1] - .05, base[2] + h), (.06, .06, .06), 'DARK', 6, 4)


def muzzle(parent, p):
    Node('muzzle', parent, p)


def crew(node, c, s=1., helmet='SNOW', arms=True, lean=0.):
    x, y, z = c
    box(node, 'culture_trim', (x, y, z + .38 * s), (.78 * s, .5 * s, .76 * s), bw=.08 * s, taper=(1.12, 1.05), shift=(0, lean))
    box(node, 'cloth', (x, y + .2 * s + lean, z + .45 * s), (.6 * s, .1 * s, .4 * s), 'WEB', .03)
    ball(node, 'skin', (x, y + .04 * s + lean, z + .98 * s), (.23 * s, .23 * s, .25 * s), 'SKIN', 8, 5)
    ball(node, 'paint', (x, y + lean, z + 1.05 * s), (.33 * s, .35 * s, .27 * s), helmet, 9, 6, cut=0)
    box(node, 'glass', (x, y + .28 * s + lean, z + 1.12 * s), (.3 * s, .06 * s, .09 * s), 'ORANGE', .02)
    if arms:
        for side in (-1, 1):
            cyl(node, 'culture_trim', (x + side * .45 * s, y + lean, z + .7 * s),
                (x + side * .32 * s, y + .45 * s + lean, z + .45 * s), .13 * s, .11 * s, n=7)
            ball(node, 'cloth', (x + side * .3 * s, y + .5 * s + lean, z + .44 * s), (.11 * s,) * 3, 'WEB', 7, 4)


# ---------------------------------------------------------------- infantry
HIP = 1.28
POSES = {
    # right elbow, right hand, left elbow, left hand
    'rifle': ((.64, .12, 1.66), (.24, .44, 1.74), (-.52, .5, 1.72), (-.04, .98, 1.86)),
    'smg': ((.62, .14, 1.62), (.22, .42, 1.66), (-.5, .42, 1.64), (-.02, .78, 1.72)),
    'launcher': ((.66, .02, 1.84), (.4, .28, 2.12), (-.38, .52, 1.86), (.18, .84, 2.14)),
    'sniper': ((.62, .16, 1.8), (.22, .4, 1.9), (-.46, .6, 1.84), (-.02, 1.1, 1.96)),
    'hunting': ((.62, .1, 1.62), (.24, .4, 1.7), (-.5, .46, 1.7), (-.04, .95, 1.8)),
}


def rifle(n, style='rifle'):
    x = .14
    if style == 'rifle':
        box(n, 'metal', (x, .72, 1.84), (.15, .95, .22), 'GUN', .03)
        box(n, 'metal', (x + .02, .22, 1.8), (.13, .48, .24), 'DARK', .03, taper=(1, .9))
        cyl(n, 'metal', (x, 1.18, 1.87), (x, 1.9, 1.87), .045, tint='DARK', n=6)
        cyl(n, 'metal', (x, 1.84, 1.87), (x, 1.98, 1.87), .07, tint='DARK', n=6)
        box(n, 'metal', (x, .66, 1.63), (.1, .18, .3), 'DARK', .02, rot=(.25, 0, 0))
        box(n, 'metal', (x, .6, 2.0), (.08, .22, .1), 'DARK', .02)
        box(n, 'cloth', (x, 1.02, 1.84), (.17, .38, .2), 'OLIVE', .03)
        muzzle(n, (x, 2.0, 1.87))
    elif style == 'smg':
        box(n, 'metal', (x, .66, 1.72), (.16, .72, .22), 'GUN', .03)
        cyl(n, 'metal', (x, 1.0, 1.75), (x, 1.36, 1.75), .06, tint='DARK', n=6)
        box(n, 'metal', (x, .56, 1.5), (.1, .14, .36), 'DARK', .02, rot=(-.1, 0, 0))
        box(n, 'metal', (x, .2, 1.72), (.08, .38, .1), 'DARK', .02)
        muzzle(n, (x, 1.4, 1.75))
    elif style == 'sniper':
        box(n, 'metal', (x, .78, 1.97), (.14, 1.0, .2), 'OLIVE', .03)
        box(n, 'metal', (x + .02, .2, 1.92), (.13, .5, .26), 'UMBER', .03, taper=(1, .85))
        cyl(n, 'metal', (x, 1.25, 2.0), (x, 2.55, 2.0), .045, tint='DARK', n=6)
        cyl(n, 'metal', (x, 2.48, 2.0), (x, 2.66, 2.0), .075, tint='DARK', n=6)
        cyl(n, 'metal', (x, .45, 2.2), (x, 1.05, 2.2), .08, tint='DARK', n=8)
        cyl(n, 'glass', (x, 1.05, 2.2), (x, 1.08, 2.2), .1, tint='GLASS', n=8)
        for s in (-1, 1):
            cyl(n, 'metal', (x, 1.3, 1.9), (x + s * .1, 1.9, 1.86), .025, tint='DARK', n=4)
        muzzle(n, (x, 2.7, 2.0))
    elif style == 'hunting':
        box(n, 'wood', (x, .3, 1.76), (.13, .6, .24), 'WHITE', .04, taper=(1, .85))
        box(n, 'wood', (x, 1.02, 1.78), (.12, .7, .14), 'WHITE', .03)
        box(n, 'metal', (x, .72, 1.84), (.13, .4, .14), 'GUN', .02)
        cyl(n, 'metal', (x, .9, 1.88), (x, 1.95, 1.88), .045, tint='DARK', n=6)
        cyl(n, 'metal', (x, .55, 1.97), (x, .95, 1.97), .05, tint='DARK', n=6)
        muzzle(n, (x, 1.98, 1.88))


def soldier(kind, weapon='rifle', head='helmet', scheme='winter', trousers=None, bulky=1.):
    Unit(kind, 'infantry', scheme, camo_scale=2.6, dirt=.45, ao=.55)
    root = U.root
    trous = trousers
    for name, x in (('leg_left', -.26), ('leg_right', .26)):
        leg = Node(name, root, (x, 0, HIP))
        w = .38 * bulky
        box(leg, 'cloth', (x, 0, 1.0), (w, .42, .62), trous or 'SNOW', .07, taper=(1.08, 1.05), camo=not trous, cuts=1)
        box(leg, 'cloth', (x, .02, .5), (w * .88, .37, .48), trous or 'SNOW', .06, taper=(1.12, 1.05), camo=not trous, cuts=1)
        box(leg, 'cloth', (x, .21, .74), (w * .72, .1, .22), 'WEB', .03)
        box(leg, 'cloth', (x, .08, .15), (w + .02, .66, .3), 'BOOT', .07, taper=(.92, .78), shift=(0, -.07))
        box(leg, 'cloth', (x, .09, .03), (w + .05, .7, .06), 'DARK', .02)
    torso = Node('torso', root, (0, 0, HIP))
    b = bulky
    box(torso, 'cloth', (0, 0, 1.38), (.8 * b, .5, .32), trous or 'SNOW', .07, camo=not trous, cuts=1)
    box(torso, 'culture_trim', (0, 0, 1.8), (.96 * b, .6, .74), bw=.12, segs=2, taper=(1.12, 1.04))
    box(torso, 'culture_trim', (0, 0, 1.44), (.9 * b, .58, .24), bw=.08)
    box(torso, 'cloth', (0, 0, 1.3), (.84 * b, .56, .1), 'LEATHER' if head in ('cap',) else 'WEB', .03)
    box(torso, 'metal', (0, .3, 1.3), (.12, .04, .09), 'BRASS', .01)
    for s in (-1, 1):
        ball(torso, 'culture_trim', (s * .52 * b, 0, 2.08), (.25 * b, .27, .21), n=8, rings=5)
    # Head and neck.
    ball(torso, 'skin', (0, .03, 2.42), (.25, .25, .27), 'SKIN', 10, 6)
    U._torso = torso
    return torso


def arms(torso, pose, sleeve='culture_trim', glove='WEB', shoulder=.55):
    re, rh, le, lh = POSES[pose]
    for name, sh, el, ha in (('arm_right', (shoulder, 0, 2.06), re, rh), ('arm_left', (-shoulder, 0, 2.06), le, lh)):
        a = Node(name, torso, sh)
        mat = 'culture_trim' if sleeve == 'culture_trim' else 'cloth'
        cyl(a, mat, sh, el, .17, .15, tint=sleeve, n=8)
        ball(a, mat, el, (.16, .16, .16), sleeve, 8, 5)
        cyl(a, mat, el, ha, .15, .12, tint=sleeve, n=8)
        ball(a, 'cloth', ha, (.13, .14, .13), glove, 8, 5)


def helmet(torso, tint='SNOW', goggles='ORANGE', camo=True):
    ball(torso, 'paint', (0, 0, 2.5), (.39, .41, .32), tint, 12, 6, cut=0, camo=camo)
    ring(torso, 'paint', (0, 0, 2.51), .43, .3, .07, 'SLATE' if tint == 'SNOW' else 'DARK', 12)
    if goggles:
        box(torso, 'glass', (0, .3, 2.66), (.36, .1, .12), goggles, .03, rot=(.4, 0, 0))
        box(torso, 'cloth', (0, .02, 2.66), (.8, .62, .05), 'DARK', 0, taper=(1, 1))


def pack(torso, tint='CANVAS', roll_tint='OLIVE', h=.64):
    box(torso, 'cloth', (0, -.44, 1.82), (.72, .36, h), tint, .08, taper=(.92, .9))
    box(torso, 'cloth', (0, -.64, 1.7), (.5, .1, .3), 'WEB', .04)
    roll(torso, (-.4, -.44, 1.82 + h / 2 + .1), (.4, -.44, 1.82 + h / 2 + .1), .13, roll_tint)


def chest_rig(torso, tint='WEB', pouches=3):
    box(torso, 'cloth', (0, .31, 1.8), (.76, .09, .52), tint, .03)
    for i in range(pouches):
        x = (i - (pouches - 1) / 2) * .22
        box(torso, 'cloth', (x, .38, 1.68), (.18, .1, .22), 'OLIVE', .03)
    for s in (-1, 1):
        box(torso, 'cloth', (s * .26, 0, 2.16), (.1, .64, .06), tint, 0)


def ranger():
    t = soldier('ranger')
    helmet(t)
    chest_rig(t)
    pack(t)
    box(t, 'cloth', (0, 0, 2.2), (.52, .5, .12), 'OLIVE', .04)
    rifle(t, 'rifle')
    arms(t, 'rifle')


def rocket():
    t = soldier('rocket')
    helmet(t, 'SNOW', 'GLASS')
    chest_rig(t, pouches=2)
    pack(t, 'CANVAS', 'SLATE', .7)
    for x in (-.2, .2):
        cyl(t, 'paint', (x, -.62, 1.5), (x, -.62, 2.2), .1, tint='OLIVE', n=8)
        cyl(t, 'paint', (x, -.62, 2.2), (x, -.62, 2.45), .1, .02, tint='ORANGE', n=8)
    x, z = .4, 2.34
    cyl(t, 'paint', (x, -.75, z), (x, 1.3, z), .17, tint='OLIVE', n=10, bw=.03)
    cyl(t, 'paint', (x, -.95, z), (x, -.75, z), .21, .17, tint='DARK', n=10)
    cyl(t, 'paint', (x, 1.3, z), (x, 1.48, z), .22, tint='DARK', n=10)
    cyl(t, 'paint', (x, 1.48, z), (x, 1.95, z), .2, .05, tint='ORANGE', n=10)
    box(t, 'metal', (x - .22, .35, z + .12), (.12, .36, .18), 'DARK', .02)
    box(t, 'glass', (x - .22, .54, z + .12), (.1, .03, .12), 'GLASS', 0)
    box(t, 'metal', (x, .28, z - .24), (.1, .14, .3), 'DARK', .02)
    box(t, 'metal', (x, .8, z - .22), (.09, .12, .26), 'DARK', .02)
    muzzle(t, (x, 1.98, z))
    arms(t, 'launcher')


def raider():
    t = soldier('raider', 'smg', 'hood', 'fjord', trousers='SNOW')
    # Fur-ruffed snow hood over a white anorak yoke.
    ball(t, 'cloth', (0, -.04, 2.5), (.42, .44, .38), 'SNOW', 12, 6, cut=-.35)
    ring(t, 'cloth', (0, .17, 2.46), .33, .2, .16, 'FUR', 10, rot=(math.pi / 2 - .25, 0, 0))
    box(t, 'glass', (0, .27, 2.5), (.34, .08, .1), 'ORANGE', .03)
    box(t, 'cloth', (0, 0, 2.08), (1.02, .64, .2), 'SNOW', .08)
    box(t, 'culture_trim', (0, 0, 1.28), (.94, .6, .22), bw=.06)
    # Skis and poles strapped on the pack: a tall, unmistakable silhouette.
    pack(t, 'SNOW', 'BLUE', .6)
    for s in (-1, 1):
        box(t, 'paint', (s * .16, -.66, 2.0), (.13, .06, 2.3), 'RED', .02, rot=(0, s * .12, 0))
        box(t, 'paint', (s * .3, -.66, 3.1), (.13, .12, .14), 'RED', .02, rot=(.6, s * .12, 0))
    box(t, 'cloth', (-.46, .1, 1.38), (.2, .42, .34), 'CANVAS', .04)
    box(t, 'paint', (-.46, .3, 1.5), (.16, .06, .1), 'ORANGE', .01)
    cyl(t, 'cloth', (-.4, .05, 1.55), (.3, .0, 2.12), .04, tint='WEB', n=4)
    rifle(t, 'smg')
    arms(t, 'smg')


def sapper():
    t = soldier('sapper', 'rifle', 'blast', 'iron', trousers='GUN', bulky=1.12)
    # Blast helmet with visor, riveted plate armour and breaching charges.
    box(t, 'paint', (0, 0, 2.58), (.66, .7, .48), 'IRON', .1, segs=2, taper=(.86, .86))
    box(t, 'glass', (0, .33, 2.52), (.5, .08, .18), 'ORANGE', .03)
    box(t, 'paint', (0, .02, 2.84), (.36, .5, .06), 'GUN', .02)
    box(t, 'metal', (0, .33, 1.86), (.84, .12, .56), 'IRON', .06, taper=(.9, 1))
    for s in (-1, 1):
        box(t, 'metal', (s * .6, 0, 2.14), (.34, .62, .14), 'IRON', .05, rot=(0, s * .35, 0))
        for zz in (1.68, 2.0):
            ball(t, 'metal', (s * .3, .4, zz), (.035,) * 3, 'BRASS', 5, 3)
    for i, x in enumerate((-.24, 0, .24)):
        box(t, 'paint', (x, .42, 1.62), (.2, .1, .2), 'ORANGE', .02)
        cyl(t, 'cloth', (x, .47, 1.72), (x, .47, 1.86), .02, tint='DARK', n=4)
    box(t, 'metal', (0, -.46, 1.84), (.78, .4, .7), 'IRON', .07)
    for x in (-.2, .2):
        cyl(t, 'paint', (x, -.5, 2.2), (x, -.5, 2.62), .13, tint='ORANGE', n=8)
    cyl(t, 'cloth', (-.3, -.7, 1.55), (.3, -.7, 1.55), .16, tint='DARK', n=10)
    rifle(t, 'smg')
    arms(t, 'smg', shoulder=.6)


def militia():
    t = soldier('militia', 'hunting', 'cap', 'hearth', trousers='UMBER')
    # Wool coat to the knee, knitted scarf and a fur trapper hat.
    box(t, 'culture_trim', (0, 0, 1.12), (.98, .64, .5), bw=.08, taper=(.94, .96))
    cyl(t, 'cloth', (0, 0, 2.62), (0, 0, 2.82), .34, .32, tint='FUR', n=10, bw=.05)
    box(t, 'cloth', (0, .02, 2.62), (.78, .58, .2), 'UMBER', .06)
    for s in (-1, 1):
        box(t, 'cloth', (s * .3, .02, 2.42), (.1, .3, .3), 'UMBER', .04)
    box(t, 'cloth', (0, 0, 2.2), (.62, .56, .18), 'CREAM', .06)
    box(t, 'cloth', (.16, .26, 1.96), (.18, .08, .46), 'CREAM', .03, rot=(0, .2, 0))
    box(t, 'cloth', (0, .31, 1.9), (.12, .06, .7), 'LEATHER', 0, rot=(0, .7, 0))
    box(t, 'cloth', (.42, -.1, 1.36), (.22, .4, .34), 'LEATHER', .05)
    box(t, 'cloth', (0, -.42, 1.78), (.62, .32, .52), 'LEATHER', .07)
    roll(t, (-.36, -.42, 2.14), (.36, -.42, 2.14), .12, 'CREAM')
    rifle(t, 'hunting')
    arms(t, 'hunting')


def marksman():
    t = soldier('marksman', 'sniper', 'ghillie', 'ash', trousers='UMBER')
    # Ghillie hood and cloak: shaggy strips break the outline from above.
    ball(t, 'cloth', (0, -.05, 2.5), (.44, .46, .4), 'GHILLIE', 12, 6, cut=-.3)
    box(t, 'cloth', (0, .26, 2.42), (.3, .06, .16), 'DARK', .02)
    prism(t, 'cloth', [(-.5, 2.25), (.1, 2.25), (.0, 1.9), (-.75, 1.0), (-.5, 1.0)], -.58, .58, 'GHILLIE', .04)
    import random
    rng = random.Random(7)
    for i in range(22):
        x = rng.uniform(-.6, .6)
        y = rng.uniform(-.72, -.35)
        z = rng.uniform(1.1, 2.3)
        box(t, 'cloth', (x, y, z), (.07, .05, rng.uniform(.3, .55)), rng.choice(['GHILLIE', 'MOSS', 'UMBER', 'SAND']), 0,
            rot=(rng.uniform(-.4, .4), rng.uniform(-.4, .4), 0))
    for s in (-1, 1):
        box(t, 'cloth', (s * .5, .05, 2.1), (.36, .66, .16), 'GHILLIE', .04, rot=(0, s * .5, 0))
    box(t, 'cloth', (0, .31, 1.78), (.66, .08, .4), 'LEATHER', .03)
    rifle(t, 'sniper')
    arms(t, 'sniper')


# ---------------------------------------------------------------- vehicles
def headlights(node, y, z, xs):
    for x in xs:
        lamp(node, (x, y, z))


def tank():
    u = Unit('tank', 'vehicle', 'winter')
    r = u.root
    for s in (-1, 1):
        track(s, s * 1.55, .92, 5.9, .52, 6)
    box(r, 'paint', (0, 0, .95), (2.3, 5.5, .8), 'SLATE', .08)
    prism(r, 'paint', [(-2.95, 1.02), (2.7, 1.02), (3.1, 1.3), (1.8, 1.72), (-2.85, 1.72), (-3.0, 1.45)], -2.02, 2.02, bw=.08, camo=True)
    for s in (-1, 1):
        prism(r, 'paint', [(-2.8, .7), (2.55, .7), (2.95, 1.1), (-2.95, 1.1)], s * 2.0, s * 2.12, bw=.03, camo=True)
        box(r, 'culture_trim', (s * 2.14, -.2, .9), (.05, 3.6, .32), bw=.02)
        for y in (-2.3, -1.1, .1, 1.3):
            ball(r, 'metal', (s * 2.14, y, 1.06), (.04,) * 3, 'STEEL', 5, 3)
    # Recognition panel on the rear deck and a chevron on the glacis.
    box(r, 'culture_trim', (0, -2.1, 1.74), (1.9, .9, .04), bw=.02)
    for s in (-1, 1):
        box(r, 'culture_trim', (s * .45, 2.35, 1.5), (.9, .22, .05), bw=.01, rot=(-.33, 0, s * .45))
    for i in range(6):
        box(r, 'metal', (0, -2.55 + i * .1, 1.75), (1.6, .05, .04), 'DARK', 0)
    for s in (-1, 1):
        cyl(r, 'metal', (s * 1.2, -2.95, 1.35), (s * 1.2, -3.12, 1.35), .16, tint='DARK', n=8)
        headlights(r, 2.62, 1.42, [s * 1.55])
        jerrycan(r, (s * 1.7, -2.6, 2.0), 'OLIVE')
        box(r, 'metal', (s * .9, 3.02, 1.15), (.25, .22, .18), 'GUN', .03)
    roll(r, (-1.2, -1.5, 1.9), (1.2, -1.5, 1.9), .2, 'CANVAS')
    t = Node('turret', r, (0, -.25, 1.72))
    box(t, 'paint', (0, -.3, 2.14), (2.55, 3.3, .86), bw=.12, segs=2, taper=(.86, .86), shift=(0, -.08), camo=True)
    box(t, 'paint', (0, 1.5, 2.08), (2.3, .8, .7), bw=.08, taper=(.84, .45), shift=(0, -.18), camo=True)
    box(t, 'paint', (0, -2.1, 2.14), (2.1, .7, .64), bw=.06, camo=True)
    for s in (-1, 1):
        box(t, 'culture_trim', (s * 1.2, -.4, 2.1), (.06, 2.5, .44), bw=.02, rot=(0, s * .14, 0))
        for i in range(3):
            cyl(t, 'metal', (s * 1.02, 1.1 - i * .2, 2.3), (s * 1.18, 1.3 - i * .2, 2.45), .07, tint='DARK', n=6)
    box(t, 'culture_trim', (.3, -1.0, 2.58), (1.5, 1.2, .04), bw=.02)
    cyl(t, 'paint', (-.55, -.55, 2.5), (-.55, -.55, 2.82), .42, .36, tint='SLATE', n=10, bw=.04)
    cyl(t, 'metal', (-.55, -.55, 2.82), (-.55, -.55, 2.88), .32, tint='GUN', n=10)
    box(t, 'metal', (-.55, -.1, 3.0), (.12, .7, .14), 'DARK', .02)
    cyl(t, 'metal', (-.55, .2, 3.0), (-.55, .9, 3.0), .04, tint='DARK', n=6)
    box(t, 'glass', (.5, .4, 2.66), (.4, .4, .22), 'GLASS', .04)
    box(t, 'metal', (.5, .4, 2.62), (.46, .46, .14), 'GUN', .03)
    for x in (-.8, .8):
        box(t, 'metal', (x, -2.1, 2.58), (.6, .7, .1), 'DARK', 0)
    crate(t, (-.55, -2.12, 2.72), (.7, .6, .3), 'CANVAS')
    roll(t, (.15, -2.35, 2.66), (.95, -2.35, 2.66), .16, 'OLIVE')
    antenna(t, (-.95, -2.0, 2.5), 2.0)
    box(t, 'paint', (0, 1.85, 2.08), (.95, .5, .66), 'SLATE', .06)
    g = Node('barrel', t, (0, 2.05, 2.08))
    cyl(g, 'metal', (0, 1.85, 2.08), (0, 5.3, 2.08), .15, .13, tint='GUN', n=12)
    for y0, y1 in ((2.4, 3.0), (3.6, 4.3)):
        cyl(g, 'paint', (0, y0, 2.08), (0, y1, 2.08), .19, tint='OLIVE', n=12, bw=.02)
    cyl(g, 'metal', (0, 3.1, 2.08), (0, 3.45, 2.08), .24, .2, tint='GUN', n=12, bw=.03)
    box(g, 'metal', (0, 5.38, 2.08), (.44, .5, .36), 'DARK', .05)
    muzzle(g, (0, 5.66, 2.08))


def jotun():
    u = Unit('jotun', 'vehicle', 'winter')
    r = u.root
    for s in (-1, 1):
        tn = Node('track_left' if s < 0 else 'track_right', r, (s * 1.95, 0, .6))
        track(s, s * 1.45, .85, 6.8, .56, 6, node=tn)
        track(s, s * 2.42, .85, 6.4, .52, 5, node=tn)
    box(r, 'paint', (0, 0, 1.0), (2.2, 6.4, .9), 'SLATE', .08)
    prism(r, 'paint', [(-3.4, 1.08), (3.1, 1.08), (3.6, 1.45), (2.2, 2.05), (-3.2, 2.05), (-3.45, 1.6)], -2.95, 2.95, bw=.1, camo=True)
    for s in (-1, 1):
        prism(r, 'paint', [(-3.3, .72), (3.0, .72), (3.4, 1.2), (-3.4, 1.2)], s * 2.92, s * 3.06, bw=.03, camo=True)
        box(r, 'culture_trim', (s * 3.08, -.2, .96), (.05, 5.0, .34), bw=.02)
        for y in (-2.4, -.8, .8, 2.4):
            box(r, 'metal', (s * 3.02, y, 1.35), (.16, .12, .22), 'GUN', .02)
    for s in (-1, 1):
        box(r, 'culture_trim', (s * .75, 2.75, 1.78), (1.2, .28, .05), bw=.01, rot=(-.4, 0, s * .4))
        cyl(r, 'metal', (s * 1.6, -3.0, 2.0), (s * 1.6, -3.0, 3.1), .2, tint='DARK', n=8)
        cyl(r, 'metal', (s * 1.6, -3.0, 3.1), (s * 1.6, -3.0, 3.2), .26, tint='GUN', n=8)
        headlights(r, 3.05, 1.72, [s * 2.2])
        for k in range(3):
            box(r, 'metal', (s * (.6 + k * .5), 3.52, 1.05), (.14, .5, .35), 'GUN', .02)
    box(r, 'culture_trim', (0, -2.6, 2.07), (2.3, 1.0, .04), bw=.02)
    for s in (-1, 1):
        crate(r, (s * 2.3, -1.2, 2.3), (.8, 1.6, .5), 'OLIVE', 'paint')
        jerrycan(r, (s * 2.45, .4, 2.3), 'OLIVE')
        jerrycan(r, (s * 2.45, .95, 2.3), 'SLATE')
    for k in range(4):
        box(r, 'metal', (-.9 + k * .6, 2.9, 1.95), (.5, .3, .1), 'GUN', .02, rot=(-.42, 0, 0))
    for i in range(7):
        box(r, 'metal', (0, -1.95 - i * .12, 2.08), (1.8, .05, .04), 'DARK', 0)
    t = Node('turret', r, (0, -.3, 2.05))
    box(t, 'paint', (0, -.3, 2.55), (3.3, 3.8, 1.0), bw=.14, segs=2, taper=(.84, .84), camo=True)
    box(t, 'paint', (0, 1.9, 2.48), (3.0, 1.0, .82), bw=.1, taper=(.82, .4), shift=(0, -.2), camo=True)
    for s in (-1, 1):
        box(t, 'culture_trim', (s * 1.56, -.4, 2.5), (.06, 3.0, .5), bw=.02, rot=(0, s * .16, 0))
        for i in range(4):
            box(t, 'paint', (s * (.4 + i * .36), 2.3, 2.25), (.3, .3, .3), 'SLATE', .04, rot=(-.5, 0, 0))
    box(t, 'culture_trim', (0, -1.3, 3.06), (2.0, 1.3, .04), bw=.02)
    for x in (-.7, .7):
        cyl(t, 'paint', (x, .1, 3.05), (x, .1, 3.35), .38, .32, tint='SLATE', n=10, bw=.03)
        cyl(t, 'metal', (x, .1, 3.35), (x, .1, 3.4), .28, tint='GUN', n=10)
    box(t, 'glass', (0, .8, 3.14), (.5, .4, .24), 'GLASS', .04)
    crate(t, (0, -2.35, 2.9), (2.4, .7, .4), 'CANVAS')
    antenna(t, (-1.2, -2.0, 3.0), 2.2)
    antenna(t, (1.2, -2.0, 3.0), 1.4)
    box(t, 'paint', (0, 2.3, 2.5), (1.8, .5, .7), 'SLATE', .06)
    g = Node('barrel', t, (0, 2.5, 2.5))
    for x in (-.5, .5):
        cyl(g, 'metal', (x, 2.3, 2.5), (x, 6.4, 2.5), .17, .15, tint='GUN', n=12)
        cyl(g, 'paint', (x, 3.0, 2.5), (x, 4.0, 2.5), .22, tint='OLIVE', n=12, bw=.02)
        cyl(g, 'metal', (x, 4.3, 2.5), (x, 4.7, 2.5), .26, .22, tint='GUN', n=12)
        box(g, 'metal', (x, 6.5, 2.5), (.46, .55, .4), 'DARK', .05)
    box(g, 'metal', (0, 3.5, 2.5), (1.0, .3, .2), 'GUN', .03)
    muzzle(g, (0, 6.8, 2.5))


def lynx():
    u = Unit('lynx', 'vehicle', 'winter')
    r = u.root
    R = .66
    for name, y in (('wheel_front', 1.95), ('wheel_mid', .15), ('wheel_rear', -1.65)):
        axle(name, y, R, R, .56, (-1.34, 1.34))
    box(r, 'metal', (0, 0, .9), (2.0, 5.2, .5), 'GUN', .05)
    box(r, 'paint', (0, -.1, 1.62), (2.75, 5.6, 1.1), bw=.12, segs=2, taper=(.9, .93), camo=True)
    prism(r, 'paint', [(2.55, 1.07), (3.2, 1.3), (3.05, 1.72), (2.2, 2.17), (2.2, 1.07)], -1.3, 1.3, bw=.1, camo=True)
    for s in (-1, 1):
        for y in (1.95, .15, -1.65):
            box(r, 'paint', (s * 1.42, y, 1.4), (.62, 1.45, .12), 'SLATE', .04)
        box(r, 'culture_trim', (s * 1.3, -.25, 1.66), (.06, 3.4, .56), bw=.03, rot=(0, s * .08, 0))
        box(r, 'glass', (s * 1.18, .7, 2.08), (.06, .5, .16), 'GLASS', .02, rot=(0, s * .3, 0))
        box(r, 'glass', (s * 1.18, -.5, 2.08), (.06, .5, .16), 'GLASS', .02, rot=(0, s * .3, 0))
        headlights(r, 3.1, 1.52, [s * .95])
        box(r, 'metal', (s * .6, 3.25, 1.15), (.3, .2, .2), 'GUN', .03)
        jerrycan(r, (s * .95, -3.05, 1.6), 'OLIVE')
    box(r, 'culture_trim', (0, 2.45, 2.2), (1.3, .8, .04), bw=.02, rot=(-.2, 0, 0))
    box(r, 'metal', (0, -3.02, 1.55), (1.1, .12, .9), 'SLATE', .04)
    crate(r, (-.55, -2.0, 2.28), (.8, 1.2, .34), 'CANVAS')
    roll(r, (.2, -2.4, 2.26), (1.0, -2.4, 2.26), .17, 'OLIVE')
    antenna(r, (-1.0, -2.6, 2.2), 1.9)
    t = Node('turret', r, (0, .35, 2.18))
    cyl(t, 'metal', (0, .35, 2.14), (0, .35, 2.28), .82, tint='GUN', n=12)
    box(t, 'paint', (0, .3, 2.55), (1.6, 1.9, .56), bw=.1, segs=2, taper=(.8, .78), camo=True)
    box(t, 'culture_trim', (0, -.05, 2.84), (.8, .9, .04), bw=.02)
    for s in (-1, 1):
        for i in range(3):
            cyl(t, 'metal', (s * .7, .9 - i * .16, 2.45), (s * .85, 1.05 - i * .16, 2.6), .06, tint='DARK', n=6)
    box(t, 'glass', (.5, .6, 2.9), (.28, .3, .2), 'GLASS', .03)
    box(t, 'metal', (.5, .6, 2.86), (.34, .36, .1), 'GUN', .02)
    box(t, 'paint', (0, 1.3, 2.52), (.6, .4, .44), 'SLATE', .05)
    g = Node('barrel', t, (0, 1.45, 2.54))
    cyl(g, 'metal', (0, 1.3, 2.54), (0, 3.65, 2.54), .085, tint='GUN', n=8)
    cyl(g, 'metal', (0, 1.45, 2.54), (0, 2.1, 2.54), .15, tint='OLIVE', n=8)
    cyl(g, 'metal', (0, 3.5, 2.54), (0, 3.85, 2.54), .13, tint='DARK', n=8)
    muzzle(g, (0, 3.9, 2.54))


def harvester():
    u = Unit('harvester', 'vehicle', 'hearth')
    r = u.root
    R = .76
    for name, y in (('wheel_front', 2.35), ('wheel_mid', -1.0), ('wheel_rear', -2.55)):
        axle(name, y, R, R, .64, (-1.5, 1.5), n=15)
    box(r, 'metal', (0, -.2, 1.2), (2.2, 7.0, .5), 'GUN', .05)
    # Cab: chunky, forward, red timber accent roof.
    box(r, 'paint', (0, 2.55, 2.15), (2.9, 2.0, 1.5), bw=.14, segs=2, taper=(.94, .9), camo=True)
    box(r, 'paint', (0, 2.45, 3.0), (2.8, 1.9, .2), 'RED', .06)
    box(r, 'glass', (0, 3.52, 2.45), (2.3, .08, .62), 'GLASS', .03, rot=(-.25, 0, 0))
    for s in (-1, 1):
        box(r, 'glass', (s * 1.38, 2.7, 2.45), (.06, 1.1, .56), 'GLASS', .02)
        box(r, 'culture_trim', (s * 1.46, 2.5, 1.9), (.06, 1.6, .7), bw=.03)
        box(r, 'metal', (s * 1.6, 3.35, 2.6), (.08, .12, .3), 'DARK', .02)
        box(r, 'paint', (s * 1.52, 2.35, 1.45), (.6, 1.6, .12), 'SLATE', .04)
        box(r, 'paint', (s * 1.52, -1.75, 1.6), (.6, 3.0, .12), 'SLATE', .04)
    headlights(r, 3.6, 1.72, [-1.0, 1.0])
    box(r, 'paint', (0, 3.08, 3.2), (.34, .3, .22), 'ORANGE', .04)
    box(r, 'light', (0, 3.08, 3.36), (.22, .2, .12), 'LAMP', .02)
    cyl(r, 'metal', (-1.2, 1.4, 2.0), (-1.2, 1.4, 3.7), .13, tint='DARK', n=8)
    cyl(r, 'metal', (-1.2, 1.4, 3.7), (-1.2, 1.4, 3.8), .18, tint='GUN', n=8)
    # Crusher drum: the harvester's signature front, with hazard stripes.
    for s in (-1, 1):
        box(r, 'metal', (s * 1.1, 3.9, 1.35), (.22, 1.3, .3), 'GUN', .03, rot=(-.35, 0, 0))
    cyl(r, 'metal', (-1.45, 4.45, .95), (1.45, 4.45, .95), .55, tint='STEEL', n=12, bw=.04)
    for i in range(12):
        a = i * math.pi / 6
        box(r, 'metal', (0, 4.45 + math.cos(a) * .58, .95 + math.sin(a) * .58), (2.8, .14, .14), 'GUN', 0, rot=(a, 0, 0))
    prism(r, 'paint', [(4.0, 1.35), (5.05, 1.35), (5.1, 1.7), (4.0, 1.9)], -1.6, 1.6, 'HAZ', .04)
    for i in range(6):
        box(r, 'paint', (-1.3 + i * .52, 4.6, 1.63), (.2, 1.15, .4), 'DARK', 0, rot=(0, .6, 0))
    # Open ore bin: separate floor and walls, ribs outside the load.
    bz = 1.55
    box(r, 'metal', (0, -1.3, bz - .1), (3.0, 4.4, .2), 'GUN', .04)
    box(r, 'paint', (0, -1.3, bz + .02), (2.6, 4.0, .04), 'DARK', 0)
    for s in (-1, 1):
        box(r, 'paint', (s * 1.4, -1.3, bz + .68), (.2, 4.4, 1.4), bw=.05, camo=True)
        box(r, 'paint', (0, -1.3 + s * 2.1, bz + .68), (3.0, .2, 1.4), bw=.05, camo=True)
        box(r, 'culture_trim', (s * 1.52, -1.3, bz + .75), (.05, 3.3, .78), bw=.03)
        for y in (-3.1, -1.3, .5):
            box(r, 'metal', (s * 1.53, y, bz + .68), (.1, .16, 1.42), 'GUN', .02)
        box(r, 'paint', (s * 1.4, -1.3, bz + 1.42), (.34, 4.5, .1), 'RED', .02)
    for i in range(5):
        box(r, 'metal', (-1.62, -3.4 + i * .18, 1.0 + i * .28), (.08, .5, .06), 'STEEL', 0)
    cyl(r, 'metal', (1.2, -2.0, 1.05), (1.2, -.2, 1.05), .3, tint='STEEL', n=10)
    box(r, 'paint', (0, -3.62, 1.2), (2.4, .12, .35), 'HAZ', .02)
    # Ironstone load: grows from the bin floor; the renderer scales local Y.
    cargo = Node('cargo_fill', r, (0, -1.3, bz + .04), mesh=True, occluder=False)
    import random
    rng = random.Random(372)
    nx, ny, W, D = 7, 10, 1.26, 1.96
    grid = []
    verts, faces = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x, y = (i / nx * 2 - 1) * W, (j / ny * 2 - 1) * D
            edge = max(abs(x) / W, abs(y) / D)
            z = .85 + (1 - edge) * .42 + rng.uniform(-.1, .1)
            verts.append(Vector((x, y - 1.3, bz + .04 + z)))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    rim = list(range(nx + 1)) + [j * (nx + 1) + nx for j in range(1, ny + 1)] + \
        [ny * (nx + 1) + i for i in range(nx - 1, -1, -1)] + [j * (nx + 1) for j in range(ny - 1, 0, -1)]
    base = len(verts)
    verts += [Vector((verts[i].x, verts[i].y, bz + .04)) for i in rim]
    for i, a in enumerate(rim):
        k = (i + 1) % len(rim)
        faces.append((a, rim[k], base + k, base + i))
    faces.append(tuple(range(base, base + len(rim))))
    bm = bmesh.new()
    bv = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([bv[i] for i in f])
    emit(cargo, bm, Matrix.Identity(4), 'harvester_ore', 'WHITE')
    palette = [T[k] for k in ('RUST', 'UMBER', 'BRASS', 'IRON', 'RUST')]
    cargo.ftint = [palette[rng.randrange(5)] * rng.uniform(.8, 1.1) for _ in cargo.faces]
    for i in range(9):
        p = (rng.uniform(-1, 1), rng.uniform(-3.0, .4), bz + 1.05 + rng.uniform(0, .3))
        ball(cargo, 'harvester_ore', p, (rng.uniform(.22, .34),) * 3, rng.choice(['RUST', 'BRASS', 'IRON']), 6, 4,
             rot=(rng.uniform(0, 3), rng.uniform(0, 3), 0))


def howitzer():
    u = Unit('howitzer', 'vehicle', 'winter')
    r = u.root
    R = .74
    for name, y in (('wheel_front', 2.7), ('wheel_mid', -.85), ('wheel_rear', -2.35)):
        axle(name, y, R, R, .6, (-1.45, 1.45), n=15)
    box(r, 'metal', (0, 0, 1.2), (2.1, 6.4, .5), 'GUN', .05)
    box(r, 'paint', (0, 2.75, 2.1), (2.8, 1.9, 1.5), bw=.14, segs=2, taper=(.92, .86), camo=True)
    box(r, 'glass', (0, 3.68, 2.4), (2.2, .08, .56), 'GLASS', .03, rot=(-.3, 0, 0))
    for s in (-1, 1):
        box(r, 'glass', (s * 1.34, 2.9, 2.4), (.06, 1.0, .5), 'GLASS', .02)
        box(r, 'culture_trim', (s * 1.42, 2.7, 1.85), (.06, 1.5, .6), bw=.03)
        box(r, 'paint', (s * 1.5, 2.7, 1.5), (.6, 1.5, .12), 'SLATE', .04)
        box(r, 'paint', (s * 1.5, -1.6, 1.62), (.6, 2.8, .12), 'SLATE', .04)
        box(r, 'metal', (s * .9, -3.35, .9), (.7, .25, 1.0), 'STEEL', .03, rot=(.5, 0, 0))
        headlights(r, 3.72, 1.75, [s * .95])
    box(r, 'culture_trim', (0, 2.6, 2.86), (1.8, 1.2, .04), bw=.02)
    t = Node('turret', r, (0, -1.3, 1.6))
    box(t, 'paint', (0, -1.3, 2.38), (2.75, 3.6, 1.35), bw=.14, segs=2, taper=(.86, .9), camo=True)
    for s in (-1, 1):
        box(t, 'culture_trim', (s * 1.3, -1.4, 2.35), (.06, 3.0, .56), bw=.03, rot=(0, s * .1, 0))
        box(t, 'metal', (s * 1.15, .05, 2.6), (.3, .6, .6), 'GUN', .04)
    box(t, 'culture_trim', (0, -2.0, 3.08), (1.6, 1.4, .04), bw=.02)
    for i in range(4):
        cyl(t, 'metal', (-.9 + i * .6, -3.15, 2.2), (-.9 + i * .6, -3.15, 2.9), .12, tint='BRASS', n=8)
    antenna(t, (-1.0, -2.8, 3.05), 1.6)
    box(t, 'paint', (0, .45, 2.6), (1.1, .7, .8), 'SLATE', .06)
    elev = math.radians(12)
    d = Vector((0, math.cos(elev), math.sin(elev)))
    pv = Vector((0, .55, 2.65))
    g = Node('barrel', t, tuple(pv), rot=(elev, 0, 0))
    cyl(g, 'metal', pv - d * .6, pv + d * 6.2, .17, .14, tint='GUN', n=12)
    cyl(g, 'paint', pv + d * .3, pv + d * 1.6, .27, .24, tint='OLIVE', n=12, bw=.03)
    cyl(g, 'metal', pv + d * 6.1, pv + d * 6.7, .26, tint='DARK', n=8, bw=.04)
    muzzle(g, tuple(pv + d * 6.8))


def mortar():
    u = Unit('mortar', 'vehicle', 'iron', camo_scale=1.3)
    r = u.root
    for s in (-1, 1):
        track(s, s * 1.5, .92, 5.3, .5, 5)
    box(r, 'paint', (0, 0, 1.0), (2.3, 5.1, .9), 'IRON', .08)
    prism(r, 'paint', [(-2.65, 1.05), (2.45, 1.05), (2.85, 1.35), (2.3, 1.95), (-2.55, 1.95), (-2.75, 1.55)], -2.05, 2.05, bw=.1, camo=True)
    for s in (-1, 1):
        box(r, 'paint', (s * 2.08, 0, .98), (.14, 4.9, .6), 'IRON', .04)
        box(r, 'culture_trim', (s * 2.17, .1, 1.0), (.05, 3.8, .42), bw=.02)
        for y in (-2.1, -1.0, .1, 1.2, 2.3):
            ball(r, 'metal', (s * 2.17, y, 1.28), (.05,) * 3, 'BRASS', 5, 3)
            ball(r, 'metal', (s * 2.17, y, .72), (.05,) * 3, 'BRASS', 5, 3)
        headlights(r, 2.62, 1.72, [s * 1.4])
    # Forge stack and shell racks: Ironclad industry.
    cyl(r, 'metal', (1.4, -2.2, 1.9), (1.4, -2.2, 3.4), .22, .18, tint='DARK', n=8)
    cyl(r, 'metal', (1.4, -2.2, 3.4), (1.4, -2.2, 3.55), .3, tint='RUST', n=8)
    for i in range(5):
        cyl(r, 'metal', (-1.5 + i * .32, -2.35, 1.95), (-1.5 + i * .32, -2.35, 2.55), .12, tint='BRASS', n=8)
        cyl(r, 'paint', (-1.5 + i * .32, -2.35, 2.55), (-1.5 + i * .32, -2.35, 2.75), .12, .03, tint='ORANGE', n=8)
    box(r, 'metal', (-.86, -2.35, 2.1), (1.7, .4, .3), 'DARK', .03)
    box(r, 'culture_trim', (-.3, -1.55, 1.97), (2.4, .7, .04), bw=.02)
    for s in (-1, 1):
        box(r, 'culture_trim', (s * 1.1, 2.3, 1.72), (1.0, .3, .05), bw=.01, rot=(-.6, 0, 0))
    t = r  # hull-aimed: the whole siege mortar turns to fire
    cyl(t, 'metal', (0, .2, 1.95), (0, .2, 2.3), 1.55, tint='GUN', n=16, bw=.05)
    prism(t, 'paint', [(.8, 2.3), (1.9, 2.3), (1.7, 3.2), (.95, 3.3)], -1.45, 1.45, bw=.06, camo=True)
    for s in (-1, 1):
        box(t, 'paint', (s * 1.2, .1, 2.8), (.18, 1.8, 1.0), 'IRON', .05, taper=(1, .8))
        box(t, 'culture_trim', (s * 1.3, .1, 2.8), (.05, 1.4, .56), bw=.02)
        box(t, 'metal', (s * .7, .15, 2.75), (.25, .5, .9), 'STEEL', .04)
    box(t, 'culture_trim', (0, 1.5, 3.18), (1.8, .5, .04), bw=.02, rot=(-.35, 0, 0))
    elev = math.radians(50)
    d = Vector((0, math.cos(elev), math.sin(elev)))
    pv = Vector((0, .15, 2.85))
    g = Node('barrel', t, tuple(pv), rot=(elev, 0, 0))
    cyl(g, 'metal', pv - d * .8, pv + d * 2.3, .44, .4, tint='IRON', n=14, bw=.04)
    for k in (-.4, .6, 1.6):
        cyl(g, 'metal', pv + d * k, pv + d * (k + .22), .5, tint='GUN', n=14, bw=.03)
    cyl(g, 'metal', pv + d * 2.2, pv + d * 2.6, .52, .56, tint='DARK', n=14, bw=.04)
    cyl(g, 'culture_trim', pv + d * .9, pv + d * 1.4, .47, n=14)
    ball(g, 'metal', pv - d * .8, (.46, .46, .46), 'IRON', 10, 5)
    muzzle(g, tuple(pv + d * 2.65))


def bulwark():
    u = Unit('bulwark', 'vehicle', 'hearth')
    r = u.root
    for s in (-1, 1):
        track(s, s * 1.5, .95, 5.2, .55, 5)
    box(r, 'paint', (0, 0, 1.0), (2.2, 5.0, .9), 'UMBER', .08)
    # Tractor hood forward, armoured cab behind.
    box(r, 'paint', (0, .2, 1.5), (4.0, 5.2, .45), bw=.1, camo=True)
    box(r, 'paint', (0, 1.35, 2.15), (2.0, 2.4, 1.0), bw=.3, segs=2, taper=(.85, .95), camo=True)
    for i in range(5):
        box(r, 'metal', (0, .7 + i * .3, 2.66), (1.4, .1, .05), 'DARK', 0)
    box(r, 'paint', (0, -1.25, 2.55), (2.6, 2.1, 1.7), bw=.14, segs=2, taper=(.88, .85), camo=True)
    box(r, 'paint', (0, -1.3, 3.45), (2.8, 2.4, .16), 'RED', .06)
    for s in (-1, 1):
        box(r, 'glass', (s * 1.2, -1.05, 2.9), (.06, 1.1, .5), 'GLASS', .02, rot=(0, s * .12, 0))
        box(r, 'culture_trim', (s * 1.27, -1.3, 2.25), (.06, 1.9, .55), bw=.03, rot=(0, s * .1, 0))
        box(r, 'culture_trim', (s * 2.02, .2, 1.5), (.05, 4.4, .3), bw=.02)
        box(r, 'metal', (s * 1.2, 2.9, 1.35), (.26, 1.6, .3), 'STEEL', .04, rot=(.2, 0, 0))
        lamp(r, (s * .75, 2.58, 2.2))
    box(r, 'glass', (0, -.2, 2.9), (1.9, .07, .5), 'GLASS', .02, rot=(.15, 0, 0))
    cyl(r, 'metal', (.75, 1.9, 2.5), (.75, 1.9, 3.8), .13, tint='DARK', n=8)
    cyl(r, 'metal', (.75, 1.9, 3.8), (.75, 2.05, 3.95), .16, tint='GUN', n=8)
    # Plough blade: curved, hazard-striped, wider than the hull.
    prof = [(3.35 + .5 * math.sin(a / 8 * math.pi) ** 2 * 0 + .35 * (1 - math.sin(a / 8 * math.pi)), .12 + a * .23) for a in range(9)]
    prof = prof + [(p[0] - .22, p[1]) for p in reversed(prof)]
    prism(r, 'metal', prof, -2.35, 2.35, 'GUN', .05)
    for i in range(10):
        x = -2.1 + i * .47
        box(r, 'paint', (x, 3.72, 1.0), (.26, .06, 1.9), 'HAZ' if i % 2 else 'DARK', 0, rot=(0, .5, 0))
    box(r, 'culture_trim', (0, 3.82, 2.0), (4.6, .12, .16), bw=.02)
    for i in range(7):
        box(r, 'metal', (-1.8 + i * .6, 3.8, .08), (.18, .3, .16), 'STEEL', .02)
    crate(r, (-1.1, -2.2, 2.0), (.8, .7, .6), 'WHITE', 'wood')
    crate(r, (.9, -2.35, 1.95), (.7, .6, .5), 'WHITE', 'wood')
    t = Node('turret', r, (0, -1.35, 3.53))
    cyl(t, 'metal', (0, -1.35, 3.5), (0, -1.35, 3.68), .7, tint='GUN', n=12)
    box(t, 'paint', (0, -.9, 3.95), (1.1, .12, .6), 'UMBER', .03)
    box(t, 'metal', (0, -1.3, 3.9), (.3, .8, .3), 'DARK', .03)
    g = Node('barrel', t, (0, -.9, 3.95))
    cyl(g, 'metal', (0, -1.0, 3.95), (0, .5, 3.95), .07, tint='DARK', n=6)
    cyl(g, 'metal', (0, .4, 3.95), (0, .65, 3.95), .1, tint='DARK', n=6)
    muzzle(g, (0, .7, 3.95))


def snowmobile():
    u = Unit('snowmobile', 'vehicle', 'fjord', dirt=.6)
    r = u.root
    # One wide rear track, split into two rig halves.
    for s in (-1, 1):
        track(s, s * .38, .74, 3.0, .34, 4, z0=.02, rise=.16)
    for s in (-1, 1):
        box(r, 'metal', (s * .9, 2.35, .08), (.36, 2.1, .1), 'STEEL', .03)
        box(r, 'metal', (s * .9, 3.4, .3), (.36, .5, .1), 'STEEL', .03, rot=(-.8, 0, 0))
        cyl(r, 'metal', (s * .9, 2.2, .1), (s * .6, 1.9, .95), .06, tint='DARK', n=6)
        box(r, 'culture_trim', (s * .78, 1.8, .95), (.08, 1.7, .42), bw=.03, rot=(0, s * .25, 0))
    box(r, 'paint', (0, -.2, .72), (1.8, 3.6, .36), bw=.08, camo=True)
    prism(r, 'paint', [(.9, .72), (3.0, .72), (2.9, 1.0), (1.8, 1.55), (.9, 1.62)], -.82, .82, bw=.12, camo=True)
    box(r, 'culture_trim', (0, 1.9, 1.42), (1.2, .9, .05), bw=.02, rot=(-.5, 0, 0))
    box(r, 'glass', (0, 1.02, 1.85), (1.2, .06, .5), 'GLASS', .02, rot=(-.4, 0, 0))
    lamp(r, (0, 2.95, .95), (.5, .08, .2))
    box(r, 'cloth', (0, .1, 1.05), (.7, 1.5, .28), 'DARK', .1)
    crew(r, (0, .3, 1.0), .95, 'SNOW', lean=.15)
    box(r, 'cloth', (0, -1.75, 1.05), (1.3, .8, .36), 'CANVAS', .06)
    jerrycan(r, (.5, -1.8, 1.45), 'RED', math.pi / 2)
    t = Node('turret', r, (0, -.9, .95))
    cyl(t, 'metal', (0, -.9, .9), (0, -.9, 1.95), .07, tint='DARK', n=6)
    crew(t, (0, -1.35, 1.35), .95, 'SNOW', arms=False)
    for s in (-1, 1):
        cyl(t, 'culture_trim', (s * .44, -1.35, 2.02), (s * .16, -.62, 2.0), .12, .1, n=7)
    box(t, 'metal', (0, -.8, 2.05), (.5, .1, .4), 'SLATE', .03)
    g = Node('barrel', t, (0, -.7, 2.12))
    box(g, 'metal', (0, -.75, 2.12), (.16, .6, .2), 'GUN', .03)
    cyl(g, 'metal', (0, -.5, 2.14), (0, .55, 2.14), .05, tint='DARK', n=6)
    box(g, 'metal', (.14, -.7, 2.06), (.1, .24, .14), 'OLIVE', .02)
    muzzle(g, (0, .6, 2.14))


def fenrir():
    u = Unit('fenrir', 'vehicle', 'ash')
    r = u.root
    R = .7
    for name, y in (('wheel_front', 1.75), ('wheel_rear', -1.6)):
        axle(name, y, R, R, .58, (-1.3, 1.3))
    box(r, 'metal', (0, 0, .95), (1.9, 4.8, .45), 'GUN', .05)
    # Open-topped tub: floor, walls, sloped engine hood.
    box(r, 'paint', (0, -.6, 1.35), (2.4, 3.3, .5), bw=.1, camo=True)
    for s in (-1, 1):
        box(r, 'paint', (s * 1.12, -.6, 1.95), (.16, 3.3, .8), bw=.05, camo=True)
        box(r, 'culture_trim', (s * 1.22, -.55, 1.7), (.06, 2.5, .6), bw=.03)
        for y in (1.75, -1.6):
            box(r, 'paint', (s * 1.34, y, 1.45), (.66, 1.4, .12), 'UMBER', .04)
    box(r, 'paint', (0, -2.2, 1.95), (2.4, .16, .8), bw=.05, camo=True)
    prism(r, 'paint', [(1.05, 1.1), (2.75, 1.1), (2.75, 1.45), (1.05, 2.0)], -1.18, 1.18, bw=.1, camo=True)
    box(r, 'culture_trim', (0, 1.85, 1.8), (1.2, 1.1, .04), bw=.02, rot=(-.34, 0, 0))
    box(r, 'metal', (0, 1.05, 2.3), (2.1, .08, .55), 'DARK', .02, rot=(-.3, 0, 0))
    box(r, 'glass', (0, 1.08, 2.32), (1.9, .05, .42), 'GLASS', 0, rot=(-.3, 0, 0))
    for s in (-1, 1):
        lamp(r, (s * .8, 2.8, 1.32))
        cyl(r, 'metal', (s * 1.05, -2.0, 1.6), (s * 1.05, .4, 2.85), .05, tint='DARK', n=6)
    cyl(r, 'metal', (-1.05, .4, 2.85), (1.05, .4, 2.85), .05, tint='DARK', n=6)
    crew(r, (-.5, .45, 1.35), .9, 'SAND')
    # Telescopic sensor mast with an optics head: Ashwalker long sight.
    cyl(r, 'metal', (.75, -1.75, 1.6), (.75, -1.75, 3.2), .12, tint='DARK', n=8)
    cyl(r, 'metal', (.75, -1.75, 3.2), (.75, -1.75, 4.4), .08, tint='STEEL', n=8)
    box(r, 'paint', (.75, -1.7, 4.55), (.7, .4, .36), 'SAND', .06)
    cyl(r, 'glass', (.55, -1.5, 4.55), (.55, -1.44, 4.55), .12, tint='GLASS', n=8)
    cyl(r, 'glass', (.95, -1.5, 4.55), (.95, -1.44, 4.55), .12, tint='GLASS', n=8)
    box(r, 'culture_trim', (.75, -1.9, 4.55), (.72, .06, .3), bw=.02)
    # Flare launcher box and spare wheel.
    box(r, 'metal', (-.7, -1.75, 2.45), (.8, .7, .45), 'GUN', .04, rot=(.4, 0, 0))
    for i in range(3):
        for k in range(2):
            cyl(r, 'paint', (-.95 + i * .25, -1.5, 2.45 + k * .2), (-.95 + i * .25, -1.44 + .1, 2.62 + k * .2), .07, tint='ORANGE', n=6)
    cyl(r, 'rubber', (0, -2.3, 1.95), (0, -2.55, 1.95), .5, tint='TYRE', n=12)
    for s in (-1, 1):
        jerrycan(r, (s * 1.25, .5, 1.6), 'SAND')
    t = Node('turret', r, (.35, -.9, 1.9))
    ring(t, 'metal', (.35, -.9, 2.3), .7, .56, .1, 'DARK', 14)
    cyl(t, 'metal', (.35, -.9, 1.9), (.35, -.4, 2.5), .05, tint='DARK', n=6)
    box(t, 'metal', (.35, -.2, 2.72), (.9, .08, .5), 'SAND', .03)
    crew(t, (.35, -1.2, 1.4), .9, 'SAND', arms=False)
    g = Node('barrel', t, (.35, -.35, 2.8))
    box(g, 'metal', (.35, -.45, 2.8), (.2, .7, .24), 'GUN', .03)
    cyl(g, 'metal', (.35, -.2, 2.82), (.35, 1.05, 2.82), .06, tint='DARK', n=6)
    box(g, 'metal', (.5, -.45, 2.72), (.14, .3, .2), 'OLIVE', .02)
    muzzle(g, (.35, 1.1, 2.82))


def drone():
    u = Unit('drone', 'air', 'winter', dirt=0, ao=.7, ground=False)
    r = u.root
    # Hugin, the raven: dark body, beak sensor, four ducted fans.
    ball(r, 'paint', (0, 0, .78), (.72, 1.3, .42), 'SLATE', 12, 6)
    box(r, 'culture_trim', (0, -.1, 1.1), (.7, 1.4, .14), bw=.05, taper=(.7, .85))
    cyl(r, 'paint', (0, .95, .75), (0, 1.75, .7), .28, .04, tint='DARK', n=8)
    ball(r, 'glass', (0, .95, .55), (.24, .24, .22), 'GLASS', 8, 5)
    for s in (-1, 1):
        box(r, 'paint', (s * .4, -1.25, .82), (.36, .7, .06), 'DARK', .02, rot=(0, 0, s * .4))
    for name, x, y in (('fl', 1, 1), ('fr', -1, 1), ('rl', 1, -1), ('rr', -1, -1)):
        px, py = x * 1.45, y * 1.25
        cyl(r, 'paint', (x * .35, y * .3, .8), (px, py, .85), .09, tint='SLATE', n=6)
        ring(r, 'paint', (px, py, .86), .78, .66, .26, 'SNOW', 16)
        ring(r, 'culture_trim', (px, py, 1.0), .8, .64, .05, None, 16)
        for a in range(3):
            ang = a * 2 * math.pi / 3
            cyl(r, 'metal', (px, py, .8), (px + math.cos(ang) * .68, py + math.sin(ang) * .68, .8), .025, tint='DARK', n=4)
        cyl(r, 'metal', (px, py, .7), (px, py, .92), .14, tint='GUN', n=8)
        rp = Node('rotor_pivot_' + name, r, (px, py, .92), occluder=False)
        for k in range(3):
            ang = k * 2 * math.pi / 3 + .3
            box(rp, 'paint', (px + math.cos(ang) * .32, py + math.sin(ang) * .32, .92), (.6, .12, .03), 'DARK', .01,
                rot=(.25, 0, ang))
        cyl(rp, 'metal', (px, py, .9), (px, py, .98), .1, tint='STEEL', n=8)
        cyl(r, 'metal', (x * .5, y * .45, .55), (x * .55, y * .5, .03), .035, tint='DARK', n=4)
    for s in (-1, 1):
        box(r, 'metal', (s * .55, 0, .03), (.07, 1.4, .06), 'DARK', .01)
    ball(r, 'metal', (0, .55, .4), (.2, .2, .18), 'GUN', 8, 5)
    g = Node('barrel', r, (0, .65, .38))
    cyl(g, 'metal', (0, .6, .38), (0, 1.25, .38), .045, tint='DARK', n=6)
    muzzle(g, (0, 1.3, .38))


def gunship():
    u = Unit('gunship', 'air', 'winter', camo_scale=.9, dirt=0, ao=1.2, ground=False)
    r = u.root
    # Fuselage: long tapered body, stepped tandem canopy, engine nacelles.
    box(r, 'paint', (0, .4, 1.55), (1.7, 4.6, 1.5), bw=.2, segs=2, taper=(.8, .92), camo=True)
    box(r, 'paint', (0, 3.1, 1.3), (1.3, 1.4, 1.0), bw=.18, segs=2, taper=(.75, .6), shift=(0, -.2), camo=True)
    cyl(r, 'paint', (0, 3.75, 1.2), (0, 4.3, 1.1), .45, .15, tint='SLATE', n=8)
    box(r, 'glass', (0, 2.45, 2.28), (1.0, 1.1, .6), 'GLASS', .1, segs=2, taper=(.8, .7))
    box(r, 'glass', (0, 1.35, 2.5), (1.05, 1.0, .7), 'GLASS', .1, segs=2, taper=(.8, .7))
    box(r, 'paint', (0, .9, 2.4), (1.2, .2, .9), 'SLATE', .04)
    prism(r, 'paint', [(-1.6, 1.3), (-.2, 1.2), (-.2, 2.1), (-1.4, 1.9)], -.45, .45, bw=.05, camo=True)
    box(r, 'paint', (0, -3.8, 1.75), (.62, 5.0, .6), bw=.12, taper=(.7, 1), camo=True)
    prism(r, 'paint', [(-6.4, 1.5), (-5.7, 1.6), (-6.0, 3.0), (-6.65, 3.1)], -.1, .1, bw=.04, camo=True)
    box(r, 'culture_trim', (0, -6.2, 2.4), (.24, .5, .7), bw=.02, rot=(.2, 0, 0))
    box(r, 'paint', (0, -5.3, 1.8), (2.2, .6, .1), 'SLATE', .03)
    for s in (-1, 1):
        cyl(r, 'paint', (s * .82, 1.3, 2.35), (s * .82, -1.2, 2.35), .42, .36, tint='SNOW', n=10, bw=.04)
        cyl(r, 'metal', (s * .82, -1.2, 2.35), (s * .82, -1.5, 2.35), .3, tint='DARK', n=10)
        box(r, 'culture_trim', (s * .82, .1, 2.8), (.5, 1.8, .04), bw=.02)
        box(r, 'culture_trim', (s * .72, .3, 1.35), (.06, 2.8, .7), bw=.03, rot=(0, s * .2, 0))
        # Stub wing, rocket pod and a missile rail.
        box(r, 'paint', (s * 1.55, .1, 1.7), (1.8, 1.0, .14), 'SLATE', .04)
        box(r, 'culture_trim', (s * 1.75, .1, 1.78), (.9, .7, .03), bw=.01)
        cyl(r, 'paint', (s * 1.7, 1.0, 1.35), (s * 1.7, -.7, 1.35), .3, tint='OLIVE', n=10, bw=.04)
        cyl(r, 'metal', (s * 1.7, 1.0, 1.35), (s * 1.7, 1.08, 1.35), .26, tint='DARK', n=10)
        for k in range(2):
            cyl(r, 'paint', (s * 2.35, .9 - k * .0, 1.5 - k * .3), (s * 2.35, -.4, 1.5 - k * .3), .09, tint='SNOW', n=6)
            cyl(r, 'paint', (s * 2.35, .9, 1.5 - k * .3), (s * 2.35, 1.2, 1.5 - k * .3), .09, .02, tint='ORANGE', n=6)
        # Landing skids.
        box(r, 'metal', (s * .95, .6, .06), (.12, 4.0, .1), 'DARK', .03)
        box(r, 'metal', (s * .95, 2.65, .2), (.12, .4, .1), 'DARK', .03, rot=(.7, 0, 0))
        for y in (1.6, -.6):
            cyl(r, 'metal', (s * .95, y, .08), (s * .6, y, 1.0), .05, tint='DARK', n=5)
    cyl(r, 'metal', (0, -.1, 2.6), (0, -.1, 3.25), .2, tint='DARK', n=8)
    rp = Node('rotor_pivot', r, (0, -.1, 3.3), occluder=False)
    cyl(rp, 'metal', (0, -.1, 3.2), (0, -.1, 3.45), .36, tint='GUN', n=8)
    for k in range(4):
        a = k * math.pi / 2 + .4
        c, s_ = math.cos(a), math.sin(a)
        box(rp, 'paint', (c * 2.75, -.1 + s_ * 2.75, 3.32), (5.0, .36, .06), 'DARK', .02, rot=(0, .06, a))
        box(rp, 'culture_trim', (c * 5.0, -.1 + s_ * 5.0, 3.34), (.5, .38, .07), bw=.01, rot=(0, 0, a))
    mount = Node('tail_rotor_mount', r, (.18, -6.3, 2.45), rot=(0, -math.pi / 2, 0), occluder=False)
    tr = Node('rotor_pivot_tail', mount, (.18, -6.3, 2.45), rot=(0, -math.pi / 2, 0), occluder=False)
    cyl(tr, 'metal', (.1, -6.3, 2.45), (.32, -6.3, 2.45), .12, tint='GUN', n=8)
    for k in range(4):
        a = k * math.pi / 2
        box(tr, 'paint', (.3, -6.3 + math.cos(a) * .55, 2.45 + math.sin(a) * .55), (.04, .18, 1.1), 'DARK', .01, rot=(-a + math.pi / 2, 0, 0))
    ball(r, 'metal', (0, 3.2, .7), (.34, .34, .3), 'GUN', 10, 6)
    g = Node('barrel', r, (0, 3.45, .62))
    cyl(g, 'metal', (0, 3.35, .62), (0, 4.6, .62), .06, tint='DARK', n=6)
    cyl(g, 'metal', (0, 3.4, .62), (0, 3.9, .62), .11, tint='GUN', n=6)
    muzzle(g, (0, 4.65, .62))


BUILDERS = dict(ranger=ranger, rocket=rocket, harvester=harvester, lynx=lynx, tank=tank, howitzer=howitzer,
                jotun=jotun, drone=drone, gunship=gunship, raider=raider, snowmobile=snowmobile, sapper=sapper,
                mortar=mortar, militia=militia, bulwark=bulwark, marksman=marksman, fenrir=fenrir)


# ---------------------------------------------------------------- baking
def hemisphere(n=24):
    dirs = []
    g = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - (i + .5) / n
        rr = math.sqrt(1 - z * z)
        dirs.append(Vector((math.cos(i * g) * rr, math.sin(i * g) * rr, z)))
    return dirs


HEMI = hemisphere()


def newell(vs):
    n = Vector()
    for i in range(len(vs)):
        a, b = vs[i], vs[(i + 1) % len(vs)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))


def hash3(p):
    v = math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453
    return v - math.floor(v)


def settle(u):
    """Lift the model so its lowest point (tyre lugs, cleats) sits on the ground."""
    low = min(v.z for n in u.nodes for v in n.verts)
    lift = .004 - low
    if abs(lift) < 1e-4 or (u.category == 'air' and low > 0):
        return
    for n in u.nodes:
        n.W = Matrix.Translation((0, 0, lift)) @ n.W
        n.verts = [v + Vector((0, 0, lift)) for v in n.verts]


def bake(u):
    """Ambient occlusion from the rest pose, plus sun-bleached tops and road dirt."""
    allv, allf = [], []
    for n in u.nodes:
        if not n.occluder:
            continue
        off = len(allv)
        allv += n.verts
        allf += [[i + off for i in f] for f in n.faces]
    bvh = BVHTree.FromPolygons(allv, allf, all_triangles=False)
    maxd = u.ao
    for n in u.nodes:
        fn = [newell([n.verts[i] for i in f]) for f in n.faces]
        vn = [Vector() for _ in n.verts]
        for f, nr in zip(n.faces, fn):
            for i in f:
                vn[i] += nr
        ao = []
        for p, v in zip(n.verts, vn):
            nn = v.normalized() if v.length > 1e-6 else Vector((0, 0, 1))
            t = nn.orthogonal().normalized()
            b = nn.cross(t)
            o = p + nn * .012
            occ = tot = 0.
            for d in HEMI:
                dd = t * d.x + b * d.y + nn * d.z
                hit = bvh.ray_cast(o, dd, maxd)[0] is not None
                if not hit and u.ground and dd.z < -1e-3:
                    hit = -o.z / dd.z < maxd
                occ += d.z * hit
                tot += d.z
            ao.append(1 - .72 * occ / tot)
        cols = []
        for f, nr, tint, mat in zip(n.faces, fn, n.ftint, n.fmat):
            for i in f:
                p = n.verts[i]
                k = ao[i] * (.9 + .1 * max(0, nr.z)) * (.95 + .05 * hash3(p))
                c = Vector((tint.x * k, tint.y * k, tint.z * k))
                if u.dirt and mat not in ('glass', 'light', 'skin') and p.z < u.dirt:
                    w = ((u.dirt - p.z) / u.dirt) ** 1.4 * .6
                    c = Vector((c.x * (1 - w + w * MUD.x), c.y * (1 - w + w * MUD.y), c.z * (1 - w + w * MUD.z)))
                cols.append((min(1, c.x), min(1, c.y), min(1, c.z), 1))
        n.cols = cols


def realize(u):
    objs = {}
    root_obj = None
    stats = {'tris': 0, 'meshes': 0}
    for n in u.nodes:
        B = C @ n.W @ CI
        if n.mesh:
            obj = bpy.data.objects.new(n.name, bpy.data.meshes.new(n.name))
        else:
            obj = bpy.data.objects.new(n.name, None)
            obj.empty_display_size = .25
        bpy.context.scene.collection.objects.link(obj)
        if n.parent:
            obj.parent = objs[id(n.parent)]
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.matrix_basis = (C @ n.parent.W @ CI).inverted() @ B
        else:
            obj.matrix_basis = B
            root_obj = obj
        objs[id(n)] = obj
        if not n.faces:
            continue
        if n.mesh:
            target = obj
        else:
            label = 'geo_body' if n.parent is None else 'geo_' + n.name
            target = bpy.data.objects.new(label, bpy.data.meshes.new(label))
            bpy.context.scene.collection.objects.link(target)
            target.parent = obj
            target.matrix_parent_inverse = Matrix.Identity(4)
        L = C @ n.W.inverted()
        me = target.data
        me.from_pydata([L @ v for v in n.verts], [], n.faces)
        mats = []
        for m in n.fmat:
            if m not in mats:
                mats.append(m)
        for m in mats:
            me.materials.append(MATS[m])
        me.polygons.foreach_set('material_index', [mats.index(m) for m in n.fmat])
        attr = me.color_attributes.new('Surface', 'BYTE_COLOR', 'CORNER')
        flat = [c for col in n.cols for c in col]
        attr.data.foreach_set('color', flat)
        me.color_attributes.active_color = attr
        me.update()
        stats['tris'] += sum(len(f) - 2 for f in n.faces)
        stats['meshes'] += len(mats)
    for k, v in u.extras.items():
        root_obj[k] = v
    root_obj['tactical_kind'] = u.kind
    u.obj = root_obj
    u.stats = stats
    return root_obj


def tree(obj):
    return [obj, *obj.children_recursive]


def export(u):
    bpy.ops.object.select_all(action='DESELECT')
    for o in tree(u.obj):
        o.select_set(True)
    bpy.context.view_layer.objects.active = u.obj
    path = MODELS / (u.kind + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_yup=True,
                              export_extras=True, export_vertex_color='NAME', export_vertex_color_name='Surface',
                              export_all_vertex_colors=False, export_texcoords=False, export_apply=False,
                              export_animations=False)
    u.stats['bytes'] = path.stat().st_size


def bounds(obj):
    pts = []
    for o in tree(obj):
        if o.type == 'MESH':
            pts += [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector(tuple(min(p[i] for p in pts) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in pts) for i in range(3)))
    return lo, hi


# ---------------------------------------------------------------- build all
units = []
for kind in ONLY:
    BUILDERS[kind]()
    u = U
    settle(u)
    bake(u)
    realize(u)
    bpy.context.view_layer.update()
    if not FLAGS.get('no-export'):
        export(u)
    lo, hi = bounds(u.obj)
    rig = sorted({o.name for o in tree(u.obj) if o.type == 'EMPTY' and o is not u.obj})
    print('UNIT %s tris=%d meshes=%d bytes=%s size=(%.2f w, %.2f l, %.2f h) minz=%.3f rig=%s extras=%s' % (
        kind, u.stats['tris'], u.stats['meshes'], u.stats.get('bytes'), hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, lo.z,
        ','.join(rig), dict(u.extras)), flush=True)
    for o in tree(u.obj):
        o.name = kind + ':' + o.name
        if o.type == 'MESH':
            o.data.name = o.name
    units.append(u)

if not FLAGS.get('no-save'):
    for u in units:
        trim_preview(False)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)

# ---------------------------------------------------------------- rendering
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = True
    scene.cycles.device = 'GPU'
except Exception as err:  # CPU fallback
    print('GPU unavailable', err)
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Punchy'
except TypeError:
    pass
world = bpy.data.worlds.new('Golden hour')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (.36, .5, .78, 1)
bg.inputs[1].default_value = .55


def sun(name, rot, energy, color, angle):
    d = bpy.data.lights.new(name, 'SUN')
    d.energy, d.color, d.angle = energy, color, angle
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.rotation_euler = rot
    return o


# Low warm key from the front-left, cool rim from behind.
sun('Key', (math.radians(64), 0, math.radians(-38)), 4.2, (1, .76, .5), math.radians(4))
sun('Rim', (math.radians(62), 0, math.radians(160)), 1.6, (.62, .76, 1), math.radians(8))

cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
scene.collection.objects.link(cam)
scene.camera = cam


def show_only(targets):
    keep = {o for u in targets for o in tree(u.obj)}
    for u in units:
        for o in tree(u.obj):
            o.hide_render = o not in keep


def look(camobj, eye, target):
    camobj.location = eye
    camobj.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()


catcher = None


def portraits():
    global catcher
    bpy.ops.mesh.primitive_plane_add(size=60)
    catcher = bpy.context.object
    catcher.is_shadow_catcher = True
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = 256, 192
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 64
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    cam.data.type = 'ORTHO'
    for u in units:
        trim_preview(True, TRIM_PREVIEW[FACTION.get(u.kind, 'core')])
        show_only([u])
        lo, hi = bounds(u.obj)
        centre = (lo + hi) / 2
        view = Vector((.62, -1.0, .78)).normalized()
        look(cam, centre + view * 30, centre)
        bpy.context.view_layer.update()
        inv = cam.matrix_world.inverted()
        pts = [inv @ (o.matrix_world @ v.co) for o in tree(u.obj) if o.type == 'MESH' for v in o.data.vertices]
        x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
        y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
        cam.location = cam.matrix_world @ Vector(((x0 + x1) / 2, (y0 + y1) / 2, 0))
        cam.data.ortho_scale = max(x1 - x0, (y1 - y0) * 256 / 192) * 1.1
        scene.render.filepath = str(ICONS / (u.kind + '.png'))
        bpy.ops.render.render(write_still=True)
    catcher.hide_render = True


def ground_material():
    m = bpy.data.materials.new('sheet_ground')
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes['Principled BSDF']
    bs.inputs['Roughness'].default_value = .95
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 30
    noise.inputs['Detail'].default_value = 6
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = .42, tuple(rgb('6f5c45')) + (1,)
    el[1].position, el[1].color = .58, tuple(rgb('5f6b3e')) + (1,)
    e = el.new(.66)
    e.color = tuple(rgb('efe9dc')) + (1,)
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bs.inputs['Base Color'])
    return m


def sheet(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.mesh.primitive_plane_add(size=400)
    g = bpy.context.object
    g.data.materials.append(ground_material())
    scene.render.film_transparent = False
    scene.cycles.samples = 48
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(44)
    trim_preview(True, TRIM_PREVIEW['core'])
    # Per-faction paint for the review sheet only (after export).
    for u in units:
        m = MATS['culture_trim'].copy()
        c = tuple(rgb(TRIM_PREVIEW[FACTION.get(u.kind, 'core')])) + (1,)
        m.node_tree.nodes['Preview multiply'].inputs['A'].default_value = c
        m.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = c
        for o in tree(u.obj):
            if o.type == 'MESH':
                for i, s in enumerate(o.data.materials):
                    if s and s.name.startswith('culture_trim'):
                        o.data.materials[i] = m
    show_only(units)
    cols = 6
    for i, u in enumerate(units):
        u.obj.location = ((i % cols - (cols - 1) / 2) * 12.5, (1 - i // cols) * 12.5, 4.5 if u.category == 'air' else 0)
        u.obj.rotation_euler = (0, 0, math.radians(35))
    pitch = math.radians(50)
    for dist, name, res in ((66, 'sheet-play.png', (1920, 1080)), (36, 'sheet-close.png', (1920, 1080))):
        scene.render.resolution_x, scene.render.resolution_y = res
        look(cam, (0, -dist * math.cos(pitch), dist * math.sin(pitch)), (0, 0, 0))
        scene.render.filepath = str(out / name)
        bpy.ops.render.render(write_still=True)
    # Per-unit inspection shots from the game angle, for the tiled review sheet.
    scene.render.resolution_x, scene.render.resolution_y = 480, 360
    for u in units:
        u.obj.location = (0, 0, 0)
        u.obj.rotation_euler = (0, 0, math.radians(35))
        bpy.context.view_layer.update()
        show_only([u])
        lo, hi = bounds(u.obj)
        c = (lo + hi) / 2
        size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
        dist = size * 1.25 + 2
        look(cam, c + Vector((0, -dist * math.cos(pitch), dist * math.sin(pitch))), c)
        scene.render.filepath = str(out / ('tile-' + u.kind + '.png'))
        bpy.ops.render.render(write_still=True)


if not FLAGS.get('no-portraits'):
    portraits()
if FLAGS.get('sheet'):
    sheet(FLAGS['sheet'])
print('Diorama troops complete: %d units.' % len(units), flush=True)
