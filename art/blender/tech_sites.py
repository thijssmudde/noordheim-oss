"""Neutral tech sites, in the "living diorama" style of diorama_buildings.py.

Three capturable structures that stand at contested midpoints (lib/tactical-sites.ts),
plus the unarmed recon plane an airstrip launches:

  derrick        an oil derrick: a lattice tower with crown block, a rocking pumpjack,
                 storage tanks with a painted band, pipe runs, a pump shed and drums
  fieldHospital  a field hospital: a white marquee ward with red crosses, a timber
                 triage hut, an ambulance under a canopy, stretchers and a cross flag
  airstrip       a forward airstrip: a short asphalt strip with markings and lights,
                 an arched hangar, a parked high-wing recon plane, windsock and fuel
  recon          the recon plane on its own, origin at its centre of mass, nose +Z

They share the buildings' modular kit, vertex-colour bake and export. `culture_trim`
carries the holder's colour (neutral grey while nobody holds the site). Models face
+Z (Blender -Y) with their origin at ground centre and stay inside the footprints in
TECH_SITES. Rig nodes: `pump` (the pumpjack beam, rocks about X), `light_*` (lamps),
`flag` (waves), `prop` (the recon plane's propeller, spins about Z).

Run:  pnpm art:tactical tech-sites
  or  Blender -b --factory-startup -P art/blender/tech_sites.py
  or, without Blender, the `bpy` 4.5 wheel:  python3.11 art/blender/tech_sites.py
Writes public/models/tactical/sites/<kind>.glb and public/art/tactical/sites/<kind>.png.
"""
import math, os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import diorama_buildings as d  # noqa: E402
from diorama_buildings import Kit, yard, hazard, house  # noqa: E402

d.OUT = d.ROOT / 'public/models/tactical/sites'
d.ICONS = d.ROOT / 'public/art/tactical/sites'
KINDS = ['derrick', 'fieldHospital', 'airstrip', 'recon']


def lattice(k, x, y, z0, h, w0, w1, levels=7, paint='iron'):
    """A tapering four-legged lattice tower with X bracing between levels."""
    def corner(sx, sy, t):
        w = w0 + (w1 - w0) * t
        return (x + sx * w / 2, y + sy * w / 2, z0 + h * t)
    legs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for sx, sy in legs:
        k.bar(corner(sx, sy, 0), corner(sx, sy, 1), .16, paint)
    for i in range(levels):
        t0, t1 = i / levels, (i + 1) / levels
        for j in range(4):
            a, b = legs[j], legs[(j + 1) % 4]
            k.bar(corner(*a, t1), corner(*b, t1), .1, paint)
            if i % 2:
                k.bar(corner(*a, t0), corner(*b, t1), .07, paint)
            else:
                k.bar(corner(*b, t0), corner(*a, t1), .07, paint)


def build_derrick(k):
    yard(k, 9.6, 9.6, 0, 0, 'gravel')
    k.slab(4.6, 4.6, .3, (-1.4, .6, .14), 'concrete')
    # the derrick: a lattice tower, a working floor and the crown block
    tx, ty = -1.4, .6
    k.box((3.6, 3.6, .14), (tx, ty, 1.3), 'wood', bevel=.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.2, .2, .9), (tx + sx * 1.6, ty + sy * 1.6, .88), 'iron', 'metal', bevel=0)
    lattice(k, tx, ty, 1.37, 9.4, 3.0, .7)
    k.box((1.3, 1.3, .3), (tx, ty, 10.9), 'iron', 'metal', bevel=.03)
    k.cyl(.36, .5, (tx, ty, 11.3), 'steel', 'metal', n=10, rot=(math.pi / 2, 0, 0))
    k.box((1.0, .18, .5), (tx, ty - .7, 10.75), 'trim', 'trim', bevel=0)
    k.box((.22, .22, .22), (tx, ty, 11.7), 'orange', 'lamp', bevel=0)
    k.empty('light', (tx, ty, 11.8))
    k.tube((tx, ty, 10.7), (tx, ty, 2.0), .03, 'steel_lt', 'metal', n=4)
    k.cyl(.2, .9, (tx, ty, 1.82), 'steel', 'metal', n=10)
    k.box((2.6, .9, .7), (tx + .2, ty + 1.9, 1.72), 'timber', bevel=.04)
    k.box((2.8, 1.1, .1), (tx + .2, ty + 1.9, 2.12), 'snow', bevel=.03)
    k.ladder((tx + 1.55, ty - 1.5, 1.37), 7.5)
    # pumpjack in front: a sampson post, a rocking beam with a horse head, a crank
    px, py = 2.6, -2.4
    k.box((3.4, 1.2, .3), (px, py, .29), 'concrete', bevel=.04)
    for sx in (-1, 1):
        k.bar((px - .6, py + sx * .35, .44), (px, py, 2.4), .14, 'iron')
        k.bar((px + .6, py + sx * .35, .44), (px, py, 2.4), .14, 'iron')
    prev = k.rig('pump', (px, py, 2.5))
    k.box((3.4, .32, .4), (px, py, 2.62), 'trim', 'trim', bevel=.04)
    k.poly([(0, -.7), (.5, -.75), (.75, .2), (.2, .45), (0, .35)], -.22, .22,
           at=(px - 1.7, py, 2.62), paint='iron', surf='metal', rot=(0, 0, math.pi))
    k.tube((px - 2.3, py, 2.0), (px - 2.3, py, .5), .03, 'steel_lt', 'metal', n=4)
    k.end(prev)
    k.cyl(.55, .3, (px + 1.3, py - .5, 1.0), 'iron', 'metal', n=14, rot=(math.pi / 2, 0, 0))
    k.box((.9, .5, .6), (px + 1.3, py + .1, .74), 'olive', bevel=.05)
    k.cyl(.12, .4, (px - 2.3, py, .5), 'steel', 'metal', n=8)
    # storage tanks with the holder's band, joined by a pipe run
    for x, y, r, h in ((1.9, 3.0, 1.1, 2.7), (3.9, 1.6, .9, 2.2)):
        k.cyl(r, h, (x, y, .14 + h / 2), 'cream', n=18, bevel=.04)
        k.cyl(r + .03, .34, (x, y, .14 + h * .62), 'trim', 'trim', n=18, bevel=0)
        k.cyl(r * .96, .14, (x, y, .14 + h + .06), 'snow', n=18, bevel=.04)
        k.ladder((x - r - .05, y, .14), h, math.pi / 2)
    k.tube((1.9, 1.9, .5), (tx + .8, ty + .2, .5), .12, 'steel', 'metal', n=8)
    k.tube((3.9, .7, .5), (px + .6, py + 1.2, .5), .12, 'steel', 'metal', n=8)
    k.tube((1.9, 1.9, .5), (3.9, 1.6, .5), .1, 'rust', 'metal', n=8)
    # pump shed, drums and a floodlight
    house(k, -3.4, -2.9, 2.2, 1.8, 1.9, .9, z0=.14, ridge='x', faces='fl', rows=[1.1], win=(.6, .6),
          door=(.4, .8, 1.6), spacing=1.4)
    k.drums((-.9, -3.9, .14), 4, 'rust')
    k.drums((-4.3, 3.6, .14), 3)
    k.floodlight((4.0, -4.0, .14), 4.6, face=2.4)
    k.post_lamp((-4.4, -.6, .14), 2.4)
    k.flag((-4.3, 1.4, .14), 4.4, 1.4, .9)
    k.drift((3.9, 4.3, .14), .9, .5, .25)
    k.drift((-3.6, 4.5, .14), 1.0, .4, .2)


def build_fieldHospital(k):
    yard(k, 10.6, 9.6, 0, 0, 'gravel')
    # the ward: a long white marquee on a timber floor, red crosses on both slopes
    wx, wy, L, W = -.8, 1.6, 6.4, 3.6
    k.box((L + .4, W + .4, .16), (wx, wy, .22), 'wood', bevel=.02)
    for s in (-1, 1):
        k.box((L, W * .62, .1), (wx, wy + s * W * .25, 2.3), 'white', bevel=.03, rot=(-s * .62, 0, 0), dense=.9)
        k.box((L, .1, 1.5), (wx, wy + s * W / 2, .98), 'canvas', bevel=.02, dense=.9)
    for u in (-L / 2, L / 2):
        k.poly([(-W / 2, .3), (W / 2, .3), (W / 2, 1.7), (0, 3.25), (-W / 2, 1.7)], -.05, .05,
               at=(wx + u, wy, 0), paint='canvas', rot=(0, 0, math.pi / 2))
    k.box((L + .2, .12, .12), (wx, wy, 3.28), 'wood_dk', bevel=0)
    for s in (-1, 1):
        for u in (-1.6, 1.6):
            k.push((wx + u, wy + s * W * .25, 2.35), 0)
            k.box((1.3, 1.3, .04), (0, s * .03, .06), 'white', bevel=0, rot=(-s * .62, 0, 0))
            k.box((1.0, .32, .05), (0, s * .03, .08), 'medic', bevel=0, rot=(-s * .62, 0, 0))
            k.box((.32, 1.0, .05), (0, s * .03, .08), 'medic', bevel=0, rot=(-s * .62, 0, 0))
            k.pop()
    k.box((1.4, .1, 2.0), (wx, wy - W / 2 - .02, 1.15), 'canvas_dk', bevel=0)
    k.box((1.6, .1, .3), (wx, wy - W / 2 - .06, 2.25), 'trim', 'trim', bevel=0)
    for u in (-2.4, 2.4):
        k.cyl(.05, 3.0, (wx + u, wy - W / 2 - .6, 1.6), 'wood_dk', n=6, bevel=0)
        k.tube((wx + u, wy - W / 2 - .6, 3.0), (wx + u, wy - W / 2 - 1.3, .2), .015, 'iron', 'metal', n=4)
    # timber triage hut with a lamp and a stove chimney
    house(k, 3.6, -1.8, 2.6, 2.4, 2.2, 1.2, z0=.14, ridge='y', faces='fl', rows=[1.2], win=(.6, .7),
          door=(0, .9, 1.8), spacing=1.4)
    k.chimney(4.3, -1.0, 2.6, 4.0, .45, .45)
    k.push((3.6, -3.0, .14))
    for dx in (-.55, .55):
        k.box((.8, .1, .8), (dx, -.04, 2.0), 'white', bevel=0)
    k.box((.5, .12, .16), (0, -.12, 2.0), 'medic', bevel=0)
    k.box((.16, .12, .5), (0, -.12, 2.0), 'medic', bevel=0)
    k.pop()
    # ambulance under a canopy in the holder's colour
    ax, ay = -3.0, -2.8
    k.box((3.4, 2.4, .1), (ax, ay, 2.7), 'trim', 'trim', bevel=.02)
    k.box((3.2, 2.2, .1), (ax, ay, 2.8), 'snow', bevel=.04)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((.12, .12, 2.6), (ax + sx * 1.55, ay + sy * 1.05, 1.44), 'iron', 'metal', bevel=0)
    k.box((2.4, 1.3, 1.3), (ax + .3, ay, 1.15), 'white', bevel=.08)
    k.box((.9, 1.3, 1.0), (ax - 1.25, ay, 1.0), 'white', bevel=.08)
    k.box((.5, 1.32, .5), (ax - 1.4, ay, 1.3), 'glass', 'glass', bevel=.02)
    k.box((.7, 1.34, .22), (ax + .3, ay, 1.15), 'medic', bevel=0)
    k.box((.22, 1.34, .7), (ax + .3, ay, 1.15), 'medic', bevel=0)
    for x in (ax - 1.2, ax + 1.0):
        for sy in (-1, 1):
            k.cyl(.3, .22, (x, ay + sy * .62, .45), 'rubber', n=10, rot=(math.pi / 2, 0, 0))
    k.box((.14, .14, .14), (ax - .5, ay, 1.88), 'lamp', 'lamp', bevel=0)
    k.empty('light', (ax - .5, ay, 1.95))
    # stretchers, supply crates, a cross flag and a lantern post
    for i in range(3):
        x = -4.6 + i * .8
        k.box((.6, 1.9, .08), (x, 3.9, .62), 'canvas', bevel=.02)
        for sy in (-1, 1):
            k.box((.06, .06, .5), (x, 3.9 + sy * .8, .38), 'iron', 'metal', bevel=0)
    for i in range(3):
        k.box((.8, .6, .5), (4.5, 1.6 + i * .8, .39), 'white', bevel=.04)
        k.box((.4, .62, .12), (4.5, 1.6 + i * .8, .4), 'medic', bevel=0)
    k.flag((3.6, 4.2, .14), 4.6, 1.5, .95)
    k.post_lamp((.8, -4.2, .14), 2.6)
    k.drums((-4.8, .6, .14), 2, 'olive')
    k.drift((1.8, 4.3, .14), 1.2, .5, .22)


def recon_plane(k, at=(0, 0, 0), heading=0.0, group=None):
    """A small high-wing recon monoplane; nose along -Y of the frame."""
    k.push(at, heading)
    k.box((.9, 4.2, .9), (0, 0, 0), 'olive', bevel=.25, seg=2, taper=(.7, .9), group=group)
    k.box((.7, .9, .55), (0, -.9, .55), 'glass', 'glass', bevel=.12, group=group)
    k.box((7.6, 1.1, .12), (0, -.6, .82), 'olive', bevel=.05, group=group)
    for sx in (-1, 1):
        k.box((.9, .9, .13), (sx * 3.4, -.6, .83), 'trim', 'trim', bevel=.02, group=group)
        k.bar((sx * .4, -.6, -.3), (sx * 1.9, -.6, .78), .06, 'iron', group=group)
    k.box((2.6, .7, .1), (0, 2.0, .1), 'olive', bevel=.04, group=group)
    k.box((.1, .8, .9), (0, 2.1, .5), 'olive', bevel=.04, group=group)
    k.box((.12, .5, .5), (0, 2.2, .5), 'trim', 'trim', bevel=0, group=group)
    k.cyl(.32, .3, (0, -2.15, 0), 'iron', 'metal', n=10, rot=(math.pi / 2, 0, 0), group=group)
    prev = k.rig('prop', (0, -2.35, 0)) if group is None else None
    k.box((2.0, .06, .18), (0, -2.35, 0), 'wood_dk', bevel=0, group=group, rot=(0, .4, 0))
    if prev is not None:
        k.end(prev)
    for sx in (-1, 1):
        k.bar((sx * .2, -.8, -.4), (sx * .9, -.9, -1.0), .06, 'iron', group=group)
        k.cyl(.22, .14, (sx * .9, -.9, -1.05), 'rubber', n=10, rot=(0, math.pi / 2, 0), group=group)
    k.cyl(.12, .1, (0, 1.9, -.45), 'rubber', n=8, rot=(0, math.pi / 2, 0), group=group)
    k.pop()


def build_airstrip(k):
    yard(k, 12.0, 11.0, 0, 0, 'gravel')
    # the strip: asphalt with a centre line, threshold bars and edge lights
    sy = -1.6
    k.box((11.6, 3.6, .08), (0, sy, .18), 'asphalt', bevel=0)
    for i in range(6):
        k.box((.9, .16, .02), (-4.2 + i * 1.7, sy, .23), 'white', bevel=0)
    for end in (-1, 1):
        for j in range(4):
            k.box((.12, .5, .02), (end * 5.2, sy - 1.2 + j * .8, .23), 'white', bevel=0)
    for i in range(7):
        for s in (-1, 1):
            k.box((.16, .16, .14), (-5.4 + i * 1.8, sy + s * 1.9, .26), 'lamp', 'lamp', bevel=0)
    k.empty('light', (-5.4, sy - 1.9, .4))
    k.empty('light', (5.4, sy + 1.9, .4))
    hazard(k, (-5.8, sy - 2.2, .2), (5.8, sy - 2.2, .2), .2)
    # the parked recon plane, on its wheels at the west end of the strip
    recon_plane(k, (-1.8, sy, 1.35), math.pi / 2, group='root')
    # arched hangar behind the strip, doors facing the strip
    hx, hy, R = 2.6, 3.2, 1.9
    for sxx in (-1, 1):
        k.box((.3, 3.6, .6), (hx + sxx * (R - .05), hy, .44), 'stone', bevel=.04)
    k.arch(R - .05, R + .1, hy - 1.8, hy + 1.8, at=(hx, 0, .74), seg=12, paint='zinc', surf='metal')
    k.arch(R + .1, R + .22, hy - 1.7, hy + 1.7, at=(hx, 0, .74), a0=math.radians(60),
           a1=math.radians(120), seg=4, paint='snow')
    pts = [(math.cos(math.pi * i / 12) * (R - .1), .6 + math.sin(math.pi * i / 12) * (R - .1)) for i in range(13)]
    k.poly(pts, -.08, .08, at=(hx, hy + 1.8, .14), paint='timber')
    k.box((2.6, .2, 2.1), (hx, hy - 1.82, 1.2), 'tar', bevel=0)
    k.box((2.4, .1, .36), (hx, hy - 1.9, 2.05), 'trim', 'trim', bevel=0)
    k.text('09', (hx, hy - 1.97, 1.25), .55, 'cream')
    # control hut with a lamp mast, windsock and a fuel bowser
    house(k, -4.0, 3.4, 2.4, 2.2, 2.0, 1.0, z0=.14, ridge='x', faces='fr', rows=[1.2], win=(.6, .6),
          door=(-.5, .8, 1.7), spacing=1.4)
    k.mast((-3.2, 4.0, 3.3), 2.4, guy=False)
    wx, wy = 5.4, -4.6
    k.cyl(.07, 3.6, (wx, wy, 1.94), 'steel_lt', 'metal', n=6, bevel=0)
    for i in range(4):
        k.cyl(.26 - i * .04, .34, (wx - .28 - i * .34, wy, 3.55 - i * .05), 'orange' if i % 2 == 0 else 'white',
              n=8, r2=.26 - (i + 1) * .04, rot=(0, -math.pi / 2 - .1, 0), bevel=0, caps=True)
    k.box((1.8, 1.0, .9), (-.4, 3.4, .74), 'olive', bevel=.08)
    k.cyl(.45, 1.5, (-.2, 3.4, 1.3), 'olive', n=12, rot=(0, math.pi / 2, 0))
    k.box((1.5, .1, .2), (-.2, 2.92, 1.3), 'trim', 'trim', bevel=0)
    k.drums((-5.4, -4.7, .14), 3)
    k.floodlight((5.1, 4.6, .14), 4.4, face=2.6)
    k.drift((-5.2, .9, .14), .8, .4, .2)


def build_recon(k):
    recon_plane(k, (0, 0, 0), 0.0)


BUILDERS = {
    'derrick': build_derrick,
    'fieldHospital': build_fieldHospital,
    'airstrip': build_airstrip,
    'recon': build_recon,
}


def main():
    only = [s for s in os.environ.get('DIORAMA_ONLY', '').split(',') if s]
    kinds = [k for k in KINDS if not only or k in only]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = d.materials()
    d.OUT.mkdir(parents=True, exist_ok=True)
    d.ICONS.mkdir(parents=True, exist_ok=True)
    cam, ground = d.setup_render()
    roots, report = [], []
    for kind in kinds:
        k = Kit(kind)
        BUILDERS[kind](k)
        root, meshes = d.realise(k, mats)
        ground.hide_render = True
        d.bake(root, meshes)
        ground.hide_render = False
        d.export(root)
        lo, hi = d.bounds(root)
        size = (d.OUT / f'{kind}.glb').stat().st_size
        report.append(f'{kind:14s} tris={d.triangles(root):6d} bytes={size:7d} '
                      f'x[{lo.x:.2f},{hi.x:.2f}] gltfZ[{-hi.y:.2f},{-lo.y:.2f}] y[{lo.z:.2f},{hi.z:.2f}] meshes={len(meshes)}')
        print(report[-1], flush=True)
        for other in roots:
            for o in [other, *other.children_recursive]:
                o.hide_render = True
        if kind != 'recon':
            d.render_portrait(cam, root)
        roots.append(root)
    sheet = os.environ.get('DIORAMA_SHEET')
    if sheet:
        Path(sheet).mkdir(parents=True, exist_ok=True)
        for root in roots:
            for other in roots:
                for o in [other, *other.children_recursive]:
                    o.hide_render = other is not root
            d.render_game_view(cam, (0, 0, 2), Path(sheet) / f"{root['tactical_kind']}.png", 40,
                               yaw=float(os.environ.get('DIORAMA_YAW', '0.35')))
    print('\n'.join(report))


main()
